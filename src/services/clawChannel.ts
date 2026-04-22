import { getActiveConnectionId } from './connectionStore';

const DEFAULT_WS_URL = 'wss://gateway.clawlines.net/client';
const MAX_RECONNECT_ATTEMPTS = 6;
const MAX_ACTIVE_CONNECTIONS = 6;
const IDLE_TIMEOUT_MS = 30 * 60 * 1000; // 30 minutes — chat apps should stay connected
const HEARTBEAT_INTERVAL_MS = 30 * 1000; // 30 seconds
const HEARTBEAT_MAX_MISSED = 2; // allow 2 missed pongs before killing
const THINKING_TIMEOUT_MS = 60 * 1000;
const AGENT_CACHE_PREFIX = 'clawline.agentList.';
const STATUS_CACHE_PREFIX = 'clawline.channelStatus.';

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
  isDefault: boolean;
  identityName?: string;
  identityEmoji?: string;
  model?: string;
  description?: string;
  skills?: string[];
  /** Skills explicitly declared in agent config (subset of skills) */
  configuredSkills?: string[];
  /** Skills from npm-bundled locations (openclaw built-in) */
  builtinSkills?: string[];
  globalSkills?: string[];
  workspaceSkills?: string[];
  status?: 'online' | 'idle' | 'busy';
};

export type ContextFile = {
  name: string;
  content: string;
  updatedAt?: number;
};

export type AgentContext = {
  files: ContextFile[];
  timestamp: number;
};

export type ConversationSummary = {
  chatId: string;
  agentId?: string;
  title?: string;
  senderName?: string;
  lastMessage?: string;
  lastContent?: string;
  timestamp?: number;
  lastTimestamp?: number;
  unreadCount?: number;
};

export type ChannelStatus = ConnectionStatus;

type StatusListener = (status: ConnectionStatus) => void;
type MessageListener = (packet: InboundPacket) => void;
type TypingListener = (connectionId: string, agentIds: string[]) => void;
type AgentContextListener = (connectionId: string, agentId: string, context: AgentContext) => void;
type ErrorListener = (connectionId: string, error: { code: string; message: string }) => void;

export type ConnectOptions = {
  connectionId?: string;
  chatId?: string;
  channelId?: string;
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
  lastReconnectAt: number;
  reconnectTimer: ReturnType<typeof setTimeout> | null;
  idleTimer: ReturnType<typeof setTimeout> | null;
  heartbeatTimer: ReturnType<typeof setInterval> | null;
  heartbeatMissed: number;
  manualClose: boolean;
  currentStatus: ConnectionStatus;
  currentServerUrl: string;
  currentChatId: string;
  currentSenderId: string;
  currentSenderName: string;
  currentAgentId: string;
  currentAuthToken: string;
  currentChannelId: string;
  statusListeners: Set<StatusListener>;
  messageListeners: Set<MessageListener>;
  lastTouchedAt: number;
  lastMessageTimestamp: number;
};

function createStableId(prefix: string) {
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

function buildSocketUrl(serverUrl: string, chatId?: string, agentId?: string, token?: string, channelId?: string) {
  const base = serverUrl || DEFAULT_WS_URL;
  const parsed = new URL(base);
  const effectiveChannelId = channelId || chatId;
  if (effectiveChannelId) parsed.searchParams.set('channelId', effectiveChannelId);
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
    lastReconnectAt: 0,
    reconnectTimer: null,
    idleTimer: null,
    heartbeatTimer: null,
    heartbeatMissed: 0,
    manualClose: false,
    currentStatus: 'disconnected',
    currentServerUrl: '',
    currentChatId: '',
    currentSenderId: '',
    currentSenderName: '',
    currentAgentId: '',
    currentAuthToken: '',
    currentChannelId: '',
    statusListeners: new Set<StatusListener>(),
    messageListeners: new Set<MessageListener>(),
    lastTouchedAt: 0,
    lastMessageTimestamp: 0,
  };
}

