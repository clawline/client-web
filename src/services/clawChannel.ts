import { getActiveConnectionId } from './connectionStore';

const DEFAULT_WS_URL = 'wss://gateway.clawlines.net/client';
const MAX_RECONNECT_ATTEMPTS = 6;
const MAX_ACTIVE_CONNECTIONS = 3;
const IDLE_TIMEOUT_MS = 5 * 60 * 1000;
const LEGACY_AGENT_CACHE_KEY = 'openclaw.agentList';
const LEGACY_STATUS_CACHE_KEY = 'openclaw.channelStatus';
const AGENT_CACHE_PREFIX = 'openclaw.agentList.';
const STATUS_CACHE_PREFIX = 'openclaw.channelStatus.';

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

export type ConversationSummary = {
  chatId: string;
  agentId?: string;
  senderName?: string;
  lastMessage?: string;
  timestamp?: number;
  unreadCount?: number;
};

export type ChannelStatus = ConnectionStatus;

type StatusListener = (status: ConnectionStatus) => void;
type MessageListener = (packet: InboundPacket) => void;

export type ConnectOptions = {
  connectionId?: string;
  chatId?: string;
  senderId: string;
  senderName: string;
  serverUrl?: string;
  agentId?: string;
  token?: string;
};

type ChannelInstance = {
  connectionId: string;
  ws: WebSocket | null;
  connectionToken: number;
  reconnectAttempts: number;
  reconnectTimer: ReturnType<typeof setTimeout> | null;
  idleTimer: ReturnType<typeof setTimeout> | null;
  manualClose: boolean;
  currentStatus: ConnectionStatus;
  currentServerUrl: string;
  currentChatId: string;
  currentSenderId: string;
  currentSenderName: string;
  currentAgentId: string;
  currentAuthToken: string;
  statusListeners: Set<StatusListener>;
  messageListeners: Set<MessageListener>;
  lastTouchedAt: number;
};

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

function getResolvedConnectionId(explicitConnectionId?: string) {
  return explicitConnectionId || getActiveConnectionId() || '';
}

function createInstance(connectionId: string): ChannelInstance {
  return {
    connectionId,
    ws: null,
    connectionToken: 0,
    reconnectAttempts: 0,
    reconnectTimer: null,
    idleTimer: null,
    manualClose: false,
    currentStatus: 'disconnected',
    currentServerUrl: '',
    currentChatId: '',
    currentSenderId: '',
    currentSenderName: '',
    currentAgentId: '',
    currentAuthToken: '',
    statusListeners: new Set<StatusListener>(),
    messageListeners: new Set<MessageListener>(),
    lastTouchedAt: 0,
  };
}

class ChannelManager {
  private instances = new Map<string, ChannelInstance>();

  get(connectionId?: string) {
    const resolved = getResolvedConnectionId(connectionId);
    if (!resolved) return null;
    let instance = this.instances.get(resolved);
    if (!instance) {
      instance = createInstance(resolved);
      this.instances.set(resolved, instance);
    }
    return instance;
  }

  private clearReconnectTimer(instance: ChannelInstance) {
    if (instance.reconnectTimer) {
      clearTimeout(instance.reconnectTimer);
      instance.reconnectTimer = null;
    }
  }

  private clearIdleTimer(instance: ChannelInstance) {
    if (instance.idleTimer) {
      clearTimeout(instance.idleTimer);
      instance.idleTimer = null;
    }
  }

  private touch(instance: ChannelInstance) {
    instance.lastTouchedAt = Date.now();
    this.scheduleIdleClose(instance);
  }

  private updateStatus(instance: ChannelInstance, status: ConnectionStatus) {
    instance.currentStatus = status;
    instance.statusListeners.forEach((fn) => fn(status));
  }

  private scheduleIdleClose(instance: ChannelInstance) {
    this.clearIdleTimer(instance);
    if (!instance.ws || instance.currentStatus === 'disconnected') {
      return;
    }

    instance.idleTimer = setTimeout(() => {
      this.closeInstance(instance, true);
    }, IDLE_TIMEOUT_MS);
  }

  private getOpenInstances(excludeConnectionId?: string) {
    return [...this.instances.values()].filter((instance) => {
      if (excludeConnectionId && instance.connectionId === excludeConnectionId) return false;
      return !!instance.ws && (
        instance.ws.readyState === WebSocket.OPEN ||
        instance.ws.readyState === WebSocket.CONNECTING
      );
    });
  }

