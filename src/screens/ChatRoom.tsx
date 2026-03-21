import { useState, useRef, useEffect, useCallback, type ChangeEvent } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { ChevronLeft, Columns2, MoreHorizontal, Smile, Mic, MicOff, Send, Code, FileText, Zap, SmilePlus, Wifi, WifiOff, Loader2, HelpCircle, Database, Activity, User, Plus, RotateCcw, Cpu, Server, MessageSquare, LayoutDashboard, Square, Image, CornerDownLeft, X, Pencil, Trash2, Paperclip, Brain, Puzzle, RefreshCw } from 'lucide-react';
import { cn } from '../lib/utils';
import * as channel from '../services/clawChannel';
import type { AgentContext, AgentInfo, ConversationSummary } from '../services/clawChannel';
import { getUserId } from '../App';
import { getActiveConnection, getConnectionById } from '../services/connectionStore';
import ActionCard from '../components/ActionCard';
import AgentContextViewer from '../components/AgentContextViewer';
import MarkdownRenderer from '../components/MarkdownRenderer';
import MemorySheet from '../components/MemorySheet';
import FileGallery from '../components/FileGallery';
import { clearConversationMessages, DEFAULT_LOAD_LIMIT, loadConversationMessages, saveConversationMessages } from '../services/messageDB';

type Message = {
  id: string;
  sender: 'user' | 'ai';
  text: string;
  reactions?: string[];
  mediaType?: string;
  mediaUrl?: string;
  replyTo?: string;
  timestamp?: number;
  isStreaming?: boolean; // Temporary streaming message indicator
};

const PREVIEW_KEY_PREFIX = 'openclaw.agentPreview.';
const MESSAGE_PREVIEW_UPDATED_EVENT = 'openclaw:message-preview-updated';

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

const EMOJI_LIST = ['👍', '❤️', '😂', '🔥', '✨', '👀', '💯', '🚀'];

const QUICK_COMMANDS = [
  { label: '/status', emoji: '📊', desc: 'Session status' },
  { label: '/models', emoji: '🤖', desc: 'List models' },
  { label: '/help', emoji: '❓', desc: 'Show help' },
  { label: '/new', emoji: '✨', desc: 'New session' },
  { label: '/reset', emoji: '🔄', desc: 'Reset context' },
];

// Context-aware suggestions shown after bot messages
const CONTEXT_SUGGESTIONS = [
  { label: 'Explain more', emoji: '💡' },
  { label: 'Summarize', emoji: '📝' },
  { label: 'Try again', emoji: '🔄' },
];

function formatTime(ts?: number) {
  if (!ts) return '';
  const d = new Date(ts);
  const h = d.getHours().toString().padStart(2, '0');
  const m = d.getMinutes().toString().padStart(2, '0');
  return `${h}:${m}`;
}

function formatDate(ts: number) {
  const d = new Date(ts);
  const now = new Date();
  if (d.toDateString() === now.toDateString()) return 'Today';
  const yesterday = new Date(now);
  yesterday.setDate(yesterday.getDate() - 1);
  if (d.toDateString() === yesterday.toDateString()) return 'Yesterday';
  return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: d.getFullYear() !== now.getFullYear() ? 'numeric' : undefined });
}

