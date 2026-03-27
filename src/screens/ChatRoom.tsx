import { useState, useRef, useEffect, useCallback, type ChangeEvent } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { ChevronLeft, Columns2, MoreHorizontal, Smile, Mic, MicOff, Send, Code, FileText, Zap, SmilePlus, Wifi, WifiOff, Loader2, HelpCircle, Database, Activity, User, Plus, RotateCcw, Cpu, Server, MessageSquare, LayoutDashboard, Square, Image, CornerDownLeft, X, Pencil, Trash2, Paperclip, Brain, Puzzle, RefreshCw, Copy, Check } from 'lucide-react';
import { cn } from '../lib/utils';
import * as channel from '../services/clawChannel';
import type { AgentContext, ConversationSummary } from '../services/clawChannel';
import { getUserId } from '../App';
import { getActiveConnection, getConnectionById } from '../services/connectionStore';
import { markAgentAsRead } from './ChatList';
import ActionCard from '../components/ActionCard';
import AgentContextViewer from '../components/AgentContextViewer';
import MarkdownRenderer from '../components/MarkdownRenderer';
import MemorySheet from '../components/MemorySheet';
import FileGallery from '../components/FileGallery';
import { clearConversationMessages, DEFAULT_LOAD_LIMIT, loadConversationMessages, saveConversationMessages } from '../services/messageDB';
import * as outbox from '../services/outbox';
import {
  type DeliveryStatus, type Message, type AgentInfo,
  QUICK_COMMANDS, CONTEXT_SUGGESTIONS, EMOJI_LIST,
  formatTime, formatDate, formatLastSeen, formatToolName, formatRelativeTime,
  isDifferentDay, isGroupedWithPrev, humanizeError, fileToDataUrl,
  getPreviewKey, emitPreviewUpdated, saveAgentPreview, mergeMessages,
  getConnectionDisplayName, getSkillDescription,
  PREVIEW_KEY_PREFIX, MESSAGE_PREVIEW_UPDATED_EVENT,
} from '../components/chat';
import { DeliveryTicks } from '../components/chat';

function getAgentInfo(agentId: string | null | undefined, connectionId: string): AgentInfo | null {
  const list = channel.loadCachedAgents(connectionId);
  return list.find((agent) => agent.id === agentId) || null;
}

const slashCommands = [
  { id: 'help', icon: HelpCircle, label: '/help', desc: 'Show built-in help and command usage' },
  { id: 'commands', icon: Database, label: '/commands', desc: 'List available slash commands' },
  { id: 'status', icon: Activity, label: '/status', desc: 'Show current session and model status' },
  { id: 'whoami', icon: User, label: '/whoami', desc: 'Show the current sender identity' },
  { id: 'new', icon: Plus, label: '/new', desc: 'Start a fresh session, optionally with a model' },
  { id: 'reset', icon: RotateCcw, label: '/reset', desc: 'Reset the current session context' },
  { id: 'model', icon: Cpu, label: '/model', desc: 'Inspect or switch the active model' },
  { id: 'think', icon: Code, label: '/think', desc: 'Adjust reasoning level for the session' },
  { id: 'fast', icon: Server, label: '/fast', desc: 'Toggle fast-mode for the session' },
  { id: 'verbose', icon: FileText, label: '/verbose', desc: 'Control extra debug and tool output' },
  { id: 'reasoning', icon: MessageSquare, label: '/reasoning', desc: 'Control reasoning message output' },
  { id: 'compact', icon: LayoutDashboard, label: '/compact', desc: 'Compact the current conversation context' },
  { id: 'memory', icon: Brain, label: '/memory', desc: 'View agent long-term memory context' },
  { id: 'stop', icon: Square, label: '/stop', desc: 'Stop the running task in this session' },
];

