import { useState, useRef, useEffect, useCallback, type ChangeEvent } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { ChevronDown, ChevronRight, Smile, Mic, Send, ArrowUp, Code, FileText, Zap, SmilePlus, Wifi, WifiOff, Loader2, HelpCircle, Database, Activity, User, Plus, RotateCcw, Cpu, Server, MessageSquare, LayoutDashboard, Square, Image, CornerDownLeft, X, Pencil, Trash2, Paperclip, Puzzle, Copy, Check, Shield, Keyboard, ArrowDown } from 'lucide-react';
import { SpeechRecognitionSession } from '../services/volcASR';
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
import { refineVoiceText, syncMissedMessages } from '../services/suggestions';
import {
  type DeliveryStatus, type Message, type AgentInfo,
  QUICK_COMMANDS, EMOJI_LIST,
  formatTime, formatDate, formatLastSeen, formatToolName, formatToolArgSnippet, formatResultSummary, formatRelativeTime,
  isDifferentDay, isGroupedWithPrev, humanizeError, fileToDataUrl,
  getPreviewKey, emitPreviewUpdated, saveAgentPreview, mergeMessages,
  getConnectionDisplayName, getSkillDescription,
  PREVIEW_KEY_PREFIX, MESSAGE_PREVIEW_UPDATED_EVENT,
} from '../components/chat';
import { DeliveryTicks, MessageItem, ActionSheet, SuggestionBar, HistoryDrawer, HeaderMenu, ConnectionBanner, ChatHeader, AgentDetailSheet } from '../components/chat';

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

type ThinkLevel = 'off' | 'low' | 'medium' | 'high';