  private enforcePoolLimit(targetConnectionId: string) {
    const openInstances = this.getOpenInstances();
    if (openInstances.length <= MAX_ACTIVE_CONNECTIONS) return;

    const overflow = openInstances.length - MAX_ACTIVE_CONNECTIONS;
    const candidates = this.getOpenInstances(targetConnectionId)
      .sort((a, b) => a.lastTouchedAt - b.lastTouchedAt);

    candidates.slice(0, overflow).forEach((instance) => {
      this.closeInstance(instance, true);
    });
  }

  private scheduleReconnect(instance: ChannelInstance) {
    if (instance.reconnectAttempts >= MAX_RECONNECT_ATTEMPTS) {
      this.updateStatus(instance, 'disconnected');
      return;
    }

    instance.reconnectAttempts += 1;
    const delay = Math.min(1000 * 2 ** (instance.reconnectAttempts - 1), 15000);
    this.updateStatus(instance, 'reconnecting');
    this.clearReconnectTimer(instance);

    instance.reconnectTimer = setTimeout(() => {
      instance.reconnectTimer = null;
      if (!instance.manualClose) {
        this.connect({
          connectionId: instance.connectionId,
          chatId: instance.currentChatId,
          senderId: instance.currentSenderId,
          senderName: instance.currentSenderName,
          serverUrl: instance.currentServerUrl,
          agentId: instance.currentAgentId,
          token: instance.currentAuthToken,
        });
      }
    }, delay);
  }

  connect(opts: ConnectOptions) {
    const instance = this.get(opts.connectionId);
    if (!instance) return;

    const nextServerUrl = opts.serverUrl || DEFAULT_WS_URL;
    const nextAgentId = opts.agentId || '';
    let nextChatId = opts.chatId || '';

    if (!nextChatId) {
      try {
        const urlParams = new URL(nextServerUrl).searchParams;
        nextChatId = urlParams.get('chatId') || urlParams.get('channelId') || '';
      } catch {
        // ignore invalid URL here; WebSocket constructor will throw separately
      }
    }

    if (
      instance.ws &&
      (instance.ws.readyState === WebSocket.CONNECTING || instance.ws.readyState === WebSocket.OPEN) &&
      instance.currentChatId === nextChatId &&
      instance.currentServerUrl === nextServerUrl &&
      instance.currentAgentId === nextAgentId
    ) {
      this.touch(instance);
      this.enforcePoolLimit(instance.connectionId);
      return;
    }

    this.closeInstance(instance, false);

    instance.currentServerUrl = nextServerUrl;
    instance.currentChatId = nextChatId;
    instance.currentSenderId = opts.senderId;
    instance.currentSenderName = opts.senderName;
    instance.currentAgentId = nextAgentId;
    instance.currentAuthToken = opts.token || '';
    instance.manualClose = false;

    const token = ++instance.connectionToken;
    this.updateStatus(instance, instance.reconnectAttempts > 0 ? 'reconnecting' : 'connecting');

    const socket = new WebSocket(buildSocketUrl(nextServerUrl, opts.chatId, opts.agentId, opts.token));
    instance.ws = socket;
    this.touch(instance);
    this.enforcePoolLimit(instance.connectionId);

    socket.addEventListener('open', () => {
      if (instance.connectionToken !== token || instance.ws !== socket) return;
      instance.reconnectAttempts = 0;
      this.updateStatus(instance, 'connected');
      this.touch(instance);
      try {
        this.requestAgentList(instance.connectionId);
      } catch {
        // ignore
      }
    });

    socket.addEventListener('message', (event) => {
      if (instance.connectionToken !== token || instance.ws !== socket) return;
      this.touch(instance);

      try {
        const packet: InboundPacket = JSON.parse(event.data as string);
        if (packet.type === 'connection.open' && packet.data?.chatId) {
          instance.currentChatId = packet.data.chatId as string;
        }
        instance.messageListeners.forEach((fn) => fn(packet));
      } catch {
        // ignore malformed packets
      }
    });

    socket.addEventListener('close', () => {
      if (instance.connectionToken !== token) return;
      instance.ws = null;
      this.clearIdleTimer(instance);
      if (instance.manualClose) {
        this.updateStatus(instance, 'disconnected');
        return;
      }
      this.scheduleReconnect(instance);
    });

    socket.addEventListener('error', () => {
      // close event handles recovery
    });
  }

  close(connectionId?: string, manual = true) {
    const instance = this.get(connectionId);
    if (!instance) return;
    this.closeInstance(instance, manual);
  }

  closeAll(manual = true) {
    this.instances.forEach((instance) => {
      this.closeInstance(instance, manual);
    });
  }

