import { useState, useRef, useEffect, useCallback, type ChangeEvent } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { ChevronLeft, ChevronDown, ChevronRight, Columns2, MoreHorizontal, Smile, Mic, MicOff, Send, Code, FileText, Zap, SmilePlus, Wifi, WifiOff, Loader2, HelpCircle, Database, Activity, User, Plus, RotateCcw, Cpu, Server, MessageSquare, LayoutDashboard, Square, Image, CornerDownLeft, X, Pencil, Trash2, Paperclip, Puzzle, RefreshCw, Copy, Check, Shield } from 'lucide-react';
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
  QUICK_COMMANDS, EMOJI_LIST,
  formatTime, formatDate, formatLastSeen, formatToolName, formatToolArgSnippet, formatRelativeTime,
  isDifferentDay, isGroupedWithPrev, humanizeError, fileToDataUrl,
  getPreviewKey, emitPreviewUpdated, saveAgentPreview, mergeMessages,
  getConnectionDisplayName, getSkillDescription,
  PREVIEW_KEY_PREFIX, MESSAGE_PREVIEW_UPDATED_EVENT,
} from '../components/chat';
import { DeliveryTicks, MessageItem, ActionSheet, SuggestionBar, HistoryDrawer, HeaderMenu, ConnectionBanner } from '../components/chat';

function getAgentInfo(agentId: string | null | undefined, connectionId: string): AgentInfo | null {
  const list = channel.loadCachedAgents(connectionId);
  return list.find((agent) => agent.id === agentId) || null;
}