class ChannelManager {
  private instances = new Map<string, ChannelInstance>();
  private typingAgents = new Map<string, Set<string>>();
  private typingTimers = new Map<string, ReturnType<typeof setTimeout>>();
  private typingListeners = new Set<TypingListener>();
  private thinkingAgents = new Map<string, Set<string>>();
  private thinkingTimeouts = new Map<string, ReturnType<typeof setTimeout>>();
  private thinkingListeners = new Set<TypingListener>();
  private agentContexts = new Map<string, Map<string, AgentContext>>();
  private agentContextListeners = new Set<AgentContextListener>();
  private errorListeners = new Set<ErrorListener>();
  private pendingSuggestionRequests = new Map<string, {
    resolve: (suggestions: string[]) => void;
    timer: ReturnType<typeof setTimeout>;
  }>();

  private handleVisibilityChange = () => {
    if (document.visibilityState === 'visible') {
      // Page came back to foreground — reconnect all disconnected instances (debounced)
      // and restart heartbeats for connected ones
      this.reconnectAllDebounced();
      for (const instance of this.instances.values()) {
        if (instance.ws && instance.ws.readyState === WebSocket.OPEN) {
          this.startHeartbeat(instance);
        }
      }
    } else {
      // Page going to background — pause idle timers and heartbeats
      // (browser may throttle timers anyway; no point wasting resources)
      for (const instance of this.instances.values()) {
        this.clearIdleTimer(instance);
        this.stopHeartbeat(instance);
      }
    }
  };

  private handleOnline = () => {
    // Network restored — reconnect all disconnected instances (debounced)
    this.reconnectAllDebounced();
  };

  private handleOffline = () => {
    // Network lost — proactively mark all as disconnected for faster UI feedback
    for (const instance of this.instances.values()) {
      if (instance.currentStatus === 'connected') {
        this.updateStatus(instance, 'disconnected');
      }
    }
  };

  private reconnectAllTimer: ReturnType<typeof setTimeout> | null = null;

  /** Debounced reconnectAll — prevents reconnect storms from rapid online/visibility events */
  private reconnectAllDebounced = () => {
    if (this.reconnectAllTimer) return; // already scheduled
    this.reconnectAllTimer = setTimeout(() => {
      this.reconnectAllTimer = null;
      this.reconnectAll();
    }, 1500);
  };

  constructor() {
    if (typeof document !== 'undefined') {
      document.addEventListener('visibilitychange', this.handleVisibilityChange);
    }
    if (typeof window !== 'undefined') {
      window.addEventListener('online', this.handleOnline);
      window.addEventListener('offline', this.handleOffline);
    }
  }

  destroy() {
    if (typeof document !== 'undefined') {
      document.removeEventListener('visibilitychange', this.handleVisibilityChange);
    }
    if (typeof window !== 'undefined') {
      window.removeEventListener('online', this.handleOnline);
      window.removeEventListener('offline', this.handleOffline);
    }
    if (this.reconnectAllTimer) {
      clearTimeout(this.reconnectAllTimer);
      this.reconnectAllTimer = null;
    }
    this.closeAll(true);
  }

  // ── File upload ──
  async uploadFile(file: File, connectionId?: string): Promise<string> {
    const connId = connectionId || getActiveConnectionId();
    const instance = this.instances.get(connId || "");
    if (!instance) throw new Error("No active connection");
    
    // Derive HTTP upload URL from WSS URL
    const wsUrl = instance.currentServerUrl || DEFAULT_WS_URL;
    const httpBase = wsUrl
      .replace(/^wss:/, "https:")
      .replace(/^ws:/, "http:")
      .replace(/\/client\/?$/, "")
      .replace(/\/backend\/?$/, "");

    const formData = new FormData();
    formData.append("file", file);

    const headers: Record<string, string> = {};
    if (instance.currentAuthToken) {
      if (instance.currentAuthToken.length > 32) {
         headers["Authorization"] = `Bearer ${instance.currentAuthToken}`;
      } else {
         headers["x-relay-admin-token"] = instance.currentAuthToken;
      }
    }

    const res = await fetch(`${httpBase}/api/media/upload`, {
      method: "POST",
      body: formData,
      headers,
    });
    
    if (!res.ok) {
      const statusText = res.status === 413 ? 'File too large (max 10 MB)' : res.status === 401 ? 'Authentication failed — please reconnect' : res.status === 403 ? 'Access denied — check server permissions' : `Upload failed (error ${res.status})`;
      throw new Error(statusText);
    }
    const data = await res.json();
    return data.url;
  }

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

  private getTypingTimerKey(connectionId: string, agentId: string) {
    return `${connectionId}::${agentId}`;
  }