export default function ChatRoom({
  agentId,
  chatId,
  connectionId,
  channelConnectionId,
  onBack,
  onOpenConversation,
  isDesktop,
  showSplitButton,
  splitActive,
  isSplitPane,
  onToggleSplit,
  onCloseSplit,
}: {
  agentId?: string | null;
  chatId?: string | null;
  connectionId?: string | null;
  channelConnectionId?: string | null;
  onBack: () => void;
  onOpenConversation: (chatId: string) => void;
  isDesktop?: boolean;
  showSplitButton?: boolean;
  splitActive?: boolean;
  isSplitPane?: boolean;
  onToggleSplit?: () => void;
  onCloseSplit?: () => void;
}) {
  const activeConn = connectionId ? getConnectionById(connectionId) : getActiveConnection();
  const connId = activeConn?.id || '';
  const runtimeConnId = channelConnectionId || connId;
  const [messages, setMessages] = useState<Message[]>([]);
  // Tick every 30s so "follow up" pill can appear after 2min without re-render trigger
  const [, setTick] = useState(0);
  useEffect(() => {
    const timer = setInterval(() => setTick((t) => t + 1), 30000);
    return () => clearInterval(timer);
  }, []);
  const [agentInfo, setAgentInfo] = useState<AgentInfo | null>(() => getAgentInfo(agentId, connId));
  const [agentContext, setAgentContext] = useState<AgentContext | null>(() => (
    channel.getAgentContext(runtimeConnId, agentId ?? undefined) ??
    channel.getAgentContext(connId, agentId ?? undefined)
  ));
  const [isContextLoading, setIsContextLoading] = useState(false);
  const [hasLoadedMessages, setHasLoadedMessages] = useState(false);
  const [inputValue, setInputValue] = useState('');
  const [showSlashMenu, setShowSlashMenu] = useState(false);
  const [showEmojiPicker, setShowEmojiPicker] = useState(false);
  const [reactingToMsgId, setReactingToMsgId] = useState<string | null>(null);
  const [wsStatus, setWsStatus] = useState<string>(channel.getStatus(runtimeConnId));
  const [agentPresence, setAgentPresence] = useState<{ status: string; lastSeen?: number } | null>(null);
  const prevWsStatusRef = useRef<string>(channel.getStatus(runtimeConnId));
  const [showReconnected, setShowReconnected] = useState(false);
  const [errorToast, setErrorToast] = useState<{ code: string; message: string } | null>(null);
  const [isThinking, setIsThinking] = useState(false);
  const [thinkingPhase, setThinkingPhase] = useState<string>('');
  const thinkingTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const thinkingStartRef = useRef<number>(0);
  const [activeToolCalls, setActiveToolCalls] = useState<{ toolCallId: string; toolName: string; args?: Record<string, unknown>; startTime: number }[]>([]);
  const retryingRef = useRef<Set<string>>(new Set()); // B1: prevent double-tap retry
  const [isRecording, setIsRecording] = useState(false);
  const [recordingSeconds, setRecordingSeconds] = useState(0);
  const recordingTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const [replyingTo, setReplyingTo] = useState<Message | null>(null);
  const [peerTyping, setPeerTyping] = useState(false);
  const [editingMsg, setEditingMsg] = useState<Message | null>(null);
  const [showHeaderMenu, setShowHeaderMenu] = useState(false);
  const [showHistoryDrawer, setShowHistoryDrawer] = useState(false);
  const [showFileGallery, setShowFileGallery] = useState(false);
  const [showContextViewer, setShowContextViewer] = useState(false);
  const [showMoreIcons, setShowMoreIcons] = useState(false);
  const [copiedMsgId, setCopiedMsgId] = useState<string | null>(null);

  const copyMessage = useCallback((msgId: string, text: string) => {
    navigator.clipboard.writeText(text).then(() => {
      setCopiedMsgId(msgId);
      setTimeout(() => setCopiedMsgId(null), 1500);
    }).catch(() => {});
  }, []);
  const [conversations, setConversations] = useState<ConversationSummary[]>([]);
  const [loadingConversations, setLoadingConversations] = useState(false);
  const [hasMoreHistory, setHasMoreHistory] = useState(false);
  const [loadingMoreHistory, setLoadingMoreHistory] = useState(false);
  const [agentReady, setAgentReady] = useState(false);
  const agentReadyTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const prevAgentIdRef = useRef<string | null | undefined>(undefined);
  const streamingSourceAgentRef = useRef<string | null>(null); // Track which agent owns current streaming
  const lastTypingSentRef = useRef(0);
  const fileInputRef2 = useRef<HTMLInputElement>(null);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const scrollContainerRef = useRef<HTMLDivElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const audioChunksRef = useRef<Blob[]>([]);
  const skills = agentInfo?.skills ?? [];

  // B1: Retry pending message — dequeue first, send, re-enqueue on failure
  const retryMessage = async (msg: Message) => {
    if (retryingRef.current.has(msg.id)) return; // prevent double-tap
    retryingRef.current.add(msg.id);
    try {
      // Dequeue from outbox BEFORE sending to prevent outbox flush duplicate
      await outbox.dequeue(msg.id).catch(() => {});
      channel.reconnect(runtimeConnId);
      // Give reconnect a moment to establish
      await new Promise((r) => setTimeout(r, 300));
      try {
        const payload = msg.replyTo
          ? channel.sendTextWithParent(msg.text, msg.replyTo, agentId || undefined, runtimeConnId)
          : channel.sendText(msg.text, agentId || undefined, runtimeConnId);
        setMessages((prev) => prev.map((m) => m.id === msg.id ? { ...m, id: payload.messageId || m.id, deliveryStatus: 'sent' as DeliveryStatus } : m));
      } catch {
        // Send failed — re-enqueue for next reconnect
        await outbox.enqueue({
          id: msg.id, connectionId: runtimeConnId, agentId: agentId || '',
          content: msg.text, type: 'text', replyTo: msg.replyTo, timestamp: msg.timestamp,
        }).catch(() => {});
      }
    } finally {
      retryingRef.current.delete(msg.id);
    }
  };
  const skillCount = skills.length;

  useEffect(() => {
    setAgentInfo(getAgentInfo(agentId, connId));
    setAgentContext(
      channel.getAgentContext(runtimeConnId, agentId ?? undefined) ??
      channel.getAgentContext(connId, agentId ?? undefined),
    );
    setIsContextLoading(false);
    setAgentPresence(null); // S4: Reset presence on agent switch
    // Mark agent as read when entering chat
    if (connId && agentId) {
      markAgentAsRead(connId, agentId);
    }
  }, [agentId, connId, runtimeConnId]);

  useEffect(() => {
    // no-op: skills panel removed, skills now in slash menu
  }, [skillCount]);

  useEffect(() => {
    return channel.onAgentContextChange((contextConnectionId, contextAgentId, nextContext) => {
      if (contextConnectionId !== runtimeConnId || contextAgentId !== agentId) {
        return;
      }

      setAgentContext(nextContext);
      setIsContextLoading(false);
    });
  }, [agentId, runtimeConnId]);

  const requestAgentContext = useCallback(() => {
    if (!agentId || !runtimeConnId) return;
    setIsContextLoading(true);
    try {
      channel.requestAgentContext(agentId, runtimeConnId);
    } catch {
      setIsContextLoading(false);
    }
  }, [agentId, runtimeConnId]);

  const refreshAgentMeta = useCallback(() => {
    if (!runtimeConnId) return;

    if (agentId) {
      requestAgentContext();
    }

    try {
      channel.requestAgentList(runtimeConnId);
    } catch {
      // ignore disconnected refresh attempts
    }
  }, [agentId, requestAgentContext, runtimeConnId]);

  useEffect(() => {
    if (!showContextViewer || !agentId || !runtimeConnId) {
      return;
    }

    const cachedContext = channel.getAgentContext(runtimeConnId, agentId) ?? channel.getAgentContext(connId, agentId);
    if (cachedContext) {
      setAgentContext(cachedContext);
      setIsContextLoading(false);
      return;
    }

    if (wsStatus !== 'connected') {
      setIsContextLoading(wsStatus === 'connecting' || wsStatus === 'reconnecting');
      return;
    }

    requestAgentContext();
  }, [agentId, connId, requestAgentContext, runtimeConnId, showContextViewer, wsStatus]);

  useEffect(() => {
    setMessages([]);
    setHasLoadedMessages(false);
    setHasMoreHistory(false);
    setLoadingMoreHistory(false);
    streamingSourceAgentRef.current = null; // Clear streaming source tracking on agent change

    if (!connId || !agentId) {
      setHasLoadedMessages(true);
      return;
    }

    let cancelled = false;

    void loadConversationMessages(connId, agentId, {
      chatId,
      limit: DEFAULT_LOAD_LIMIT,
    }).then((cachedMessages) => {
      if (cancelled) return;
      setMessages((currentMessages) => mergeMessages(cachedMessages, currentMessages));
      setHasLoadedMessages(true);
    }).catch(() => {
      if (!cancelled) {
        setHasLoadedMessages(true);
      }
    });

    return () => {
      cancelled = true;
    };
  }, [agentId, chatId, connId]);

  // Persist messages on change (debounced to avoid thrashing IndexedDB)
  const saveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => {
    if (!connId || !agentId || !hasLoadedMessages) return;
    if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
    saveTimerRef.current = setTimeout(() => {
      if (messages.length === 0) {
        void clearConversationMessages(connId, agentId, { chatId });
        return;
      }
      void saveConversationMessages(connId, agentId, messages, { chatId });
      saveAgentPreview(agentId, connId, messages);
    }, 500);
    return () => { if (saveTimerRef.current) clearTimeout(saveTimerRef.current); };
  }, [hasLoadedMessages, messages, agentId, connId, chatId]);

  useEffect(() => {
    if (!connId || !agentId) {
      setPeerTyping(false);
      return;
    }

    const syncPeerTyping = (typingAgentIds?: string[]) => {
      const agentIds = typingAgentIds ?? channel.getTypingAgents(runtimeConnId);
      setPeerTyping(agentIds.includes(agentId));
    };

    syncPeerTyping();
    return channel.onTypingChange((typingConnectionId, typingAgentIds) => {
      if (typingConnectionId !== runtimeConnId) return;
      syncPeerTyping(typingAgentIds);
    });
  }, [agentId, connId, runtimeConnId]);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages, isThinking]);

  // WebSocket 连接 & 消息监听
  useEffect(() => {
    if (!activeConn || !runtimeConnId) return;
    // Use explicit chatId if provided; otherwise let server assign via connection.open
    const conversationId = chatId || activeConn.chatId || undefined;
    const requestSelectedHistory = () => {
      const effectiveId = chatId || activeConn?.chatId;
      if (!effectiveId) return;
      try { channel.requestHistory(effectiveId, agentId || undefined, runtimeConnId, { limit: 20 }); } catch { /* ignore */ }
    };

    setIsThinking(false); if (thinkingTimerRef.current) { clearInterval(thinkingTimerRef.current); thinkingTimerRef.current = null; }
    setActiveToolCalls([]);
    setShowHeaderMenu(false);
    setShowHistoryDrawer(false);
    setConversations([]);
    setWsStatus(channel.getStatus(runtimeConnId));
    prevWsStatusRef.current = channel.getStatus(runtimeConnId);

    const currentStatus = channel.getStatus(runtimeConnId);
    const currentChatId = channel.getChatId(runtimeConnId);

    // Bug 3: Only call selectAgent if agentId actually changed
    const agentChanged = prevAgentIdRef.current !== agentId;
    prevAgentIdRef.current = agentId;

    // If already connected to the same chat: just select agent + request history
    if (currentStatus === 'connected' && (!chatId || currentChatId === chatId)) {
      // Bug 1 & 3: Only select agent if it actually changed
      if (agentId && agentChanged) {
        setAgentReady(false);
        channel.selectAgent(agentId, runtimeConnId);
        // Bug 1: Fallback timeout in case agent.selected is not received
        if (agentReadyTimeoutRef.current) clearTimeout(agentReadyTimeoutRef.current);
        agentReadyTimeoutRef.current = setTimeout(() => setAgentReady(true), 1500);
      } else if (agentId) {
        // Agent unchanged, already ready
        setAgentReady(true);
      }
      requestSelectedHistory();
    } else if (currentStatus !== 'connecting') {
      // Not connected: establish connection (without agentId)
      channel.connect({
        connectionId: runtimeConnId,
        chatId: conversationId,
        senderId: activeConn.senderId || getUserId(),
        senderName: activeConn.displayName,
        serverUrl: activeConn.serverUrl,
        // Note: agentId not passed — agent is selected after connection via selectAgent()
        token: activeConn.token,
      });
    }

    const unsubMsg = channel.onMessage((packet) => {
      if (packet.type === 'connection.open') {
        // Connection established: select agent + request history
        if (agentId) {
          setAgentReady(false);
          channel.selectAgent(agentId, runtimeConnId);
          // Bug 1: Fallback timeout in case agent.selected is not received
          if (agentReadyTimeoutRef.current) clearTimeout(agentReadyTimeoutRef.current);
          agentReadyTimeoutRef.current = setTimeout(() => setAgentReady(true), 1500);
        }
        // Bug 4: Use packet.data.chatId if our chatId is empty (first-time entry)
        const effectiveChatId = chatId || (packet.data?.chatId as string);
        if (effectiveChatId) {
          try { channel.requestHistory(effectiveChatId, agentId || undefined, runtimeConnId, { limit: 20 }); } catch { /* ignore */ }
        }
      } else if (packet.type === 'agent.selected') {
        // Bug 1: Server confirmed agent selection
        if (agentReadyTimeoutRef.current) {
          clearTimeout(agentReadyTimeoutRef.current);
          agentReadyTimeoutRef.current = null;
        }
        setAgentReady(true);
      } else if (packet.type === 'message.send' && (packet.data?.content || packet.data?.mediaUrl)) {
        // Message isolation: only accept messages for current agent
        const packetAgentId = (packet.data.agentId as string | undefined) || undefined;
        if (packetAgentId && agentId && packetAgentId !== agentId) {
          // Ignore messages from other agents (prevents cross-agent contamination)
          return;
        }
        // Fallback: if server didn't send agentId, use streaming source tracking
        if (!packetAgentId && agentId && streamingSourceAgentRef.current && streamingSourceAgentRef.current !== agentId) {
          return;
        }

        // Clear streaming source on final message delivery
        streamingSourceAgentRef.current = null;
        const content = (packet.data.content as string) || '';
        const mediaUrl = packet.data.mediaUrl as string | undefined;
        const contentType = packet.data.contentType as string | undefined;
        const mimeType = packet.data.mimeType as string | undefined;

        // Determine media type from contentType or mimeType
        let mediaType: string | undefined;
        if (contentType === 'image' || mimeType?.startsWith('image/')) {
          mediaType = 'image';
        } else if (contentType === 'voice' || contentType === 'audio' || mimeType?.startsWith('audio/')) {
          mediaType = contentType === 'voice' ? 'voice' : 'audio';
        } else if (mediaUrl) {
          mediaType = 'file';
        }

        // Remove any streaming placeholder before adding the final message
        setMessages((prev) => {
          const msgId = packet.data.messageId || Date.now().toString();
          // Deduplicate: if a message with this ID already exists, update it instead of appending
          if (prev.some((m) => m.id === msgId && !m.isStreaming)) {
            return prev.map((m) => m.id === msgId ? {
              ...m,
              text: content || m.text,
              mediaUrl: mediaUrl || m.mediaUrl,
              mediaType: mediaType || m.mediaType,
              replyTo: (packet.data.replyTo as string) || m.replyTo,
            } : m);
          }
          const withoutStreaming = prev.filter((m) => !m.isStreaming);
          return [
            ...withoutStreaming,
            {
              id: msgId,
              sender: 'ai',
              text: content || (mediaType === 'image' ? '[Image]' : mediaType === 'file' ? `📎 File` : ''),
              replyTo: (packet.data.replyTo as string) || undefined,
              timestamp: (packet.data.timestamp as number) || Date.now(),
              mediaUrl,
              mediaType,
            },
          ];
        });

        // Push notification (browser)
        if (localStorage.getItem('openclaw.pushNotif') !== '0' && 'Notification' in window && Notification.permission === 'granted' && document.hidden) {
          new Notification(agentInfo?.name || 'OpenClaw', {
            body: content.slice(0, 100),
            icon: '/icon-192.svg',
          });
        }

        // S1: Mark ALL pending/sent user messages as delivered (bot responded = all prior msgs received)
        setActiveToolCalls([]); // S3: Clear stale tool calls on final message
        setMessages((prev) => {
          let changed = false;
          const next = prev.map((m) => {
            if (m.sender === 'user' && m.deliveryStatus && m.deliveryStatus !== 'delivered' && m.deliveryStatus !== 'read') {
              changed = true;
              return { ...m, deliveryStatus: 'delivered' as DeliveryStatus };
            }
            return m;
          });
          return changed ? next : prev;
        });
      } else if (packet.type === 'reaction.add' || packet.type === 'reaction.remove') {
        const { messageId, emoji } = packet.data as { messageId: string; emoji: string };
        setMessages((prev) => prev.map((m) => {
          if (m.id !== messageId) return m;
          const reactions = m.reactions || [];
          if (packet.type === 'reaction.add') {
            return { ...m, reactions: reactions.includes(emoji) ? reactions : [...reactions, emoji] };
          }
          return { ...m, reactions: reactions.filter((r) => r !== emoji) };
        }));
      } else if (packet.type === 'tool.start') {
        const d = packet.data as { toolCallId?: string; toolName?: string; args?: Record<string, unknown>; agentId?: string };
        if (!d.agentId || !agentId || d.agentId === agentId) {
          const tc = { toolCallId: d.toolCallId || `tc-${Date.now()}`, toolName: d.toolName || 'tool', args: d.args, startTime: Date.now() };
          setActiveToolCalls((prev) => [...prev, tc]);
          setThinkingPhase(formatToolName(d.toolName || 'tool'));
          setIsThinking(true);
        }
      } else if (packet.type === 'tool.end') {
        const d = packet.data as { toolCallId?: string; agentId?: string };
        if (!d.agentId || !agentId || d.agentId === agentId) {
          setActiveToolCalls((prev) => prev.filter((tc) => tc.toolCallId !== d.toolCallId));
        }
      } else if (packet.type === 'thinking.start') {
        // Only accept thinking for current agent (ignore events without agentId or from other agents)
        const thinkAgentId = (packet.data as { agentId?: string }).agentId;
        if (!thinkAgentId || !agentId || thinkAgentId === agentId) {
          setIsThinking(true);
          setThinkingPhase('Thinking');
          thinkingStartRef.current = Date.now();
          // Progressive phase labels (ChatGPT-style)
          if (thinkingTimerRef.current) clearInterval(thinkingTimerRef.current);
          thinkingTimerRef.current = setInterval(() => {
            const elapsed = Date.now() - thinkingStartRef.current;
            if (elapsed > 15000) setThinkingPhase('Working on it…');
            else if (elapsed > 8000) setThinkingPhase('Putting it together');
            else if (elapsed > 4000) setThinkingPhase('Analyzing');
          }, 1000);
        }
      } else if (packet.type === 'thinking.update') {
        const d = packet.data as { agentId?: string; content?: string };
        if (!d.agentId || !agentId || d.agentId === agentId) {
          setIsThinking(true);
          // If update carries content (e.g. tool name), show it
          if (d.content) {
            setThinkingPhase(d.content);
          }
        }
      } else if (packet.type === 'thinking.end') {
        // keep thinking visible until message.send arrives
        if (thinkingTimerRef.current) { clearInterval(thinkingTimerRef.current); thinkingTimerRef.current = null; }
      } else if (packet.type === 'status.delivered' || packet.type === 'status.read') {
        // Channel status event: update delivery status on matching user message
        const d = packet.data as { messageId?: string; status?: string };
        if (d.messageId) {
          const newStatus: DeliveryStatus = packet.type === 'status.read' ? 'read' : 'delivered';
          setMessages((prev) => prev.map((m) =>
            m.id === d.messageId && m.sender === 'user' ? { ...m, deliveryStatus: newStatus } : m
          ));
        }
      } else if (packet.type === 'message.edit') {
        const d = packet.data as { messageId: string; content: string };
        setMessages((prev) => prev.map((m) => m.id === d.messageId ? { ...m, text: d.content } : m));
      } else if (packet.type === 'message.delete') {
        const d = packet.data as { messageId: string };
        setMessages((prev) => prev.filter((m) => m.id !== d.messageId));
      } else if (packet.type === 'history.sync' && Array.isArray(packet.data?.messages)) {
        // Message isolation: only accept history for current agent
        const historyAgentId = packet.data.agentId as string | undefined;
        if (historyAgentId && agentId && historyAgentId !== agentId) {
          return;
        }
        const hasMore = Boolean(packet.data.hasMore);
        setHasMoreHistory(hasMore);
        setLoadingMoreHistory(false);
        const history = (packet.data.messages as Array<{messageId?: string; content?: string; direction?: string; senderId?: string; timestamp?: number; mediaUrl?: string; contentType?: string; mimeType?: string}>).map((m) => {
          let mediaType: string | undefined;
          if (m.contentType === 'image' || m.mimeType?.startsWith('image/')) {
            mediaType = 'image';
          } else if (m.contentType === 'voice' || m.contentType === 'audio' || m.mimeType?.startsWith('audio/')) {
            mediaType = m.contentType === 'voice' ? 'voice' : 'audio';
          } else if (m.mediaUrl) {
            mediaType = 'file';
          }
          return {
            id: m.messageId || Date.now().toString(),
            sender: (m.direction === 'sent' ? 'user' : 'ai') as 'user' | 'ai',
            text: m.content || (mediaType === 'image' ? '[Image]' : mediaType === 'file' ? '📎 File' : ''),
            timestamp: m.timestamp || Date.now(),
            mediaUrl: m.mediaUrl,
            mediaType,
          };
        });
        setMessages((prev) => {
          // Merge history — don't replace if we already have messages, to prevent disappearing
          if (prev.length === 0) return history;
          const existingIds = new Set(prev.map(m => m.id));
          const newMsgs = history.filter(m => !existingIds.has(m.id));
          if (newMsgs.length === 0) return prev; // no new messages, keep current
          // If history has significantly more messages, it's a fresh load — use it
          if (history.length > prev.length * 1.5) return history;
          // Otherwise merge new messages and sort by timestamp
          return [...prev, ...newMsgs].sort((a, b) => (a.timestamp ?? 0) - (b.timestamp ?? 0));
        });
      } else if (packet.type === 'conversation.list') {
        const nextConversations = Array.isArray((packet.data as { conversations?: ConversationSummary[] }).conversations)
          ? [ ...((packet.data as { conversations?: ConversationSummary[] }).conversations || []) ].sort((a, b) => ((b.timestamp || b.lastTimestamp || 0) - (a.timestamp || a.lastTimestamp || 0)))
          : [];
        setConversations(nextConversations);
        setLoadingConversations(false);
      } else if (packet.type === 'agent.list') {
        const nextAgents = Array.isArray((packet.data as { agents?: AgentInfo[] }).agents)
          ? ((packet.data as { agents?: AgentInfo[] }).agents ?? [])
          : [];
        channel.saveCachedAgents(connId, nextAgents);
        setAgentInfo(nextAgents.find((agent) => agent.id === agentId) ?? null);
      } else if (packet.type === 'user.status') {
        // Agent presence update
        const d = packet.data as { userId?: string; status?: string; lastSeen?: number };
        if (d.userId === agentId || !d.userId) {
          setAgentPresence({ status: d.status || 'online', lastSeen: d.lastSeen });
        }
      } else if (packet.type === 'relay.backend.disconnected') {
        // Gateway grace period — backend temporarily down
        setAgentPresence({ status: 'offline', lastSeen: Date.now() });
      } else if (packet.type === 'relay.backend.reconnected') {
        // Backend recovered during grace period
        setAgentPresence({ status: 'online' });
      } else if (packet.type === 'stream.resume') {
        // Stream resume after reconnection — restore accumulated streaming text
        const resumeData = packet.data as { chatId?: string; agentId?: string; text?: string; isComplete?: boolean; startTime?: number };
        const resumeAgentId = resumeData.agentId;
        
        // Message isolation: only accept for current agent
        if (resumeAgentId && agentId && resumeAgentId !== agentId) {
          return;
        }
        
        setIsThinking(false); if (thinkingTimerRef.current) { clearInterval(thinkingTimerRef.current); thinkingTimerRef.current = null; }
        
        // Show "Restoring…" phase briefly
        if (!resumeData.isComplete && resumeData.text) {
          setThinkingPhase('Restoring stream…');
          setIsThinking(true);
          setTimeout(() => setIsThinking(false), 800);
        }
        
        if (resumeData.isComplete) {
          // Stream already completed on server — history.sync will deliver the final message.
          // Just clear streaming state; don't create a duplicate message here.
          streamingSourceAgentRef.current = null;
          setMessages((prev) => prev.filter((m) => !m.isStreaming));
        } else if (typeof resumeData.text === 'string') {
          // Stream still in progress — show as streaming message
          streamingSourceAgentRef.current = resumeAgentId || agentId || null;
          setMessages((prev) => {
            const withoutStreaming = prev.filter((m) => !m.isStreaming);
            return [
              ...withoutStreaming,
              {
                id: `streaming-${Date.now()}`,
                sender: 'ai',
                text: resumeData.text,
                isStreaming: true,
                timestamp: resumeData.startTime || Date.now(),
              },
            ];
          });
        }
      } else if (packet.type === 'text.delta') {
        // Message isolation: only accept streaming for current agent
        const packetAgentId = (packet.data.agentId as string | undefined) || undefined;
        const deltaData = packet.data as { chatId?: string; text?: string; done?: boolean; timestamp?: number };
        
        if (deltaData.done) {
          // Streaming finished - clear source tracking and remove streaming placeholder
          streamingSourceAgentRef.current = null;
          setMessages((prev) => prev.filter((m) => !m.isStreaming));
        } else {
          // Determine the source agent of this stream
          // First delta without agentId — assume it belongs to current agent at time of request
          if (!streamingSourceAgentRef.current && !packetAgentId) {
            streamingSourceAgentRef.current = agentId || null;
          } else if (packetAgentId && !streamingSourceAgentRef.current) {
            streamingSourceAgentRef.current = packetAgentId;
          }
          
          // Filter: reject if source agent doesn't match current view
          const sourceAgent = packetAgentId || streamingSourceAgentRef.current;
          if (sourceAgent && agentId && sourceAgent !== agentId) {
            return;
          }

          if (localStorage.getItem('openclaw.streaming.enabled') === 'false') return;

          // Streaming text output from backend
          setIsThinking(false); if (thinkingTimerRef.current) { clearInterval(thinkingTimerRef.current); thinkingTimerRef.current = null; } // Hide thinking indicator when streaming starts

          if (typeof deltaData.text === 'string') {
            // Update or create streaming bubble with accumulated text
            setMessages((prev) => {
              const streamingIdx = prev.findIndex((m) => m.isStreaming);
              if (streamingIdx >= 0) {
                // Update existing streaming message
                const updated = [...prev];
                updated[streamingIdx] = { ...updated[streamingIdx], text: deltaData.text! };
                return updated;
              }
              // Create new streaming message
              return [
                ...prev,
                {
                  id: `streaming-${Date.now()}`,
                  sender: 'ai',
                  text: deltaData.text,
                  isStreaming: true,
                  timestamp: deltaData.timestamp || Date.now(),
                },
              ];
            });
          }
        }
      }
    }, runtimeConnId);

    const unsubStatus = channel.onStatus((status) => {
      // Detect reconnect: was disconnected/reconnecting → now connected
      if (status === 'connected' && prevWsStatusRef.current !== 'connected' && prevWsStatusRef.current !== 'connecting') {
        setShowReconnected(true);
        setTimeout(() => setShowReconnected(false), 2500);

        // Flush offline outbox — send pending messages
        outbox.getByConnection(runtimeConnId).then(async (entries) => {
          for (const entry of entries) {
            try {
              if (entry.type === 'text') {
                entry.replyTo
                  ? channel.sendTextWithParent(entry.content, entry.replyTo, entry.agentId || undefined, runtimeConnId)
                  : channel.sendText(entry.content, entry.agentId || undefined, runtimeConnId);
              } else if (entry.type === 'media' && entry.mediaUrl) {
                channel.sendMedia({
                  messageType: 'image',
                  content: entry.content || '',
                  mediaUrl: entry.mediaUrl,
                  mimeType: entry.mimeType || 'application/octet-stream',
                  agentId: entry.agentId || undefined,
                }, runtimeConnId);
              }
              // B2: Update UI: pending → sent + dequeue
              setMessages((prev) => prev.map((m) =>
                m.id === entry.id ? { ...m, deliveryStatus: 'sent' as DeliveryStatus } : m
              ));
              await outbox.dequeue(entry.id);
            } catch (err) {
              // B2: continue to next entry instead of blocking all — only break on connection errors
              const isConnectionError = !navigator.onLine || (err instanceof Error && /closed|not open|CLOSING/i.test(err.message));
              if (isConnectionError) break; // connection-level: stop trying
              // else: per-message error, skip this one and continue
              continue;
            }
          }
        }).catch(() => {});
      }
      prevWsStatusRef.current = status;
      setWsStatus(status);
      if (status === 'disconnected') {
        setLoadingConversations(false);
      }
    }, runtimeConnId);

    const unsubError = channel.onError((_connId, error) => {
      setErrorToast(error);
      setTimeout(() => setErrorToast(null), 6000);
    });

    return () => {
      unsubMsg();
      unsubStatus();
      unsubError();
      if (agentReadyTimeoutRef.current) {
        clearTimeout(agentReadyTimeoutRef.current);
        agentReadyTimeoutRef.current = null;
      }
      // S2: Clean up thinking timer on unmount
      if (thinkingTimerRef.current) {
        clearInterval(thinkingTimerRef.current);
        thinkingTimerRef.current = null;
      }
      // Don't close channel here — next connect() will replace it,
      // and StrictMode double-invoke would kill the connection prematurely
    };
  }, [agentId, chatId, activeConn?.id, connId, runtimeConnId]);

  const lastConvListRequestRef = useRef<number>(0);
  const requestConversationList = useCallback(() => {
    if (!agentId || !runtimeConnId) return;
    // Debounce: skip if requested within last 2 seconds
    const now = Date.now();
    if (now - lastConvListRequestRef.current < 2000) return;
    lastConvListRequestRef.current = now;
    setLoadingConversations(true);
    try {
      channel.requestConversationList(agentId, runtimeConnId);
    } catch {
      setLoadingConversations(false);
    }
  }, [agentId, runtimeConnId]);

  useEffect(() => {
    if (!showHistoryDrawer || !activeConn || !runtimeConnId || !agentId) return;

    const drawerStatus = channel.getStatus(runtimeConnId);
    if (drawerStatus !== 'connected' && drawerStatus !== 'connecting') {
      channel.connect({
        connectionId: runtimeConnId,
        chatId: chatId || activeConn.chatId || undefined,
        senderId: activeConn.senderId || getUserId(),
        senderName: activeConn.displayName,
        serverUrl: activeConn.serverUrl,
        // Note: agentId not passed — agent is selected via selectAgent()
        token: activeConn.token,
      });
    }

    if (drawerStatus === 'connected' || wsStatus === 'connected') {
      requestConversationList();
    } else {
      setLoadingConversations(true);
    }
  }, [activeConn, agentId, chatId, requestConversationList, runtimeConnId, showHistoryDrawer, wsStatus]);

  // ── Load more history on scroll to top ──
  const loadMoreHistory = useCallback(() => {
    if (loadingMoreHistory || !hasMoreHistory || !chatId || !agentId || !runtimeConnId) return;
    const oldest = messages[0];
    if (!oldest?.timestamp) return;
    setLoadingMoreHistory(true);
    channel.requestHistory(chatId, agentId, runtimeConnId, { limit: 20, before: oldest.timestamp });
  }, [loadingMoreHistory, hasMoreHistory, chatId, agentId, runtimeConnId, messages]);

  useEffect(() => {
    const container = scrollContainerRef.current;
    if (!container) return;
    const handleScroll = () => {
      if (container.scrollTop < 80 && hasMoreHistory && !loadingMoreHistory) {
        loadMoreHistory();
      }
    };
    container.addEventListener('scroll', handleScroll, { passive: true });
    return () => container.removeEventListener('scroll', handleScroll);
  }, [hasMoreHistory, loadingMoreHistory, loadMoreHistory]);

  // Preserve scroll position when prepending older messages
  useEffect(() => {
    const container = scrollContainerRef.current;
    if (!container || !loadingMoreHistory) return;
    // After messages update + loadingMoreHistory becomes false, scroll will auto-adjust
    // because React inserts at top — we rely on browser's scroll anchoring
  }, [messages, loadingMoreHistory]);

  const typingTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const handleInputChange = (e: ChangeEvent<HTMLInputElement>) => {
    const val = e.target.value;
    setInputValue(val);
    // Show unified slash menu when typing "/" — keep open for "/use skillname" too
    setShowSlashMenu(val.startsWith('/') && (
      !val.includes(' ') || val.startsWith('/use ')
    ));

    // Bug 2: Throttle typing indicator to prevent WS spam
    if (val.trim()) {
      const now = Date.now();
      if (now - lastTypingSentRef.current > 3000) {
        try { channel.sendTyping(true, runtimeConnId); } catch {}
        lastTypingSentRef.current = now;
      }
      if (typingTimer.current) clearTimeout(typingTimer.current);
      typingTimer.current = setTimeout(() => { try { channel.sendTyping(false, runtimeConnId); } catch {} }, 3000);
    }
  };

  // Edit message
  const handleEditMessage = (msg: Message) => {
    setEditingMsg(msg);
    setInputValue(msg.text);
  };

  const handleSaveEdit = () => {
    if (!editingMsg || !inputValue.trim()) return;
    channel.editMessage(editingMsg.id, inputValue.trim(), runtimeConnId);
    setMessages((prev) => prev.map((m) => m.id === editingMsg.id ? { ...m, text: inputValue.trim() } : m));
    setEditingMsg(null);
    setInputValue('');
  };

  const handleCancelEdit = () => {
    setEditingMsg(null);
    setInputValue('');
  };

  // Delete message
  const handleDeleteMessage = (msgId: string) => {
    channel.deleteMessage(msgId, runtimeConnId);
    setMessages((prev) => prev.filter((m) => m.id !== msgId));
  };

  // File picker — now stages file for preview before sending
  const [pendingFile, setPendingFile] = useState<{ file: File; dataUrl: string; isImage: boolean } | null>(null);
  const [fileCaption, setFileCaption] = useState('');

  const handleFilePick = () => fileInputRef2.current?.click();
  const handleFileSelected2 = async (e: ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    e.target.value = '';
    const dataUrl = await fileToDataUrl(file);
    const isImage = file.type.startsWith('image/');
    setPendingFile({ file, dataUrl, isImage });
    setFileCaption('');
  };

  const handleSendPendingFile = async () => {
    if (!pendingFile) return;
    const { file, dataUrl, isImage } = pendingFile;
    const caption = fileCaption.trim();
    
    // Optimistic UI update using dataUrl immediately
    const userMsg: Message = {
      id: Date.now().toString(),
      sender: 'user',
      text: caption || (isImage ? '' : `📎 ${file.name}`),
      mediaType: isImage ? 'image' : 'file',
      mediaUrl: dataUrl,
      timestamp: Date.now(),
      deliveryStatus: 'sent',
    };
    setMessages((prev) => [...prev, userMsg]);
    setPendingFile(null);
    setFileCaption('');

    try {
      let finalUrl = dataUrl;
      // Try to upload to relay if file > 100KB to save bandwidth/WS overhead
      // (Small files can stay inline base64 for speed)
      if (file.size > 100 * 1024) {
        try {
          // @ts-ignore - uploadFile added recently
          if (channel.uploadFile) {
            // @ts-ignore
            finalUrl = await channel.uploadFile(file, runtimeConnId);
            console.log('[ChatRoom] Uploaded file:', finalUrl);
          }
        } catch (err) {
          console.warn('[ChatRoom] Upload failed, falling back to base64:', err);
        }
      }

      channel.sendFile({ 
        content: caption || file.name, 
        mediaUrl: finalUrl, 
        mimeType: file.type, 
        fileName: file.name, 
        agentId: agentId || undefined 
      }, runtimeConnId);
    } catch (err) {
      console.error('[ChatRoom] Failed to send file message:', err);
      setErrorToast({ code: 'SEND_FAILED', message: err instanceof Error ? err.message : 'Failed to send file' });
      setTimeout(() => setErrorToast(null), 6000);
    }
  };

  const handleCancelPendingFile = () => {
    setPendingFile(null);
    setFileCaption('');
  };

  const handleSend = () => {
    if (editingMsg) { handleSaveEdit(); return; }
    if (!inputValue.trim()) return;
    if (!agentReady) return; // Bug 1: Prevent sending before agent is ready
    if (inputValue.trim() === '/memory') {
      setShowMemory(true);
      setInputValue('');
      setShowSlashMenu(false);
      return;
    }
    const replyId = replyingTo?.id;
    const capturedInput = inputValue;
    setInputValue('');
    setShowSlashMenu(false);
    setReplyingTo(null);

    try {
      // Send first to get the stable messageId, then use it for the local message
      const payload = replyId
        ? channel.sendTextWithParent(capturedInput, replyId, agentId || undefined, runtimeConnId)
        : channel.sendText(capturedInput, agentId || undefined, runtimeConnId);
      const userMsg: Message = {
        id: payload.messageId || Date.now().toString(),
        sender: 'user',
        text: capturedInput,
        replyTo: replyId,
        timestamp: payload.timestamp || Date.now(),
        deliveryStatus: 'sent',
      };
      setMessages((prev) => [...prev, userMsg]);
    } catch {
      // Offline: queue message in outbox with 'pending' status
      const msgId = `pending-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
      const userMsg: Message = {
        id: msgId,
        sender: 'user',
        text: capturedInput,
        replyTo: replyId,
        timestamp: Date.now(),
        deliveryStatus: 'pending',
      };
      setMessages((prev) => [...prev, userMsg]);
      outbox.enqueue({
        id: msgId,
        connectionId: runtimeConnId,
        agentId: agentId || '',
        content: capturedInput,
        type: 'text',
        replyTo: replyId,
        timestamp: Date.now(),
      }).catch(() => { /* ignore outbox write failure */ });
    }
  };

  const quickSend = (text: string) => {
    if (text.trim() === '/memory') {
      setShowMemory(true);
      setShowSlashMenu(false);
      setInputValue('');
      return;
    }
    try {
      const payload = channel.sendText(text, agentId || undefined, runtimeConnId);
      const userMsg: Message = { id: payload.messageId || Date.now().toString(), sender: 'user', text, timestamp: payload.timestamp || Date.now(), deliveryStatus: 'sent' };
      setMessages((prev) => [...prev, userMsg]);
    } catch {
      const msgId = `pending-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
      setMessages((prev) => [...prev, { id: msgId, sender: 'user', text, timestamp: Date.now(), deliveryStatus: 'pending' as DeliveryStatus }]);
      outbox.enqueue({ id: msgId, connectionId: runtimeConnId, agentId: agentId || '', content: text, type: 'text', timestamp: Date.now() }).catch(() => {});
    }
  };

  // --- Image sending — now stages for preview ---
  const handleImagePick = () => fileInputRef.current?.click();

  const handleFileSelected = async (e: ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file || !file.type.startsWith('image/')) return;
    e.target.value = '';
    const dataUrl = await fileToDataUrl(file);
    setPendingFile({ file, dataUrl, isImage: true });
    setFileCaption('');
  };

  // --- Voice recording ---
  const toggleRecording = useCallback(async () => {
    if (isRecording && mediaRecorderRef.current) {
      mediaRecorderRef.current.stop();
      setIsRecording(false);
      setRecordingSeconds(0);
      if (recordingTimerRef.current) { clearInterval(recordingTimerRef.current); recordingTimerRef.current = null; }
      return;
    }

    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const recorder = new MediaRecorder(stream, { mimeType: 'audio/webm' });
      audioChunksRef.current = [];

      recorder.ondataavailable = (e) => {
        if (e.data.size > 0) audioChunksRef.current.push(e.data);
      };

      recorder.onstop = async () => {
        stream.getTracks().forEach((t) => t.stop());
        if (recordingTimerRef.current) { clearInterval(recordingTimerRef.current); recordingTimerRef.current = null; }
        const blob = new Blob(audioChunksRef.current, { type: 'audio/webm' });
        const reader = new FileReader();
        reader.onload = () => {
          const dataUrl = reader.result as string;
          const userMsg: Message = {
            id: Date.now().toString(),
            sender: 'user',
            text: '[Voice]',
            mediaType: 'voice',
            deliveryStatus: 'sent',
          };
          setMessages((prev) => [...prev, userMsg]);

          try {
            channel.sendMedia({
              messageType: 'voice',
              content: '',
              mediaUrl: dataUrl,
              mimeType: 'audio/webm',
              agentId: agentId || undefined,
            }, runtimeConnId);
          } catch { /* ignore */ }
        };
        reader.readAsDataURL(blob);
      };

      mediaRecorderRef.current = recorder;
      recorder.start();
      setIsRecording(true);
      setRecordingSeconds(0);
      recordingTimerRef.current = setInterval(() => setRecordingSeconds((s) => s + 1), 1000);
    } catch {
      setMessages((prev) => [
        ...prev,
        { id: `err-${Date.now()}`, sender: 'ai', text: '⚠️ Microphone access denied.' },
      ]);
    }
  }, [agentId, isRecording, runtimeConnId]);

  const handleCommandSelect = (cmd: string) => {
    // Commands that need additional arguments → fill input
    const needsArgs = ['/new', '/think', '/model'];
    if (needsArgs.includes(cmd)) {
      setInputValue(cmd + ' ');
      setShowSlashMenu(false);
      return;
    }
    // Stand-alone commands → send directly
    quickSend(cmd);
    setShowSlashMenu(false);
  };

  const handleEmojiSelect = (emoji: string) => {
    if (reactingToMsgId) {
      // reaction mode: toggle via protocol
      const msg = messages.find((m) => m.id === reactingToMsgId);
      const hasReaction = msg?.reactions?.includes(emoji);

      // Optimistic local update
      setMessages(prev => prev.map(m => {
        if (m.id !== reactingToMsgId) return m;
        const reactions = m.reactions || [];
        return {
          ...m,
          reactions: hasReaction ? reactions.filter(r => r !== emoji) : [...reactions, emoji],
        };
      }));

      // Send to server
      try {
        if (hasReaction) {
          channel.removeReaction(reactingToMsgId, emoji, runtimeConnId);
        } else {
          channel.addReaction(reactingToMsgId, emoji, runtimeConnId);
        }
      } catch { /* ignore */ }
    } else {
      // send emoji as a message directly
      const emojiMsg: Message = { id: Date.now().toString(), sender: 'user', text: emoji, timestamp: Date.now(), deliveryStatus: 'sent' };
      setMessages((prev) => [...prev, emojiMsg]);
      try {
        channel.sendText(emoji, undefined, runtimeConnId);
      } catch {
        // ignore
      }
    }
    setShowEmojiPicker(false);
    setReactingToMsgId(null);
  };

  const openReactionPicker = (msgId: string) => {
    setReactingToMsgId(msgId);
    setShowEmojiPicker(true);
    setShowSlashMenu(false);
  };

  const startReply = (msg: Message) => {
    setReplyingTo(msg);
  };
  
  const [showMemory, setShowMemory] = useState(false);

  // Long-press for mobile message actions
  const [longPressedMsgId, setLongPressedMsgId] = useState<string | null>(null);
  const longPressTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const handleTouchStart = (msgId: string) => {
    longPressTimer.current = setTimeout(() => setLongPressedMsgId(msgId), 400);
  };
  const handleTouchEnd = () => {
    if (longPressTimer.current) { clearTimeout(longPressTimer.current); longPressTimer.current = null; }
  };
  const closeLongPress = () => setLongPressedMsgId(null);

  // Global keyboard shortcuts (Escape to dismiss modals)
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        if (showEmojiPicker) { setShowEmojiPicker(false); return; }
        if (showSlashMenu) { setShowSlashMenu(false); return; }
        if (showHeaderMenu) { setShowHeaderMenu(false); return; }
        if (replyingTo) { setReplyingTo(null); return; }
        if (editingMsg) { setEditingMsg(null); return; }
        if (showHistoryDrawer) { setShowHistoryDrawer(false); return; }
        if (showContextViewer) { setShowContextViewer(false); return; }
        if (longPressedMsgId) { closeLongPress(); return; }
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [showEmojiPicker, showSlashMenu, showHeaderMenu, replyingTo, editingMsg, showHistoryDrawer, showContextViewer, longPressedMsgId]);

  const openHistoryDrawer = () => {
    setShowHeaderMenu(false);
    setShowHistoryDrawer(true);
  };
  const openFileGallery = () => {
    setShowHeaderMenu(false);
    setShowFileGallery(true);
  };
  const handleConversationSwitch = (nextChatId: string) => {
    setShowHistoryDrawer(false);
    setShowHeaderMenu(false);
    if (nextChatId === chatId) return;
    onOpenConversation(nextChatId);
  };

  return (
    <div className="flex flex-col h-full bg-surface dark:bg-surface-dark relative">
      {/* Header */}
      <div className="px-4 py-2 sticky top-0 bg-white/80 dark:bg-card-alt/80 backdrop-blur-[20px] border-b border-border dark:border-border-dark z-20 flex items-center justify-between min-h-[48px]">
        {!isDesktop && (
          <motion.button whileTap={{ scale: 0.9 }} onClick={onBack} className="p-2 -ml-2 text-text dark:text-text-inv" aria-label="Go back">
            <ChevronLeft size={28} />
          </motion.button>
        )}
        <div className={`flex flex-col ${isDesktop ? 'items-start ml-2' : 'items-center'}`}>
          <h2 className="font-semibold text-[17px] text-text dark:text-text-inv leading-tight truncate max-w-[200px] md:max-w-none">
            {agentInfo ? `${agentInfo.identityEmoji || '🤖'} ${agentInfo.name}` : agentId || 'OpenClaw Bot'}
          </h2>
          <p className="text-[11px] text-text/40 dark:text-text-inv/35 truncate max-w-[200px] md:max-w-none -mt-0.5">
            {getConnectionDisplayName(activeConn?.name, activeConn?.displayName)}{agentInfo?.model ? ` · ${agentInfo.model.split('/').pop()}` : ''}
          </p>
          <span className={`text-[10px] font-medium flex items-center gap-1 ${
            wsStatus === 'connected' ? 'text-primary' : wsStatus === 'connecting' || wsStatus === 'reconnecting' ? 'text-amber-500' : 'text-red-400'
          }`}>
            {wsStatus === 'connected' && <><div className={`w-1.5 h-1.5 rounded-full ${agentPresence?.status === 'offline' ? 'bg-gray-400' : 'bg-primary'}`} /> {agentPresence?.status === 'offline' ? formatLastSeen(agentPresence.lastSeen) || 'offline' : 'online'}</>}
            {wsStatus === 'connecting' && <><Loader2 size={10} className="animate-spin" /> Connecting…</>}
            {wsStatus === 'reconnecting' && <><Loader2 size={10} className="animate-spin" /> Reconnecting…</>}
            {wsStatus === 'disconnected' && (
              <button
                onClick={() => channel.reconnect(runtimeConnId)}
                className="flex items-center gap-1 hover:opacity-80 transition-opacity"
                aria-label="Tap to reconnect"
              >
                <RefreshCw size={10} /> Tap to reconnect
              </button>
            )}
          </span>
        </div>
        <div className="flex items-center gap-1">
          {!isSplitPane && showSplitButton && agentId && onToggleSplit && (
            <motion.button
              whileTap={{ scale: 0.96 }}
              onClick={onToggleSplit}
              className={cn(
                'inline-flex items-center gap-1.5 rounded-full border px-3 py-1.5 text-[12px] font-medium transition-colors',
                splitActive
                  ? 'border-primary/30 bg-primary/10 text-primary'
                  : 'border-border/70 bg-white/75 text-text/65 hover:border-primary/25 hover:text-primary dark:border-border-dark/70 dark:bg-card-alt/75 dark:text-text-inv/65'
              )}
              aria-label="Toggle split view"
            >
              <Columns2 size={15} />
              <span>Split</span>
            </motion.button>
          )}
          <motion.button
            whileTap={{ scale: 0.9 }}
            onClick={() => {
              const newChatId = `chat-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
              onOpenConversation(newChatId);
            }}
            className="p-2.5 text-text dark:text-text-inv rounded-full active:bg-text/5 dark:active:bg-text-inv/5 transition-colors"
            aria-label="New conversation"
          >
            <Plus size={20} />
          </motion.button>
          <motion.button whileTap={{ scale: 0.9 }} onClick={openHistoryDrawer} className="p-2.5 text-text dark:text-text-inv rounded-full active:bg-text/5 dark:active:bg-text-inv/5 transition-colors" aria-label="Open history drawer">
            <MessageSquare size={20} />
          </motion.button>
          {isSplitPane && onCloseSplit && (
            <motion.button whileTap={{ scale: 0.9 }} onClick={onCloseSplit} className="p-2.5 text-text dark:text-text-inv rounded-full active:bg-text/5 dark:active:bg-text-inv/5 transition-colors" aria-label="Close split view">
              <X size={20} />
            </motion.button>
          )}
          <motion.button whileTap={{ scale: 0.9 }} onClick={() => setShowHeaderMenu(!showHeaderMenu)} className="p-2.5 -mr-2 text-text dark:text-text-inv rounded-full active:bg-text/5 dark:active:bg-text-inv/5 transition-colors" aria-label="More options">
            <MoreHorizontal size={24} />
          </motion.button>
        </div>
      </div>

      {/* Header context menu */}
      <AnimatePresence>
        {showHeaderMenu && (
          <>
            <motion.div
              initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
              className="fixed inset-0 z-30"
              onClick={() => setShowHeaderMenu(false)}
            />
            <motion.div
              initial={{ opacity: 0, y: -10, scale: 0.95 }}
              animate={{ opacity: 1, y: 0, scale: 1 }}
              exit={{ opacity: 0, y: -10, scale: 0.95 }}
              className="absolute top-[48px] right-4 z-40 bg-white dark:bg-card-alt border border-border dark:border-border-dark rounded-2xl shadow-xl p-1.5 min-w-[180px]"
            >
              <button
                onClick={openHistoryDrawer}
                className="w-full flex items-center gap-3 px-3 py-2.5 rounded-xl text-left text-[14px] text-text dark:text-text-inv hover:bg-surface dark:hover:bg-surface-dark transition-colors"
              >
                <MessageSquare size={16} />
                Conversation History
              </button>
              <button
                onClick={openFileGallery}
                className="w-full flex items-center gap-3 px-3 py-2.5 rounded-xl text-left text-[14px] text-text dark:text-text-inv hover:bg-surface dark:hover:bg-surface-dark transition-colors"
              >
                <Paperclip size={16} />
                Files &amp; Media
              </button>
              <button
                onClick={() => { setShowHeaderMenu(false); setShowMemory(true); }}
                className="w-full flex items-center gap-3 px-3 py-2.5 rounded-xl text-left text-[14px] text-text dark:text-text-inv hover:bg-surface dark:hover:bg-surface-dark transition-colors"
              >
                <Cpu size={16} />
                View Memory
              </button>
              <button
                onClick={() => {
                  setMessages([]);
                  setHasLoadedMessages(true);
                  if (connId && agentId) {
                    void clearConversationMessages(connId, agentId, { chatId });
                    localStorage.removeItem(getPreviewKey(connId, agentId));
                    emitPreviewUpdated(connId, agentId);
                  }
                  setShowHeaderMenu(false);
                }}
                className="w-full flex items-center gap-3 px-3 py-2.5 rounded-xl text-left text-[14px] text-red-500 hover:bg-red-50 dark:hover:bg-red-900/20 transition-colors"
              >
                <Trash2 size={16} />
                Clear Chat
              </button>
            </motion.div>
          </>
        )}
      </AnimatePresence>

      <AnimatePresence>
        {showHistoryDrawer && (
          <>
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              className="fixed inset-0 z-30 bg-black/25"
              onClick={() => setShowHistoryDrawer(false)}
            />
            <motion.div
              initial={isDesktop ? { opacity: 0, x: 32 } : { opacity: 0, y: 32 }}
              animate={isDesktop ? { opacity: 1, x: 0 } : { opacity: 1, y: 0 }}
              exit={isDesktop ? { opacity: 0, x: 32 } : { opacity: 0, y: 32 }}
              transition={{ type: 'spring', stiffness: 320, damping: 30 }}
              className={cn(
                'fixed z-40 bg-white dark:bg-card-alt shadow-2xl border border-border dark:border-border-dark',
                isDesktop
                  ? 'top-0 right-0 h-full w-[360px] max-w-[88vw] rounded-l-[28px]'
                  : 'left-0 right-0 bottom-0 max-h-[78vh] rounded-t-[28px]'
              )}
            >
              <div className="flex items-center justify-between px-5 py-4 border-b border-border dark:border-border-dark">
                <div>
                  <h3 className="text-[15px] font-semibold">Conversation History</h3>
                  <p className="text-[12px] text-text/45 dark:text-text-inv/45">
                    {agentInfo?.name || agentId || 'Agent'}
                  </p>
                </div>
                <div className="flex items-center gap-1">
                  <motion.button
                    whileTap={{ scale: 0.9 }}
                    onClick={() => {
                      const newChatId = `chat-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
                      setShowHistoryDrawer(false);
                      onOpenConversation(newChatId);
                    }}
                    className="p-2 text-primary hover:bg-primary/10 rounded-full"
                    title="New conversation"
                  >
                    <Plus size={18} />
                  </motion.button>
                  <motion.button whileTap={{ scale: 0.9 }} onClick={() => setShowHistoryDrawer(false)} className="p-2 text-text/55 dark:text-text-inv/55">
                    <X size={18} />
                  </motion.button>
                </div>
              </div>

              <div className="overflow-y-auto p-3 space-y-2 max-h-[calc(78vh-76px)] md:max-h-[calc(100vh-76px)]">
                {loadingConversations ? (
                  <div className="flex flex-col items-center justify-center py-16">
                    <Loader2 size={24} className="text-primary animate-spin mb-3" />
                    <p className="text-[13px] text-text/40 dark:text-text-inv/40">Loading conversations…</p>
                  </div>
                ) : conversations.length > 0 ? conversations.map((conversation) => (
                  <button
                    key={conversation.chatId}
                    type="button"
                    onClick={() => handleConversationSwitch(conversation.chatId)}
                    className={cn(
                      'w-full text-left rounded-[20px] border px-4 py-3 transition-colors',
                      chatId === conversation.chatId
                        ? 'border-primary bg-primary/5 dark:bg-primary/10'
                        : 'border-border/70 dark:border-border-dark/70 hover:border-primary/30'
                    )}
                  >
                    <div className="flex items-center justify-between gap-3 mb-1">
                      <p className="font-medium text-[14px] truncate">{conversation.title || conversation.lastMessage || conversation.lastContent || conversation.chatId}</p>
                      {(conversation.timestamp || conversation.lastTimestamp) && (
                        <span className="text-[11px] text-text/40 dark:text-text-inv/40 shrink-0">
                          {formatRelativeTime((conversation.timestamp || conversation.lastTimestamp)!)}
                        </span>
                      )}
                    </div>
                    <p className="text-[12px] text-text/45 dark:text-text-inv/45 line-clamp-2">
                      {conversation.lastMessage || conversation.lastContent || 'No messages yet'}
                    </p>
                  </button>
                )) : (
                  <div className="flex flex-col items-center justify-center text-center py-16 px-6">
                    <div className="w-14 h-14 rounded-full bg-primary/10 dark:bg-primary/15 flex items-center justify-center mb-4">
                      <MessageSquare size={22} className="text-primary" />
                    </div>
                    <p className="text-[15px] font-medium text-text dark:text-text-inv mb-1">No saved conversations</p>
                    <p className="text-[13px] text-text/40 dark:text-text-inv/40">This agent has no conversation history yet.</p>
                  </div>
                )}
              </div>
            </motion.div>
          </>
        )}
      </AnimatePresence>

      <FileGallery
        agentId={agentId}
        connectionId={connId}
        agentName={agentInfo?.name}
        isOpen={showFileGallery}
        isDesktop={isDesktop}
        onClose={() => setShowFileGallery(false)}
      />

      {/* Reconnect celebration toast */}
      {/* WhatsApp-style persistent disconnection banner */}
      <AnimatePresence>
        {(wsStatus === 'disconnected' || wsStatus === 'reconnecting') && (
          <motion.div
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: 'auto' }}
            exit={{ opacity: 0, height: 0 }}
            className={`w-full z-20 px-4 py-2 flex items-center justify-center gap-2 text-[13px] font-medium ${
              wsStatus === 'reconnecting'
                ? 'bg-amber-50 dark:bg-amber-900/20 text-amber-700 dark:text-amber-300 border-b border-amber-200 dark:border-amber-800/40'
                : 'bg-red-50 dark:bg-red-900/20 text-red-600 dark:text-red-300 border-b border-red-200 dark:border-red-800/40'
            }`}
          >
            {wsStatus === 'reconnecting' ? (
              <><Loader2 size={14} className="animate-spin" /> Reconnecting… Check your network.</>
            ) : (
              <>
                <WifiOff size={14} /> Connection lost.
                <button
                  onClick={() => channel.reconnect(runtimeConnId)}
                  className="underline font-semibold hover:opacity-80"
                >
                  Reconnect
                </button>
              </>
            )}
          </motion.div>
        )}
      </AnimatePresence>

      <AnimatePresence>
        {showReconnected && (
          <motion.div
            initial={{ opacity: 0, y: -10 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -10 }}
            className="absolute top-16 left-1/2 -translate-x-1/2 z-20 bg-primary text-white text-[13px] font-medium px-4 py-2 rounded-full shadow-lg shadow-primary/25 flex items-center gap-2"
          >
            <Wifi size={14} /> Back online!
          </motion.div>
        )}
      </AnimatePresence>

      {/* Error toast */}
      <AnimatePresence>
        {errorToast && (() => {
          const friendly = humanizeError(errorToast);
          return (
          <motion.div
            initial={{ opacity: 0, y: -10 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -10 }}
            className="absolute top-16 left-4 right-4 z-30 bg-red-500 text-white text-[13px] font-medium px-4 py-3 rounded-2xl shadow-lg flex items-start gap-3"
          >
            <WifiOff size={16} className="flex-shrink-0 mt-0.5" />
            <div className="flex-1 min-w-0">
              <p className="font-semibold">{friendly.title}</p>
              <p className="text-white/80 text-[12px] mt-0.5 break-words">{friendly.body}</p>
            </div>
            <button onClick={() => setErrorToast(null)} className="flex-shrink-0 text-white/70 hover:text-white">
              <X size={16} />
            </button>
          </motion.div>
          );
        })()}
      </AnimatePresence>

      {/* Messages */}
      <div ref={scrollContainerRef} className="flex-1 overflow-y-auto overflow-x-hidden px-4 py-6 pb-4 flex flex-col overscroll-contain" style={{ WebkitOverflowScrolling: 'touch' }}>
        {/* Load more indicator */}
        {loadingMoreHistory && (
          <div className="flex justify-center py-3">
            <Loader2 size={18} className="text-primary animate-spin" />
          </div>
        )}
        {hasMoreHistory && !loadingMoreHistory && messages.length > 0 && (
          <button
            type="button"
            onClick={loadMoreHistory}
            className="text-[12px] text-primary/70 hover:text-primary text-center py-2"
          >
            Load earlier messages…
          </button>
        )}
        {/* Empty chat welcome — skeleton loading */}
        {!hasLoadedMessages && (
          <div className="flex-1 flex flex-col gap-4 px-4 py-6">
            {[1, 2, 3].map((i) => (
              <div key={i} className="flex gap-3 animate-pulse" style={{ opacity: 1 - i * 0.2 }}>
                <div className="w-8 h-8 rounded-full bg-border dark:bg-border-dark flex-shrink-0" />
                <div className="flex-1 space-y-2">
                  <div className="flex items-center gap-2">
                    <div className="h-3 w-16 bg-border dark:bg-border-dark rounded" />
                    <div className="h-2.5 w-10 bg-border/60 dark:bg-border-dark/60 rounded" />
                  </div>
                  <div className="h-3 bg-border dark:bg-border-dark rounded w-3/4" />
                  {i === 1 && <div className="h-3 bg-border dark:bg-border-dark rounded w-1/2" />}
                </div>
              </div>
            ))}
          </div>
        )}
        {hasLoadedMessages && messages.length === 0 && (
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.2, type: 'spring', stiffness: 300, damping: 25 }}
            className="flex-1 flex flex-col items-center justify-center text-center px-6"
          >
            <div className="relative mb-5">
              <div className="absolute inset-0 rounded-[24px] bg-[radial-gradient(circle_at_top_left,_rgba(239,90,35,0.18),_transparent_55%)] blur-xl" />
              <div className="relative w-20 h-20 rounded-[24px] border border-primary/20 bg-gradient-to-br from-primary/12 via-white to-primary/5 dark:from-primary/18 dark:via-card-alt dark:to-primary/8 flex items-center justify-center shadow-lg shadow-primary/10 overflow-hidden">
                <span className="relative text-3xl">{agentInfo?.identityEmoji || '🤖'}</span>
              </div>
            </div>
            <div className="space-y-2 max-w-[300px]">
              <h3 className="text-lg font-semibold">{agentInfo?.name || 'Agent'}</h3>
              <p className="text-text/50 dark:text-text-inv/50 text-[14px] leading-relaxed">
                {agentInfo?.description || `${agentInfo?.name || 'This agent'} is ready for chat, tools, and slash commands.`}
              </p>
              {skillCount > 0 && (
                <div className="inline-flex items-center gap-2 rounded-full border border-primary/15 bg-white/80 dark:bg-card-alt/80 px-3 py-1.5 text-[12px] font-medium text-text/60 dark:text-text-inv/60 shadow-sm">
                  <Puzzle size={13} className="text-primary" />
                  {skillCount} skills available
                </div>
              )}
            </div>
          </motion.div>
        )}
        {messages.map((msg, i) => {
          const isUser = msg.sender === 'user';
          const isStreaming = msg.isStreaming;
          const hasCodeBlock = !isUser && msg.text?.includes('```');
          const isErrorMsg = !isUser && msg.text?.startsWith('⚠️');
          const prevMsg = i > 0 ? messages[i - 1] : null;
          const showDateSep = isDifferentDay(prevMsg?.timestamp, msg.timestamp);
          const grouped = !showDateSep && isGroupedWithPrev(messages, i);
          return (
            <div key={msg.id}>
              {/* Date separator */}
              {showDateSep && msg.timestamp && (
                <div className="flex items-center gap-3 my-4">
                  <div className="flex-1 h-px bg-border dark:bg-border-dark" />
                  <span className="text-[11px] text-text/45 dark:text-text-inv/40 font-medium">{formatDate(msg.timestamp)}</span>
                  <div className="flex-1 h-px bg-border dark:bg-border-dark" />
                </div>
              )}
              {/* Flat thread-style message (Slack/Discord inspired, no bubbles) */}
              <div
                className={`group/msg flex gap-3 px-2 py-0.5 rounded-lg hover:bg-black/[0.02] dark:hover:bg-white/[0.02] transition-colors relative animate-in ${grouped ? '' : 'mt-3'}`}
                onTouchStart={() => handleTouchStart(msg.id)}
                onTouchEnd={handleTouchEnd}
                onTouchMove={handleTouchEnd}
              >
                {/* Avatar column — show avatar or time-on-hover placeholder */}
                <div className="w-8 flex-shrink-0 pt-0.5">
                  {!grouped ? (
                    <div className={`w-8 h-8 rounded-full flex items-center justify-center text-white shadow-sm text-sm ${
                      isUser
                        ? 'bg-gradient-to-br from-info to-accent'
                        : 'bg-gradient-to-br from-primary to-primary-deep'
                    }`}>
                      {isUser ? <User size={16} /> : (agentInfo?.identityEmoji || '🤖')}
                    </div>
                  ) : (
                    <span className="hidden group-hover/msg:block text-[10px] text-text/30 dark:text-text-inv/25 tabular-nums leading-8 text-center">
                      {formatTime(msg.timestamp)}
                    </span>
                  )}
                </div>

                {/* Content column */}
                <div className="flex-1 min-w-0 overflow-x-hidden">
                  {/* Header row: name + timestamp + inline reply ref (only for first in group) */}
                  {!grouped && (
                    <div className="flex items-baseline gap-2 mb-0.5 flex-wrap">
                      <span className={`text-[14px] font-bold ${isUser ? 'text-info' : 'text-primary'}`}>
                        {isUser ? 'You' : (agentInfo?.name || 'Bot')}
                      </span>
                      {msg.timestamp && (
                        <span className="text-[10px] text-text/30 dark:text-text-inv/25 tabular-nums">
                          {formatTime(msg.timestamp)}
                        </span>
                      )}
                      {!isUser && agentInfo?.model && (
                        <span className="text-[9px] text-text/35 dark:text-text-inv/30 font-medium bg-text/5 dark:bg-text-inv/5 rounded-full px-2 py-px">
                          {agentInfo.model.split('/').pop()}
                        </span>
                      )}
                      {/* Inline reply reference — compact, deduplicated */}
                      {msg.replyTo && (() => {
                        // Skip if previous message from same sender already shows the same replyTo
                        const prevRef = i > 0 ? messages[i - 1] : null;
                        const isDuplicateRef = prevRef && prevRef.sender === msg.sender && prevRef.replyTo === msg.replyTo;
                        if (isDuplicateRef) return null;
                        const quoted = messages.find((m) => m.id === msg.replyTo);
                        if (!quoted) return null;
                        const previewText = quoted.text.slice(0, 30) + (quoted.text.length > 30 ? '…' : '');
                        return (
                          <span className="text-[10px] text-text/40 dark:text-text-inv/35 truncate max-w-[200px]" title={quoted.text.slice(0, 200)}>
                            ↩ {quoted.sender === 'user' ? 'You' : 'Bot'}: {previewText}
                          </span>
                        );
                      })()}
                    </div>
                  )}

                  {/* Message content */}
                  <div className={`text-[15px] leading-relaxed relative overflow-x-hidden ${
                    isErrorMsg ? 'text-red-600 dark:text-red-400' : 'text-text dark:text-text-inv'
                  } ${hasCodeBlock ? 'border-l-[3px] border-l-primary/50 pl-3' : ''}`}>
                    {/* Image / Voice / File / Text */}
                    {(msg.mediaType === 'image' && msg.mediaUrl) ? (
                      <div>
                        <img src={msg.mediaUrl} alt="Message attachment" loading="lazy" className="max-w-full rounded-lg shadow-sm max-h-[300px] object-cover mt-1" />
                        {msg.text && <p className="mt-1.5 text-[15px]">{msg.text}</p>}
                        {msg.timestamp && isUser && (
                          <span className="md:hidden text-[10px] float-right mt-1 ml-3 tabular-nums text-text/50 dark:text-text-inv/45">
                            {formatTime(msg.timestamp)}<DeliveryTicks status={msg.deliveryStatus} isUser={isUser} />
                          </span>
                        )}
                      </div>
                    ) : (msg.mediaType === 'voice' || msg.mediaType === 'audio') && msg.mediaUrl ? (
                      <div className="flex flex-col gap-1">
                        <div className="flex items-center gap-2 bg-surface/60 dark:bg-[#131420]/60 p-2 rounded-lg max-w-[280px]">
                          <audio src={msg.mediaUrl} controls className="h-8 w-full max-w-[240px]" />
                        </div>
                        {msg.text && <p className="text-[13px] opacity-80">{msg.text}</p>}
                      </div>
                    ) : msg.mediaType === 'file' && msg.mediaUrl ? (
                      <div className="flex items-center gap-3 bg-surface dark:bg-[#131420] p-3 rounded-xl border border-border dark:border-border-dark max-w-[300px] mt-1">
                        <div className="w-10 h-10 rounded-lg bg-info/10 flex items-center justify-center text-info shrink-0">
                          <FileText size={20} />
                        </div>
                        <div className="flex-1 min-w-0">
                          <p className="text-[14px] font-medium truncate">{msg.text || 'File'}</p>
                          <a href={msg.mediaUrl} target="_blank" rel="noopener noreferrer" className="text-[12px] text-info hover:underline">Download</a>
                        </div>
                      </div>
                    ) : isUser ? (
                      <div className="inline">
                        <span className="whitespace-pre-wrap break-words">{msg.text}</span>
                        {msg.timestamp && (
                          <span className="md:hidden text-[10px] text-text/40 dark:text-text-inv/40 float-right mt-1 ml-3 tabular-nums whitespace-nowrap">
                            {formatTime(msg.timestamp)}<DeliveryTicks status={msg.deliveryStatus} isUser={isUser} />
                          </span>
                        )}
                        {msg.deliveryStatus === 'pending' && (
                          <div className="md:hidden flex items-center gap-1 mt-1">
                            <button
                              onClick={() => retryMessage(msg)}
                              className="text-[11px] text-red-500 dark:text-red-400 underline"
                            >
                              ⟳ Retry
                            </button>
                          </div>
                        )}
                      </div>
                    ) : (
                      <div>
                        <MarkdownRenderer content={msg.text} />
                        {isStreaming && (
                          <span className="inline-block w-2 h-4 bg-primary ml-0.5 animate-pulse align-middle" />
                        )}
                      {/* Inline timestamp for bot messages (mobile) — model badge only in header */}
                        {!isUser && !isStreaming && msg.timestamp && (
                          <span className="md:hidden text-[10px] text-text/40 dark:text-text-inv/35 float-right mt-1 ml-3 tabular-nums whitespace-nowrap">
                            {formatTime(msg.timestamp)}
                          </span>
                        )}
                      </div>
                    )}
                  </div>

                  {/* Inline message actions — timestamp + delivery + retry (flat layout) */}
                  {!isStreaming && (
                    <div className="flex items-center gap-1.5 mt-0.5">
                      {msg.timestamp && (
                        <span className="hidden md:inline text-[10px] text-text/35 dark:text-text-inv/30 tabular-nums">
                          {formatTime(msg.timestamp)}<DeliveryTicks status={msg.deliveryStatus} isUser={isUser} />
                        </span>
                      )}
                      {isUser && msg.deliveryStatus === 'pending' && (
                        <button
                          onClick={() => retryMessage(msg)}
                          className="text-[10px] text-red-400 hover:text-red-500 underline"
                        >
                          ⟳ Retry
                        </button>
                      )}
                    </div>
                  )}

                  {/* Reactions */}
                  {msg.reactions && msg.reactions.length > 0 && (
                    <div className="flex gap-1 mt-1">
                      {msg.reactions.map((emoji, idx) => (
                        <motion.button
                          key={idx}
                          initial={{ scale: 0 }}
                          animate={{ scale: 1 }}
                          transition={{ type: 'spring', stiffness: 600, damping: 15 }}
                          whileTap={{ scale: 0.8 }}
                          onClick={() => {
                            setMessages((prev) => prev.map((m) => {
                              if (m.id !== msg.id) return m;
                              const reactions = m.reactions ?? [];
                              return { ...m, reactions: reactions.filter(r => r !== emoji) };
                            }));
                            channel.removeReaction(msg.id, emoji, runtimeConnId);
                          }}
                          className="inline-flex items-center gap-0.5 bg-surface dark:bg-[#1f2c34] rounded-full px-1.5 py-0.5 border border-border dark:border-border-dark text-[13px] hover:border-primary/30 transition-colors"
                        >
                          {emoji}
                        </motion.button>
                      ))}
                    </div>
                  )}

                  {/* Action Card for AI messages (hide for streaming) */}
                  {!isUser && !isStreaming && <ActionCard text={msg.text} onSend={quickSend} />}
                </div>

                {/* Hover actions (desktop) */}
                {!isStreaming && (
                  <div className="hidden md:flex items-center gap-0.5 opacity-0 group-hover/msg:opacity-100 transition-opacity absolute right-1 top-0.5">
                    {!isUser && (
                      <div className="relative group/emoji">
                        <button type="button" className="w-6 h-6 flex items-center justify-center text-text/25 dark:text-text-inv/20 hover:text-text/50 dark:hover:text-text-inv/45 rounded transition-colors">
                          <SmilePlus size={13} />
                        </button>
                        <div className={`absolute bottom-full right-0 mb-1.5 hidden group-hover/emoji:flex items-center gap-0.5 bg-white dark:bg-card-alt rounded-full px-1.5 py-1 border border-border dark:border-border-dark shadow-lg z-20 after:content-[''] after:absolute after:inset-x-0 after:-bottom-3 after:h-3`}>
                          {['👍', '❤️', '😂', '🎉', '🔥', '👀'].map((e) => (
                            <button
                              key={e}
                              type="button"
                              onClick={() => {
                                const hasIt = msg.reactions?.includes(e);
                                setMessages((prev) => prev.map((m) => {
                                  if (m.id !== msg.id) return m;
                                  const reactions = m.reactions ?? [];
                                  return { ...m, reactions: hasIt ? reactions.filter(r => r !== e) : [...reactions, e] };
                                }));
                                if (hasIt) { channel.removeReaction(msg.id, e, runtimeConnId); } else { channel.addReaction(msg.id, e, runtimeConnId); }
                              }}
                              className={`w-7 h-7 text-[15px] flex items-center justify-center rounded-full transition-all ${
                                msg.reactions?.includes(e) ? 'bg-primary/20 scale-110' : 'hover:bg-border dark:hover:bg-border-dark hover:scale-110'
                              }`}
                            >
                              {e}
                            </button>
                          ))}
                          <button
                            type="button"
                            onClick={() => openReactionPicker(msg.id)}
                            className="w-7 h-7 flex items-center justify-center text-text/40 dark:text-text-inv/35 hover:text-primary rounded-full hover:bg-border dark:hover:bg-border-dark transition-colors"
                          >
                            <SmilePlus size={13} />
                          </button>
                        </div>
                      </div>
                    )}
                    <button type="button" onClick={() => startReply(msg)} className="w-7 h-7 flex items-center justify-center text-text/25 dark:text-text-inv/20 hover:text-info hover:bg-info/10 rounded-md transition-colors" title="Reply">
                      <CornerDownLeft size={14} />
                    </button>
                    <button type="button" onClick={() => copyMessage(msg.id, msg.text)} className={`w-7 h-7 flex items-center justify-center rounded-md transition-colors ${copiedMsgId === msg.id ? 'text-green-500 bg-green-500/10' : 'text-text/25 dark:text-text-inv/20 hover:text-text/60 dark:hover:text-text-inv/50 hover:bg-text/5 dark:hover:bg-text-inv/5'}`} title={copiedMsgId === msg.id ? 'Copied!' : 'Copy'}>
                      {copiedMsgId === msg.id ? <Check size={14} /> : <Copy size={14} />}
                    </button>
                    {isUser && (
                      <>
                        <button type="button" onClick={() => handleEditMessage(msg)} className="w-7 h-7 flex items-center justify-center text-text/25 dark:text-text-inv/20 hover:text-amber-500 hover:bg-amber-500/10 rounded-md transition-colors">
                          <Pencil size={14} />
                        </button>
                        <button type="button" onClick={() => handleDeleteMessage(msg.id)} className="w-7 h-7 flex items-center justify-center text-text/25 dark:text-text-inv/20 hover:text-red-500 hover:bg-red-500/10 rounded-md transition-colors">
                          <Trash2 size={14} />
                        </button>
                      </>
                    )}
                  </div>
                )}
              </div>
            </div>
          );
        })}
        {/* Typing indicator */}
        {peerTyping && !isThinking && (
          <div className="flex items-center gap-2 px-2 text-[12px] text-text/55 dark:text-text-inv/55">
            <span className="w-1.5 h-1.5 bg-primary rounded-full animate-pulse" />
            {agentInfo?.name || 'Bot'} is typing…
          </div>
        )}

        {/* Thinking indicator */}
        <AnimatePresence>
          {isThinking && (
            <motion.div
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -5 }}
              className="flex gap-3 px-2 py-0.5 mt-3"
            >
              <div className="w-8 h-8 rounded-full bg-gradient-to-br from-primary to-primary-deep flex-shrink-0 flex items-center justify-center text-white shadow-sm text-sm">
                {agentInfo?.identityEmoji || '🤖'}
              </div>
              <div className="pt-2">
                {/* Breathing text indicator — no dots */}
                <span className="text-[13px] text-primary font-medium animate-pulse">
                  {thinkingPhase || 'Thinking'}
                </span>
                {activeToolCalls.length > 0 && (
                  <div className="mt-1.5 flex flex-col gap-1">
                    {activeToolCalls.map((tc) => (
                      <span key={tc.toolCallId} className="text-[11px] text-text/45 dark:text-text-inv/45 animate-pulse">
                        🔧 {formatToolName(tc.toolName)}
                        {tc.args && (tc.args as Record<string, unknown>).path && (
                          <span className="text-text/30 dark:text-text-inv/30 ml-1">
                            {String((tc.args as Record<string, unknown>).path || (tc.args as Record<string, unknown>).file_path || (tc.args as Record<string, unknown>).command || (tc.args as Record<string, unknown>).url || '').slice(0, 50)}
                          </span>
                        )}
                      </span>
                    ))}
                  </div>
                )}
              </div>
            </motion.div>
          )}
        </AnimatePresence>
        <div ref={messagesEndRef} />

        {/* WhatsApp-style long-press action sheet */}
        <AnimatePresence>
          {longPressedMsgId && (() => {
            const lMsg = messages.find(m => m.id === longPressedMsgId);
            if (!lMsg) return null;
            const lIsUser = lMsg.sender === 'user';
            return (
              <>
                {/* Blurred backdrop */}
                <motion.div
                  initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
                  className="fixed inset-0 bg-black/40 backdrop-blur-sm z-50 md:hidden"
                  onClick={closeLongPress}
                />
                {/* Floating message preview + emoji bar */}
                <motion.div
                  initial={{ opacity: 0, scale: 0.92 }}
                  animate={{ opacity: 1, scale: 1 }}
                  exit={{ opacity: 0, scale: 0.92 }}
                  transition={{ type: 'spring', stiffness: 400, damping: 28 }}
                  className="fixed inset-x-4 top-[15vh] z-50 md:hidden flex flex-col items-center"
                >
                  {/* Emoji reaction bar — floating above message */}
                  <motion.div
                    initial={{ opacity: 0, y: 10 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ delay: 0.05 }}
                    className="flex items-center gap-1 bg-[#1f2c34] dark:bg-[#1f2c34] rounded-full px-2 py-1.5 shadow-xl mb-2"
                  >
                    {['👍', '❤️', '😂', '😮', '😢', '🙏', '👏'].map((e) => (
                      <motion.button
                        key={e}
                        whileTap={{ scale: 0.75 }}
                        onClick={() => {
                          const hasIt = lMsg.reactions?.includes(e);
                          setMessages(prev => prev.map(m => {
                            if (m.id !== longPressedMsgId) return m;
                            const reactions = m.reactions ?? [];
                            return { ...m, reactions: hasIt ? reactions.filter(r => r !== e) : [...reactions, e] };
                          }));
                          if (hasIt) { channel.removeReaction(longPressedMsgId, e, runtimeConnId); } else { channel.addReaction(longPressedMsgId, e, runtimeConnId); }
                          closeLongPress();
                        }}
                        className={`w-10 h-10 text-[22px] flex items-center justify-center rounded-full transition-all ${
                          lMsg.reactions?.includes(e) ? 'bg-white/20 scale-110' : 'hover:bg-white/10'
                        }`}
                      >
                        {e}
                      </motion.button>
                    ))}
                    <motion.button
                      whileTap={{ scale: 0.85 }}
                      onClick={() => { openReactionPicker(longPressedMsgId); closeLongPress(); }}
                      className="w-10 h-10 flex items-center justify-center rounded-full text-white/60 hover:bg-white/10"
                    >
                      <SmilePlus size={18} />
                    </motion.button>
                  </motion.div>

                  {/* Message preview bubble */}
                  <div className={`max-w-[85%] ${lIsUser ? 'self-end' : 'self-start'}`}>
                    <div className={`px-4 py-3 rounded-[18px] text-[15px] leading-relaxed shadow-lg ${
                      lIsUser
                        ? 'bg-primary text-white rounded-tr-[6px]'
                        : 'bg-white dark:bg-card-alt text-text dark:text-text-inv rounded-tl-[6px]'
                    }`}>
                      <p className="line-clamp-4">{lMsg.text}</p>
                      {lMsg.timestamp && (
                        <span className={`text-[10px] float-right mt-1 ml-3 ${lIsUser ? 'text-white/60' : 'text-text/40 dark:text-text-inv/35'}`}>
                          {formatTime(lMsg.timestamp)}
                        </span>
                      )}
                    </div>
                  </div>
                </motion.div>

                {/* Bottom action sheet */}
                <motion.div
                  initial={{ opacity: 0, y: 100 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, y: 100 }}
                  transition={{ type: 'spring', stiffness: 350, damping: 30 }}
                  className="fixed bottom-0 left-0 right-0 z-50 md:hidden bg-[#1f2c34] dark:bg-[#1f2c34] rounded-t-2xl shadow-2xl pb-[max(1rem,env(safe-area-inset-bottom))]"
                >
                  <div className="flex flex-col">
                    <button
                      onClick={() => { startReply(lMsg); closeLongPress(); }}
                      className="flex items-center gap-4 px-6 py-3.5 text-[16px] text-white/90 active:bg-white/10 transition-colors"
                    >
                      <CornerDownLeft size={20} className="text-white/60" />
                      Reply
                    </button>
                    <button
                      onClick={() => {
                        copyMessage(lMsg.id, lMsg.text);
                        closeLongPress();
                      }}
                      className="flex items-center gap-4 px-6 py-3.5 text-[16px] text-white/90 active:bg-white/10 transition-colors"
                    >
                      <Copy size={20} className="text-white/60" />
                      Copy
                    </button>
                    {lIsUser && (
                      <>
                        <button
                          onClick={() => { handleEditMessage(lMsg); closeLongPress(); }}
                          className="flex items-center gap-4 px-6 py-3.5 text-[16px] text-white/90 active:bg-white/10 transition-colors"
                        >
                          <Pencil size={20} className="text-white/60" />
                          Edit
                        </button>
                        <button
                          onClick={() => { handleDeleteMessage(lMsg.id); closeLongPress(); }}
                          className="flex items-center gap-4 px-6 py-3.5 text-[16px] text-red-400 active:bg-white/10 transition-colors"
                        >
                          <Trash2 size={20} className="text-red-400/80" />
                          Delete
                        </button>
                      </>
                    )}
                  </div>
                </motion.div>
              </>
            );
          })()}
        </AnimatePresence>
      </div>

      {/* Input Area */}
      <div className="px-3 pt-1.5 bg-white/60 dark:bg-card-alt/60 backdrop-blur-md border-t border-border/50 dark:border-border-dark/50 z-30 flex-shrink-0 relative safe-area-bottom">
        <AnimatePresence>
          {showSlashMenu && (
            <>
              <motion.div
                initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
                className="fixed inset-0 z-40"
                onClick={() => setShowSlashMenu(false)}
              />
              <motion.div
                initial={{ opacity: 0, y: 8 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: 8 }}
                transition={{ duration: 0.15 }}
                className="absolute bottom-full left-0 right-0 mb-1 bg-white dark:bg-card-alt border border-border dark:border-border-dark rounded-xl z-50 max-h-[50vh] overflow-y-auto overflow-x-hidden"
              >
                {/* System commands section */}
                {(() => {
                  const filtered = slashCommands.filter(cmd =>
                    cmd.label.startsWith(inputValue) || inputValue === '/'
                  );
                  if (filtered.length === 0) return null;
                  return (
                    <>
                      <div className="px-3 pt-2 pb-1 text-[10px] font-semibold text-text/35 dark:text-text-inv/30 uppercase tracking-wider sticky top-0 bg-white dark:bg-card-alt">Commands</div>
                      {filtered.map(cmd => (
                        <button
                          key={cmd.id}
                          onClick={() => handleCommandSelect(cmd.label)}
                          className="w-full flex items-center gap-2.5 px-3 py-1.5 text-left hover:bg-surface dark:hover:bg-surface-dark transition-colors"
                        >
                          <div className="w-7 h-7 rounded-lg bg-text/[0.04] dark:bg-text-inv/[0.06] flex items-center justify-center text-text/50 dark:text-text-inv/45 shrink-0">
                            <cmd.icon size={14} />
                          </div>
                          <div className="min-w-0 flex-1">
                            <span className="text-[13px] font-medium text-text dark:text-text-inv">{cmd.label}</span>
                            <span className="ml-2 text-[11px] text-text/35 dark:text-text-inv/30 truncate">{cmd.desc}</span>
                          </div>
                        </button>
                      ))}
                    </>
                  );
                })()}

                {/* Skills section */}
                {skills.length > 0 && (inputValue === '/' || '/use'.startsWith(inputValue) || inputValue.startsWith('/use ')) && (
                  <>
                    <div className="px-3 pt-2 pb-1 text-[10px] font-semibold text-text/35 dark:text-text-inv/30 uppercase tracking-wider sticky top-0 bg-white dark:bg-card-alt flex items-center gap-1.5">
                      <Puzzle size={10} className="text-primary" />
                      Skills ({skillCount})
                    </div>
                    {skills
                      .filter(s => {
                        if (inputValue === '/' || inputValue === '/use') return true;
                        if (inputValue.startsWith('/use ')) {
                          const q = inputValue.slice(5).toLowerCase();
                          return s.toLowerCase().includes(q);
                        }
                        return `/use ${s}`.startsWith(inputValue);
                      })
                      .map(skillName => (
                        <button
                          key={`skill-${skillName}`}
                          onClick={() => handleCommandSelect(`/use ${skillName}`)}
                          className="w-full flex items-center gap-2.5 px-3 py-1.5 text-left hover:bg-surface dark:hover:bg-surface-dark transition-colors"
                        >
                          <div className="w-7 h-7 rounded-lg bg-primary/8 flex items-center justify-center text-primary shrink-0">
                            <Puzzle size={14} />
                          </div>
                          <div className="min-w-0 flex-1">
                            <span className="text-[13px] font-medium text-text dark:text-text-inv">{skillName}</span>
                            <span className="ml-2 text-[11px] text-text/35 dark:text-text-inv/30 truncate">{getSkillDescription(skillName)}</span>
                          </div>
                        </button>
                      ))}
                  </>
                )}

                {/* Empty state */}
                {slashCommands.filter(cmd => cmd.label.startsWith(inputValue) || inputValue === '/').length === 0
                  && !(skills.length > 0 && (inputValue.startsWith('/use ')))
                  && (
                  <div className="px-3 py-4 text-center text-[12px] text-text/35 dark:text-text-inv/30">
                    No matching commands
                  </div>
                )}
              </motion.div>
            </>
          )}

          {showEmojiPicker && (
            <>
              <motion.div
                initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
                className="fixed inset-0 bg-surface/40 dark:bg-surface-dark/40 backdrop-blur-md z-40"
                onClick={() => { setShowEmojiPicker(false); setReactingToMsgId(null); }}
              />
              <motion.div
                initial={{ opacity: 0, y: 20, scale: 0.95 }}
                animate={{ opacity: 1, y: 0, scale: 1 }}
                exit={{ opacity: 0, y: 10, scale: 0.95 }}
                className="absolute bottom-full left-0 right-0 mb-2 bg-white/95 dark:bg-card-alt/95 backdrop-blur-[20px] border border-border/50 dark:border-border-dark/50 shadow-2xl rounded-[24px] p-4 flex flex-wrap gap-2 justify-center z-50"
              >
                {EMOJI_LIST.map((emoji) => (
                  <motion.button
                    key={emoji}
                    whileTap={{ scale: 0.8 }}
                    onClick={() => handleEmojiSelect(emoji)}
                    className="w-10 h-10 text-2xl flex items-center justify-center hover:bg-white/50 dark:hover:bg-border-dark/50 rounded-full transition-colors"
                  >
                    {emoji}
                  </motion.button>
                ))}
              </motion.div>
            </>
          )}
        </AnimatePresence>

        {/* Dynamic suggestions area */}
        <AnimatePresence mode="popLayout">
          {/* Context suggestions after last bot message */}
          {messages.length > 0 && messages[messages.length - 1]?.sender === 'ai' && !showSlashMenu && !showEmojiPicker && (
            <motion.div
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: 10 }}
              className="flex items-center gap-1.5 overflow-x-auto pb-1 px-0.5 scrollbar-hide"
            >
              {/* Primary icon buttons — solid bg, larger touch target */}
              <motion.button
                whileTap={{ scale: 0.95 }}
                onClick={() => { setInputValue('/'); setShowSlashMenu(true); }}
                className="flex-shrink-0 inline-flex items-center gap-1 w-8 h-8 justify-center bg-primary/12 border border-primary/20 rounded-full text-primary transition-colors active:bg-primary/20"
                title={`Skills (${skillCount})`}
              >
                <Puzzle size={15} />
              </motion.button>
              <motion.button
                whileTap={{ scale: 0.95 }}
                onClick={() => setShowContextViewer(true)}
                className="flex-shrink-0 inline-flex items-center justify-center w-8 h-8 bg-primary/12 border border-primary/20 rounded-full text-primary transition-colors active:bg-primary/20"
                title="Context"
              >
                <FileText size={15} />
              </motion.button>
              <div className="h-5 w-px bg-border dark:bg-border-dark mx-0.5 shrink-0" />
              {/* Secondary suggestion pills — ghost style, clear hierarchy */}
              {CONTEXT_SUGGESTIONS.map((sug) => (
                <motion.button
                  key={sug.label}
                  whileTap={{ scale: 0.95 }}
                  onClick={() => setInputValue(sug.label)}
                  className="flex-shrink-0 inline-flex items-center gap-1 px-3 py-1.5 rounded-full text-[12px] font-medium text-text/60 dark:text-text-inv/55 hover:bg-text/5 dark:hover:bg-text-inv/5 active:bg-text/10 transition-colors"
                >
                  <span>{sug.emoji}</span>
                  {sug.label}
                </motion.button>
              ))}
            </motion.div>
          )}

          {/* Default quick commands when no context — with dynamic "follow up" when waiting too long */}
          {(messages.length === 0 || messages[messages.length - 1]?.sender === 'user') && !showSlashMenu && !showEmojiPicker && (
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              className="flex items-center gap-1.5 overflow-x-auto pb-1 px-0.5 scrollbar-hide"
            >
              {/* Primary icon buttons */}
              <motion.button
                whileTap={{ scale: 0.95 }}
                onClick={() => { setInputValue('/'); setShowSlashMenu(true); }}
                className="flex-shrink-0 inline-flex items-center gap-1 w-8 h-8 justify-center bg-primary/12 border border-primary/20 rounded-full text-primary transition-colors active:bg-primary/20"
                title={`Skills (${skillCount})`}
              >
                <Puzzle size={15} />
              </motion.button>
              <motion.button
                whileTap={{ scale: 0.95 }}
                onClick={() => setShowContextViewer(true)}
                className="flex-shrink-0 inline-flex items-center justify-center w-8 h-8 bg-primary/12 border border-primary/20 rounded-full text-primary transition-colors active:bg-primary/20"
                title="Context"
              >
                <FileText size={15} />
              </motion.button>
              <div className="h-5 w-px bg-border dark:bg-border-dark mx-0.5 shrink-0" />
              {/* Dynamic "follow up" pill — shows when last user message is > 2min old with no reply */}
              {messages.length > 0 && messages[messages.length - 1]?.sender === 'user' && messages[messages.length - 1]?.timestamp && (Date.now() - (messages[messages.length - 1]?.timestamp || 0)) > 120000 && !isThinking && (
                <motion.button
                  initial={{ opacity: 0, scale: 0.9 }}
                  animate={{ opacity: 1, scale: 1 }}
                  whileTap={{ scale: 0.95 }}
                  onClick={() => {
                    const lastMsg = messages[messages.length - 1];
                    quickSend(`进度怎么样了？上次我说的是："${lastMsg?.text?.slice(0, 50) || ''}"`);
                  }}
                  className="flex-shrink-0 inline-flex items-center gap-1 px-3 py-1.5 bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-700/40 rounded-full text-[12px] font-medium text-amber-600 dark:text-amber-400 active:bg-amber-100 transition-colors animate-pulse"
                >
                  <span>👋</span>
                  催一下
                </motion.button>
              )}
              {/* Tertiary quick commands — minimal styling */}
              {QUICK_COMMANDS.map((cmd) => (
                <motion.button
                  key={cmd.label}
                  whileTap={{ scale: 0.95 }}
                  onClick={() => quickSend(cmd.label)}
                  className="flex-shrink-0 inline-flex items-center gap-1 px-3 py-1.5 rounded-full text-[12px] font-medium text-text/60 dark:text-text-inv/55 hover:bg-text/5 dark:hover:bg-text-inv/5 active:bg-text/10 transition-colors"
                >
                  <span>{cmd.emoji}</span>
                  {cmd.label}
                </motion.button>
              ))}
            </motion.div>
          )}
        </AnimatePresence>

        {/* Edit bar */}
        {editingMsg && (
          <div className="flex items-center gap-2 px-4 py-2 mb-2 bg-amber-50 border border-amber-200 rounded-[16px]">
            <Pencil size={14} className="text-amber-500 flex-shrink-0" />
            <div className="flex-1 min-w-0">
              <p className="text-[11px] text-amber-600 font-medium">Editing message</p>
              <p className="text-[13px] text-amber-800/60 truncate">{editingMsg.text}</p>
            </div>
            <motion.button whileTap={{ scale: 0.8 }} onClick={handleCancelEdit} className="p-1 text-amber-400">
              <X size={16} />
            </motion.button>
          </div>
        )}

        {/* Reply bar */}
        <AnimatePresence>
          {replyingTo && (
            <motion.div
              initial={{ height: 0, opacity: 0 }}
              animate={{ height: 'auto', opacity: 1 }}
              exit={{ height: 0, opacity: 0 }}
              className="overflow-hidden"
            >
              <div className="flex items-center gap-2 px-4 py-2 mb-2 bg-white dark:bg-card-alt border border-blue-200 dark:border-blue-700 rounded-[16px]">
                <div className="w-1 h-8 bg-[#5B8DEF] rounded-full flex-shrink-0" />
                <div className="flex-1 min-w-0">
                  <p className="text-[11px] text-info font-medium">
                    Replying to {replyingTo.sender === 'user' ? 'yourself' : 'Bot'}
                  </p>
                  <p className="text-[13px] text-text/55 dark:text-text-inv/55 truncate">{replyingTo.text}</p>
                </div>
                <motion.button whileTap={{ scale: 0.8 }} onClick={() => setReplyingTo(null)} className="p-1 text-text/55 dark:text-text-inv/55">
                  <X size={16} />
                </motion.button>
              </div>
            </motion.div>
          )}
        </AnimatePresence>

        <div className="bg-white dark:bg-card-alt border border-border dark:border-border-dark rounded-full p-1 flex items-center gap-0.5 shadow-lg shadow-black/5 relative">
          {/* Action menu toggle (+ button) */}
          <motion.button
            whileTap={{ scale: 0.9 }}
            onClick={() => setShowMoreIcons(!showMoreIcons)}
            className={`w-9 h-9 flex items-center justify-center rounded-full transition-colors ${showMoreIcons ? 'bg-primary/10 text-primary' : 'text-text/55 dark:text-text-inv/55 hover:text-text dark:hover:text-text-inv'}`}
            aria-label="Attach"
          >
            <Plus size={20} />
          </motion.button>

          {/* Action menu popover */}
          <AnimatePresence>
            {showMoreIcons && (
              <>
                <motion.div
                  initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
                  className="fixed inset-0 z-20"
                  onClick={() => setShowMoreIcons(false)}
                />
                <motion.div
                  initial={{ opacity: 0, y: 10, scale: 0.95 }}
                  animate={{ opacity: 1, y: 0, scale: 1 }}
                  exit={{ opacity: 0, y: 10, scale: 0.95 }}
                  className="absolute bottom-full left-0 mb-2 z-30 bg-white dark:bg-card-alt border border-border dark:border-border-dark rounded-2xl shadow-xl p-2 flex flex-col gap-1 min-w-[140px]"
                >
                  <button
                    onClick={() => { handleImagePick(); setShowMoreIcons(false); }}
                    className="flex items-center gap-3 px-3 py-2.5 rounded-xl text-[14px] text-text dark:text-text-inv hover:bg-surface dark:hover:bg-surface-dark transition-colors"
                  >
                    <Image size={18} />
                    Image
                  </button>
                  <button
                    onClick={() => { handleFilePick(); setShowMoreIcons(false); }}
                    className="flex items-center gap-3 px-3 py-2.5 rounded-xl text-[14px] text-text dark:text-text-inv hover:bg-surface dark:hover:bg-surface-dark transition-colors"
                  >
                    <Paperclip size={18} />
                    File
                  </button>
                  <button
                    onClick={() => { setShowEmojiPicker(!showEmojiPicker); setShowMoreIcons(false); }}
                    className="flex items-center gap-3 px-3 py-2.5 rounded-xl text-[14px] text-text dark:text-text-inv hover:bg-surface dark:hover:bg-surface-dark transition-colors"
                  >
                    <Smile size={18} />
                    Emoji
                  </button>
                </motion.div>
              </>
            )}
          </AnimatePresence>

          <input ref={fileInputRef} type="file" accept="image/*" className="hidden" onChange={handleFileSelected} />
          <input ref={fileInputRef2} type="file" className="hidden" onChange={handleFileSelected2} />

          {/* Pending file/image preview */}
          <AnimatePresence>
            {pendingFile && (
              <motion.div
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: 10 }}
                className="absolute bottom-full left-0 right-0 mb-3 mx-1 rounded-[16px] bg-white/95 dark:bg-card-alt/95 p-3 border border-border/50 dark:border-border-dark/50 shadow-xl z-20"
              >
                <div className="flex items-start gap-3">
                  {pendingFile.isImage ? (
                    <img src={pendingFile.dataUrl} alt="Preview" className="w-12 h-12 object-cover rounded-lg bg-surface dark:bg-surface-dark border border-border dark:border-border-dark" />
                  ) : (
                    <div className="w-12 h-12 flex items-center justify-center bg-surface dark:bg-surface-dark rounded-lg text-primary border border-border dark:border-border-dark">
                      <FileText size={20} />
                    </div>
                  )}
                  <div className="flex-1 min-w-0 flex flex-col justify-center h-12">
                    <div className="flex items-center justify-between">
                      <span className="text-[13px] font-medium truncate text-text dark:text-text-inv pr-2">{pendingFile.file.name}</span>
                      <button onClick={handleCancelPendingFile} className="p-1 hover:bg-surface dark:hover:bg-surface-dark rounded-full text-text/50 dark:text-text-inv/50 transition-colors">
                        <X size={14} />
                      </button>
                    </div>
                    <input
                      type="text"
                      value={fileCaption}
                      onChange={(e) => setFileCaption(e.target.value)}
                      onKeyDown={(e) => e.key === 'Enter' && handleSendPendingFile()}
                      placeholder="Add a caption..."
                      className="w-full bg-transparent text-[12px] outline-none text-text/70 dark:text-text-inv/70 placeholder:text-text/45 dark:placeholder:text-text-inv/40"
                      autoFocus
                    />
                  </div>
                  <button
                    onClick={handleSendPendingFile}
                    className="self-center p-2 bg-primary text-white rounded-full shadow-md hover:shadow-lg hover:scale-105 transition-all"
                  >
                    <Send size={14} />
                  </button>
                </div>
              </motion.div>
            )}
          </AnimatePresence>

          <input
            type="text"
            value={inputValue}
            onChange={handleInputChange}
            onFocus={() => { setShowEmojiPicker(false); }}
            onKeyDown={(e) => e.key === 'Enter' && agentReady && handleSend()}
            placeholder={agentReady ? "Message..." : "Switching agent..."}
            disabled={!agentReady}
            aria-label="Type a message"
            className="flex-1 bg-transparent border-none focus:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:rounded-md text-[14px] py-1.5 px-2 text-text dark:text-text-inv placeholder:text-text/45 dark:placeholder:text-text-inv/45 disabled:opacity-50"
          />

          {/* Voice button when no text, Send button when has text */}
          {inputValue.trim() ? (
            <motion.button
              initial={{ scale: 0.8, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              whileHover={{ scale: 1.08, y: -2 }}
              whileTap={{ scale: 0.9 }}
              onClick={handleSend}
              disabled={!agentReady}
              aria-label="Send message"
              className="w-10 h-10 rounded-full flex items-center justify-center bg-primary text-white shadow-md shadow-primary/30 disabled:opacity-50 disabled:cursor-not-allowed"
            >
              <Send size={18} />
            </motion.button>
          ) : isRecording ? (
            <div className="flex items-center gap-2">
              <motion.div
                initial={{ opacity: 0, width: 0 }}
                animate={{ opacity: 1, width: 'auto' }}
                className="flex items-center gap-2 bg-red-50 dark:bg-red-900/20 px-3 py-1.5 rounded-full"
              >
                <span className="w-2 h-2 bg-red-500 rounded-full animate-pulse" />
                <span className="text-[13px] text-red-500 font-semibold tabular-nums min-w-[36px]">
                  {Math.floor(recordingSeconds / 60)}:{(recordingSeconds % 60).toString().padStart(2, '0')}
                </span>
              </motion.div>
              <motion.button
                whileTap={{ scale: 0.85 }}
                onClick={toggleRecording}
                aria-label="Stop recording and send"
                className="w-10 h-10 rounded-full flex items-center justify-center bg-red-500 text-white shadow-lg shadow-red-500/30"
              >
                <Send size={18} />
              </motion.button>
            </div>
          ) : (
            <motion.button
              whileTap={{ scale: 0.9 }}
              onClick={toggleRecording}
              aria-label="Start voice recording"
              className="w-10 h-10 rounded-full flex items-center justify-center bg-border dark:bg-border-dark text-text/55 dark:text-text-inv/55 hover:text-primary hover:bg-primary/10 transition-colors"
            >
              <Mic size={18} />
            </motion.button>
          )}
        </div>
      </div>

      <AnimatePresence>
        {showMemory && (
          <MemorySheet 
            onClose={() => setShowMemory(false)} 
            agentName={agentInfo ? agentInfo.name : agentId || 'Bot'} 
          />
        )}
      </AnimatePresence>

      <AnimatePresence>
        {showContextViewer && (
          <AgentContextViewer
            agentName={agentInfo?.name || agentId || 'Agent'}
            context={agentContext}
            isLoading={isContextLoading}
            isOpen={showContextViewer}
            onClose={() => setShowContextViewer(false)}
            onRefresh={requestAgentContext}
          />
        )}
      </AnimatePresence>
    </div>
  );
}