  private closeInstance(instance: ChannelInstance, manual = true) {
    instance.manualClose = manual;
    this.clearReconnectTimer(instance);
    this.clearIdleTimer(instance);
    instance.connectionToken += 1;

    const socket = instance.ws;
    instance.ws = null;

    if (socket) {
      try {
        if (socket.readyState === WebSocket.OPEN || socket.readyState === WebSocket.CONNECTING) {
          socket.close(1000, manual ? 'Manual close' : 'Connection replaced');
        }
      } catch {
        // ignore
      }
    }

    if (manual) {
      this.updateStatus(instance, 'disconnected');
    }
  }

  sendRaw(packet: { type: string; data: Record<string, unknown> }, connectionId?: string) {
    const instance = this.get(connectionId);
    if (!instance?.ws || instance.ws.readyState !== WebSocket.OPEN) {
      throw new Error('Socket is not connected.');
    }

    this.touch(instance);
    instance.ws.send(JSON.stringify(packet));
  }

  isReady(connectionId?: string) {
    const instance = this.get(connectionId);
    return !!instance?.ws && instance.ws.readyState === WebSocket.OPEN;
  }

  sendText(content: string, agentId?: string, connectionId?: string): OutboundPayload {
    const instance = this.get(connectionId);
    if (!instance?.ws || instance.ws.readyState !== WebSocket.OPEN) {
      throw new Error('Socket is not connected.');
    }

    const payload: OutboundPayload = {
      messageId: createStableId('msg'),
      chatId: instance.currentChatId,
      chatType: 'direct',
      senderId: instance.currentSenderId,
      senderName: instance.currentSenderName,
      messageType: 'text',
      content,
      timestamp: Date.now(),
    };

    if (agentId || instance.currentAgentId) {
      payload.agentId = agentId || instance.currentAgentId;
    }

    this.touch(instance);
    instance.ws.send(JSON.stringify({ type: 'message.receive', data: payload }));
    return payload;
  }

  sendMedia(opts: MediaOptions, connectionId?: string): OutboundPayload {
    const instance = this.get(connectionId);
    if (!instance?.ws || instance.ws.readyState !== WebSocket.OPEN) {
      throw new Error('Socket is not connected.');
    }

    const payload: OutboundPayload = {
      messageId: createStableId('msg'),
      chatId: instance.currentChatId,
      chatType: 'direct',
      senderId: instance.currentSenderId,
      senderName: instance.currentSenderName,
      messageType: opts.messageType,
      content: opts.content,
      mediaUrl: opts.mediaUrl,
      mimeType: opts.mimeType,
      timestamp: Date.now(),
    };

    if (opts.agentId || instance.currentAgentId) {
      payload.agentId = opts.agentId || instance.currentAgentId;
    }

    this.touch(instance);
    instance.ws.send(JSON.stringify({ type: 'message.receive', data: payload }));
    return payload;
  }

  requestAgentList(connectionId?: string) {
    this.sendRaw({
      type: 'agent.list.get',
      data: { requestId: createStableId('agent-list') },
    }, connectionId);
  }

  requestConversationList(agentId?: string, connectionId?: string) {
    const instance = this.get(connectionId);
    this.sendRaw({
      type: 'conversation.list.get',
      data: {
        requestId: createStableId('conv-list'),
        agentId: agentId || instance?.currentAgentId || undefined,
      },
    }, connectionId);
  }

  requestHistory(chatId: string, connectionId?: string) {
    this.sendRaw({
      type: 'history.get',
      data: {
        requestId: createStableId('history'),
        chatId,
      },
    }, connectionId);
  }

  selectAgent(agentId: string | null, connectionId?: string) {
    const instance = this.get(connectionId);
    if (!instance) return;
    instance.currentAgentId = agentId || '';
    this.sendRaw({
      type: 'agent.select',
      data: {
        requestId: createStableId('agent-select'),
        agentId: agentId || null,
      },
    }, connectionId);
  }

  addReaction(messageId: string, emoji: string, connectionId?: string) {
    const instance = this.get(connectionId);
    if (!instance?.currentChatId) return;
    this.sendRaw({
      type: 'reaction.add',
      data: {
        messageId,
        chatId: instance.currentChatId,
        senderId: instance.currentSenderId,
        emoji,
        timestamp: Date.now(),
      },
    }, connectionId);
  }