  private emitTypingChange(connectionId: string) {
    const agentIds = [...(this.typingAgents.get(connectionId) ?? new Set<string>())];
    this.typingListeners.forEach((listener) => listener(connectionId, agentIds));
  }

  private clearTypingTimer(connectionId: string, agentId: string) {
    const timerKey = this.getTypingTimerKey(connectionId, agentId);
    const timer = this.typingTimers.get(timerKey);
    if (timer) {
      clearTimeout(timer);
      this.typingTimers.delete(timerKey);
    }
  }

  private clearConnectionTyping(connectionId: string) {
    const typingAgents = this.typingAgents.get(connectionId);
    if (!typingAgents || typingAgents.size === 0) {
      return;
    }

    typingAgents.forEach((agentId) => this.clearTypingTimer(connectionId, agentId));
    this.typingAgents.delete(connectionId);
    this.emitTypingChange(connectionId);
  }

  private emitThinkingChange(connectionId: string) {
    const agentIds = [...(this.thinkingAgents.get(connectionId) ?? new Set<string>())];
    this.thinkingListeners.forEach((listener) => listener(connectionId, agentIds));
  }

  private getThinkingTimeoutKey(connectionId: string, agentId: string) {
    return `${connectionId}::${agentId}`;
  }

  private clearThinkingTimeout(connectionId: string, agentId: string) {
    const timeoutKey = this.getThinkingTimeoutKey(connectionId, agentId);
    const timeout = this.thinkingTimeouts.get(timeoutKey);
    if (timeout) {
      clearTimeout(timeout);
      this.thinkingTimeouts.delete(timeoutKey);
    }
  }

  private setThinkingState(connectionId: string, agentId: string, isThinking: boolean) {
    if (!connectionId || !agentId) {
      return;
    }

    const nextThinkingAgents = new Set(this.thinkingAgents.get(connectionId) ?? []);

    if (isThinking) {
      nextThinkingAgents.add(agentId);
      this.thinkingAgents.set(connectionId, nextThinkingAgents);
      this.clearThinkingTimeout(connectionId, agentId);
      const timeoutKey = this.getThinkingTimeoutKey(connectionId, agentId);
      this.thinkingTimeouts.set(timeoutKey, setTimeout(() => {
        this.setThinkingState(connectionId, agentId, false);
      }, THINKING_TIMEOUT_MS));
    } else {
      nextThinkingAgents.delete(agentId);
      this.clearThinkingTimeout(connectionId, agentId);
      if (nextThinkingAgents.size === 0) {
        this.thinkingAgents.delete(connectionId);
      } else {
        this.thinkingAgents.set(connectionId, nextThinkingAgents);
      }
    }

    this.emitThinkingChange(connectionId);
  }

  private clearConnectionThinking(connectionId: string) {
    const thinkingAgents = this.thinkingAgents.get(connectionId);
    if (!thinkingAgents || thinkingAgents.size === 0) {
      return;
    }

    thinkingAgents.forEach((agentId) => this.clearThinkingTimeout(connectionId, agentId));
    this.thinkingAgents.delete(connectionId);
    this.emitThinkingChange(connectionId);
  }

  private setAgentContext(connectionId: string, agentId: string, context: AgentContext) {
    if (!connectionId || !agentId) {
      return;
    }

    const connectionContexts = this.agentContexts.get(connectionId) ?? new Map<string, AgentContext>();
    connectionContexts.set(agentId, context);
    this.agentContexts.set(connectionId, connectionContexts);
    this.agentContextListeners.forEach((listener) => listener(connectionId, agentId, context));
  }

  private setTypingState(connectionId: string, agentId: string, isTyping: boolean) {
    if (!connectionId || !agentId) {
      return;
    }

    const nextTypingAgents = new Set(this.typingAgents.get(connectionId) ?? []);

    if (isTyping) {
      nextTypingAgents.add(agentId);
      this.typingAgents.set(connectionId, nextTypingAgents);
      this.clearTypingTimer(connectionId, agentId);
      const timerKey = this.getTypingTimerKey(connectionId, agentId);
      this.typingTimers.set(timerKey, setTimeout(() => {
        this.setTypingState(connectionId, agentId, false);
      }, 5000));
    } else {
      nextTypingAgents.delete(agentId);
      this.clearTypingTimer(connectionId, agentId);
      if (nextTypingAgents.size === 0) {
        this.typingAgents.delete(connectionId);
      } else {
        this.typingAgents.set(connectionId, nextTypingAgents);
      }
    }

    this.emitTypingChange(connectionId);
  }