/** Slash commands — synced with OpenClaw 2026.4.1 */
const SECTION_COMMANDS = 'COMMANDS';
const SECTION_DIRECTIVES = 'DIRECTIVES';
const SECTION_SESSION = 'SESSION';
const SECTION_ADVANCED = 'ADVANCED';
const slashCommands = [
  // --- Commands ---
  { id: 'help', icon: HelpCircle, label: '/help', desc: 'Show help and command usage', section: SECTION_COMMANDS },
  { id: 'commands', icon: Database, label: '/commands', desc: 'List available commands', section: SECTION_COMMANDS },
  { id: 'status', icon: Activity, label: '/status', desc: 'Session and model status', section: SECTION_COMMANDS },
  { id: 'whoami', icon: User, label: '/whoami', desc: 'Show sender identity', section: SECTION_COMMANDS },
  { id: 'skill', icon: Puzzle, label: '/skill', desc: 'Run a skill by name', section: SECTION_COMMANDS },
  { id: 'stop', icon: Square, label: '/stop', desc: 'Stop the running task', section: SECTION_COMMANDS },
  // --- Session ---
  { id: 'new', icon: Plus, label: '/new', desc: 'New session (optionally with model)', section: SECTION_SESSION },
  { id: 'reset', icon: RotateCcw, label: '/reset', desc: 'Reset session context', section: SECTION_SESSION },
  { id: 'model', icon: Cpu, label: '/model', desc: 'Inspect or switch model', section: SECTION_SESSION },
  { id: 'models', icon: Cpu, label: '/models', desc: 'Browse providers and models', section: SECTION_SESSION },
  { id: 'compact', icon: LayoutDashboard, label: '/compact', desc: 'Compact conversation context', section: SECTION_SESSION },
  { id: 'context', icon: FileText, label: '/context', desc: 'Show context breakdown', section: SECTION_SESSION },
  { id: 'export', icon: Database, label: '/export', desc: 'Export session to HTML', section: SECTION_SESSION },
  // --- Directives ---
  { id: 'think', icon: Code, label: '/think', desc: 'Set reasoning level (off–xhigh)', section: SECTION_DIRECTIVES },
  { id: 'verbose', icon: FileText, label: '/verbose', desc: 'Toggle debug/tool output', section: SECTION_DIRECTIVES },
  { id: 'reasoning', icon: MessageSquare, label: '/reasoning', desc: 'Reasoning output (on/off/stream)', section: SECTION_DIRECTIVES },
  { id: 'elevated', icon: Shield, label: '/elevated', desc: 'Elevated exec (on/off/ask/full)', section: SECTION_DIRECTIVES },
  { id: 'exec', icon: Code, label: '/exec', desc: 'Configure exec host/security', section: SECTION_DIRECTIVES },
  { id: 'queue', icon: LayoutDashboard, label: '/queue', desc: 'Queue mode and options', section: SECTION_DIRECTIVES },
  // --- Advanced ---
  { id: 'usage', icon: Activity, label: '/usage', desc: 'Usage footer (off/tokens/full/cost)', section: SECTION_ADVANCED },
  { id: 'tts', icon: Mic, label: '/tts', desc: 'Text-to-speech settings', section: SECTION_ADVANCED },
  { id: 'subagents', icon: Server, label: '/subagents', desc: 'Inspect/control sub-agents', section: SECTION_ADVANCED },
  { id: 'acp', icon: Server, label: '/acp', desc: 'ACP runtime sessions', section: SECTION_ADVANCED },
  { id: 'allowlist', icon: Shield, label: '/allowlist', desc: 'Manage access allowlists', section: SECTION_ADVANCED },
  { id: 'restart', icon: RotateCcw, label: '/restart', desc: 'Restart gateway', section: SECTION_ADVANCED },
  { id: 'activation', icon: Zap, label: '/activation', desc: 'Activation mode (mention/always)', section: SECTION_ADVANCED },
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
  const [showBuiltinSkills, setShowBuiltinSkills] = useState(false);
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
  const [toolCallHistory, setToolCallHistory] = useState<{ toolCallId: string; toolName: string; args?: Record<string, unknown>; startTime: number; endTime: number; resultSummary?: string }[]>([]);
  const [toolHistoryExpanded, setToolHistoryExpanded] = useState(false);
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
    const showFeedback = () => {
      setCopiedMsgId(msgId);
      setTimeout(() => setCopiedMsgId(null), 2000);
    };

    // Try sync copy first (works in more contexts, especially mobile WebViews)
    const syncCopy = (): boolean => {
      try {
        const ta = document.createElement('textarea');
        ta.value = text;
        ta.style.cssText = 'position:fixed;opacity:0;left:-9999px;top:-9999px';
        document.body.appendChild(ta);
        ta.focus();
        ta.select();
        ta.setSelectionRange(0, text.length);
        const ok = document.execCommand('copy');
        document.body.removeChild(ta);
        return ok;
      } catch { return false; }
    };

    // Attempt sync first, then async clipboard API
    if (syncCopy()) {
      showFeedback();
    } else if (navigator.clipboard?.writeText) {
      navigator.clipboard.writeText(text).then(showFeedback).catch(() => {});
    }
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
  const configuredSkills = agentInfo?.configuredSkills ?? [];

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
  const skillCount = configuredSkills.length || skills.length;

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

  // Auto-scroll: use instant scroll during streaming to avoid jitter, smooth scroll otherwise.
  // Also debounce streaming scrolls to avoid excessive layout thrashing.
  const scrollRafRef = useRef<number | null>(null);
  useEffect(() => {
    const hasStreaming = messages.some((m) => m.isStreaming);
    if (hasStreaming) {
      // Streaming: throttle with rAF to avoid layout thrash & jitter
      if (scrollRafRef.current) return;
      scrollRafRef.current = requestAnimationFrame(() => {
        scrollRafRef.current = null;
        const container = scrollContainerRef.current;
        if (container) {
          container.scrollTop = container.scrollHeight;
        }
      });
    } else {
      // Non-streaming: smooth scroll for user comfort
      messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
    }
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
    setToolCallHistory([]);
    setToolHistoryExpanded(false);
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
    } else if (currentStatus === 'connecting') {
      // Already connecting: agent selection will happen in connection.open handler below
      // Set a safety timeout so agentReady doesn't stay false forever
      if (agentReadyTimeoutRef.current) clearTimeout(agentReadyTimeoutRef.current);
      agentReadyTimeoutRef.current = setTimeout(() => setAgentReady(true), 5000);
    } else {
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
        // Connection established: select agent + request history + agent list
        try { channel.requestAgentList(runtimeConnId); } catch { /* ignore */ }
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
          const withoutStreaming = prev.filter((m) => !m.isStreaming && !m.streamingDone);
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

        // Clear thinking indicator on final message delivery
        setIsThinking(false);
        if (thinkingTimerRef.current) { clearInterval(thinkingTimerRef.current); thinkingTimerRef.current = null; }
        // S1: Mark ALL pending/sent user messages as delivered (bot responded = all prior msgs received)
        setActiveToolCalls([]); // S3: Clear stale tool calls on final message
        setToolCallHistory([]);
        setToolHistoryExpanded(false);
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
        const d = packet.data as { toolCallId?: string; agentId?: string; resultSummary?: string };
        if (!d.agentId || !agentId || d.agentId === agentId) {
          setActiveToolCalls((prev) => {
            const ended = prev.find((tc) => tc.toolCallId === d.toolCallId);
            if (ended) {
              setToolCallHistory((hist) => [...hist, {
                ...ended,
                endTime: Date.now(),
                resultSummary: d.resultSummary,
              }]);
            }
            return prev.filter((tc) => tc.toolCallId !== d.toolCallId);
          });
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
          // Streaming finished - clear source tracking.
          // Don't remove streaming placeholder yet — let message.send replace it
          // to avoid a 1-frame flash where the message disappears and reappears.
          streamingSourceAgentRef.current = null;
          // Mark streaming message as done (remove cursor but keep content visible)
          setMessages((prev) => prev.map((m) =>
            m.isStreaming ? { ...m, isStreaming: false, streamingDone: true } : m
          ));
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
      // When connected: ensure agentReady is true (safety net for missed agent.selected events)
      if (status === 'connected') {
        if (agentReadyTimeoutRef.current) {
          clearTimeout(agentReadyTimeoutRef.current);
          agentReadyTimeoutRef.current = null;
        }
        // Give a short grace period for agent.selected to arrive, then force-ready
        agentReadyTimeoutRef.current = setTimeout(() => setAgentReady(true), 800);
      }
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
    setInputValue('');
    setShowSlashMenu(false);
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

  const handleReactionToggle = useCallback((msgId: string, emoji: string, hasIt: boolean) => {
    setMessages((prev) => prev.map((m) => {
      if (m.id !== msgId) return m;
      const reactions = m.reactions ?? [];
      return { ...m, reactions: hasIt ? reactions.filter(r => r !== emoji) : [...reactions, emoji] };
    }));
    if (hasIt) { channel.removeReaction(msgId, emoji, runtimeConnId); } else { channel.addReaction(msgId, emoji, runtimeConnId); }
  }, [runtimeConnId]);

  const handleReactionRemove = useCallback((msgId: string, emoji: string) => {
    setMessages((prev) => prev.map((m) => {
      if (m.id !== msgId) return m;
      const reactions = m.reactions ?? [];
      return { ...m, reactions: reactions.filter(r => r !== emoji) };
    }));
    channel.removeReaction(msgId, emoji, runtimeConnId);
  }, [runtimeConnId]);

  const startReply = (msg: Message) => {
    setReplyingTo(msg);
  };
  
  const [showMemory, setShowMemory] = useState(false);

  // Long-press for mobile message actions
  const [longPressedMsgId, setLongPressedMsgId] = useState<string | null>(null);
  const longPressTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const handleTouchStart = (msgId: string) => {
    longPressTimer.current = setTimeout(() => {
      // Clear any native text selection to avoid iOS system menu conflict
      window.getSelection()?.removeAllRanges();
      setLongPressedMsgId(msgId);
    }, 400);
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
          <p className="text-[11px] text-text/40 dark:text-text-inv/35 truncate max-w-[200px] md:max-w-none flex items-center gap-1">
            {getConnectionDisplayName(activeConn?.name, activeConn?.displayName)}{agentInfo?.model ? ` · ${agentInfo.model.split('/').pop()}` : ''}
            {wsStatus === 'connected' && <><span className="mx-0.5">·</span><span className={`inline-flex items-center gap-0.5 ${agentPresence?.status === 'offline' ? 'text-text/30 dark:text-text-inv/25' : 'text-primary'}`}><span className={`inline-block w-1.5 h-1.5 rounded-full ${agentPresence?.status === 'offline' ? 'bg-gray-400' : 'bg-primary'}`} />{agentPresence?.status === 'offline' ? formatLastSeen(agentPresence.lastSeen) || 'offline' : 'online'}</span></>}
            {(wsStatus === 'connecting' || wsStatus === 'reconnecting') && <><span className="mx-0.5">·</span><span className="inline-flex items-center gap-0.5 text-amber-500"><Loader2 size={9} className="animate-spin" />{wsStatus === 'connecting' ? 'connecting' : 'reconnecting'}</span></>}
            {wsStatus === 'disconnected' && <><span className="mx-0.5">·</span><button onClick={() => channel.reconnect(runtimeConnId)} className="inline-flex items-center gap-0.5 text-red-400 hover:opacity-80 transition-opacity" aria-label="Tap to reconnect"><RefreshCw size={9} />reconnect</button></>}
          </p>
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
      <HeaderMenu
        isOpen={showHeaderMenu}
        onClose={() => setShowHeaderMenu(false)}
        onOpenHistory={openHistoryDrawer}
        onOpenFiles={openFileGallery}
        onOpenMemory={() => { setShowHeaderMenu(false); setShowMemory(true); }}
        onClearChat={() => {
          setMessages([]);
          setHasLoadedMessages(true);
          if (connId && agentId) {
            void clearConversationMessages(connId, agentId, { chatId });
            localStorage.removeItem(getPreviewKey(connId, agentId));
            emitPreviewUpdated(connId, agentId);
          }
          setShowHeaderMenu(false);
        }}
      />

      <HistoryDrawer
        isOpen={showHistoryDrawer}
        isDesktop={isDesktop}
        loading={loadingConversations}
        conversations={conversations}
        currentChatId={chatId}
        agentName={agentInfo?.name || agentId || undefined}
        onClose={() => setShowHistoryDrawer(false)}
        onNewConversation={() => {
          const newChatId = `chat-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
          setShowHistoryDrawer(false);
          onOpenConversation(newChatId);
        }}
        onSwitchConversation={handleConversationSwitch}
      />

      <FileGallery
        agentId={agentId}
        connectionId={connId}
        agentName={agentInfo?.name}
        isOpen={showFileGallery}
        isDesktop={isDesktop}
        onClose={() => setShowFileGallery(false)}
      />

      {/* Connection status banners */}
      <ConnectionBanner
        wsStatus={wsStatus}
        showReconnected={showReconnected}
        onReconnect={() => channel.reconnect(runtimeConnId)}
      />

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

      {/* Copy success toast (mobile-friendly) */}
      <AnimatePresence>
        {copiedMsgId && (
          <motion.div
            initial={{ opacity: 0, y: -10 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -10 }}
            className="absolute top-16 left-1/2 -translate-x-1/2 z-20 bg-emerald-600 text-white text-[13px] font-medium px-4 py-2 rounded-full shadow-lg flex items-center gap-2"
          >
            <Check size={14} /> Copied!
          </motion.div>
        )}
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
        {messages.map((msg, i) => (
          <MessageItem
            key={msg.id}
            msg={msg}
            index={i}
            messages={messages}
            agentInfo={agentInfo}
            copiedMsgId={copiedMsgId}
            runtimeConnId={runtimeConnId}
            onTouchStart={handleTouchStart}
            onTouchEnd={handleTouchEnd}
            onRetry={retryMessage}
            onReply={startReply}
            onEdit={handleEditMessage}
            onDelete={handleDeleteMessage}
            onCopy={copyMessage}
            onQuickSend={quickSend}
            onReactionToggle={handleReactionToggle}
            onReactionRemove={handleReactionRemove}
            onOpenReactionPicker={openReactionPicker}
          />
        ))}
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
              <div className="pt-2 min-w-0 flex-1">
                {/* Current tool or thinking phase — single line */}
                {(() => {
                  const latestActive = activeToolCalls[activeToolCalls.length - 1];
                  const argSnippet = latestActive ? formatToolArgSnippet(latestActive.args) : '';
                  return (
                    <span className="text-[13px] text-primary font-medium animate-pulse truncate block">
                      {latestActive
                        ? `🔧 ${formatToolName(latestActive.toolName)}${argSnippet ? ` · ${argSnippet}` : ''}`
                        : (thinkingPhase || 'Thinking')}
                    </span>
                  );
                })()}

                {/* Expandable tool call history */}
                {(toolCallHistory.length > 0 || activeToolCalls.length > 1) && (
                  <div className="mt-1">
                    <button
                      onClick={() => setToolHistoryExpanded((v) => !v)}
                      className="text-[11px] text-text/40 dark:text-text-inv/40 hover:text-text/60 dark:hover:text-text-inv/60 transition-colors flex items-center gap-1"
                    >
                      <span className="inline-block transition-transform" style={{ transform: toolHistoryExpanded ? 'rotate(90deg)' : 'rotate(0deg)' }}>▸</span>
                      {toolCallHistory.length + activeToolCalls.length} tool call{toolCallHistory.length + activeToolCalls.length !== 1 ? 's' : ''}
                    </button>
                    {toolHistoryExpanded && (
                      <div className="mt-1 flex flex-col gap-0.5 text-[11px] text-text/45 dark:text-text-inv/45 max-h-40 overflow-y-auto">
                        {toolCallHistory.map((tc) => (
                          <div key={tc.toolCallId} className="flex items-center gap-1 truncate">
                            <span className="text-green-500/70">✓</span>
                            <span className="font-medium">{formatToolName(tc.toolName)}</span>
                            {tc.resultSummary && (
                              <span className="text-text/30 dark:text-text-inv/30 truncate" title={tc.resultSummary}>
                                — {tc.resultSummary.replace(/\n/g, ' ').slice(0, 60)}
                              </span>
                            )}
                            <span className="text-text/25 dark:text-text-inv/25 flex-shrink-0">{tc.endTime - tc.startTime}ms</span>
                          </div>
                        ))}
                        {activeToolCalls.map((tc) => (
                          <div key={tc.toolCallId} className="flex items-center gap-1 truncate animate-pulse">
                            <span className="text-primary">⟳</span>
                            <span className="font-medium">{formatToolName(tc.toolName)}</span>
                            {formatToolArgSnippet(tc.args) && (
                              <span className="text-text/30 dark:text-text-inv/30 truncate">
                                {formatToolArgSnippet(tc.args)}
                              </span>
                            )}
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                )}
              </div>
            </motion.div>
          )}
        </AnimatePresence>
        <div ref={messagesEndRef} />
      </div>

      {/* WhatsApp-style long-press action sheet — MUST be outside scroll container for iOS z-index */}
      <ActionSheet
        longPressedMsgId={longPressedMsgId}
        messages={messages}
        onClose={closeLongPress}
        onReply={startReply}
        onCopy={copyMessage}
        onEdit={handleEditMessage}
        onDelete={handleDeleteMessage}
        onReactionToggle={handleReactionToggle}
        onOpenReactionPicker={openReactionPicker}
      />

      {/* Input Area */}
      <div className="px-2 pt-2 pb-1 bg-white/60 dark:bg-card-alt/60 backdrop-blur-md border-t border-border/50 dark:border-border-dark/50 z-30 flex-shrink-0 relative safe-area-bottom flex flex-col gap-2.5">
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
                {/* System commands by section */}
                {(() => {
                  const filtered = slashCommands.filter(cmd =>
                    cmd.label.startsWith(inputValue) || inputValue === '/'
                  );
                  if (filtered.length === 0) return null;
                  // Group by section, preserving order
                  const sections: { name: string; items: typeof filtered }[] = [];
                  const seen = new Set<string>();
                  for (const cmd of filtered) {
                    if (!seen.has(cmd.section)) {
                      seen.add(cmd.section);
                      sections.push({ name: cmd.section, items: [] });
                    }
                    sections.find(s => s.name === cmd.section)!.items.push(cmd);
                  }
                  return sections.map(sec => (
                    <div key={sec.name}>
                      <div className="px-3 pt-2 pb-1 text-[10px] font-semibold text-text/35 dark:text-text-inv/30 uppercase tracking-wider sticky top-0 bg-white dark:bg-card-alt">{sec.name}</div>
                      {sec.items.map(cmd => (
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
                    </div>
                  ));
                })()}

                {/* Skills section */}
                {skills.length > 0 && (inputValue === '/' || '/use'.startsWith(inputValue) || inputValue.startsWith('/use ')) && (() => {
                  const configuredSet = new Set(configuredSkills);
                  const loadedSkills = skills.filter(s => configuredSet.has(s));
                  const builtinSkills = skills.filter(s => !configuredSet.has(s));

                  const filterSkill = (s: string) => {
                    if (inputValue === '/' || inputValue === '/use') return true;
                    if (inputValue.startsWith('/use ')) {
                      const q = inputValue.slice(5).toLowerCase();
                      return s.toLowerCase().includes(q);
                    }
                    return `/use ${s}`.startsWith(inputValue);
                  };

                  const filteredLoaded = loadedSkills.filter(filterSkill);
                  const filteredBuiltin = builtinSkills.filter(filterSkill);

                  if (filteredLoaded.length === 0 && filteredBuiltin.length === 0) return null;

                  return (
                    <>
                      {/* Loaded skills — always visible */}
                      {filteredLoaded.length > 0 && (
                        <>
                          <div className="px-3 pt-2 pb-1 text-[10px] font-semibold text-text/35 dark:text-text-inv/30 uppercase tracking-wider sticky top-0 bg-white dark:bg-card-alt flex items-center gap-1.5">
                            <Puzzle size={10} className="text-primary" />
                            Skills ({filteredLoaded.length})
                          </div>
                          {filteredLoaded.map(skillName => (
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
                              </div>
                            </button>
                          ))}
                        </>
                      )}

                      {/* Built-in / unloaded skills — collapsible, greyed out */}
                      {filteredBuiltin.length > 0 && (
                        <>
                          <button
                            type="button"
                            onClick={() => setShowBuiltinSkills(prev => !prev)}
                            className="w-full px-3 pt-2 pb-1 text-[10px] font-semibold text-text/25 dark:text-text-inv/20 uppercase tracking-wider sticky top-0 bg-white dark:bg-card-alt flex items-center gap-1.5 hover:text-text/40 dark:hover:text-text-inv/35 transition-colors"
                          >
                            {showBuiltinSkills ? <ChevronDown size={10} /> : <ChevronRight size={10} />}
                            Built-in ({filteredBuiltin.length})
                          </button>
                          {showBuiltinSkills && filteredBuiltin.map(skillName => (
                            <button
                              key={`builtin-${skillName}`}
                              onClick={() => handleCommandSelect(`/use ${skillName}`)}
                              className="w-full flex items-center gap-2.5 px-3 py-1.5 text-left hover:bg-surface dark:hover:bg-surface-dark transition-colors opacity-50"
                            >
                              <div className="w-7 h-7 rounded-lg bg-text/[0.04] dark:bg-text-inv/[0.04] flex items-center justify-center text-text/30 dark:text-text-inv/25 shrink-0">
                                <Puzzle size={14} />
                              </div>
                              <div className="min-w-0 flex-1">
                                <span className="text-[13px] text-text/50 dark:text-text-inv/40">{skillName}</span>
                              </div>
                            </button>
                          ))}
                        </>
                      )}
                    </>
                  );
                })()}

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
        <SuggestionBar
          messages={messages}
          isThinking={isThinking}
          showSlashMenu={showSlashMenu}
          showEmojiPicker={showEmojiPicker}
          skillCount={skillCount}
          connectionId={runtimeConnId}
          onOpenSlashMenu={() => { setInputValue('/'); setShowSlashMenu(true); }}
          onOpenContextViewer={() => setShowContextViewer(true)}
          onSetInputValue={setInputValue}
          onQuickSend={quickSend}
        />

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

        <div className="bg-white dark:bg-card-alt border border-border dark:border-border-dark rounded-full p-0.5 flex items-center gap-0.5 shadow-lg shadow-black/5 relative">
          {/* Action menu toggle (+ button) */}
          <motion.button
            whileTap={{ scale: 0.9 }}
            onClick={() => setShowMoreIcons(!showMoreIcons)}
            className={`w-8 h-8 flex items-center justify-center rounded-full transition-colors ${showMoreIcons ? 'bg-primary/10 text-primary' : 'text-text/55 dark:text-text-inv/55 hover:text-text dark:hover:text-text-inv'}`}
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
              className="w-9 h-9 rounded-full flex items-center justify-center bg-primary text-white shadow-md shadow-primary/30 disabled:opacity-50 disabled:cursor-not-allowed"
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
                className="w-9 h-9 rounded-full flex items-center justify-center bg-red-500 text-white shadow-lg shadow-red-500/30"
              >
                <Send size={18} />
              </motion.button>
            </div>
          ) : (
            <motion.button
              whileTap={{ scale: 0.9 }}
              onClick={toggleRecording}
              aria-label="Start voice recording"
              className="w-9 h-9 rounded-full flex items-center justify-center bg-border dark:bg-border-dark text-text/55 dark:text-text-inv/55 hover:text-primary hover:bg-primary/10 transition-colors"
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