  removeReaction(messageId: string, emoji: string, connectionId?: string) {
    const instance = this.get(connectionId);
    if (!instance?.currentChatId) return;
    this.sendRaw({
      type: 'reaction.remove',
      data: {
        messageId,
        chatId: instance.currentChatId,
        senderId: instance.currentSenderId,
        emoji,
        timestamp: Date.now(),
      },
    }, connectionId);
  }

  sendTextWithParent(content: string, parentId: string, agentId?: string, connectionId?: string): OutboundPayload {
    const instance = this.get(connectionId);
    if (!instance?.ws || instance.ws.readyState !== WebSocket.OPEN) {
      throw new Error('Socket is not connected.');
    }

    const payload: OutboundPayload & { parentId?: string } = {
      messageId: createStableId('msg'),
      chatId: instance.currentChatId,
      chatType: 'direct',
      senderId: instance.currentSenderId,
      senderName: instance.currentSenderName,
      messageType: 'text',
      content,
      timestamp: Date.now(),
      parentId,
    };

    if (agentId || instance.currentAgentId) {
      payload.agentId = agentId || instance.currentAgentId;
    }

    this.touch(instance);
    instance.ws.send(JSON.stringify({ type: 'message.receive', data: payload }));
    return payload;
  }

  editMessage(messageId: string, newContent: string, connectionId?: string) {
    const instance = this.get(connectionId);
    if (!instance?.currentChatId) return;
    this.sendRaw({
      type: 'message.edit',
      data: {
        messageId,
        chatId: instance.currentChatId,
        senderId: instance.currentSenderId,
        content: newContent,
        timestamp: Date.now(),
      },
    }, connectionId);
  }

  deleteMessage(messageId: string, connectionId?: string) {
    const instance = this.get(connectionId);
    if (!instance?.currentChatId) return;
    this.sendRaw({
      type: 'message.delete',
      data: {
        messageId,
        chatId: instance.currentChatId,
        senderId: instance.currentSenderId,
        timestamp: Date.now(),
      },
    }, connectionId);
  }

  sendTyping(isTyping = true, connectionId?: string) {
    const instance = this.get(connectionId);
    if (!instance?.currentChatId) return;
    this.sendRaw({
      type: 'typing',
      data: {
        chatId: instance.currentChatId,
        senderId: instance.currentSenderId,
        isTyping,
        timestamp: Date.now(),
      },
    }, connectionId);
  }

  sendFile(opts: { content: string; mediaUrl: string; mimeType: string; fileName?: string; agentId?: string }, connectionId?: string): OutboundPayload {
    const instance = this.get(connectionId);
    if (!instance?.ws || instance.ws.readyState !== WebSocket.OPEN) {
      throw new Error('Socket is not connected.');
    }

    const payload: OutboundPayload = {
      messageId: createStableId('msg'),
      chatId: instance.currentChatId,
      chatType: 'direct',
      senderId: instance.currentSenderId,
      senderName: instance.currentSenderName,
      messageType: 'file',
      content: opts.content || opts.fileName || 'File',
      mediaUrl: opts.mediaUrl,
      mimeType: opts.mimeType,
      timestamp: Date.now(),
    };

    if (opts.agentId || instance.currentAgentId) {
      payload.agentId = opts.agentId || instance.currentAgentId;
    }

    this.touch(instance);
    instance.ws.send(JSON.stringify({ type: 'message.receive', data: payload }));
    return payload;
  }

  onMessage(fn: MessageListener, connectionId?: string) {
    const instance = this.get(connectionId);
    if (!instance) return () => {};
    instance.messageListeners.add(fn);
    return () => {
      instance.messageListeners.delete(fn);
    };
  }

  onStatus(fn: StatusListener, connectionId?: string) {
    const instance = this.get(connectionId);
    if (!instance) return () => {};
    instance.statusListeners.add(fn);
    return () => {
      instance.statusListeners.delete(fn);
    };
  }

  getStatus(connectionId?: string) {
    return this.get(connectionId)?.currentStatus || 'disconnected';
  }

  getChatId(connectionId?: string) {
    return this.get(connectionId)?.currentChatId || '';
  }
}

const manager = new ChannelManager();

export type MediaOptions = {
  messageType: 'image' | 'voice' | 'audio';
  content: string;
  mediaUrl: string;
  mimeType: string;
  agentId?: string;
};

export function getAgentCacheKey(connectionId: string) {
  return `${AGENT_CACHE_PREFIX}${connectionId}`;
}

export function getStatusCacheKey(connectionId: string) {
  return `${STATUS_CACHE_PREFIX}${connectionId}`;
}