function formatRelativeTime(ts?: number) {
  if (!ts) return '';
  const diff = Date.now() - ts;
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return 'now';
  if (mins < 60) return `${mins}m`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h`;
  const days = Math.floor(hours / 24);
  if (days < 7) return `${days}d`;
  return new Date(ts).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}

function isDifferentDay(ts1?: number, ts2?: number) {
  if (!ts1 || !ts2) return true;
  return new Date(ts1).toDateString() !== new Date(ts2).toDateString();
}

// --- File to data URL ---
function fileToDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result as string);
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}

// --- Load agent info ---
function getAgentInfo(agentId: string | null | undefined, connectionId: string) {
  const list = channel.loadCachedAgents(connectionId);
  return list.find((agent) => agent.id === agentId) || null;
}

function getPreviewKey(connectionId: string, agentId: string) {
  return `${PREVIEW_KEY_PREFIX}${connectionId}.${agentId}`;
}

function emitPreviewUpdated(connectionId: string, agentId: string) {
  window.dispatchEvent(new CustomEvent(MESSAGE_PREVIEW_UPDATED_EVENT, {
    detail: { connectionId, agentId },
  }));
}

function saveAgentPreview(agentId: string | null | undefined, connectionId: string, messages: Message[]) {
  if (!agentId || !connectionId || messages.length === 0) return;
  const lastMeaningfulMessage = [...messages].reverse().find((message) => !message.isStreaming);
  if (!lastMeaningfulMessage) return;

  try {
    localStorage.setItem(getPreviewKey(connectionId, agentId), JSON.stringify({
      text: lastMeaningfulMessage.text || lastMeaningfulMessage.mediaType || 'Attachment',
      timestamp: lastMeaningfulMessage.timestamp,
    }));
    emitPreviewUpdated(connectionId, agentId);
  } catch {
    // ignore storage failures
  }
}

function mergeMessages(cachedMessages: Message[], liveMessages: Message[]) {
  const merged = new Map<string, Message>();

  cachedMessages.forEach((message) => {
    merged.set(message.id, message);
  });

  liveMessages.forEach((message) => {
    merged.set(message.id, message);
  });

  return [...merged.values()].sort((left, right) => (left.timestamp ?? 0) - (right.timestamp ?? 0));
}

function getConnectionDisplayName(name?: string, fallbackName?: string) {
  return name || fallbackName || 'Server';
}

function getSkillDescription(skillName: string) {
  return `${skillName} is available in this agent.`;
}

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
  const prevWsStatusRef = useRef<string>(channel.getStatus(runtimeConnId));
  const [showReconnected, setShowReconnected] = useState(false);
  const [isThinking, setIsThinking] = useState(false);
  const [isRecording, setIsRecording] = useState(false);
  const [replyingTo, setReplyingTo] = useState<Message | null>(null);
  const [peerTyping, setPeerTyping] = useState(false);
  const [editingMsg, setEditingMsg] = useState<Message | null>(null);
  const [showHeaderMenu, setShowHeaderMenu] = useState(false);
  const [showHistoryDrawer, setShowHistoryDrawer] = useState(false);
  const [showFileGallery, setShowFileGallery] = useState(false);
  const [showSkills, setShowSkills] = useState(false);
  const [showContextViewer, setShowContextViewer] = useState(false);
  const [showMoreIcons, setShowMoreIcons] = useState(false);
  const [conversations, setConversations] = useState<ConversationSummary[]>([]);
  const [loadingConversations, setLoadingConversations] = useState(false);
  const fileInputRef2 = useRef<HTMLInputElement>(null);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const audioChunksRef = useRef<Blob[]>([]);
  const skills = agentInfo?.skills ?? [];
  const skillCount = skills.length;

  useEffect(() => {
    setAgentInfo(getAgentInfo(agentId, connId));
    setAgentContext(
      channel.getAgentContext(runtimeConnId, agentId ?? undefined) ??
      channel.getAgentContext(connId, agentId ?? undefined),
    );
    setIsContextLoading(false);
    setShowSkills(false);
  }, [agentId, connId, runtimeConnId]);

  useEffect(() => {
    if (skillCount > 0) return;
    setShowSkills(false);
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
      if (!chatId) return;
      try { channel.requestHistory(chatId, runtimeConnId); } catch { /* ignore */ }
    };

    setIsThinking(false);
    setShowHeaderMenu(false);
    setShowHistoryDrawer(false);
    setConversations([]);
    setWsStatus(channel.getStatus(runtimeConnId));
    prevWsStatusRef.current = channel.getStatus(runtimeConnId);

    const currentStatus = channel.getStatus(runtimeConnId);
    const currentChatId = channel.getChatId(runtimeConnId);

    if (currentStatus !== 'connecting') {
      channel.connect({
        connectionId: runtimeConnId,
        chatId: conversationId,
        senderId: activeConn.senderId || getUserId(),
        senderName: activeConn.displayName,
        serverUrl: activeConn.serverUrl,
        agentId: agentId || undefined,
        token: activeConn.token,
      });
    }

    if (currentStatus === 'connected' && (!chatId || currentChatId === chatId)) {
      requestSelectedHistory();
    }

    const unsubMsg = channel.onMessage((packet) => {
      if (packet.type === 'connection.open') {
        requestSelectedHistory();
      } else if (packet.type === 'message.send' && packet.data?.content) {
        setIsThinking(false);
        const content = packet.data.content as string;
        // Remove any streaming placeholder before adding the final message
        setMessages((prev) => {
          const withoutStreaming = prev.filter((m) => !m.isStreaming);
          return [
            ...withoutStreaming,
            {
              id: packet.data.messageId || Date.now().toString(),
              sender: 'ai',
              text: content,
              replyTo: (packet.data.replyTo as string) || undefined,
              timestamp: (packet.data.timestamp as number) || Date.now(),
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
      } else if (packet.type === 'thinking.start') {
        setIsThinking(true);
      } else if (packet.type === 'thinking.update') {
        setIsThinking(true);
      } else if (packet.type === 'thinking.end') {
        // keep thinking visible until message.send arrives
      } else if (packet.type === 'message.edit') {
        const d = packet.data as { messageId: string; content: string };
        setMessages((prev) => prev.map((m) => m.id === d.messageId ? { ...m, text: d.content } : m));
      } else if (packet.type === 'message.delete') {
        const d = packet.data as { messageId: string };
        setMessages((prev) => prev.filter((m) => m.id !== d.messageId));
      } else if (packet.type === 'history.sync' && Array.isArray(packet.data?.messages)) {
        const history = (packet.data.messages as Array<{messageId?: string; content?: string; direction?: string; senderId?: string; timestamp?: number}>).map((m) => ({
          id: m.messageId || Date.now().toString(),
          sender: (m.direction === 'sent' ? 'user' : 'ai') as 'user' | 'ai',
          text: m.content || '',
          timestamp: m.timestamp || Date.now(),
        }));
        setMessages(history);
      } else if (packet.type === 'conversation.list') {
        const nextConversations = Array.isArray((packet.data as { conversations?: ConversationSummary[] }).conversations)
          ? [ ...((packet.data as { conversations?: ConversationSummary[] }).conversations || []) ].sort((a, b) => (b.timestamp || 0) - (a.timestamp || 0))
          : [];
        setConversations(nextConversations);
        setLoadingConversations(false);
      } else if (packet.type === 'agent.list') {
        const nextAgents = Array.isArray((packet.data as { agents?: AgentInfo[] }).agents)
          ? ((packet.data as { agents?: AgentInfo[] }).agents ?? [])
          : [];
        channel.saveCachedAgents(connId, nextAgents);
        setAgentInfo(nextAgents.find((agent) => agent.id === agentId) ?? null);
      } else if (packet.type === 'text.delta') {
        if (localStorage.getItem('openclaw.streaming.enabled') === 'false') return;

        // Streaming text output from backend
        const deltaData = packet.data as { chatId?: string; text?: string; done?: boolean; timestamp?: number };
        setIsThinking(false); // Hide thinking indicator when streaming starts

        if (deltaData.done) {
          // Streaming finished - remove the streaming placeholder message
          // The final message.send will replace it with a permanent message
          setMessages((prev) => prev.filter((m) => !m.isStreaming));
        } else if (typeof deltaData.text === 'string') {
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
    }, runtimeConnId);

    const unsubStatus = channel.onStatus((status) => {
      // Detect reconnect: was disconnected/reconnecting → now connected
      if (status === 'connected' && prevWsStatusRef.current !== 'connected' && prevWsStatusRef.current !== 'connecting') {
        setShowReconnected(true);
        setTimeout(() => setShowReconnected(false), 2500);
      }
      prevWsStatusRef.current = status;
      setWsStatus(status);
      if (status === 'disconnected') {
        setLoadingConversations(false);
      }
    }, runtimeConnId);

    return () => {
      unsubMsg();
      unsubStatus();
      // Don't close channel here — next connect() will replace it,
      // and StrictMode double-invoke would kill the connection prematurely
    };
  }, [agentId, chatId, activeConn?.id, connId, runtimeConnId]);

  const requestConversationList = useCallback(() => {
    if (!agentId || !runtimeConnId) return;
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
        agentId: agentId || undefined,
        token: activeConn.token,
      });
    }

    if (drawerStatus === 'connected') {
      requestConversationList();
    } else {
      setLoadingConversations(true);
    }
  }, [activeConn, agentId, chatId, requestConversationList, runtimeConnId, showHistoryDrawer]);

  useEffect(() => {
    if (showHistoryDrawer && wsStatus === 'connected') {
      requestConversationList();
    }
  }, [requestConversationList, showHistoryDrawer, wsStatus]);

  const typingTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const handleInputChange = (e: ChangeEvent<HTMLInputElement>) => {
    const val = e.target.value;
    setInputValue(val);
    setShowSlashMenu(val.startsWith('/') && !val.includes(' '));

    // Send typing indicator (debounced)
    if (val.trim()) {
      try { channel.sendTyping(true, runtimeConnId); } catch {}
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

  const handleSendPendingFile = () => {
    if (!pendingFile) return;
    const { file, dataUrl, isImage } = pendingFile;
    const caption = fileCaption.trim();
    const userMsg: Message = {
      id: Date.now().toString(),
      sender: 'user',
      text: caption || (isImage ? '' : `📎 ${file.name}`),
      mediaType: isImage ? 'image' : 'file',
      mediaUrl: dataUrl,
      timestamp: Date.now(),
    };
    setMessages((prev) => [...prev, userMsg]);
    try {
      channel.sendFile({ content: caption || file.name, mediaUrl: dataUrl, mimeType: file.type, fileName: file.name, agentId: agentId || undefined }, runtimeConnId);
    } catch { /* ignore */ }
    setPendingFile(null);
    setFileCaption('');
  };

  const handleCancelPendingFile = () => {
    setPendingFile(null);
    setFileCaption('');
  };

  const handleSend = () => {
    if (editingMsg) { handleSaveEdit(); return; }
    if (!inputValue.trim()) return;
    if (inputValue.trim() === '/memory') {
      setShowMemory(true);
      setInputValue('');
      setShowSlashMenu(false);
      return;
    }
    const userMsg: Message = {
      id: Date.now().toString(),
      sender: 'user',
      text: inputValue,
      replyTo: replyingTo?.id,
      timestamp: Date.now(),
    };
    setMessages((prev) => [...prev, userMsg]);
    const replyId = replyingTo?.id;
    setInputValue('');
    setShowSlashMenu(false);
    setReplyingTo(null);

    try {
      if (replyId) {
        channel.sendTextWithParent(inputValue, replyId, agentId || undefined, runtimeConnId);
      } else {
        channel.sendText(inputValue, agentId || undefined, runtimeConnId);
      }
    } catch {
      setMessages((prev) => [
        ...prev,
        { id: `err-${Date.now()}`, sender: 'ai', text: '⚠️ Failed to send — WebSocket not connected.' },
      ]);
    }
  };

  const quickSend = (text: string) => {
    if (text.trim() === '/memory') {
      setShowMemory(true);
      setShowSlashMenu(false);
      setInputValue('');
      return;
    }
    const userMsg: Message = { id: Date.now().toString(), sender: 'user', text, timestamp: Date.now() };
    setMessages((prev) => [...prev, userMsg]);
    try {
      channel.sendText(text, agentId || undefined, runtimeConnId);
    } catch {
      setMessages((prev) => [
        ...prev,
        { id: `err-${Date.now()}`, sender: 'ai', text: '⚠️ Failed to send — WebSocket not connected.' },
      ]);
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
        const blob = new Blob(audioChunksRef.current, { type: 'audio/webm' });
        const reader = new FileReader();
        reader.onload = () => {
          const dataUrl = reader.result as string;
          const userMsg: Message = {
            id: Date.now().toString(),
            sender: 'user',
            text: '[Voice]',
            mediaType: 'voice',
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
      const emojiMsg: Message = { id: Date.now().toString(), sender: 'user', text: emoji, timestamp: Date.now() };
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
      <div className="px-4 py-3 sticky top-0 bg-white/70 dark:bg-card-alt/70 backdrop-blur-[20px] border-b border-border dark:border-border-dark z-20 flex items-center justify-between min-h-[57px]">
        {!isDesktop && (
          <motion.button whileTap={{ scale: 0.9 }} onClick={onBack} className="p-2 -ml-2 text-text dark:text-text-inv" aria-label="Go back">
            <ChevronLeft size={28} />
          </motion.button>
        )}
        <div className={`flex flex-col ${isDesktop ? 'items-start ml-2' : 'items-center'}`}>
          <h2 className="font-semibold text-[17px] text-text dark:text-text-inv">
            {`${getConnectionDisplayName(activeConn?.name, activeConn?.displayName)} / ${agentInfo ? `${agentInfo.identityEmoji || '🤖'} ${agentInfo.name}` : agentId || 'OpenClaw Bot'}`}
          </h2>
          <span className={`text-[11px] font-medium flex items-center gap-1 ${
            wsStatus === 'connected' ? 'text-primary' : wsStatus === 'connecting' || wsStatus === 'reconnecting' ? 'text-amber-500' : 'text-red-400'
          }`}>
            {wsStatus === 'connected' && <><div className="w-1.5 h-1.5 bg-primary rounded-full" /> Connected</>}
            {wsStatus === 'connecting' && <><Loader2 size={10} className="animate-spin" /> Connecting…</>}
            {wsStatus === 'reconnecting' && <><Loader2 size={10} className="animate-spin" /> Reconnecting…</>}
            {wsStatus === 'disconnected' && <><WifiOff size={10} /> Disconnected</>}
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
          <motion.button whileTap={{ scale: 0.9 }} onClick={openHistoryDrawer} className="p-2 text-text dark:text-text-inv" aria-label="Open history drawer">
            <MessageSquare size={20} />
          </motion.button>
          {isSplitPane && onCloseSplit && (
            <motion.button whileTap={{ scale: 0.9 }} onClick={onCloseSplit} className="p-2 text-text dark:text-text-inv" aria-label="Close split view">
              <X size={20} />
            </motion.button>
          )}
          <motion.button whileTap={{ scale: 0.9 }} onClick={() => setShowHeaderMenu(!showHeaderMenu)} className="p-2 -mr-2 text-text dark:text-text-inv" aria-label="More options">
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
              className="absolute top-[57px] right-4 z-40 bg-white dark:bg-card-alt border border-border dark:border-border-dark rounded-2xl shadow-xl p-1.5 min-w-[180px]"
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
                <motion.button whileTap={{ scale: 0.9 }} onClick={() => setShowHistoryDrawer(false)} className="p-2 text-text/55 dark:text-text-inv/55">
                  <X size={18} />
                </motion.button>
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
                      <p className="font-medium text-[14px] truncate">{conversation.chatId}</p>
                      {conversation.timestamp && (
                        <span className="text-[11px] text-text/40 dark:text-text-inv/40 shrink-0">
                          {formatRelativeTime(conversation.timestamp)}
                        </span>
                      )}
                    </div>
                    <p className="text-[12px] text-text/45 dark:text-text-inv/45 line-clamp-2">
                      {conversation.lastMessage || 'No messages yet'}
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

      {/* Messages */}
      <div className="flex-1 overflow-y-auto px-4 py-6 pb-4 flex flex-col gap-4">
        {/* Empty chat welcome */}
        {!hasLoadedMessages && (
          <div className="flex-1 flex flex-col items-center justify-center text-center px-6">
            <div className="flex items-center gap-1.5 text-primary">
              <span className="w-2 h-2 bg-primary rounded-full animate-pulse" />
              <span className="w-2 h-2 bg-primary rounded-full animate-pulse [animation-delay:200ms]" />
              <span className="w-2 h-2 bg-primary rounded-full animate-pulse [animation-delay:400ms]" />
            </div>
            <p className="mt-3 text-[13px] text-text/40 dark:text-text-inv/40">
              Loading cached messages…
            </p>
          </div>
        )}
        {hasLoadedMessages && messages.length === 0 && (
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.2, type: 'spring', stiffness: 300, damping: 25 }}
            className="flex-1 flex flex-col items-center justify-center text-center px-6"
          >
            <div className="w-16 h-16 bg-gradient-to-br from-primary to-primary-deep rounded-[20px] flex items-center justify-center mb-5 shadow-lg shadow-primary/20">
              <span className="text-2xl">{agentInfo?.identityEmoji || '🤖'}</span>
            </div>
            <h3 className="text-lg font-semibold mb-1">{agentInfo?.name || 'Agent'}</h3>
            <p className="text-text/45 dark:text-text-inv/45 text-[14px] leading-relaxed max-w-[260px]">
              {(() => {
                const h = new Date().getHours();
                if (h < 6) return 'Burning the midnight oil? Type away.';
                if (h < 12) return 'Good morning! What are we building today?';
                if (h < 18) return 'Ready when you are. Send a message or try a /slash command.';
                return 'Evening session? Let\'s get things done.';
              })()}
            </p>
          </motion.div>
        )}
        {messages.map((msg, i) => {
          const isUser = msg.sender === 'user';
          const isStreaming = msg.isStreaming;
          const hasCodeBlock = !isUser && msg.text?.includes('```');
          const isErrorMsg = !isUser && msg.text?.startsWith('⚠️');
          const prevMsg = i > 0 ? messages[i - 1] : null;
          const showDateSep = isDifferentDay(prevMsg?.timestamp, msg.timestamp);
          return (
            <div key={msg.id}>
              {/* Date separator */}
              {showDateSep && msg.timestamp && (
                <div className="flex items-center gap-3 my-3">
                  <div className="flex-1 h-px bg-border dark:bg-border-dark" />
                  <span className="text-[11px] text-text/55 dark:text-text-inv/55 font-medium">{formatDate(msg.timestamp)}</span>
                  <div className="flex-1 h-px bg-border dark:bg-border-dark" />
                </div>
              )}
              <motion.div
                initial={isUser ? { opacity: 0, scale: 0.9, y: 10 } : { opacity: 0, y: 10 }}
                animate={{ opacity: 1, scale: 1, y: 0 }}
                transition={isUser
                  ? { type: 'spring', stiffness: 500, damping: 25 }
                  : { delay: Math.min(i, 10) * 0.03 }
                }
                className={`flex ${isUser ? 'justify-end' : 'justify-start'} relative`}
                onTouchStart={() => handleTouchStart(msg.id)}
                onTouchEnd={handleTouchEnd}
                onTouchMove={handleTouchEnd}
              >
              {!isUser && (
                <div className="w-8 h-8 rounded-full bg-gradient-to-br from-primary to-primary-deep flex-shrink-0 mr-3 flex items-center justify-center text-white shadow-sm text-lg">
                  {agentInfo?.identityEmoji || '🤖'}
                </div>
              )}
              
              <div className={`flex flex-col ${isUser ? 'items-end' : 'items-start'} max-w-[75%]`}>
                <div
                    className={`px-5 py-3.5 rounded-[24px] text-[15px] leading-relaxed relative ${
                      isUser
                        ? 'bg-primary text-white rounded-tr-[8px] shadow-md shadow-primary/20'
                        : isErrorMsg
                          ? 'bg-red-50 dark:bg-red-900/20 text-red-700 dark:text-red-300 border border-red-200 dark:border-red-800/40 rounded-tl-[8px]'
                          : `bg-white dark:bg-card-alt text-text dark:text-text-inv border border-border dark:border-border-dark rounded-tl-[8px] shadow-sm${hasCodeBlock ? ' border-l-[3px] border-l-primary/60' : ''}`
                    }`}
                  >
                    {/* Model badge - small top-right indicator for AI messages */}
                    {!isUser && agentInfo?.model && (
                      <span className="absolute -top-1 -right-1 px-2 py-0.5 bg-[#5B8DEF] text-white text-[10px] font-medium rounded-full shadow-sm">
                        {agentInfo.model.split('/').pop()}
                      </span>
                    )}
                    {/* Quote reference */}
                    {msg.replyTo && (() => {
                      const quoted = messages.find((m) => m.id === msg.replyTo);
                      return quoted ? (
                        <div className={`text-[12px] mb-2 px-3 py-1.5 rounded-lg border-l-2 ${
                          isUser ? 'bg-white/15 border-white/40 text-white/80' : 'bg-surface dark:bg-[#131420] border-primary text-text/60 dark:text-text-inv/60'
                        }`}>
                          <span className="font-medium">{quoted.sender === 'user' ? 'You' : 'Bot'}: </span>
                          {quoted.text.slice(0, 80)}{quoted.text.length > 80 ? '…' : ''}
                        </div>
                      ) : null;
                    })()}
                    {/* Message content (Image, Voice, File, Text/Markdown) */}
                    {(msg.mediaType === 'image' && msg.mediaUrl) ? (
                      <div className="bg-transparent border-none p-0">
                        <img src={msg.mediaUrl} alt="Message attachment" loading="lazy" className="max-w-full rounded-lg shadow-sm max-h-[300px] object-cover" />
                        {msg.text && <p className="mt-2 text-[14px]">{msg.text}</p>}
                      </div>
                    ) : (msg.mediaType === 'voice' || msg.mediaType === 'audio') && msg.mediaUrl ? (
                      <div className="flex flex-col gap-1 min-w-[220px]">
                        <div className="flex items-center gap-2 bg-surface/50 dark:bg-[#131420]/50 p-2 rounded-lg">
                          <audio src={msg.mediaUrl} controls className="h-8 w-full max-w-[240px]" />
                        </div>
                        {msg.text && <p className="text-[13px] opacity-80 px-1">{msg.text}</p>}
                      </div>
                    ) : msg.mediaType === 'file' && msg.mediaUrl ? (
                      <div className="flex items-center gap-3 bg-surface dark:bg-[#131420] p-3 rounded-xl border border-border dark:border-border-dark min-w-[200px]">
                        <div className="w-10 h-10 rounded-lg bg-info/10 flex items-center justify-center text-info shrink-0">
                          <FileText size={20} />
                        </div>
                        <div className="flex-1 min-w-0">
                          <p className="text-[14px] font-medium truncate">{msg.text || 'File'}</p>
                          <a href={msg.mediaUrl} target="_blank" rel="noopener noreferrer" className="text-[12px] text-info hover:underline">Download</a>
                        </div>
                      </div>
                    ) : isUser ? (
                      <p className="whitespace-pre-wrap break-words">{msg.text}</p>
                    ) : (
                      <div className="relative">
                        <MarkdownRenderer content={msg.text} />
                        {/* Streaming cursor indicator */}
                        {isStreaming && (
                          <span className="inline-block w-2 h-4 bg-primary ml-0.5 animate-pulse align-middle" />
                        )}
                      </div>
                    )}
                  </div>
                  
                  {/* Inline message actions — always visible next to timestamp on desktop */}
                  {!isStreaming && (
                  <div className={`hidden md:flex items-center gap-0.5 mt-1 ${isUser ? 'flex-row-reverse' : 'flex-row'}`}>
                    {/* Timestamp */}
                    {msg.timestamp && (
                      <span className="text-[10px] text-text/40 dark:text-text-inv/35 mr-1.5 tabular-nums">
                        {formatTime(msg.timestamp)}
                      </span>
                    )}

                    {/* Emoji trigger — hover to expand picker row */}
                    <div className="relative group/emoji">
                      <button
                        type="button"
                        className="w-5 h-5 flex items-center justify-center text-text/25 dark:text-text-inv/20 hover:text-text/50 dark:hover:text-text-inv/45 rounded transition-colors"
                      >
                        <SmilePlus size={12} />
                      </button>
                      {/* Hover flyout: quick emoji row — after:pseudo bridges the gap so hover stays active */}
                      <div className={`absolute bottom-full ${isUser ? 'right-0' : 'left-0'} mb-1.5 hidden group-hover/emoji:flex items-center gap-0.5 bg-white dark:bg-card-alt rounded-full px-1.5 py-1 border border-border dark:border-border-dark shadow-lg z-20 after:content-[''] after:absolute after:inset-x-0 after:-bottom-3 after:h-3`}>
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

                    {/* Reply */}
                    <button
                      type="button"
                      onClick={() => startReply(msg)}
                      className="w-5 h-5 flex items-center justify-center text-text/25 dark:text-text-inv/20 hover:text-info rounded transition-colors"
                    >
                      <CornerDownLeft size={12} />
                    </button>

                    {/* Edit & Delete (user messages only) */}
                    {isUser && (
                      <>
                        <button
                          type="button"
                          onClick={() => handleEditMessage(msg)}
                          className="w-5 h-5 flex items-center justify-center text-text/25 dark:text-text-inv/20 hover:text-amber-500 rounded transition-colors"
                        >
                          <Pencil size={12} />
                        </button>
                        <button
                          type="button"
                          onClick={() => handleDeleteMessage(msg.id)}
                          className="w-5 h-5 flex items-center justify-center text-text/25 dark:text-text-inv/20 hover:text-red-500 rounded transition-colors"
                        >
                          <Trash2 size={12} />
                        </button>
                      </>
                    )}
                  </div>
                  )}

                {/* Action Card for AI messages (hide for streaming) */}
                {!isUser && !isStreaming && <ActionCard text={msg.text} onSend={quickSend} />}

                {/* Reactions Display */}
                {msg.reactions && msg.reactions.length > 0 && (
                  <div className={`flex flex-wrap gap-1.5 mt-1.5 ${isUser ? 'justify-end' : 'justify-start'}`}>
                    {msg.reactions.map((emoji, idx) => (
                      <motion.button
                        key={idx}
                        initial={{ scale: 0, rotate: -15 }}
                        animate={{ scale: 1, rotate: 0 }}
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
                        className="bg-primary/10 dark:bg-primary/15 border border-primary/30 rounded-full px-2.5 py-1 text-[14px] shadow-sm flex items-center gap-1 hover:bg-primary/20 transition-colors"
                      >
                        <span>{emoji}</span>
                      </motion.button>
                    ))}
                  </div>
                )}

                {/* Message time — mobile only (desktop shows inline with actions) */}
                {msg.timestamp && (
                  <span className={`md:hidden text-[10px] text-text/55 dark:text-text-inv/55 mt-1 ${isUser ? 'text-right' : 'text-left'}`}>
                    {formatTime(msg.timestamp)}
                  </span>
                )}
              </div>
            </motion.div>
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
              className="flex justify-start"
            >
              <div className="w-8 h-8 rounded-full bg-gradient-to-br from-primary to-primary-deep flex-shrink-0 mr-3 flex items-center justify-center text-white shadow-sm text-lg">
                {agentInfo?.identityEmoji || '🤖'}
              </div>
              <div className="bg-white dark:bg-card-alt border border-border dark:border-border-dark rounded-[24px] rounded-tl-[8px] shadow-sm px-5 py-3.5">
                <div className="flex items-center gap-1.5">
                  <span className="w-2 h-2 bg-primary rounded-full animate-pulse" />
                  <span className="w-2 h-2 bg-primary rounded-full animate-pulse [animation-delay:200ms]" />
                  <span className="w-2 h-2 bg-primary rounded-full animate-pulse [animation-delay:400ms]" />
                </div>
              </div>
            </motion.div>
          )}
        </AnimatePresence>
        <div ref={messagesEndRef} />

        {/* Mobile long-press action sheet */}
        <AnimatePresence>
          {longPressedMsgId && (() => {
            const lMsg = messages.find(m => m.id === longPressedMsgId);
            if (!lMsg) return null;
            const lIsUser = lMsg.sender === 'user';
            return (
              <>
                <motion.div
                  initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
                  className="fixed inset-0 bg-black/30 z-50 md:hidden"
                  onClick={closeLongPress}
                />
                <motion.div
                  initial={{ opacity: 0, y: 30, scale: 0.95 }}
                  animate={{ opacity: 1, y: 0, scale: 1 }}
                  exit={{ opacity: 0, y: 30, scale: 0.95 }}
                  transition={{ type: 'spring', stiffness: 400, damping: 28 }}
                  className="fixed bottom-0 left-0 right-0 z-50 md:hidden bg-white dark:bg-card-alt rounded-t-3xl shadow-2xl p-4 pb-[max(1.5rem,env(safe-area-inset-bottom))]"
                >
                  {/* Quick reactions row */}
                  <div className="flex items-center justify-center gap-2 mb-4">
                    {['👍', '❤️', '😂', '🎉', '🔥', '👀'].map((e) => (
                      <motion.button
                        key={e}
                        whileTap={{ scale: 0.8 }}
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
                        className={`w-11 h-11 text-[22px] flex items-center justify-center rounded-full transition-colors ${
                          lMsg.reactions?.includes(e) ? 'bg-primary/20 ring-2 ring-primary/40' : 'bg-surface dark:bg-surface-dark'
                        }`}
                      >
                        {e}
                      </motion.button>
                    ))}
                    <motion.button
                      whileTap={{ scale: 0.9 }}
                      onClick={() => { openReactionPicker(longPressedMsgId); closeLongPress(); }}
                      className="w-11 h-11 flex items-center justify-center rounded-full bg-surface dark:bg-surface-dark text-text/55 dark:text-text-inv/55"
                    >
                      <SmilePlus size={18} />
                    </motion.button>
                  </div>

                  {/* Action buttons */}
                  <div className="flex flex-col gap-0.5">
                    <button
                      onClick={() => { startReply(lMsg); closeLongPress(); }}
                      className="flex items-center gap-3 px-4 py-3 rounded-xl text-[15px] text-text dark:text-text-inv hover:bg-surface dark:hover:bg-surface-dark transition-colors"
                    >
                      <CornerDownLeft size={18} className="text-info" /> Reply
                    </button>
                    {lIsUser && (
                      <>
                        <button
                          onClick={() => { handleEditMessage(lMsg); closeLongPress(); }}
                          className="flex items-center gap-3 px-4 py-3 rounded-xl text-[15px] text-text dark:text-text-inv hover:bg-surface dark:hover:bg-surface-dark transition-colors"
                        >
                          <Pencil size={18} className="text-amber-500" /> Edit
                        </button>
                        <button
                          onClick={() => { handleDeleteMessage(lMsg.id); closeLongPress(); }}
                          className="flex items-center gap-3 px-4 py-3 rounded-xl text-[15px] text-red-500 hover:bg-red-50 dark:hover:bg-red-900/20 transition-colors"
                        >
                          <Trash2 size={18} /> Delete
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
      <div className="p-4 pb-[max(1rem,env(safe-area-inset-bottom))] bg-gradient-to-t from-surface via-surface dark:from-surface-dark dark:via-surface-dark to-transparent z-30 flex-shrink-0">
        <AnimatePresence>
          {showSlashMenu && (
            <>
              <motion.div
                initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
                className="fixed inset-0 bg-surface/40 dark:bg-surface-dark/40 backdrop-blur-md -z-10"
                onClick={() => setShowSlashMenu(false)}
              />
              <motion.div
                initial={{ opacity: 0, y: 20, scale: 0.95 }}
                animate={{ opacity: 1, y: 0, scale: 1 }}
                exit={{ opacity: 0, y: 10, scale: 0.95 }}
                className="absolute bottom-full left-4 right-4 mb-2 bg-white/95 dark:bg-card-alt/95 backdrop-blur-[20px] border border-border/50 dark:border-border-dark/50 shadow-2xl rounded-[24px] p-2 overflow-hidden"
              >
                {slashCommands
                  .filter((cmd) => cmd.label.startsWith(inputValue) || inputValue === '/')
                  .map((cmd) => (
                  <motion.button
                    key={cmd.id}
                    whileTap={{ scale: 0.98, backgroundColor: 'rgba(0,0,0,0.03)' }}
                    onClick={() => handleCommandSelect(cmd.label)}
                    className="w-full flex items-center gap-3 p-3 rounded-[16px] text-left transition-colors"
                  >
                    <div className="w-10 h-10 rounded-full bg-border dark:bg-border-dark flex items-center justify-center text-primary">
                      <cmd.icon size={18} />
                    </div>
                    <div>
                      <div className="font-semibold text-[15px] text-text dark:text-text-inv">{cmd.label}</div>
                      <div className="text-[13px] text-text/55 dark:text-text-inv/55">{cmd.desc}</div>
                    </div>
                  </motion.button>
                ))}
              </motion.div>
            </>
          )}

          {showEmojiPicker && (
            <>
              <motion.div
                initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
                className="fixed inset-0 bg-surface/40 dark:bg-surface-dark/40 backdrop-blur-md -z-10"
                onClick={() => { setShowEmojiPicker(false); setReactingToMsgId(null); }}
              />
              <motion.div
                initial={{ opacity: 0, y: 20, scale: 0.95 }}
                animate={{ opacity: 1, y: 0, scale: 1 }}
                exit={{ opacity: 0, y: 10, scale: 0.95 }}
                className="absolute bottom-full left-4 right-4 mb-2 bg-white/95 dark:bg-card-alt/95 backdrop-blur-[20px] border border-border/50 dark:border-border-dark/50 shadow-2xl rounded-[24px] p-4 flex flex-wrap gap-2 justify-center"
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
          {!inputValue && messages.length > 0 && messages[messages.length - 1]?.sender === 'ai' && !showSlashMenu && !showEmojiPicker && (
            <motion.div
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: 10 }}
              className="flex gap-1.5 overflow-x-auto pb-2 px-1 scrollbar-hide"
            >
              {CONTEXT_SUGGESTIONS.map((sug) => (
                <motion.button
                  key={sug.label}
                  whileTap={{ scale: 0.95 }}
                  onClick={() => setInputValue(sug.label)}
                  className="flex-shrink-0 inline-flex items-center gap-1.5 px-3 py-1.5 bg-border dark:bg-border-dark/50 border border-border dark:border-border-dark rounded-full text-[12px] font-medium text-text/60 dark:text-text-inv/60 hover:bg-border/70 dark:hover:bg-border-dark transition-colors"
                >
                  <span>{sug.emoji}</span>
                  {sug.label}
                </motion.button>
              ))}
            </motion.div>
          )}

          {/* Default quick commands when input empty and no context */}
          {!inputValue && (messages.length === 0 || messages[messages.length - 1]?.sender === 'user') && !showSlashMenu && !showEmojiPicker && (
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              className="flex gap-1.5 overflow-x-auto pb-2 px-1 scrollbar-hide"
            >
              {QUICK_COMMANDS.map((cmd) => (
                <motion.button
                  key={cmd.label}
                  whileTap={{ scale: 0.95 }}
                  onClick={() => quickSend(cmd.label)}
                  className="flex-shrink-0 inline-flex items-center gap-1 px-3 py-1.5 bg-white dark:bg-card-alt border border-border dark:border-border-dark rounded-full text-[12px] font-medium text-text/60 dark:text-text-inv/60 hover:border-primary hover:text-primary transition-colors"
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

        <div className="mb-2 rounded-[20px] border border-border/80 bg-white/70 backdrop-blur-[18px] dark:border-border-dark/80 dark:bg-card-alt/70">
          <div className="flex min-h-9 items-center justify-between gap-1 px-2 py-1">
            <button
              type="button"
              onClick={() => setShowSkills((current) => !current)}
              className={cn(
                'inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[12px] font-medium transition-colors',
                showSkills
                  ? 'bg-primary/10 text-primary'
                  : 'text-text/60 hover:bg-surface hover:text-text dark:text-text-inv/60 dark:hover:bg-surface-dark dark:hover:text-text-inv'
              )}
            >
              <Puzzle size={14} />
              <span>技能{skillCount > 0 ? `(${skillCount})` : ''}</span>
            </button>

            <div className="flex items-center gap-1">
              <button
                type="button"
                onClick={() => setShowContextViewer(true)}
                disabled={!agentId || !runtimeConnId}
                className={cn(
                  'inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[12px] font-medium transition-colors',
                  !agentId || !runtimeConnId
                    ? 'cursor-not-allowed text-text/35 dark:text-text-inv/35'
                    : 'text-text/60 hover:bg-surface hover:text-text dark:text-text-inv/60 dark:hover:bg-surface-dark dark:hover:text-text-inv'
                )}
              >
                <FileText size={14} />
                <span>上下文</span>
              </button>
              <button
                type="button"
                onClick={refreshAgentMeta}
                disabled={!runtimeConnId}
                className={cn(
                  'flex h-7 w-7 items-center justify-center rounded-full transition-colors',
                  !runtimeConnId
                    ? 'cursor-not-allowed text-text/35 dark:text-text-inv/35'
                    : 'text-text/55 hover:bg-surface hover:text-text dark:text-text-inv/55 dark:hover:bg-surface-dark dark:hover:text-text-inv'
                )}
                aria-label="Refresh agent metadata"
              >
                <RefreshCw size={14} className={cn(isContextLoading && 'animate-spin')} />
              </button>
            </div>
          </div>

          <AnimatePresence initial={false}>
            {showSkills && (
              <motion.div
                initial={{ opacity: 0, y: 8 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: 6 }}
                className="border-t border-border/80 px-2 pb-2 pt-1 dark:border-border-dark/80"
              >
                {skillCount > 0 ? (
                <div className="grid max-h-[200px] gap-2 overflow-y-auto py-1 sm:grid-cols-2">
                  {skills.map((skillName) => (
                    <div
                      key={skillName}
                      className="rounded-[18px] border border-primary/10 bg-primary/5 px-3 py-2.5 dark:border-primary/15 dark:bg-primary/10"
                    >
                      <div className="flex items-center gap-2 text-[13px] font-semibold text-text dark:text-text-inv">
                        <Puzzle size={14} className="text-primary" />
                        <span className="truncate">{skillName}</span>
                      </div>
                      <p className="mt-1 text-[12px] leading-relaxed text-text/50 dark:text-text-inv/50">
                        {getSkillDescription(skillName)}
                      </p>
                    </div>
                  ))}
                </div>
                ) : (
                <div className="py-3 text-center text-[12px] text-text/40 dark:text-text-inv/40">
                  <Puzzle size={16} className="mx-auto mb-1 opacity-40" />
                  暂无技能
                </div>
                )}
              </motion.div>
            )}
          </AnimatePresence>
        </div>

        <div className="bg-white dark:bg-card-alt border border-border dark:border-border-dark rounded-full p-2 flex items-center gap-1 shadow-lg shadow-black/5 relative">
          {/* Action menu toggle (+ button) */}
          <motion.button
            whileTap={{ scale: 0.9 }}
            onClick={() => setShowMoreIcons(!showMoreIcons)}
            className={`p-2 rounded-full transition-colors ${showMoreIcons ? 'bg-primary/10 text-primary' : 'text-text/55 dark:text-text-inv/55 hover:text-text dark:hover:text-text-inv'}`}
            aria-label="Attach"
          >
            <Plus size={22} />
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
                      className="w-full bg-transparent text-[12px] outline-none text-text/70 dark:text-text-inv/70 placeholder:text-text/30 dark:placeholder:text-text-inv/30"
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
            onKeyDown={(e) => e.key === 'Enter' && handleSend()}
            placeholder="Message..."
            className="flex-1 bg-transparent border-none focus:outline-none text-[15px] py-2 px-2 text-text dark:text-text-inv placeholder:text-text/45 dark:placeholder:text-text-inv/45"
          />

          {/* Voice button when no text, Send button when has text */}
          {inputValue.trim() ? (
            <motion.button
              initial={{ scale: 0.8, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              whileHover={{ scale: 1.08, y: -2 }}
              whileTap={{ scale: 0.9 }}
              onClick={handleSend}
              aria-label="Send message"
              className="p-3 rounded-full flex items-center justify-center bg-primary text-white shadow-md shadow-primary/30"
            >
              <Send size={20} />
            </motion.button>
          ) : (
            <div className="flex items-center gap-2">
              {isRecording && (
                <motion.div
                  initial={{ opacity: 0, x: 10 }}
                  animate={{ opacity: 1, x: 0 }}
                  className="flex items-center gap-2 bg-red-50 dark:bg-red-900/20 px-3 py-1.5 rounded-full"
                >
                  <span className="w-2 h-2 bg-red-500 rounded-full animate-pulse" />
                  <span className="text-[13px] text-red-500 font-medium">Recording…</span>
                </motion.div>
              )}
              <motion.button
                whileTap={{ scale: 0.9 }}
                onClick={toggleRecording}
                aria-label={isRecording ? 'Stop recording' : 'Start voice recording'}
                className={`p-3 rounded-full flex items-center justify-center transition-colors ${
                  isRecording ? 'bg-red-500 text-white shadow-md shadow-red-500/30 animate-pulse' : 'bg-border dark:bg-border-dark text-text/55 dark:text-text-inv/55'
                }`}
              >
                {isRecording ? <MicOff size={20} /> : <Mic size={20} />}
              </motion.button>
            </div>
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