  private resolveTypingAgentId(instance: ChannelInstance, packet: InboundPacket) {
    const packetAgentId = typeof packet.data.agentId === 'string' ? packet.data.agentId : '';
    if (packetAgentId) {
      return packetAgentId;
    }

    const senderId = typeof packet.data.senderId === 'string' ? packet.data.senderId : '';
    if (senderId && senderId !== instance.currentSenderId) {
      return senderId;
    }

    return instance.currentAgentId;
  }

  private clearIdleTimer(instance: ChannelInstance) {
    if (instance.idleTimer) {
      clearTimeout(instance.idleTimer);
      instance.idleTimer = null;
    }
  }

  /**
   * After WS reconnect, fetch messages from Supabase that arrived during the disconnect gap.
   * Dispatches them through messageListeners so ChatRoom/agentInbox handle dedup and display.
   */
  private async syncMissedAfterReconnect(instance: ChannelInstance) {
    try {
      const { syncMissedMessages, syncMessageToLocal } = await import('./suggestions');
      const result = await syncMissedMessages(
        instance.currentChannelId,
        instance.lastMessageTimestamp,
        500,
        instance.connectionId,
      );
      if (result.messages.length === 0) return;
      // Dispatch each missed message as a message.send packet through listeners
      for (const msg of result.messages) {
        const local = syncMessageToLocal(msg);
        const packet: InboundPacket = {
          type: 'message.send',
          data: {
            messageId: local.id,
            content: local.text,
            contentType: local.mediaType || 'text',
            mediaUrl: local.mediaUrl,
            agentId: msg.agent_id,
            senderId: msg.sender_id,
            timestamp: local.timestamp,
            // Mark as echo if direction is inbound (user's own message)
            echo: msg.direction === 'inbound',
          },
        };
        const ts = typeof local.timestamp === 'number' ? local.timestamp : 0;
        if (ts > instance.lastMessageTimestamp) instance.lastMessageTimestamp = ts;
        instance.messageListeners.forEach((fn) => fn(packet));
      }
    } catch {
      // Sync failed — non-critical, messages will load on next ChatRoom open
    }
  }

  private startHeartbeat(instance: ChannelInstance) {
    this.stopHeartbeat(instance);
    instance.heartbeatTimer = setInterval(() => {
      if (!instance.ws || instance.ws.readyState !== WebSocket.OPEN) {
        this.stopHeartbeat(instance);
        return;
      }
      // Track missed pongs — only kill after HEARTBEAT_MAX_MISSED consecutive misses
      instance.heartbeatMissed++;
      if (instance.heartbeatMissed > HEARTBEAT_MAX_MISSED) {
        instance.heartbeatMissed = 0;
        this.stopHeartbeat(instance);
        try { instance.ws.close(4000, 'Heartbeat timeout'); } catch { /* ignore */ }
        return;
      }
      try {
        instance.ws.send(JSON.stringify({ type: 'ping', data: { timestamp: Date.now() } }));
      } catch {
        this.stopHeartbeat(instance);
        try { instance.ws?.close(4000, 'Heartbeat send failed'); } catch { /* ignore */ }
      }
    }, HEARTBEAT_INTERVAL_MS);
  }