const isChinese = typeof navigator !== 'undefined' && /^zh\b/i.test(navigator.language);

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
  const [thinkLevel, setThinkLevel] = useState<ThinkLevel>('off');
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
  const [voiceMode, setVoiceMode] = useState(() => localStorage.getItem('clawline:voiceMode') === 'true');
  const [voiceListening, setVoiceListening] = useState(false);
  const [voiceInterimText, setVoiceInterimText] = useState('');
  const [voiceFinalText, setVoiceFinalText] = useState('');
  const [voiceSwipeY, setVoiceSwipeY] = useState(0);
  const voiceSessionRef = useRef<SpeechRecognitionSession | null>(null);
  const voiceTouchStartRef = useRef<{ y: number; time: number } | null>(null);
  const [showScrollToBottom, setShowScrollToBottom] = useState(false);
  const [deleteConfirmId, setDeleteConfirmId] = useState<string | null>(null);
  const [reconnectInfo, setReconnectInfo] = useState({ attempt: 0, maxAttempts: 6, delayMs: 0 });
  const [voiceRefining, setVoiceRefining] = useState(false);

  const [replyingTo, setReplyingTo] = useState<Message | null>(null);
  const [peerTyping, setPeerTyping] = useState(false);
  const [editingMsg, setEditingMsg] = useState<Message | null>(null);
  const [showHeaderMenu, setShowHeaderMenu] = useState(false);
  const [showAgentDetail, setShowAgentDetail] = useState(false);
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

  const skills = agentInfo?.skills ?? [];
  const configuredSkills = agentInfo?.configuredSkills ?? [];
  const configuredSkillSet = new Set(configuredSkills);
  const builtinSkillSet = new Set(agentInfo?.builtinSkills ?? []);
  const draftKey = connId && agentId ? `draft:${connId}:${agentId}` : null;

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
    setThinkLevel('off');
  }, [agentId, connId]);

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

  useEffect(() => {
    if (!draftKey) {
      setInputValue('');
      return;
    }

    try {
      setInputValue(localStorage.getItem(draftKey) || '');
    } catch {
      setInputValue('');
    }
  }, [draftKey]);

  // Persist messages on change (debounced to avoid thrashing IndexedDB)
  const saveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const draftSaveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
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
    if (!draftKey) return;
    if (draftSaveTimerRef.current) clearTimeout(draftSaveTimerRef.current);
    draftSaveTimerRef.current = setTimeout(() => {
      try {
        if (inputValue) localStorage.setItem(draftKey, inputValue);
        else localStorage.removeItem(draftKey);
      } catch {
        // ignore storage write errors
      }
    }, 300);

    return () => {
      if (draftSaveTimerRef.current) clearTimeout(draftSaveTimerRef.current);
    };
  }, [draftKey, inputValue]);

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
              quotedText: (packet.data.quotedText as string) || m.quotedText,
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
              quotedText: (packet.data.quotedText as string) || undefined,
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
        // Safety: clear any lingering streaming/streamingDone flags
        setTimeout(() => {
          setMessages((prev) => {
            const hasStale = prev.some((m) => m.isStreaming || m.streamingDone);
            if (!hasStale) return prev;
            return prev.filter((m) => !m.streamingDone).map((m) => m.isStreaming ? { ...m, isStreaming: false } : m);
          });
        }, 300);
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
        const history = (packet.data.messages as Array<{messageId?: string; content?: string; direction?: string; senderId?: string; timestamp?: number; mediaUrl?: string; contentType?: string; mimeType?: string; replyTo?: string; quotedText?: string}>).map((m) => {
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
            replyTo: m.replyTo,
            quotedText: m.quotedText,
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
      // Update reconnect info for ConnectionBanner
      if (status === 'reconnecting') {
        setReconnectInfo(channel.getReconnectInfo(runtimeConnId));
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
                  ? channel.sendTextWithParent(entry.content, entry.replyTo, entry.quotedText, entry.agentId || undefined, runtimeConnId)
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

        // Sync missed messages from DB (for multi-client scenarios)
        if (chatId && activeConn?.channelId) {
          const lastTs = messages.length > 0 ? Math.max(...messages.map(m => m.timestamp || 0)) : 0;
          if (lastTs > 0) {
            syncMissedMessages(activeConn.channelId, lastTs, 100, runtimeConnId).then((missed) => {
              if (missed.length === 0) return;
              const newMsgs: Message[] = missed
                .filter(m => !messages.some(existing => existing.id === m.message_id))
                .map(m => ({
                  id: m.message_id || m.id,
                  sender: m.direction === 'inbound' ? 'user' : 'ai',
                  text: m.content || '',
                  timestamp: m.timestamp,
                  deliveryStatus: 'delivered' as DeliveryStatus,
                }));
              if (newMsgs.length > 0) {
                setMessages(prev => {
                  const ids = new Set(prev.map(p => p.id));
                  const unique = newMsgs.filter(m => !ids.has(m.id));
                  return unique.length > 0 ? [...prev, ...unique].sort((a, b) => (a.timestamp || 0) - (b.timestamp || 0)) : prev;
                });
              }
            }).catch(() => {});
          }
        }
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

    const handleOutboxOverflow = (event: Event) => {
      const detail = (event as CustomEvent<{ connectionId?: string; agentId?: string }>).detail;
      if (detail?.connectionId && detail.connectionId !== runtimeConnId) return;
      if (detail?.agentId && detail.agentId !== agentId) return;
      setErrorToast({ code: 'OUTBOX_FULL', message: 'Offline queue is full. Oldest queued message was removed.' });
      setTimeout(() => setErrorToast(null), 6000);
    };
    window.addEventListener(outbox.OUTBOX_OVERFLOW_EVENT, handleOutboxOverflow);

    return () => {
      unsubMsg();
      unsubStatus();
      unsubError();
      window.removeEventListener(outbox.OUTBOX_OVERFLOW_EVENT, handleOutboxOverflow);
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

  const scrollBtnRafRef = useRef<number>(0);
  useEffect(() => {
    const container = scrollContainerRef.current;
    if (!container) return;
    const handleScroll = () => {
      if (container.scrollTop < 80 && hasMoreHistory && !loadingMoreHistory) {
        loadMoreHistory();
      }
      // Throttle scroll-to-bottom detection with rAF to avoid jank
      cancelAnimationFrame(scrollBtnRafRef.current);
      scrollBtnRafRef.current = requestAnimationFrame(() => {
        const distFromBottom = container.scrollHeight - container.scrollTop - container.clientHeight;
        setShowScrollToBottom(distFromBottom > 300);
      });
    };
    container.addEventListener('scroll', handleScroll, { passive: true });
    return () => { container.removeEventListener('scroll', handleScroll); cancelAnimationFrame(scrollBtnRafRef.current); };
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

  // Delete message — with confirmation
  const handleDeleteMessage = (msgId: string) => {
    setDeleteConfirmId(msgId);
  };
  const confirmDelete = () => {
    if (!deleteConfirmId) return;
    channel.deleteMessage(deleteConfirmId, runtimeConnId);
    setMessages((prev) => prev.filter((m) => m.id !== deleteConfirmId));
    setDeleteConfirmId(null);
  };

  // File picker — now stages file for preview before sending
  const [pendingFile, setPendingFile] = useState<{ file: File; dataUrl: string; isImage: boolean } | null>(null);
  const [fileCaption, setFileCaption] = useState('');

  const handleFilePick = () => fileInputRef2.current?.click();

  const handlePaste = useCallback(async (e: React.ClipboardEvent) => {
    const items = e.clipboardData?.items;
    if (!items) return;
    for (let i = 0; i < items.length; i++) {
      const item = items[i];
      if (item.kind === 'file') {
        e.preventDefault();
        const file = item.getAsFile();
        if (!file) continue;
        const dataUrl = await fileToDataUrl(file);
        const isImage = file.type.startsWith('image/');
        setPendingFile({ file, dataUrl, isImage });
        setFileCaption(inputValue.trim());
        return;
      }
    }
  }, [inputValue]);

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

  const sendTextMessage = useCallback((
    text: string,
    options?: { replyId?: string; replyQuotedText?: string },
  ) => {
    if (!agentReady) return false;

    try {
      const payload = options?.replyId
        ? channel.sendTextWithParent(text, options.replyId, options.replyQuotedText, agentId || undefined, runtimeConnId)
        : channel.sendText(text, agentId || undefined, runtimeConnId);
      const userMsg: Message = {
        id: payload.messageId || Date.now().toString(),
        sender: 'user',
        text,
        replyTo: options?.replyId,
        quotedText: options?.replyQuotedText,
        timestamp: payload.timestamp || Date.now(),
        deliveryStatus: 'sent',
      };
      setMessages((prev) => [...prev, userMsg]);
      // Immediately show thinking state after sending (unless it's a slash command)
      if (!text.startsWith('/')) {
        setIsThinking(true);
        setThinkingPhase('Thinking');
        thinkingStartRef.current = Date.now();
        if (thinkingTimerRef.current) clearInterval(thinkingTimerRef.current);
        thinkingTimerRef.current = setInterval(() => {
          const elapsed = Date.now() - thinkingStartRef.current;
          if (elapsed > 15000) setThinkingPhase('Working on it…');
          else if (elapsed > 8000) setThinkingPhase('Putting it together');
          else if (elapsed > 4000) setThinkingPhase('Analyzing');
        }, 1000);
      }
    } catch {
      const msgId = `pending-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
      const userMsg: Message = {
        id: msgId,
        sender: 'user',
        text,
        replyTo: options?.replyId,
        quotedText: options?.replyQuotedText,
        timestamp: Date.now(),
        deliveryStatus: 'pending',
      };
      setMessages((prev) => [...prev, userMsg]);
      outbox.enqueue({
        id: msgId,
        connectionId: runtimeConnId,
        agentId: agentId || '',
        content: text,
        type: 'text',
        replyTo: options?.replyId,
        quotedText: options?.replyQuotedText,
        timestamp: Date.now(),
      }).catch(() => { /* ignore outbox write failure */ });
    }

    return true;
  }, [agentId, agentReady, runtimeConnId]);

  const handleSend = () => {
    if (editingMsg) { handleSaveEdit(); return; }
    const trimmedInput = inputValue.trim();
    if (!trimmedInput) return;
    if (!agentReady) return; // Bug 1: Prevent sending before agent is ready
    if (trimmedInput === '/memory') {
      setShowMemory(true);
      setInputValue('');
      setShowSlashMenu(false);
      if (draftKey) localStorage.removeItem(draftKey);
      return;
    }
    const replyId = replyingTo?.id;
    const replyQuotedText = replyingTo?.text;
    const capturedInput = inputValue;
    setInputValue('');
    setShowSlashMenu(false);
    setReplyingTo(null);
    if (draftKey) localStorage.removeItem(draftKey);
    sendTextMessage(capturedInput, { replyId, replyQuotedText });
  };

  const handleHeaderCommand = useCallback((cmd: string) => {
    const match = cmd.match(/^\/think\s+(off|low|medium|high)$/i);
    if (match) {
      setThinkLevel(match[1].toLowerCase() as ThinkLevel);
    }
    sendTextMessage(cmd);
  }, [sendTextMessage]);

  const quickSend = useCallback((text: string, options?: { clearInput?: boolean }) => {
    const clearInput = options?.clearInput ?? true;
    const trimmed = text.trim();
    if (!trimmed) return;
    if (trimmed === '/memory') {
      setShowMemory(true);
      setShowSlashMenu(false);
      if (clearInput) {
        setInputValue('');
        if (draftKey) localStorage.removeItem(draftKey);
      }
      return;
    }
    sendTextMessage(trimmed);
    setShowSlashMenu(false);
    if (clearInput) {
      setInputValue('');
      if (draftKey) localStorage.removeItem(draftKey);
    }
  }, [draftKey, sendTextMessage]);

  useEffect(() => {
    if (wsStatus !== 'connected' || !connId || !agentId || !agentReady) return;
    // Only auto-send /status if no communication in this chat for 1 hour
    const lastMsgTime = messages.length > 0 ? Math.max(...messages.map((m) => m.timestamp || 0)) : 0;
    if (lastMsgTime && Date.now() - lastMsgTime < 3600_000) return;
    const key = `clawline.lastAutoStatus.${connId}:${agentId}`;
    try {
      const last = parseInt(localStorage.getItem(key) || '0', 10);
      if (Date.now() - last < 3600_000) return;
      localStorage.setItem(key, String(Date.now()));
    } catch {
      return;
    }
    const timer = setTimeout(() => {
      quickSend('/status', { clearInput: false });
    }, 500);
    return () => clearTimeout(timer);
  }, [agentId, agentReady, connId, messages, quickSend, wsStatus]);

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

  // --- Voice-to-text (STT) ---
  const startVoiceRecognition = useCallback(() => {
    if (voiceSessionRef.current) return;
    setVoiceListening(true);
    setVoiceInterimText('');
    setVoiceFinalText('');

    const session = new SpeechRecognitionSession({
      onResult: (text, isFinal) => {
        if (isFinal) {
          setVoiceFinalText((prev) => prev + text);
          setVoiceInterimText('');
        } else {
          setVoiceInterimText(text);
        }
      },
      onError: (err) => {
        console.warn('[STT] error:', err);
        setVoiceListening(false);
        voiceSessionRef.current = null;
      },
      onEnd: () => {
        setVoiceListening(false);
        voiceSessionRef.current = null;
      },
    });
    session.start();
    voiceSessionRef.current = session;
  }, []);

  const stopVoiceRecognition = useCallback(() => {
    if (voiceSessionRef.current) {
      voiceSessionRef.current.stop();
      voiceSessionRef.current = null;
    }
    setVoiceListening(false);
  }, []);

  const submitVoiceText = useCallback(async () => {
    const rawText = (voiceFinalText + voiceInterimText).trim();
    stopVoiceRecognition();
    if (!rawText) return;

    // Refine voice text via gateway (async, shows "Refining..." state)
    setVoiceRefining(true);
    let text = rawText;
    try {
      text = await refineVoiceText(rawText, messages, runtimeConnId);
    } catch { /* use raw text */ }
    setVoiceRefining(false);

    setInputValue(text);
    // Auto-send
    setTimeout(() => {
      const trimmed = text.trim();
      if (!trimmed) return;
      const msg: Message = { id: Date.now().toString(), sender: 'user', text: trimmed, deliveryStatus: 'pending' };
      setMessages((prev) => [...prev, msg]);
      try {
        if (replyingTo) {
          channel.sendTextWithParent(trimmed, replyingTo.id, replyingTo.text?.slice(0, 200), agentId || undefined, runtimeConnId);
        } else {
          channel.sendText(trimmed, agentId || undefined, runtimeConnId);
        }
        setMessages((prev) => prev.map((m) => m.id === msg.id ? { ...m, deliveryStatus: 'sent' as DeliveryStatus } : m));
      } catch { /* ignore */ }
      setInputValue('');
      setReplyingTo(null);
      setVoiceFinalText('');
      setVoiceInterimText('');
      setVoiceMode(false);
      setIsThinking(true);
    }, 50);
  }, [voiceFinalText, voiceInterimText, stopVoiceRecognition, agentId, runtimeConnId, replyingTo, messages]);

  // Handle voice button touch events for swipe-up-to-send
  const handleVoiceTouchStart = useCallback((e: React.TouchEvent) => {
    voiceTouchStartRef.current = { y: e.touches[0].clientY, time: Date.now() };
    setVoiceSwipeY(0);
  }, []);

  const handleVoiceTouchMove = useCallback((e: React.TouchEvent) => {
    if (!voiceTouchStartRef.current) return;
    const dy = voiceTouchStartRef.current.y - e.touches[0].clientY;
    setVoiceSwipeY(Math.max(0, dy));
  }, []);

  const handleVoiceTouchEnd = useCallback(() => {
    if (voiceSwipeY > 60) {
      // Swipe up → submit
      submitVoiceText();
    }
    setVoiceSwipeY(0);
    voiceTouchStartRef.current = null;
  }, [voiceSwipeY, submitVoiceText]);

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

  const slashSkillMenuActive = skills.length > 0 && (
    inputValue === '/' || '/use'.startsWith(inputValue) || inputValue.startsWith('/use ')
  );
  const filterSlashSkill = (skillName: string) => {
    if (inputValue === '/' || inputValue === '/use') return true;
    if (inputValue.startsWith('/use ')) {
      const query = inputValue.slice(5).toLowerCase();
      return skillName.toLowerCase().includes(query);
    }
    return `/use ${skillName}`.startsWith(inputValue);
  };
  const workspaceSkills = [...new Set(agentInfo?.workspaceSkills ?? configuredSkills.filter((skillName) => !builtinSkillSet.has(skillName)))];
  const globalSkills = [...new Set(agentInfo?.globalSkills ?? skills.filter((skillName) => !configuredSkillSet.has(skillName) && !builtinSkillSet.has(skillName)))];
  const builtinSkills = [...new Set(skills.filter((skillName) => builtinSkillSet.has(skillName)))];
  const filteredWorkspaceSkills = slashSkillMenuActive ? workspaceSkills.filter(filterSlashSkill) : [];
  const filteredGlobalSkills = slashSkillMenuActive ? globalSkills.filter(filterSlashSkill) : [];
  const filteredBuiltinSkills = slashSkillMenuActive ? builtinSkills.filter(filterSlashSkill) : [];
  const hasSkillMatches = filteredWorkspaceSkills.length > 0 || filteredGlobalSkills.length > 0 || filteredBuiltinSkills.length > 0;

  return (
    <div className="relative flex h-full flex-col bg-white dark:bg-[#11161d]">
      {/* Header */}
      {/* Chat header — sticky, always visible, same bg as page */}
      <ChatHeader
        agentInfo={agentInfo}
        agentId={agentId}
        connectionName={getConnectionDisplayName(activeConn?.name, activeConn?.displayName)}
        wsStatus={wsStatus as 'connected' | 'connecting' | 'reconnecting' | 'disconnected'}
        presence={agentPresence}
        isDesktop={isDesktop}
        isSplitPane={isSplitPane}
        splitActive={splitActive}
        showSplitButton={Boolean(showSplitButton && agentId && onToggleSplit)}
        onBack={onBack}
        onMenuOpen={() => setShowHeaderMenu(true)}
        onToggleSplit={onToggleSplit}
        onCloseSplit={onCloseSplit}
        onAvatarClick={() => setShowAgentDetail(true)}
        onReconnect={() => channel.reconnect(runtimeConnId)}
      />

      {/* Header context menu */}
      <HeaderMenu
        isOpen={showHeaderMenu}
        onClose={() => setShowHeaderMenu(false)}
        onOpenHistory={openHistoryDrawer}
        onOpenFiles={openFileGallery}
        showSplitOption={Boolean(!isSplitPane && showSplitButton && agentId && onToggleSplit)}
        splitActive={splitActive}
        onToggleSplit={onToggleSplit}
        onSendCommand={handleHeaderCommand}
        thinkLevel={thinkLevel}
        onOpenMemory={() => { setShowHeaderMenu(false); setShowMemory(true); }}
        onOpenAgentDetail={() => { setShowHeaderMenu(false); setShowAgentDetail(true); }}
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
        reconnectAttempt={reconnectInfo.attempt}
        reconnectMaxAttempts={reconnectInfo.maxAttempts}
        reconnectDelayMs={reconnectInfo.delayMs}
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
      <div className="relative flex flex-1 flex-col min-h-0">
      <div
        ref={scrollContainerRef}
        className="flex flex-1 flex-col overflow-y-auto overflow-x-hidden bg-white px-4 pt-4 pb-4 overscroll-contain dark:bg-[#11161d]"
        style={{ WebkitOverflowScrolling: 'touch' }}
      >
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
            streamingStatus={msg.isStreaming && isThinking ? (() => {
              const latestActive = activeToolCalls[activeToolCalls.length - 1];
              return latestActive ? `🔧 ${formatToolName(latestActive.toolName)}` : (thinkingPhase || undefined);
            })() : undefined}
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
          <div className="flex items-center gap-2 px-2 text-[12px] text-slate-500 dark:text-slate-400">
            <span className="h-1.5 w-1.5 rounded-full bg-sky-500 status-breathe" />
            {agentInfo?.name || 'Bot'} is typing…
          </div>
        )}

        {/* Thinking indicator — only show when NOT streaming (during streaming, status shows inline next to cursor) */}
        <AnimatePresence>
          {isThinking && !messages.some((m) => m.isStreaming) && (
            <motion.div
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -5 }}
              className="mt-3 flex gap-3 rounded-[22px] border border-primary/12 bg-primary/6 px-3 py-3 shadow-[0_16px_32px_-28px_rgba(239,90,35,0.45)] dark:border-primary/16 dark:bg-primary/8"
            >
              <div className="flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-full bg-gradient-to-br from-primary to-primary-deep text-sm text-white shadow-sm">
                {agentInfo?.identityEmoji || '🤖'}
              </div>
              <div className="min-w-0 flex-1 pt-1.5">
                {/* Current tool or thinking phase — single line */}
                {(() => {
                  const latestActive = activeToolCalls[activeToolCalls.length - 1];
                  const argSnippet = latestActive ? formatToolArgSnippet(latestActive.args) : '';
                  return (
                    <span className="flex items-center gap-1.5 truncate text-[13px] font-semibold text-primary">
                      <span className="h-1.5 w-1.5 rounded-full bg-primary status-breathe" />
                      {latestActive
                        ? `🔧 ${formatToolName(latestActive.toolName)}${argSnippet ? ` · ${argSnippet}` : ''}`
                        : (thinkingPhase || 'Thinking')}
                    </span>
                  );
                })()}

                {/* Expandable tool call history */}
                {(toolCallHistory.length > 0 || activeToolCalls.length > 1) && (
                  <div className="mt-2 rounded-2xl border border-slate-200/80 bg-white/90 px-3 py-2 shadow-sm dark:border-slate-700/70 dark:bg-card-alt/75">
                    <button
                      onClick={() => setToolHistoryExpanded((v) => !v)}
                      className="flex items-center gap-1 text-[11px] text-slate-500 transition-colors hover:text-text dark:text-slate-400 dark:hover:text-text-inv"
                    >
                      <span className="inline-block transition-transform" style={{ transform: toolHistoryExpanded ? 'rotate(90deg)' : 'rotate(0deg)' }}>▸</span>
                      {toolCallHistory.length + activeToolCalls.length} tool call{toolCallHistory.length + activeToolCalls.length !== 1 ? 's' : ''}
                    </button>
                    {toolHistoryExpanded && (
                      <div className="mt-1 flex max-h-40 flex-col gap-1 overflow-y-auto text-[11px] text-slate-600 dark:text-slate-400">
                        {toolCallHistory.map((tc) => (
                          <div key={tc.toolCallId} className="flex items-center gap-1 truncate">
                            <span className="text-emerald-500">✓</span>
                            <span className="font-medium">{formatToolName(tc.toolName)}</span>
                            {tc.resultSummary && (
                              <span className="truncate text-slate-400 dark:text-slate-500" title={tc.resultSummary}>
                                — {formatResultSummary(tc.resultSummary)}
                              </span>
                            )}
                            <span className="flex-shrink-0 text-slate-400 dark:text-slate-500">{tc.endTime - tc.startTime}ms</span>
                          </div>
                        ))}
                        {activeToolCalls.map((tc) => (
                          <div key={tc.toolCallId} className="flex items-center gap-1 truncate">
                            <span className="text-primary">⟳</span>
                            <span className="font-medium">{formatToolName(tc.toolName)}</span>
                            {formatToolArgSnippet(tc.args) && (
                              <span className="truncate text-slate-400 dark:text-slate-500">
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
              {/* Cancel thinking button */}
              <button
                onClick={() => {
                  setIsThinking(false);
                  setActiveToolCalls([]);
                  setToolCallHistory([]);
                  setThinkingPhase('');
                  if (thinkingTimerRef.current) { clearInterval(thinkingTimerRef.current); thinkingTimerRef.current = null; }
                  // Mark any streaming messages as complete
                  setMessages((prev) => prev.map((m) => m.isStreaming ? { ...m, isStreaming: false, text: m.text + '\n\n*[cancelled]*' } : m));
                }}
                className="flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-full text-primary/50 transition-colors hover:bg-primary/10 hover:text-primary self-start mt-0.5"
                title="Cancel"
                aria-label="Cancel AI response"
              >
                <X size={16} />
              </button>
            </motion.div>
          )}
        </AnimatePresence>
        <div ref={messagesEndRef} />
      </div>

        {/* Scroll to bottom floating button */}
        <AnimatePresence>
          {showScrollToBottom && (
            <motion.button
              initial={{ opacity: 0, scale: 0.8 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.8 }}
              onClick={() => {
                const container = scrollContainerRef.current;
                if (container) container.scrollTo({ top: container.scrollHeight, behavior: 'smooth' });
              }}
              className="absolute bottom-4 right-4 z-10 flex h-10 w-10 items-center justify-center rounded-full border border-border/50 bg-white/95 text-text/60 shadow-lg transition-colors hover:bg-slate-50 hover:text-text focus-visible:ring-2 focus-visible:ring-primary/50 dark:border-border-dark/50 dark:bg-card-alt/95 dark:text-text-inv/60 dark:hover:bg-card-alt dark:hover:text-text-inv"
              aria-label="Scroll to bottom"
            >
              <ArrowDown size={18} />
            </motion.button>
          )}
        </AnimatePresence>
      </div>

      {/* Delete confirmation dialog */}
      <AnimatePresence>
        {deleteConfirmId && (
          <>
            <motion.div
              initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
              className="fixed inset-0 bg-black/40 backdrop-blur-sm z-[70]"
              onClick={() => setDeleteConfirmId(null)}
            />
            <motion.div
              initial={{ opacity: 0, scale: 0.92 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.92 }}
              transition={{ type: 'spring', stiffness: 400, damping: 28 }}
              className="fixed inset-x-4 bottom-0 z-[70] md:inset-auto md:top-1/2 md:left-1/2 md:-translate-x-1/2 md:-translate-y-1/2 md:w-[320px]"
            >
              <div
                role="alertdialog"
                aria-modal="true"
                aria-labelledby="delete-confirm-title"
                aria-describedby="delete-confirm-desc"
                tabIndex={-1}
                ref={(el) => el?.focus()}
                onKeyDown={(e) => { if (e.key === 'Escape') setDeleteConfirmId(null); }}
                className="bg-white dark:bg-[#1f2c34] rounded-t-2xl md:rounded-2xl shadow-2xl safe-area-bottom border-t border-border/30 dark:border-transparent p-6 outline-none"
              >
                <p id="delete-confirm-title" className="text-[16px] font-semibold text-text dark:text-text-inv mb-1">Delete message?</p>
                <p id="delete-confirm-desc" className="text-[14px] text-text/60 dark:text-text-inv/50 mb-5">This action cannot be undone.</p>
                <div className="flex gap-3">
                  <button
                    autoFocus
                    onClick={() => setDeleteConfirmId(null)}
                    className="flex-1 rounded-xl py-2.5 text-[15px] font-medium text-text/70 dark:text-text-inv/70 bg-slate-100 dark:bg-white/[0.06] transition-colors hover:bg-slate-200 dark:hover:bg-white/[0.1]"
                  >
                    Cancel
                  </button>
                  <button
                    onClick={confirmDelete}
                    className="flex-1 rounded-xl py-2.5 text-[15px] font-medium text-white bg-red-500 transition-colors hover:bg-red-600 shadow-sm"
                  >
                    Delete
                  </button>
                </div>
              </div>
            </motion.div>
          </>
        )}
      </AnimatePresence>

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
      <div className="safe-area-bottom relative z-30 flex flex-shrink-0 flex-col gap-2.5 border-t border-border/40 bg-white px-2 pt-2 pb-1 dark:border-border-dark/40 dark:bg-[#11161d]">
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
                className="absolute bottom-full left-0 right-0 z-50 mb-1 max-h-[50vh] overflow-y-auto overflow-x-hidden rounded-[20px] border border-border/75 bg-white/96 shadow-[0_24px_48px_-26px_rgba(15,23,42,0.36)] dark:border-border-dark/75 dark:bg-card-alt/96 dark:shadow-[0_24px_48px_-26px_rgba(2,6,23,0.76)]"
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
                      <div className="sticky top-0 bg-white/96 px-3 pt-2 pb-1 text-[10px] font-semibold uppercase tracking-[0.24em] text-slate-400 dark:bg-card-alt/96 dark:text-slate-500">{sec.name}</div>
                      {sec.items.map(cmd => (
                        <button
                          key={cmd.id}
                          onClick={() => handleCommandSelect(cmd.label)}
                          className="flex w-full items-center gap-2.5 px-3 py-2 text-left transition-colors hover:bg-slate-50 dark:hover:bg-white/[0.05]"
                        >
                          <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-slate-900/[0.04] text-slate-500 dark:bg-white/[0.06] dark:text-slate-400">
                            <cmd.icon size={14} />
                          </div>
                          <div className="min-w-0 flex-1">
                            <span className="text-[13px] font-medium text-text dark:text-text-inv">{cmd.label}</span>
                            <span className="ml-2 truncate text-[11px] text-slate-400 dark:text-slate-500">{cmd.desc}</span>
                          </div>
                        </button>
                      ))}
                    </div>
                  ));
                })()}

                {/* Skills section */}
                {slashSkillMenuActive && hasSkillMatches && (
                  <>
                    {filteredWorkspaceSkills.length > 0 && (
                      <>
                        <div className="sticky top-0 flex items-center gap-1.5 bg-white/96 px-3 pt-2 pb-1 text-[10px] font-semibold uppercase tracking-[0.24em] text-slate-400 dark:bg-card-alt/96 dark:text-slate-500">
                          <Puzzle size={10} className="text-primary" />
                          Workspace Skills ({filteredWorkspaceSkills.length})
                        </div>
                        {filteredWorkspaceSkills.map((skillName) => (
                          <button
                            key={`workspace-${skillName}`}
                            onClick={() => handleCommandSelect(`/use ${skillName}`)}
                            className="flex w-full items-center gap-2.5 px-3 py-2 text-left transition-colors hover:bg-slate-50 dark:hover:bg-white/[0.05]"
                          >
                            <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-primary/8 text-primary">
                              <Puzzle size={14} />
                            </div>
                            <div className="min-w-0 flex-1">
                              <span className="text-[13px] font-medium text-text dark:text-text-inv">{skillName}</span>
                            </div>
                          </button>
                        ))}
                      </>
                    )}

                    {filteredGlobalSkills.length > 0 && (
                      <>
                        <div className="sticky top-0 flex items-center gap-1.5 bg-white/96 px-3 pt-2 pb-1 text-[10px] font-semibold uppercase tracking-[0.24em] text-slate-400 dark:bg-card-alt/96 dark:text-slate-500">
                          <Puzzle size={10} className="text-slate-400 dark:text-slate-500" />
                          Global Skills ({filteredGlobalSkills.length})
                        </div>
                        {filteredGlobalSkills.map((skillName) => (
                          <button
                            key={`global-${skillName}`}
                            onClick={() => handleCommandSelect(`/use ${skillName}`)}
                            className="flex w-full items-center gap-2.5 px-3 py-2 text-left transition-colors hover:bg-slate-50 dark:hover:bg-white/[0.05]"
                          >
                            <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-slate-900/[0.03] text-slate-400 dark:bg-white/[0.04] dark:text-slate-500">
                              <Puzzle size={14} />
                            </div>
                            <div className="min-w-0 flex-1">
                              <span className="text-[13px] text-slate-500 dark:text-slate-400">{skillName}</span>
                            </div>
                          </button>
                        ))}
                      </>
                    )}

                    {filteredBuiltinSkills.length > 0 && (
                      <>
                        <button
                          type="button"
                          onClick={() => setShowBuiltinSkills((prev) => !prev)}
                          className="sticky top-0 flex w-full items-center gap-1.5 bg-white/96 px-3 pt-2 pb-1 text-[10px] font-semibold uppercase tracking-[0.24em] text-slate-300 transition-colors hover:text-slate-500 dark:bg-card-alt/96 dark:text-slate-600 dark:hover:text-slate-400"
                        >
                          {showBuiltinSkills ? <ChevronDown size={10} /> : <ChevronRight size={10} />}
                          Built-in Skills ({filteredBuiltinSkills.length})
                        </button>
                        {showBuiltinSkills && filteredBuiltinSkills.map((skillName) => (
                          <button
                            key={`builtin-${skillName}`}
                            onClick={() => handleCommandSelect(`/use ${skillName}`)}
                            className="flex w-full items-center gap-2.5 px-3 py-2 text-left opacity-55 transition-colors hover:bg-slate-50 dark:hover:bg-white/[0.05]"
                          >
                            <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-slate-900/[0.03] text-slate-400 dark:bg-white/[0.04] dark:text-slate-500">
                              <Puzzle size={14} />
                            </div>
                            <div className="min-w-0 flex-1">
                              <span className="text-[13px] italic text-slate-400 dark:text-slate-500">{skillName}</span>
                            </div>
                          </button>
                        ))}
                      </>
                    )}
                  </>
                )}

                {/* Empty state */}
                {slashCommands.filter(cmd => cmd.label.startsWith(inputValue) || inputValue === '/').length === 0
                  && !hasSkillMatches
                  && (
                  <div className="px-3 py-4 text-center text-[12px] text-slate-400 dark:text-slate-500">
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
                className="absolute bottom-full left-0 right-0 z-50 mb-2 flex flex-wrap justify-center gap-2 rounded-[24px] border border-border/65 bg-white/96 p-4 shadow-[0_24px_48px_-26px_rgba(15,23,42,0.36)] backdrop-blur-[20px] dark:border-border-dark/65 dark:bg-card-alt/96 dark:shadow-[0_24px_48px_-26px_rgba(2,6,23,0.78)]"
              >
                {EMOJI_LIST.map((emoji) => (
                  <motion.button
                    key={emoji}
                    whileTap={{ scale: 0.8 }}
                    onClick={() => handleEmojiSelect(emoji)}
                    className="flex h-9 w-9 items-center justify-center rounded-full text-xl transition-colors hover:bg-slate-100 dark:hover:bg-white/[0.06]"
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

        <div className="relative flex items-center gap-1 rounded-[16px] border border-border/60 bg-surface/70 p-1.5 dark:border-border-dark/60 dark:bg-white/[0.04]">
          {voiceMode ? (
            <>
              {/* Recognized text floating above bar */}
              <AnimatePresence>
                {(voiceFinalText || voiceInterimText) && (
                  <motion.div
                    initial={{ opacity: 0, y: 8 }}
                    animate={{ opacity: 1, y: 0 }}
                    exit={{ opacity: 0, y: 8 }}
                    className="absolute bottom-full left-0 right-0 z-20 mx-1 mb-2 rounded-2xl border border-border/60 bg-white/96 px-4 py-3 shadow-lg dark:border-border-dark/60 dark:bg-card-alt/96"
                  >
                    <p className="text-[14px] text-text dark:text-text-inv leading-relaxed">
                      {voiceFinalText}
                      {voiceInterimText && (
                        <span className="text-text/40 dark:text-text-inv/40">{voiceInterimText}</span>
                      )}
                    </p>
                  </motion.div>
                )}
                {voiceRefining && (
                  <motion.div
                    initial={{ opacity: 0, y: 8 }}
                    animate={{ opacity: 1, y: 0 }}
                    exit={{ opacity: 0, y: 8 }}
                    className="absolute bottom-full left-0 right-0 z-20 mx-1 mb-2 rounded-2xl border border-primary/30 bg-primary/6 px-4 py-3 shadow-lg dark:border-primary/20 dark:bg-primary/8"
                  >
                    <p className="text-[13px] text-primary font-medium flex items-center gap-2">
                      <Loader2 size={14} className="animate-spin" />
                      {isChinese ? '正在优化文本...' : 'Refining text...'}
                    </p>
                  </motion.div>
                )}
              </AnimatePresence>

              {/* Keyboard toggle */}
              <motion.button
                whileTap={{ scale: 0.9 }}
                onClick={() => {
                  const text = (voiceFinalText + voiceInterimText).trim();
                  stopVoiceRecognition();
                  if (text) setInputValue(prev => prev ? prev + ' ' + text : text);
                  setVoiceFinalText('');
                  setVoiceInterimText('');
                  localStorage.setItem('clawline:voiceMode', 'false');
                  setVoiceMode(false);
                }}
                className="flex h-11 w-11 items-center justify-center rounded-full text-text/40 transition-colors hover:text-text/60 dark:text-text-inv/40 dark:hover:text-text-inv/60"
                aria-label="Switch to keyboard"
              >
                <Keyboard size={20} />
              </motion.button>

              {/* Tap-to-speak button */}
              <motion.button
                className={`flex-1 h-11 rounded-full flex items-center justify-center gap-2 transition-all relative overflow-hidden ${
                  voiceListening
                    ? 'bg-primary/10 dark:bg-primary/20'
                    : 'bg-slate-900/[0.04] dark:bg-white/[0.06]'
                }`}
                onClick={() => voiceListening ? stopVoiceRecognition() : startVoiceRecognition()}
                onTouchStart={handleVoiceTouchStart}
                onTouchMove={handleVoiceTouchMove}
                onTouchEnd={handleVoiceTouchEnd}
                aria-label={voiceListening ? 'Stop listening' : 'Start voice input'}
              >
                {voiceListening ? (
                  <>
                    <div className="flex items-center gap-[3px] h-5">
                      {[0, 1, 2, 3, 4].map((i) => (
                        <motion.div
                          key={i}
                          className="w-[3px] rounded-full bg-primary"
                          initial={{ height: 8 }}
                          animate={{ height: [8, 20, 12, 18, 8] }}
                          transition={{
                            duration: 0.8,
                            repeat: Infinity,
                            delay: i * 0.1,
                            ease: 'easeInOut',
                          }}
                        />
                      ))}
                    </div>
                    <span className="text-[14px] text-primary font-medium">{isChinese ? '正在听...' : 'Listening...'}</span>
                  </>
                ) : (
                  <>
                    <Mic size={18} className="text-slate-500 dark:text-slate-400" />
                    <span className="text-[14px] text-slate-500 dark:text-slate-400">{isChinese ? '点击说话' : 'Tap to speak'}</span>
                  </>
                )}
                {/* Swipe-up overlay */}
                <AnimatePresence>
                  {voiceSwipeY > 20 && (
                    <motion.div
                      initial={{ opacity: 0 }}
                      animate={{ opacity: Math.min(voiceSwipeY / 60, 1) }}
                      exit={{ opacity: 0 }}
                      className="absolute inset-0 flex items-center justify-center bg-primary/15 dark:bg-primary/25 rounded-full"
                    >
                      <span className="text-[13px] text-primary font-semibold">{isChinese ? '↑ 松开发送' : '↑ Release to send'}</span>
                    </motion.div>
                  )}
                </AnimatePresence>
              </motion.button>

              {/* Send button when text recognized */}
              <AnimatePresence>
                {(voiceFinalText || voiceInterimText) && (
                  <motion.button
                    initial={{ scale: 0.8, opacity: 0 }}
                    animate={{ scale: 1, opacity: 1 }}
                    exit={{ scale: 0.8, opacity: 0 }}
                    whileTap={{ scale: 0.9 }}
                    onClick={submitVoiceText}
                    className="flex h-11 w-11 items-center justify-center rounded-full bg-primary text-white shadow-sm"
                    aria-label="Send voice text"
                  >
                    <ArrowUp size={20} strokeWidth={2.5} />
                  </motion.button>
                )}
              </AnimatePresence>
            </>
          ) : (
            <>
          {/* Action menu toggle (+ button) */}
          <motion.button
            whileTap={{ scale: 0.9 }}
            onClick={() => setShowMoreIcons(!showMoreIcons)}
            className={`flex h-11 w-11 items-center justify-center rounded-full transition-colors ${showMoreIcons ? 'bg-primary/10 text-primary' : 'text-text/40 hover:text-text/60 dark:text-text-inv/40 dark:hover:text-text-inv/60'}`}
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
                  className="absolute bottom-full left-0 z-30 mb-2 flex min-w-[140px] flex-col gap-1 rounded-2xl border border-border/70 bg-white/96 p-2 shadow-[0_24px_48px_-26px_rgba(15,23,42,0.36)] dark:border-border-dark/70 dark:bg-card-alt/96 dark:shadow-[0_24px_48px_-26px_rgba(2,6,23,0.78)]"
                >
                  <button
                    onClick={() => { handleImagePick(); setShowMoreIcons(false); }}
                    className="flex items-center gap-3 rounded-xl px-3 py-2.5 text-[14px] text-text transition-colors hover:bg-slate-50 dark:text-text-inv dark:hover:bg-white/[0.05]"
                  >
                    <Image size={18} />
                    Image
                  </button>
                  <button
                    onClick={() => { handleFilePick(); setShowMoreIcons(false); }}
                    className="flex items-center gap-3 rounded-xl px-3 py-2.5 text-[14px] text-text transition-colors hover:bg-slate-50 dark:text-text-inv dark:hover:bg-white/[0.05]"
                  >
                    <Paperclip size={18} />
                    File
                  </button>
                  <button
                    onClick={() => { setShowEmojiPicker(!showEmojiPicker); setShowMoreIcons(false); }}
                    className="flex items-center gap-3 rounded-xl px-3 py-2.5 text-[14px] text-text transition-colors hover:bg-slate-50 dark:text-text-inv dark:hover:bg-white/[0.05]"
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
                className="absolute bottom-full left-0 right-0 z-20 mx-1 mb-3 rounded-[18px] border border-border/60 bg-white/96 p-3 shadow-[0_24px_48px_-26px_rgba(15,23,42,0.32)] dark:border-border-dark/60 dark:bg-card-alt/96 dark:shadow-[0_24px_48px_-26px_rgba(2,6,23,0.7)]"
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
                      onKeyDown={(e) => {
                        if (e.key === 'Enter' && !e.nativeEvent.isComposing) {
                          e.preventDefault();
                          handleSendPendingFile();
                        }
                      }}
                      placeholder="Add a caption..."
                      className="w-full bg-transparent text-[12px] text-slate-600 outline-none placeholder:text-slate-400 dark:text-slate-300 dark:placeholder:text-slate-500"
                      autoFocus
                    />
                  </div>
                  <button
                    onClick={handleSendPendingFile}
                    className="self-center rounded-full bg-primary p-2 text-white shadow-md transition-all hover:scale-105 hover:shadow-lg"
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
            onPaste={handlePaste}
            onFocus={() => { setShowEmojiPicker(false); }}
            onBlur={() => { window.scrollTo(0, 0); }}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !e.nativeEvent.isComposing && agentReady) {
                e.preventDefault();
                handleSend();
              }
            }}
            placeholder={agentReady ? "Message..." : "Switching agent..."}
            disabled={!agentReady}
            aria-label="Type a message"
            className="flex-1 bg-transparent border-none px-2 py-1.5 text-[14px] text-text placeholder:text-slate-400 focus:outline-none focus-visible:rounded-md focus-visible:ring-2 focus-visible:ring-primary dark:text-text-inv dark:placeholder:text-slate-500 disabled:text-slate-400 disabled:italic disabled:opacity-90"
          />

          {/* Voice mode toggle when no text, Send button when has text */}
          {inputValue.trim() ? (
            <motion.button
              initial={{ scale: 0.8, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              whileHover={{ scale: 1.08, y: -2 }}
              whileTap={{ scale: 0.9 }}
              onClick={handleSend}
              disabled={!agentReady}
              aria-label="Send message"
              className="flex h-11 w-11 items-center justify-center rounded-full bg-primary text-white shadow-sm disabled:cursor-not-allowed disabled:opacity-50"
            >
              <ArrowUp size={20} strokeWidth={2.5} />
            </motion.button>
          ) : (
            <motion.button
              whileTap={{ scale: 0.9 }}
              onClick={() => { localStorage.setItem('clawline:voiceMode', 'true'); setVoiceMode(true); }}
              aria-label="Switch to voice input"
              className="flex h-11 w-11 items-center justify-center rounded-full text-text/40 transition-colors hover:text-text/60 dark:text-text-inv/40 dark:hover:text-text-inv/60"
            >
              <Mic size={18} />
            </motion.button>
          )}
            </>
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

      {/* Agent detail sheet */}
      <AgentDetailSheet
        isOpen={showAgentDetail}
        onClose={() => setShowAgentDetail(false)}
        agentInfo={agentInfo}
        agentId={agentId}
        connectionName={getConnectionDisplayName(activeConn?.name, activeConn?.displayName)}
        wsStatus={wsStatus as 'connected' | 'connecting' | 'reconnecting' | 'disconnected'}
        presence={agentPresence}
      />
    </div>
  );
}
