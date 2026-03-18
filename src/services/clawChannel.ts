const DEFAULT_WS_URL = 'wss://gateway.clawlines.net/client';
const MAX_RECONNECT_ATTEMPTS = 6;

type ConnectionStatus = 'disconnected' | 'connecting' | 'connected' | 'reconnecting';

type OutboundPayload = {
  messageId: string;
  chatId: string;
  chatType: string;
  senderId: string;
  senderName: string;
  agentId?: string;
  messageType: string;
  content: string;
  mediaUrl?: string;
  mimeType?: string;
  timestamp: number;
};

export type InboundPacket = {
  type: string;
  data: {
    messageId?: string;
    content?: string;
    [key: string]: unknown;
  };
};

export type AgentInfo = {
  id: string;
  name: string;
  isDefault?: boolean;
  identityName?: string;
  identityEmoji?: string;
  model?: string;
};

type StatusListener = (status: ConnectionStatus) => void;
type MessageListener = (packet: InboundPacket) => void;

function createStableId(prefix: string) {
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

function buildSocketUrl(serverUrl: string, chatId?: string, agentId?: string, token?: string) {
  const base = serverUrl || DEFAULT_WS_URL;
  const parsed = new URL(base);
  if (chatId) parsed.searchParams.set('chatId', chatId);
  if (agentId) parsed.searchParams.set('agentId', agentId);
  if (token) parsed.searchParams.set('token', token);
  return parsed.toString();
}

let ws: WebSocket | null = null;
let connectionToken = 0;
let reconnectAttempts = 0;
let reconnectTimer: ReturnType<typeof setTimeout> | null = null;
let manualClose = false;
let currentStatus: ConnectionStatus = 'disconnected';

let currentServerUrl = '';
let currentChatId = '';
let currentSenderId = '';
let currentSenderName = '';
let currentAgentId = '';
let currentAuthToken = '';

const statusListeners = new Set<StatusListener>();
const messageListeners = new Set<MessageListener>();

function updateStatus(status: ConnectionStatus) {
  currentStatus = status;
  statusListeners.forEach((fn) => fn(status));
}

function clearReconnectTimer() {
  if (reconnectTimer) {
    clearTimeout(reconnectTimer);
    reconnectTimer = null;
  }
}

function scheduleReconnect() {
  if (reconnectAttempts >= MAX_RECONNECT_ATTEMPTS) {
    updateStatus('disconnected');
    return;
  }
  reconnectAttempts += 1;
  const delay = Math.min(1000 * 2 ** (reconnectAttempts - 1), 15000);
  updateStatus('reconnecting');
  clearReconnectTimer();
  reconnectTimer = setTimeout(() => {
    reconnectTimer = null;
    if (!manualClose) {
      connect({ chatId: currentChatId, senderId: currentSenderId, senderName: currentSenderName, serverUrl: currentServerUrl, agentId: currentAgentId, token: currentAuthToken });
    }
  }, delay);
}

export type ConnectOptions = {
  chatId?: string;
  senderId: string;
  senderName: string;
  serverUrl?: string;
  agentId?: string;
  token?: string;
};

export function connect(opts: ConnectOptions) {
  const nextServerUrl = opts.serverUrl || DEFAULT_WS_URL;
  const nextAgentId = opts.agentId || '';
  const nextChatId = opts.chatId || '';

  // If already connecting/connected to the exact same target, skip
  if (
    ws &&
    (ws.readyState === WebSocket.CONNECTING || ws.readyState === WebSocket.OPEN) &&
    currentChatId === nextChatId &&
    currentServerUrl === nextServerUrl &&
    currentAgentId === nextAgentId
  ) {
    return;
  }

  close(false);

  currentServerUrl = nextServerUrl;
  currentChatId = nextChatId;
  currentSenderId = opts.senderId;
  currentSenderName = opts.senderName;
  currentAgentId = nextAgentId;
  currentAuthToken = opts.token || '';
  manualClose = false;

  const token = ++connectionToken;
  updateStatus(reconnectAttempts > 0 ? 'reconnecting' : 'connecting');

  // When token auth is used and no explicit chatId, don't send chatId in URL — server assigns from token
  const socket = new WebSocket(buildSocketUrl(currentServerUrl, opts.chatId, opts.agentId, opts.token));
  ws = socket;

  socket.addEventListener('open', () => {
    if (connectionToken !== token || ws !== socket) return;
    reconnectAttempts = 0;
    updateStatus('connected');
    // Request agent list immediately on open (like h5-client)
    try { requestAgentList(); } catch { /* ignore */ }
  });

  socket.addEventListener('message', (event) => {
    if (connectionToken !== token || ws !== socket) return;
    try {
      const packet: InboundPacket = JSON.parse(event.data as string);
      // Update chatId from server response (server may assign/override based on token)
      if (packet.type === 'connection.open' && packet.data?.chatId) {
        currentChatId = packet.data.chatId as string;
      }
      messageListeners.forEach((fn) => fn(packet));
    } catch {
      // ignore malformed messages
    }
  });

  socket.addEventListener('close', () => {
    if (connectionToken !== token) return;
    ws = null;
    if (manualClose) {
      updateStatus('disconnected');
      return;
    }
    scheduleReconnect();
  });

  socket.addEventListener('error', () => {
    // error always followed by close — handled there
  });
}

export function close(manual = true) {
  manualClose = manual;
  clearReconnectTimer();
  connectionToken += 1;

  const socket = ws;
  ws = null;

  if (socket) {
    try {
      // Only send close frame if the socket is actually open
      if (socket.readyState === WebSocket.OPEN || socket.readyState === WebSocket.CONNECTING) {
        socket.close(1000, manual ? 'Manual close' : 'Connection replaced');
      }
    } catch {
      // ignore
    }
  }
  if (manual) {
    updateStatus('disconnected');
  }
}

export function sendRaw(packet: { type: string; data: Record<string, unknown> }) {
  if (!ws || ws.readyState !== WebSocket.OPEN) {
    throw new Error('Socket is not connected.');
  }
  ws.send(JSON.stringify(packet));
}

export function sendText(content: string, agentId?: string): OutboundPayload {
  if (!ws || ws.readyState !== WebSocket.OPEN) {
    throw new Error('Socket is not connected.');
  }

  const payload: OutboundPayload = {
    messageId: createStableId('msg'),
    chatId: currentChatId,
    chatType: 'direct',
    senderId: currentSenderId,
    senderName: currentSenderName,
    messageType: 'text',
    content,
    timestamp: Date.now(),
  };
  if (agentId || currentAgentId) {
    payload.agentId = agentId || currentAgentId;
  }

  ws.send(JSON.stringify({ type: 'message.receive', data: payload }));
  return payload;
}

export type MediaOptions = {
  messageType: 'image' | 'voice' | 'audio';
  content: string;
  mediaUrl: string;
  mimeType: string;
  agentId?: string;
};

export function sendMedia(opts: MediaOptions): OutboundPayload {
  if (!ws || ws.readyState !== WebSocket.OPEN) {
    throw new Error('Socket is not connected.');
  }

  const payload: OutboundPayload = {
    messageId: createStableId('msg'),
    chatId: currentChatId,
    chatType: 'direct',
    senderId: currentSenderId,
    senderName: currentSenderName,
    messageType: opts.messageType,
    content: opts.content,
    mediaUrl: opts.mediaUrl,
    mimeType: opts.mimeType,
    timestamp: Date.now(),
  };
  if (opts.agentId || currentAgentId) {
    payload.agentId = opts.agentId || currentAgentId;
  }

  ws.send(JSON.stringify({ type: 'message.receive', data: payload }));
  return payload;
}

export function requestAgentList() {
  sendRaw({
    type: 'agent.list.get',
    data: { requestId: createStableId('agent-list') },
  });
}

export function requestConversationList(agentId?: string) {
  sendRaw({
    type: 'conversation.list.get',
    data: {
      requestId: createStableId('conv-list'),
      agentId: agentId || currentAgentId || undefined,
    },
  });
}

export function requestHistory(chatId: string) {
  sendRaw({
    type: 'history.get',
    data: {
      requestId: createStableId('history'),
      chatId,
    },
  });
}

export function selectAgent(agentId: string | null) {
  currentAgentId = agentId || '';
  sendRaw({
    type: 'agent.select',
    data: {
      requestId: createStableId('agent-select'),
      agentId: agentId || null,
    },
  });
}

export function addReaction(messageId: string, emoji: string) {
  sendRaw({
    type: 'reaction.add',
    data: {
      messageId,
      chatId: currentChatId,
      senderId: currentSenderId,
      emoji,
      timestamp: Date.now(),
    },
  });
}

export function removeReaction(messageId: string, emoji: string) {
  sendRaw({
    type: 'reaction.remove',
    data: {
      messageId,
      chatId: currentChatId,
      senderId: currentSenderId,
      emoji,
      timestamp: Date.now(),
    },
  });
}

export function sendTextWithParent(content: string, parentId: string, agentId?: string): OutboundPayload {
  if (!ws || ws.readyState !== WebSocket.OPEN) {
    throw new Error('Socket is not connected.');
  }

  const payload: OutboundPayload & { parentId?: string } = {
    messageId: createStableId('msg'),
    chatId: currentChatId,
    chatType: 'direct',
    senderId: currentSenderId,
    senderName: currentSenderName,
    messageType: 'text',
    content,
    timestamp: Date.now(),
    parentId,
  };
  if (agentId || currentAgentId) {
    payload.agentId = agentId || currentAgentId;
  }

  ws.send(JSON.stringify({ type: 'message.receive', data: payload }));
  return payload;
}

// --- Message edit / delete ---

export function editMessage(messageId: string, newContent: string) {
  sendRaw({
    type: 'message.edit',
    data: {
      messageId,
      chatId: currentChatId,
      senderId: currentSenderId,
      content: newContent,
      timestamp: Date.now(),
    },
  });
}

export function deleteMessage(messageId: string) {
  sendRaw({
    type: 'message.delete',
    data: {
      messageId,
      chatId: currentChatId,
      senderId: currentSenderId,
      timestamp: Date.now(),
    },
  });
}

// --- Typing indicator ---

export function sendTyping(isTyping = true) {
  sendRaw({
    type: 'typing',
    data: {
      chatId: currentChatId,
      senderId: currentSenderId,
      isTyping,
      timestamp: Date.now(),
    },
  });
}

// --- File message ---

export function sendFile(opts: { content: string; mediaUrl: string; mimeType: string; fileName?: string; agentId?: string }): OutboundPayload {
  if (!ws || ws.readyState !== WebSocket.OPEN) {
    throw new Error('Socket is not connected.');
  }

  const payload: OutboundPayload = {
    messageId: createStableId('msg'),
    chatId: currentChatId,
    chatType: 'direct',
    senderId: currentSenderId,
    senderName: currentSenderName,
    messageType: 'file',
    content: opts.content || opts.fileName || 'File',
    mediaUrl: opts.mediaUrl,
    mimeType: opts.mimeType,
    timestamp: Date.now(),
  };
  if (opts.agentId || currentAgentId) {
    payload.agentId = opts.agentId || currentAgentId;
  }

  ws.send(JSON.stringify({ type: 'message.receive', data: payload }));
  return payload;
}

export function onMessage(fn: MessageListener) {
  messageListeners.add(fn);
  return () => { messageListeners.delete(fn); };
}

export function onStatus(fn: StatusListener) {
  statusListeners.add(fn);
  return () => { statusListeners.delete(fn); };
}

export function getStatus() {
  return currentStatus;
}