  private stopHeartbeat(instance: ChannelInstance) {
    if (instance.heartbeatTimer) {
      clearInterval(instance.heartbeatTimer);
      instance.heartbeatTimer = null;
    }
    instance.heartbeatMissed = 0;
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
      this.emitError(instance.connectionId, 'CONNECTION_FAILED', `Unable to connect after ${MAX_RECONNECT_ATTEMPTS} attempts. The server may be unreachable or rejecting connections (CORS/auth issue).`);
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
          channelId: instance.currentChannelId,
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
    // Note: agentId is managed by selectAgent(), not passed to connect()
    let nextChatId = opts.chatId || '';

    if (!nextChatId) {
      try {
        const urlParams = new URL(nextServerUrl).searchParams;
        nextChatId = urlParams.get('chatId') || urlParams.get('channelId') || '';
      } catch {
        // ignore invalid URL here; WebSocket constructor will throw separately
      }
    }

    // Connection reuse: only check serverUrl + chatId (not agentId)
    // Agent switching is handled by selectAgent() without reconnecting
    if (
      instance.ws &&
      (instance.ws.readyState === WebSocket.CONNECTING || instance.ws.readyState === WebSocket.OPEN) &&
      instance.currentChatId === nextChatId &&
      instance.currentServerUrl === nextServerUrl
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
    // Note: currentAgentId is managed by selectAgent(), not connect()
    instance.currentAuthToken = opts.token || '';
    instance.currentChannelId = opts.channelId || instance.currentChannelId || '';
    instance.manualClose = false;

    const token = ++instance.connectionToken;
    this.updateStatus(instance, instance.reconnectAttempts > 0 ? 'reconnecting' : 'connecting');

    // Don't pass agentId to URL — agent is selected via selectAgent() message
    const socket = new WebSocket(buildSocketUrl(nextServerUrl, opts.chatId, undefined, opts.token, instance.currentChannelId || undefined));
    instance.ws = socket;
    this.touch(instance);
    this.enforcePoolLimit(instance.connectionId);

    socket.addEventListener('open', () => {
      if (instance.connectionToken !== token || instance.ws !== socket) return;
      const wasReconnect = instance.reconnectAttempts > 0;
      instance.reconnectAttempts = 0;
      this.updateStatus(instance, 'connected');
      this.touch(instance);
      this.startHeartbeat(instance);

      // On reconnect: pull missed messages from Supabase to fill the gap
      if (wasReconnect && instance.lastMessageTimestamp > 0 && instance.currentChannelId) {
        this.syncMissedAfterReconnect(instance);
      }
    });

    socket.addEventListener('message', (event) => {
      if (instance.connectionToken !== token || instance.ws !== socket) return;
      // Any message from server means connection is alive — reset heartbeat pending
      instance.heartbeatMissed = 0;
      this.touch(instance);

      try {
        const packet: InboundPacket = JSON.parse(event.data as string);
        // Track latest message timestamp for reconnect sync
        if ((packet.type === 'message.send' || packet.type === 'message.receive') && packet.data?.timestamp) {
          const ts = typeof packet.data.timestamp === 'number' ? packet.data.timestamp : 0;
          if (ts > instance.lastMessageTimestamp) instance.lastMessageTimestamp = ts;
        }
        // Heartbeat response — silently consume, don't forward to UI
        if (packet.type === 'pong') return;
        if (packet.type === 'connection.open' && packet.data?.chatId) {
          instance.currentChatId = packet.data.chatId as string;
        }
        if (packet.type === 'agent.list') {
          const agents = Array.isArray((packet.data as { agents?: AgentInfo[] }).agents)
            ? (packet.data as { agents?: AgentInfo[] }).agents as AgentInfo[]
            : [];
          saveCachedAgents(instance.connectionId, agents);
        }
        if (packet.type === 'agent.context') {
          const agentId = typeof packet.data.agentId === 'string' ? packet.data.agentId : '';
          const files = Array.isArray((packet.data as { files?: ContextFile[] }).files)
            ? ((packet.data as { files?: ContextFile[] }).files ?? [])
              .filter((file): file is ContextFile => (
                !!file &&
                typeof file.name === 'string' &&
                typeof file.content === 'string' &&
                (file.updatedAt === undefined || typeof file.updatedAt === 'number')
              ))
            : [];
          const timestamp = typeof packet.data.timestamp === 'number'
            ? packet.data.timestamp
            : Date.now();

          this.setAgentContext(instance.connectionId, agentId, { files, timestamp });
        }
        if (packet.type === 'typing') {
          // Ignore our own typing echo from the server
          const typingSenderId = typeof packet.data.senderId === 'string' ? packet.data.senderId : '';
          if (typingSenderId && typingSenderId === instance.currentSenderId) {
            return;
          }
          const agentId = this.resolveTypingAgentId(instance, packet);
          const isTyping = packet.data.isTyping === true;
          this.setTypingState(instance.connectionId, agentId, isTyping);
        }
        if (packet.type === 'thinking.start') {
          const thinkingAgentId = typeof packet.data.agentId === 'string' ? packet.data.agentId : undefined;
          if (thinkingAgentId) {
            this.setThinkingState(instance.connectionId, thinkingAgentId, true);
          }
        }
        if (packet.type === 'thinking.end') {
          const thinkingAgentId = typeof packet.data.agentId === 'string' ? packet.data.agentId : undefined;
          if (thinkingAgentId) {
            this.setThinkingState(instance.connectionId, thinkingAgentId, false);
          }
        }
        if (packet.type === 'message.send') {
          const senderAgentId = typeof packet.data.agentId === 'string'
            ? packet.data.agentId
            : typeof packet.data.senderId === 'string' && packet.data.senderId !== instance.currentSenderId
              ? packet.data.senderId
              : '';
          if (senderAgentId) {
            this.setThinkingState(instance.connectionId, senderAgentId, false);
          }
        }
        if (packet.type === 'suggestion.response') {
          const requestId = typeof packet.data.requestId === 'string' ? packet.data.requestId : '';
          const pending = this.pendingSuggestionRequests.get(requestId);
          if (pending) {
            clearTimeout(pending.timer);
            this.pendingSuggestionRequests.delete(requestId);
            const suggestions = Array.isArray(packet.data.suggestions)
              ? (packet.data.suggestions as unknown[]).filter((s): s is string => typeof s === 'string')
              : [];
            pending.resolve(suggestions);
          }
        }
        if (packet.type === 'status.failed') {
          const code = typeof packet.data.code === 'string' ? packet.data.code : 'DELIVERY_FAILED';
          const message = typeof packet.data.message === 'string' ? packet.data.message : 'Message delivery failed.';
          this.emitError(instance.connectionId, code, message);
        }
        instance.messageListeners.forEach((fn) => fn(packet));
      } catch {
        // ignore malformed packets
      }
    });

    socket.addEventListener('close', (ev) => {
      if (instance.connectionToken !== token) return;
      console.warn(`[ws] connection closed: ${instance.connectionId} code=${ev.code} reason=${ev.reason || 'none'}`);
      instance.ws = null;
      this.clearIdleTimer(instance);
      if (instance.manualClose) {
        this.updateStatus(instance, 'disconnected');
        return;
      }
      this.scheduleReconnect(instance);
    });

    socket.addEventListener('error', (ev) => {
      console.warn(`[ws] connection error: ${instance.connectionId}`, ev);
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

  /** Manually trigger reconnect for a specific connection */
  reconnect(connectionId?: string) {
    const instance = this.get(connectionId);
    if (!instance) return;
    if (instance.ws && instance.ws.readyState === WebSocket.OPEN) return; // already connected

    // Only reset attempts if this is a manual reconnect or enough time has passed
    // This prevents visibility/online events from bypassing MAX_RECONNECT_ATTEMPTS
    const timeSinceLastAttempt = Date.now() - (instance.lastReconnectAt || 0);
    if (instance.manualClose || timeSinceLastAttempt > 30_000) {
      instance.reconnectAttempts = 0;
    }
    instance.manualClose = false;
    this.clearReconnectTimer(instance);

    if (instance.currentServerUrl && instance.currentSenderId) {
      instance.lastReconnectAt = Date.now();
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
  }

  /** Reconnect all disconnected instances — staggered to avoid thundering herd */
  reconnectAll() {
    let delay = 0;
    for (const instance of this.instances.values()) {
      if (instance.currentStatus === 'disconnected' || instance.currentStatus === 'reconnecting') {
        setTimeout(() => this.reconnect(instance.connectionId), delay);
        delay += 500; // stagger each by 500ms
      }
    }
  }

  private closeInstance(instance: ChannelInstance, manual = true) {
    instance.manualClose = manual;
    this.clearReconnectTimer(instance);
    this.clearIdleTimer(instance);
    this.stopHeartbeat(instance);
    this.clearConnectionTyping(instance.connectionId);
    this.clearConnectionThinking(instance.connectionId);
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

  requestAgentContext(agentId: string, connectionId?: string) {
    this.sendRaw({
      type: 'agent.context.get',
      data: {
        requestId: createStableId('agent-context'),
        agentId,
      },
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

  requestHistory(chatId: string, agentId?: string, connectionId?: string, opts?: { limit?: number; before?: number }) {
    this.sendRaw({
      type: 'history.get',
      data: {
        requestId: createStableId('history'),
        chatId,
        agentId: agentId || undefined,
        limit: opts?.limit,
        before: opts?.before,
      },
    }, connectionId);
  }

  requestModelsList(agentId?: string, connectionId?: string) {
    this.sendRaw({
      type: 'models.list.get',
      data: {
        requestId: createStableId('models-list'),
        agentId: agentId || undefined,
      },
    }, connectionId);
  }

  switchModel(model: string, agentId?: string, connectionId?: string) {
    this.sendRaw({
      type: 'model.switch',
      data: {
        requestId: createStableId('model-switch'),
        model,
        agentId: agentId || undefined,
      },
    }, connectionId);
  }

  requestSuggestions(
    messages: Array<{ role: string; text: string }>,
    connectionId?: string,
  ): Promise<string[]> {
    const instance = this.get(connectionId);
    if (!instance?.ws || instance.ws.readyState !== WebSocket.OPEN) {
      return Promise.resolve([]);
    }

    const requestId = createStableId('suggestion');

    return new Promise<string[]>((resolve) => {
      const timer = setTimeout(() => {
        this.pendingSuggestionRequests.delete(requestId);
        resolve([]);
      }, 10000); // 10s timeout

      this.pendingSuggestionRequests.set(requestId, { resolve, timer });

      this.sendRaw({
        type: 'suggestion.get',
        data: {
          requestId,
          messages: messages.slice(-6).map(m => ({
            role: m.role,
            text: m.text.slice(0, 300),
          })),
        },
      }, connectionId);
    });
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

  sendTextWithParent(content: string, parentId: string, quotedText?: string, agentId?: string, connectionId?: string): OutboundPayload {
    const instance = this.get(connectionId);
    if (!instance?.ws || instance.ws.readyState !== WebSocket.OPEN) {
      throw new Error('Socket is not connected.');
    }

    const payload: OutboundPayload & { parentId?: string; quotedText?: string } = {
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

    if (quotedText) {
      payload.quotedText = quotedText;
    }

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

  private emitError(connectionId: string, code: string, message: string) {
    this.errorListeners.forEach((fn) => fn(connectionId, { code, message }));
  }

  onError(fn: ErrorListener) {
    this.errorListeners.add(fn);
    return () => { this.errorListeners.delete(fn); };
  }

  getStatus(connectionId?: string) {
    return this.get(connectionId)?.currentStatus || 'disconnected';
  }

  getReconnectInfo(connectionId?: string): { attempt: number; maxAttempts: number; delayMs: number } {
    const instance = this.get(connectionId);
    if (!instance) return { attempt: 0, maxAttempts: MAX_RECONNECT_ATTEMPTS, delayMs: 0 };
    const delay = instance.reconnectAttempts > 0 ? Math.min(1000 * 2 ** (instance.reconnectAttempts - 1), 15000) : 0;
    return { attempt: instance.reconnectAttempts, maxAttempts: MAX_RECONNECT_ATTEMPTS, delayMs: delay };
  }

  getChatId(connectionId?: string) {
    return this.get(connectionId)?.currentChatId || '';
  }

  getSenderId(connectionId?: string) {
    return this.get(connectionId)?.currentSenderId || '';
  }

  getCurrentAgentId(connectionId?: string) {
    return this.get(connectionId)?.currentAgentId || '';
  }

  getTypingAgents(connectionId?: string) {
    const resolved = getResolvedConnectionId(connectionId);
    if (!resolved) return [];
    return [...(this.typingAgents.get(resolved) ?? new Set<string>())];
  }

  getThinkingAgents(connectionId?: string) {
    const resolved = getResolvedConnectionId(connectionId);
    if (!resolved) return [];
    return [...(this.thinkingAgents.get(resolved) ?? new Set<string>())];
  }

  onTypingChange(fn: TypingListener) {
    this.typingListeners.add(fn);
    return () => {
      this.typingListeners.delete(fn);
    };
  }

  onThinkingChange(fn: TypingListener) {
    this.thinkingListeners.add(fn);
    return () => {
      this.thinkingListeners.delete(fn);
    };
  }

  getAgentContext(connectionId?: string, agentId?: string) {
    const resolved = getResolvedConnectionId(connectionId);
    if (!resolved || !agentId) {
      return null;
    }

    return this.agentContexts.get(resolved)?.get(agentId) ?? null;
  }

  onAgentContextChange(fn: AgentContextListener) {
    this.agentContextListeners.add(fn);
    return () => {
      this.agentContextListeners.delete(fn);
    };
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
  if (!resolved) return [];

  // Only read connection-specific cache (no legacy fallback to prevent cross-connection leakage)
  const key = getAgentCacheKey(resolved);
  try {
    const raw = localStorage.getItem(key);
    if (raw) return JSON.parse(raw) as AgentInfo[];
  } catch {
    // ignore cache parse failures
  }

  return [];
}

export function saveCachedAgents(connectionId: string, agents: AgentInfo[]) {
  try {
    localStorage.setItem(getAgentCacheKey(connectionId), JSON.stringify(agents));
    // No longer write to legacy key to prevent cross-connection cache leakage
  } catch {
    // ignore cache failures
  }
}

export function loadCachedChannelStatus<T>(connectionId?: string): T | null {
  const resolved = getResolvedConnectionId(connectionId);
  if (!resolved) return null;

  // Only read connection-specific cache (no legacy fallback to prevent cross-connection leakage)
  const key = getStatusCacheKey(resolved);
  try {
    const raw = localStorage.getItem(key);
    if (raw) return JSON.parse(raw) as T;
  } catch {
    // ignore cache parse failures
  }

  return null;
}

export function saveCachedChannelStatus<T>(connectionId: string, status: T) {
  try {
    localStorage.setItem(getStatusCacheKey(connectionId), JSON.stringify(status));
    // No longer write to legacy key to prevent cross-connection cache leakage
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

export function reconnect(connectionId?: string) {
  manager.reconnect(connectionId);
}

export function reconnectAll() {
  manager.reconnectAll();
}

export function sendRaw(packet: { type: string; data: Record<string, unknown> }, connectionId?: string) {
  manager.sendRaw(packet, connectionId);
}

export function isReady(connectionId?: string) {
  return manager.isReady(connectionId);
}

// ── File upload ──
export async function uploadFile(file: File, connectionId?: string): Promise<string> {
  return manager.uploadFile(file, connectionId);
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

export function requestAgentContext(agentId: string, connectionId?: string) {
  manager.requestAgentContext(agentId, connectionId);
}

export function requestConversationList(agentId?: string, connectionId?: string) {
  manager.requestConversationList(agentId, connectionId);
}

export function requestHistory(chatId: string, agentId?: string, connectionId?: string, opts?: { limit?: number; before?: number }) {
  manager.requestHistory(chatId, agentId, connectionId, opts);
}

export function requestModelsList(agentId?: string, connectionId?: string) {
  manager.requestModelsList(agentId, connectionId);
}

export function switchModel(model: string, agentId?: string, connectionId?: string) {
  manager.switchModel(model, agentId, connectionId);
}

export function requestSuggestions(
  messages: Array<{ role: string; text: string }>,
  connectionId?: string,
): Promise<string[]> {
  return manager.requestSuggestions(messages, connectionId);
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

export function sendTextWithParent(content: string, parentId: string, quotedText?: string, agentId?: string, connectionId?: string) {
  return manager.sendTextWithParent(content, parentId, quotedText, agentId, connectionId);
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

export function onError(fn: ErrorListener) {
  return manager.onError(fn);
}

export function getStatus(connectionId?: string) {
  return manager.getStatus(connectionId);
}

export function getReconnectInfo(connectionId?: string) {
  return manager.getReconnectInfo(connectionId);
}

export function getChatId(connectionId?: string) {
  return manager.getChatId(connectionId);
}

export function getSenderId(connectionId?: string) {
  return manager.getSenderId(connectionId);
}

export function getCurrentAgentId(connectionId?: string) {
  return manager.getCurrentAgentId(connectionId);
}

export function getTypingAgents(connectionId?: string) {
  return manager.getTypingAgents(connectionId);
}

export function getThinkingAgents(connectionId?: string) {
  return manager.getThinkingAgents(connectionId);
}

export function onTypingChange(fn: TypingListener) {
  return manager.onTypingChange(fn);
}

export function onThinkingChange(fn: TypingListener) {
  return manager.onThinkingChange(fn);
}

export function getAgentContext(connectionId?: string, agentId?: string) {
  return manager.getAgentContext(connectionId, agentId);
}

export function onAgentContextChange(fn: AgentContextListener) {
  return manager.onAgentContextChange(fn);
}

export function destroyManager() { manager.destroy(); }

// S10: Clean up event listeners on HMR
if (import.meta.hot) {
  import.meta.hot.dispose(() => manager.destroy());
}