export function loadCachedAgents(connectionId?: string): AgentInfo[] {
  const resolved = getResolvedConnectionId(connectionId);
  const keys = resolved
    ? [getAgentCacheKey(resolved)]
    : [];

  if (!resolved || getActiveConnectionId() === resolved) {
    keys.push(LEGACY_AGENT_CACHE_KEY);
  }

  for (const key of keys) {
    try {
      const raw = localStorage.getItem(key);
      if (raw) return JSON.parse(raw) as AgentInfo[];
    } catch {
      // ignore cache parse failures
    }
  }

  return [];
}

export function saveCachedAgents(connectionId: string, agents: AgentInfo[]) {
  try {
    localStorage.setItem(getAgentCacheKey(connectionId), JSON.stringify(agents));
    if (getActiveConnectionId() === connectionId) {
      localStorage.setItem(LEGACY_AGENT_CACHE_KEY, JSON.stringify(agents));
    }
  } catch {
    // ignore cache failures
  }
}

export function loadCachedChannelStatus<T>(connectionId?: string): T | null {
  const resolved = getResolvedConnectionId(connectionId);
  const keys = resolved
    ? [getStatusCacheKey(resolved)]
    : [];

  if (!resolved || getActiveConnectionId() === resolved) {
    keys.push(LEGACY_STATUS_CACHE_KEY);
  }

  for (const key of keys) {
    try {
      const raw = localStorage.getItem(key);
      if (raw) return JSON.parse(raw) as T;
    } catch {
      // ignore cache parse failures
    }
  }

  return null;
}

export function saveCachedChannelStatus<T>(connectionId: string, status: T) {
  try {
    localStorage.setItem(getStatusCacheKey(connectionId), JSON.stringify(status));
    if (getActiveConnectionId() === connectionId) {
      localStorage.setItem(LEGACY_STATUS_CACHE_KEY, JSON.stringify(status));
    }
  } catch {
    // ignore cache failures
  }
}

export function closeAll(manual = true) {
  manager.closeAll(manual);
}

export function connect(opts: ConnectOptions) {
  manager.connect(opts);
}

export function close(manual = true, connectionId?: string) {
  manager.close(connectionId, manual);
}

export function sendRaw(packet: { type: string; data: Record<string, unknown> }, connectionId?: string) {
  manager.sendRaw(packet, connectionId);
}

export function isReady(connectionId?: string) {
  return manager.isReady(connectionId);
}

export function sendText(content: string, agentId?: string, connectionId?: string) {
  return manager.sendText(content, agentId, connectionId);
}

export function sendMedia(opts: MediaOptions, connectionId?: string) {
  return manager.sendMedia(opts, connectionId);
}

export function requestAgentList(connectionId?: string) {
  manager.requestAgentList(connectionId);
}

export function requestConversationList(agentId?: string, connectionId?: string) {
  manager.requestConversationList(agentId, connectionId);
}

export function requestHistory(chatId: string, connectionId?: string) {
  manager.requestHistory(chatId, connectionId);
}

export function selectAgent(agentId: string | null, connectionId?: string) {
  manager.selectAgent(agentId, connectionId);
}

export function addReaction(messageId: string, emoji: string, connectionId?: string) {
  manager.addReaction(messageId, emoji, connectionId);
}

export function removeReaction(messageId: string, emoji: string, connectionId?: string) {
  manager.removeReaction(messageId, emoji, connectionId);
}

export function sendTextWithParent(content: string, parentId: string, agentId?: string, connectionId?: string) {
  return manager.sendTextWithParent(content, parentId, agentId, connectionId);
}

export function editMessage(messageId: string, newContent: string, connectionId?: string) {
  manager.editMessage(messageId, newContent, connectionId);
}

export function deleteMessage(messageId: string, connectionId?: string) {
  manager.deleteMessage(messageId, connectionId);
}

export function sendTyping(isTyping = true, connectionId?: string) {
  manager.sendTyping(isTyping, connectionId);
}

export function sendFile(opts: { content: string; mediaUrl: string; mimeType: string; fileName?: string; agentId?: string }, connectionId?: string) {
  return manager.sendFile(opts, connectionId);
}

export function onMessage(fn: MessageListener, connectionId?: string) {
  return manager.onMessage(fn, connectionId);
}

export function onStatus(fn: StatusListener, connectionId?: string) {
  return manager.onStatus(fn, connectionId);
}

export function getStatus(connectionId?: string) {
  return manager.getStatus(connectionId);
}

export function getChatId(connectionId?: string) {
  return manager.getChatId(connectionId);
}
