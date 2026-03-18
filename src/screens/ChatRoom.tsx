import { useState, useRef, useEffect, useCallback, type ChangeEvent } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { ChevronLeft, MoreHorizontal, Smile, Mic, MicOff, Send, Code, FileText, Zap, SmilePlus, Wifi, WifiOff, Loader2, HelpCircle, Database, Activity, User, Plus, RotateCcw, Cpu, Server, MessageSquare, LayoutDashboard, Square, Image, CornerDownLeft, X, Pencil, Trash2, Paperclip } from 'lucide-react';
import Markdown from 'react-markdown';
import hljs from 'highlight.js/lib/core';
import javascript from 'highlight.js/lib/languages/javascript';
import typescript from 'highlight.js/lib/languages/typescript';
import python from 'highlight.js/lib/languages/python';
import bash from 'highlight.js/lib/languages/bash';
import json from 'highlight.js/lib/languages/json';
import css from 'highlight.js/lib/languages/css';
import xml from 'highlight.js/lib/languages/xml';
import yaml from 'highlight.js/lib/languages/yaml';
import sql from 'highlight.js/lib/languages/sql';
import markdown from 'highlight.js/lib/languages/markdown';

hljs.registerLanguage('javascript', javascript);
hljs.registerLanguage('js', javascript);
hljs.registerLanguage('typescript', typescript);
hljs.registerLanguage('ts', typescript);
hljs.registerLanguage('python', python);
hljs.registerLanguage('bash', bash);
hljs.registerLanguage('sh', bash);
hljs.registerLanguage('json', json);
hljs.registerLanguage('css', css);
hljs.registerLanguage('html', xml);
hljs.registerLanguage('xml', xml);
hljs.registerLanguage('yaml', yaml);
hljs.registerLanguage('yml', yaml);
hljs.registerLanguage('sql', sql);
hljs.registerLanguage('markdown', markdown);
hljs.registerLanguage('md', markdown);
import * as channel from '../services/clawChannel';
import { getUserId } from '../App';
import { getActiveConnection } from '../services/connectionStore';
import ActionCard from '../components/ActionCard';

type Message = {
  id: string;
  sender: 'user' | 'ai';
  text: string;
  reactions?: string[];
  mediaType?: string;
  mediaUrl?: string;
  replyTo?: string;
  timestamp?: number;
};

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
  { id: 'stop', icon: Square, label: '/stop', desc: 'Stop the running task in this session' },
];

const EMOJI_LIST = ['👍', '❤️', '😂', '🔥', '✨', '👀', '💯', '🚀'];

const QUICK_COMMANDS = [
  { label: '/status', emoji: '📊' },
  { label: '/models', emoji: '🤖' },
  { label: '/help', emoji: '❓' },
  { label: '/new', emoji: '✨' },
  { label: '/reset', emoji: '🔄' },
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

function isDifferentDay(ts1?: number, ts2?: number) {
  if (!ts1 || !ts2) return true;
  return new Date(ts1).toDateString() !== new Date(ts2).toDateString();
}

// --- Message persistence ---
function getStorageKey(agentId: string | null | undefined, connId: string) {
  return `openclaw.messages.${connId}.${agentId || 'default'}`;
}
function loadMessages(agentId: string | null | undefined, connId: string): Message[] {
  try {
    const raw = localStorage.getItem(getStorageKey(agentId, connId));
    return raw ? JSON.parse(raw) : [];
  } catch { return []; }
}
function saveMessages(agentId: string | null | undefined, connId: string, msgs: Message[]) {
  try {
    // Keep last 200 messages to avoid localStorage quota
    localStorage.setItem(getStorageKey(agentId, connId), JSON.stringify(msgs.slice(-200)));
  } catch { /* ignore */ }
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
function getAgentInfo(agentId: string | null | undefined) {
  try {
    const raw = localStorage.getItem('openclaw.agentList');
    if (!raw) return null;
    const list = JSON.parse(raw) as Array<{ id: string; name: string; identityEmoji?: string; model?: string }>;
    return list.find((a) => a.id === agentId) || null;
  } catch { return null; }
}

export default function ChatRoom({ agentId, onBack, isDesktop }: { agentId?: string | null; onBack: () => void; isDesktop?: boolean }) {
  const activeConn = getActiveConnection();
  const connId = activeConn?.id || '';
  const agentInfo = getAgentInfo(agentId);
  const [messages, setMessages] = useState<Message[]>(() => loadMessages(agentId, connId));
  const [inputValue, setInputValue] = useState('');
  const [showSlashMenu, setShowSlashMenu] = useState(false);
  const [showEmojiPicker, setShowEmojiPicker] = useState(false);
  const [reactingToMsgId, setReactingToMsgId] = useState<string | null>(null);
  const [wsStatus, setWsStatus] = useState<string>(channel.getStatus());
  const [isThinking, setIsThinking] = useState(false);
  const [isRecording, setIsRecording] = useState(false);
  const [replyingTo, setReplyingTo] = useState<Message | null>(null);
  const [peerTyping, setPeerTyping] = useState(false);
  const [editingMsg, setEditingMsg] = useState<Message | null>(null);
  const [showHeaderMenu, setShowHeaderMenu] = useState(false);
  const [showMoreIcons, setShowMoreIcons] = useState(false);
  const fileInputRef2 = useRef<HTMLInputElement>(null);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const audioChunksRef = useRef<Blob[]>([]);

  // Persist messages on change
  useEffect(() => {
    if (connId && messages.length > 0) saveMessages(agentId, connId, messages);
  }, [messages, agentId, connId]);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages, isThinking]);

  // WebSocket 连接 & 消息监听
  useEffect(() => {
    if (!activeConn) return;
    // chatId for the WebSocket must match token binding, but we still
    // differentiate local cache and agentId in the URL query param
    const conversationId = activeConn.chatId || (agentId ? `openclaw-web-agent-${agentId}-${activeConn.id}` : `openclaw-web-default-${activeConn.id}`);

    // Clear messages from previous agent before connecting to new one
    setMessages(loadMessages(agentId, connId));
    setIsThinking(false);

    channel.connect({
      chatId: activeConn.chatId,
      senderId: activeConn.senderId || getUserId(),
      senderName: activeConn.displayName,
      serverUrl: activeConn.serverUrl,
      agentId: agentId || undefined,
      token: activeConn.token,
    });

    const unsubMsg = channel.onMessage((packet) => {
      if (packet.type === 'message.send' && packet.data?.content) {
        setIsThinking(false);
        const content = packet.data.content as string;
        setMessages((prev) => [
          ...prev,
          {
            id: packet.data.messageId || Date.now().toString(),
            sender: 'ai',
            text: content,
            replyTo: (packet.data.replyTo as string) || undefined,
            timestamp: (packet.data.timestamp as number) || Date.now(),
          },
        ]);

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
      } else if (packet.type === 'typing') {
        const d = packet.data as { senderId?: string; isTyping?: boolean };
        if (d.senderId !== getUserId()) {
          setPeerTyping(!!d.isTyping);
          if (d.isTyping) setTimeout(() => setPeerTyping(false), 5000);
        }
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
        if (history.length > 0) setMessages(history);
      }
    });

    const unsubStatus = channel.onStatus((status) => {
      setWsStatus(status);
    });

    return () => {
      unsubMsg();
      unsubStatus();
      // Don't close channel here — next connect() will replace it,
      // and StrictMode double-invoke would kill the connection prematurely
    };
  }, [agentId, activeConn?.id]);

  const typingTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const handleInputChange = (e: ChangeEvent<HTMLInputElement>) => {
    const val = e.target.value;
    setInputValue(val);
    setShowSlashMenu(val.startsWith('/') && !val.includes(' '));

    // Send typing indicator (debounced)
    if (val.trim()) {
      try { channel.sendTyping(true); } catch {}
      if (typingTimer.current) clearTimeout(typingTimer.current);
      typingTimer.current = setTimeout(() => { try { channel.sendTyping(false); } catch {} }, 3000);
    }
  };

  // Edit message
  const handleEditMessage = (msg: Message) => {
    setEditingMsg(msg);
    setInputValue(msg.text);
  };

  const handleSaveEdit = () => {
    if (!editingMsg || !inputValue.trim()) return;
    channel.editMessage(editingMsg.id, inputValue.trim());
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
    channel.deleteMessage(msgId);
    setMessages((prev) => prev.filter((m) => m.id !== msgId));
  };

  // File picker
  const handleFilePick = () => fileInputRef2.current?.click();
  const handleFileSelected2 = async (e: ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    e.target.value = '';
    const dataUrl = await fileToDataUrl(file);
    const userMsg: Message = { id: Date.now().toString(), sender: 'user', text: `📎 ${file.name}`, timestamp: Date.now() };
    setMessages((prev) => [...prev, userMsg]);
    try {
      channel.sendFile({ content: file.name, mediaUrl: dataUrl, mimeType: file.type, fileName: file.name, agentId: agentId || undefined });
    } catch { /* ignore */ }
  };

  const handleSend = () => {
    if (editingMsg) { handleSaveEdit(); return; }
    if (!inputValue.trim()) return;
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
        channel.sendTextWithParent(inputValue, replyId, agentId || undefined);
      } else {
        channel.sendText(inputValue, agentId || undefined);
      }
    } catch {
      setMessages((prev) => [
        ...prev,
        { id: `err-${Date.now()}`, sender: 'ai', text: '⚠️ Failed to send — WebSocket not connected.' },
      ]);
    }
  };

  const quickSend = (text: string) => {
    const userMsg: Message = { id: Date.now().toString(), sender: 'user', text, timestamp: Date.now() };
    setMessages((prev) => [...prev, userMsg]);
    try {
      channel.sendText(text, agentId || undefined);
    } catch {
      setMessages((prev) => [
        ...prev,
        { id: `err-${Date.now()}`, sender: 'ai', text: '⚠️ Failed to send — WebSocket not connected.' },
      ]);
    }
  };

  // --- Image sending ---
  const handleImagePick = () => fileInputRef.current?.click();

  const handleFileSelected = async (e: ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file || !file.type.startsWith('image/')) return;
    e.target.value = ''; // reset

    const dataUrl = await fileToDataUrl(file);
    const userMsg: Message = {
      id: Date.now().toString(),
      sender: 'user',
      text: '[Image]',
      mediaType: 'image',
      mediaUrl: dataUrl,
    };
    setMessages((prev) => [...prev, userMsg]);

    try {
      channel.sendMedia({
        messageType: 'image',
        content: '',
        mediaUrl: dataUrl,
        mimeType: file.type,
        agentId: agentId || undefined,
      });
    } catch {
      setMessages((prev) => [
        ...prev,
        { id: `err-${Date.now()}`, sender: 'ai', text: '⚠️ Failed to send image.' },
      ]);
    }
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
            });
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
  }, [isRecording, agentId]);

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
          channel.removeReaction(reactingToMsgId, emoji);
        } else {
          channel.addReaction(reactingToMsgId, emoji);
        }
      } catch { /* ignore */ }
    } else {
      // send emoji as a message directly
      const emojiMsg: Message = { id: Date.now().toString(), sender: 'user', text: emoji, timestamp: Date.now() };
      setMessages((prev) => [...prev, emojiMsg]);
      try {
        channel.sendText(emoji);
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

  return (
    <div className="flex flex-col h-full bg-gray-50 dark:bg-gray-900 relative">
      {/* Header */}
      <div className="px-4 py-3 sticky top-0 bg-white/70 dark:bg-gray-800/70 backdrop-blur-[20px] border-b border-gray-200 dark:border-gray-700 z-20 flex items-center justify-between min-h-[57px]">
        {!isDesktop && (
          <motion.button whileTap={{ scale: 0.9 }} onClick={onBack} className="p-2 -ml-2 text-gray-800 dark:text-gray-200">
            <ChevronLeft size={28} />
          </motion.button>
        )}
        <div className={`flex flex-col ${isDesktop ? 'items-start ml-2' : 'items-center'}`}>
          <h2 className="font-semibold text-[17px] text-gray-800 dark:text-gray-100">{agentInfo ? `${agentInfo.identityEmoji || '🤖'} ${agentInfo.name}` : agentId || 'OpenClaw Bot'}</h2>
          <span className={`text-[11px] font-medium flex items-center gap-1 ${
            wsStatus === 'connected' ? 'text-[#67B88B]' : wsStatus === 'connecting' || wsStatus === 'reconnecting' ? 'text-amber-500' : 'text-red-400'
          }`}>
            {wsStatus === 'connected' && <><div className="w-1.5 h-1.5 bg-[#67B88B] rounded-full" /> Connected</>}
            {wsStatus === 'connecting' && <><Loader2 size={10} className="animate-spin" /> Connecting…</>}
            {wsStatus === 'reconnecting' && <><Loader2 size={10} className="animate-spin" /> Reconnecting…</>}
            {wsStatus === 'disconnected' && <><WifiOff size={10} /> Disconnected</>}
          </span>
        </div>
        <motion.button whileTap={{ scale: 0.9 }} onClick={() => setShowHeaderMenu(!showHeaderMenu)} className="p-2 -mr-2 text-gray-800 dark:text-gray-200">
          <MoreHorizontal size={24} />
        </motion.button>
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
              className="absolute top-[57px] right-4 z-40 bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-2xl shadow-xl p-1.5 min-w-[180px]"
            >
              <button
                onClick={() => { setMessages([]); if (connId && agentId) saveMessages(agentId, connId, []); setShowHeaderMenu(false); }}
                className="w-full flex items-center gap-3 px-3 py-2.5 rounded-xl text-left text-[14px] text-red-500 hover:bg-red-50 dark:hover:bg-red-900/20 transition-colors"
              >
                <Trash2 size={16} />
                Clear Chat
              </button>
            </motion.div>
          </>
        )}
      </AnimatePresence>

      {/* Messages */}
      <div className="flex-1 overflow-y-auto px-4 py-6 pb-4 flex flex-col gap-4">
        {messages.map((msg, i) => {
          const isUser = msg.sender === 'user';
          const prevMsg = i > 0 ? messages[i - 1] : null;
          const showDateSep = isDifferentDay(prevMsg?.timestamp, msg.timestamp);
          return (
            <div key={msg.id}>
              {/* Date separator */}
              {showDateSep && msg.timestamp && (
                <div className="flex items-center gap-3 my-3">
                  <div className="flex-1 h-px bg-gray-200 dark:bg-gray-700" />
                  <span className="text-[11px] text-gray-400 dark:text-gray-500 font-medium">{formatDate(msg.timestamp)}</span>
                  <div className="flex-1 h-px bg-gray-200 dark:bg-gray-700" />
                </div>
              )}
              <motion.div
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: Math.min(i, 10) * 0.03 }}
                className={`flex ${isUser ? 'justify-end' : 'justify-start'} group`}
              >
              {!isUser && (
                <div className="w-8 h-8 rounded-full bg-gradient-to-br from-[#67B88B] to-[#4a9a70] flex-shrink-0 mr-3 flex items-center justify-center text-white shadow-sm text-lg">
                  {agentInfo?.identityEmoji || '🤖'}
                </div>
              )}
              
              <div className={`flex flex-col ${isUser ? 'items-end' : 'items-start'} max-w-[75%]`}>
                <div
                    className={`px-5 py-3.5 rounded-[24px] text-[15px] leading-relaxed relative ${
                      isUser
                        ? 'bg-[#67B88B] text-white rounded-tr-[8px] shadow-md shadow-[#67B88B]/20'
                        : 'bg-white dark:bg-gray-800 text-gray-800 dark:text-gray-100 border border-gray-200 dark:border-gray-700 rounded-tl-[8px] shadow-sm'
                    }`}
                  >
                    {/* Quote reference */}
                    {msg.replyTo && (() => {
                      const quoted = messages.find((m) => m.id === msg.replyTo);
                      return quoted ? (
                        <div className={`text-[12px] mb-2 px-3 py-1.5 rounded-lg border-l-2 ${
                          isUser ? 'bg-white/15 border-white/40 text-white/80' : 'bg-gray-50 dark:bg-gray-900 border-[#67B88B] text-gray-600 dark:text-gray-400'
                        }`}>
                          <span className="font-medium">{quoted.sender === 'user' ? 'You' : 'Bot'}: </span>
                          {quoted.text.slice(0, 80)}{quoted.text.length > 80 ? '…' : ''}
                        </div>
                      ) : null;
                    })()}
                    {/* User image message */}
                    {isUser && msg.mediaType === 'image' && msg.mediaUrl ? (
                      <img src={msg.mediaUrl} alt="Sent image" className="max-w-full rounded-lg" />
                    ) : isUser && msg.mediaType === 'voice' ? (
                      <span className="flex items-center gap-2">🎙️ Voice message</span>
                    ) : isUser ? msg.text : (
                      <Markdown
                        components={{
                          p: ({ children }) => <p className="mb-2 last:mb-0">{children}</p>,
                          code: ({ children, className }) => {
                            const lang = className?.replace('language-', '') || '';
                            const isBlock = !!className?.includes('language-');
                            if (isBlock) {
                              const code = String(children).replace(/\n$/, '');
                              let highlighted = code;
                              try {
                                highlighted = lang && hljs.getLanguage(lang)
                                  ? hljs.highlight(code, { language: lang }).value
                                  : hljs.highlightAuto(code).value;
                              } catch { /* fallback to plain */ }
                              return (
                                <pre className="bg-[#1e1e2e] border border-[#313244] rounded-lg p-3 my-2 overflow-x-auto text-[13px]">
                                  {lang && <span className="text-[10px] text-[#6c7086] float-right uppercase">{lang}</span>}
                                  <code className="text-[#cdd6f4]" dangerouslySetInnerHTML={{ __html: highlighted }} />
                                </pre>
                              );
                            }
                            return <code className="bg-gray-100 dark:bg-gray-800 text-gray-800 dark:text-gray-200 px-1.5 py-0.5 rounded text-[13px]">{children}</code>;
                          },
                          pre: ({ children }) => <>{children}</>,
                          ul: ({ children }) => <ul className="list-disc pl-4 mb-2 space-y-1">{children}</ul>,
                          ol: ({ children }) => <ol className="list-decimal pl-4 mb-2 space-y-1">{children}</ol>,
                          h1: ({ children }) => <h1 className="text-lg font-bold mb-2">{children}</h1>,
                          h2: ({ children }) => <h2 className="text-base font-bold mb-1.5">{children}</h2>,
                          h3: ({ children }) => <h3 className="text-sm font-bold mb-1">{children}</h3>,
                          a: ({ href, children }) => <a href={href} target="_blank" rel="noopener noreferrer" className="text-[#5B8DEF] underline">{children}</a>,
                          blockquote: ({ children }) => <blockquote className="border-l-2 border-[#67B88B] pl-3 my-2 text-[#2D3436]/70 dark:text-[#e2e8f0]/70">{children}</blockquote>,
                          strong: ({ children }) => <strong className="font-bold">{children}</strong>,
                        }}
                      >{msg.text}</Markdown>
                    )}
                  </div>
                  
                  {/* Reaction & Reply & Edit/Delete Buttons — show on hover */}
                  <div className={`flex items-center gap-1 mt-1 opacity-0 group-hover:opacity-100 transition-opacity duration-150 ${isUser ? 'flex-row-reverse' : 'flex-row'}`}>
                    <motion.button
                      whileTap={{ scale: 0.9 }}
                      onClick={() => openReactionPicker(msg.id)}
                      className="p-1 text-gray-400 dark:text-gray-500 hover:text-[#67B88B] transition-colors"
                    >
                      <SmilePlus size={14} />
                    </motion.button>
                    <motion.button
                      whileTap={{ scale: 0.9 }}
                      onClick={() => startReply(msg)}
                      className="p-1 text-gray-400 dark:text-gray-500 hover:text-[#5B8DEF] transition-colors"
                    >
                      <CornerDownLeft size={14} />
                    </motion.button>
                    {isUser && (
                      <>
                        <motion.button
                          whileTap={{ scale: 0.9 }}
                          onClick={() => handleEditMessage(msg)}
                          className="p-1 text-gray-400 dark:text-gray-500 hover:text-amber-500 transition-colors"
                        >
                          <Pencil size={14} />
                        </motion.button>
                        <motion.button
                          whileTap={{ scale: 0.9 }}
                          onClick={() => handleDeleteMessage(msg.id)}
                          className="p-1 text-gray-400 dark:text-gray-500 hover:text-red-500 transition-colors"
                        >
                          <Trash2 size={14} />
                        </motion.button>
                      </>
                    )}
                  </div>

                {/* Action Card for AI messages */}
                {!isUser && <ActionCard text={msg.text} onSend={quickSend} />}

                {/* Reactions Display */}
                {msg.reactions && msg.reactions.length > 0 && (
                  <div className={`flex flex-wrap gap-1 mt-1.5 ${isUser ? 'justify-end' : 'justify-start'}`}>
                    {msg.reactions.map((emoji, idx) => (
                      <motion.button
                        key={idx}
                        initial={{ scale: 0 }}
                        animate={{ scale: 1 }}
                        whileTap={{ scale: 0.9 }}
                        onClick={() => openReactionPicker(msg.id)}
                        className="bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-full px-2 py-0.5 text-[13px] shadow-sm flex items-center gap-1"
                      >
                        {emoji}
                      </motion.button>
                    ))}
                  </div>
                )}

                {/* Message time */}
                {msg.timestamp && (
                  <span className={`text-[10px] text-gray-400 dark:text-gray-500 mt-1 ${isUser ? 'text-right' : 'text-left'}`}>
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
          <div className="flex items-center gap-2 px-2 text-[12px] text-gray-500 dark:text-gray-400">
            <span className="w-1.5 h-1.5 bg-[#67B88B] rounded-full animate-pulse" />
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
              <div className="w-8 h-8 rounded-full bg-gradient-to-br from-[#67B88B] to-[#4a9a70] flex-shrink-0 mr-3 flex items-center justify-center text-white shadow-sm text-lg">
                {agentInfo?.identityEmoji || '🤖'}
              </div>
              <div className="bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-[24px] rounded-tl-[8px] shadow-sm px-5 py-3.5">
                <div className="flex items-center gap-1.5">
                  <span className="w-2 h-2 bg-[#67B88B] rounded-full animate-bounce [animation-delay:0ms]" />
                  <span className="w-2 h-2 bg-[#67B88B] rounded-full animate-bounce [animation-delay:150ms]" />
                  <span className="w-2 h-2 bg-[#67B88B] rounded-full animate-bounce [animation-delay:300ms]" />
                </div>
              </div>
            </motion.div>
          )}
        </AnimatePresence>
        <div ref={messagesEndRef} />
      </div>

      {/* Input Area */}
      <div className="p-4 bg-gradient-to-t from-gray-50 via-gray-50 dark:from-gray-900 dark:via-gray-900 to-transparent z-30 flex-shrink-0">
        <AnimatePresence>
          {showSlashMenu && (
            <>
              <motion.div
                initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
                className="fixed inset-0 bg-gray-50/40 dark:bg-gray-900/40 backdrop-blur-md -z-10"
                onClick={() => setShowSlashMenu(false)}
              />
              <motion.div
                initial={{ opacity: 0, y: 20, scale: 0.95 }}
                animate={{ opacity: 1, y: 0, scale: 1 }}
                exit={{ opacity: 0, y: 10, scale: 0.95 }}
                className="absolute bottom-full left-4 right-4 mb-2 bg-white/70 dark:bg-gray-800/70 backdrop-blur-[20px] border border-white/50 dark:border-gray-700/50 shadow-2xl rounded-[24px] p-2 overflow-hidden"
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
                    <div className="w-10 h-10 rounded-full bg-gray-100 dark:bg-gray-700 flex items-center justify-center text-[#67B88B]">
                      <cmd.icon size={18} />
                    </div>
                    <div>
                      <div className="font-semibold text-[15px] text-gray-800 dark:text-gray-100">{cmd.label}</div>
                      <div className="text-[13px] text-gray-600 dark:text-gray-400">{cmd.desc}</div>
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
                className="fixed inset-0 bg-gray-50/40 dark:bg-gray-900/40 backdrop-blur-md -z-10"
                onClick={() => { setShowEmojiPicker(false); setReactingToMsgId(null); }}
              />
              <motion.div
                initial={{ opacity: 0, y: 20, scale: 0.95 }}
                animate={{ opacity: 1, y: 0, scale: 1 }}
                exit={{ opacity: 0, y: 10, scale: 0.95 }}
                className="absolute bottom-full left-4 right-4 mb-2 bg-white/70 dark:bg-gray-800/70 backdrop-blur-[20px] border border-white/50 dark:border-gray-700/50 shadow-2xl rounded-[24px] p-4 flex flex-wrap gap-2 justify-center"
              >
                {EMOJI_LIST.map((emoji) => (
                  <motion.button
                    key={emoji}
                    whileTap={{ scale: 0.8 }}
                    onClick={() => handleEmojiSelect(emoji)}
                    className="w-10 h-10 text-2xl flex items-center justify-center hover:bg-white/50 dark:hover:bg-gray-700/50 rounded-full transition-colors"
                  >
                    {emoji}
                  </motion.button>
                ))}
              </motion.div>
            </>
          )}
        </AnimatePresence>

        {/* Quick command chips */}
        {!showSlashMenu && !showEmojiPicker && !inputValue && (
          <div className="flex gap-1.5 overflow-x-auto pb-2 px-1 scrollbar-hide">
            {QUICK_COMMANDS.map((cmd) => (
              <motion.button
                key={cmd.label}
                whileTap={{ scale: 0.95 }}
                onClick={() => quickSend(cmd.label)}
                className="flex-shrink-0 inline-flex items-center gap-1 px-3 py-1.5 bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-full text-[12px] font-medium text-gray-600 dark:text-gray-300 hover:border-[#67B88B] hover:text-[#67B88B] transition-colors"
              >
                <span>{cmd.emoji}</span>
                {cmd.label}
              </motion.button>
            ))}
          </div>
        )}

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
              <div className="flex items-center gap-2 px-4 py-2 mb-2 bg-white dark:bg-gray-800 border border-blue-200 dark:border-blue-700 rounded-[16px]">
                <div className="w-1 h-8 bg-[#5B8DEF] rounded-full flex-shrink-0" />
                <div className="flex-1 min-w-0">
                  <p className="text-[11px] text-[#5B8DEF] font-medium">
                    Replying to {replyingTo.sender === 'user' ? 'yourself' : 'Bot'}
                  </p>
                  <p className="text-[13px] text-gray-600 dark:text-gray-400 truncate">{replyingTo.text}</p>
                </div>
                <motion.button whileTap={{ scale: 0.8 }} onClick={() => setReplyingTo(null)} className="p-1 text-gray-400 dark:text-gray-500">
                  <X size={16} />
                </motion.button>
              </div>
            </motion.div>
          )}
        </AnimatePresence>

        <div className="bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-full p-2 flex items-center gap-2 shadow-lg shadow-black/5">
          {/* Image button - always visible */}
          <motion.button
            whileTap={{ scale: 0.9 }}
            onClick={handleImagePick}
            className="p-2 text-gray-500 dark:text-gray-400 hover:text-gray-800 dark:hover:text-gray-200 transition-colors"
          >
            <Image size={22} />
          </motion.button>

          {/* More button - toggles to X when expanded */}
          <AnimatePresence mode="popLayout">
            {!showMoreIcons ? (
              <motion.button
                key="more"
                whileTap={{ scale: 0.9 }}
                onClick={() => setShowMoreIcons(true)}
                className="p-2 text-gray-500 dark:text-gray-400 hover:text-gray-800 dark:hover:text-gray-200 transition-colors"
              >
                <MoreHorizontal size={22} />
              </motion.button>
            ) : (
              <motion.button
                key="close"
                initial={{ rotate: -90, opacity: 0 }}
                animate={{ rotate: 0, opacity: 1 }}
                exit={{ rotate: 90, opacity: 0 }}
                whileTap={{ scale: 0.9 }}
                onClick={() => setShowMoreIcons(false)}
                className="p-2 text-gray-400 dark:text-gray-500 hover:text-gray-600 dark:hover:text-gray-300 transition-colors"
              >
                <X size={20} />
              </motion.button>
            )}
          </AnimatePresence>

          {/* Additional icons - shown when more is clicked */}
          <AnimatePresence>
            {showMoreIcons && (
              <>
                <motion.button
                  initial={{ width: 0, opacity: 0, scale: 0.8 }}
                  animate={{ width: 'auto', opacity: 1, scale: 1 }}
                  exit={{ width: 0, opacity: 0, scale: 0.8 }}
                  whileTap={{ scale: 0.9 }}
                  onClick={() => { setShowEmojiPicker(!showEmojiPicker); setShowSlashMenu(false); setReactingToMsgId(null); }}
                  className={`p-2 transition-colors ${showEmojiPicker && !reactingToMsgId ? 'text-[#67B88B]' : 'text-gray-500 dark:text-gray-400 hover:text-gray-800 dark:hover:text-gray-200'}`}
                >
                  <Smile size={22} />
                </motion.button>
                <motion.button
                  initial={{ width: 0, opacity: 0, scale: 0.8 }}
                  animate={{ width: 'auto', opacity: 1, scale: 1 }}
                  exit={{ width: 0, opacity: 0, scale: 0.8 }}
                  whileTap={{ scale: 0.9 }}
                  onClick={handleFilePick}
                  className="p-2 text-gray-500 dark:text-gray-400 hover:text-gray-800 dark:hover:text-gray-200 transition-colors"
                >
                  <Paperclip size={20} />
                </motion.button>
              </>
            )}
          </AnimatePresence>

          <input ref={fileInputRef} type="file" accept="image/*" className="hidden" onChange={handleFileSelected} />
          <input ref={fileInputRef2} type="file" className="hidden" onChange={handleFileSelected2} />
          <input
            type="text"
            value={inputValue}
            onChange={handleInputChange}
            onFocus={() => { setShowMoreIcons(false); setShowEmojiPicker(false); }}
            onKeyDown={(e) => e.key === 'Enter' && handleSend()}
            placeholder="Message..."
            className="flex-1 bg-transparent border-none focus:outline-none text-[15px] py-2 text-gray-800 dark:text-gray-100 placeholder:text-gray-400 dark:placeholder:text-gray-500"
          />

          {/* Voice button when no text, Send button when has text */}
          {inputValue.trim() ? (
            <motion.button
              initial={{ scale: 0.8, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              whileTap={{ scale: 0.9 }}
              onClick={handleSend}
              className="p-3 rounded-full flex items-center justify-center bg-[#67B88B] text-white shadow-md shadow-[#67B88B]/30"
            >
              <Send size={20} />
            </motion.button>
          ) : (
            <motion.button
              whileTap={{ scale: 0.9 }}
              onClick={toggleRecording}
              className={`p-3 rounded-full flex items-center justify-center transition-colors ${
                isRecording ? 'bg-red-500 text-white shadow-md shadow-red-500/30' : 'bg-gray-100 dark:bg-gray-700 text-gray-500 dark:text-gray-400'
              }`}
            >
              {isRecording ? <MicOff size={20} /> : <Mic size={20} />}
            </motion.button>
          )}
        </div>
      </div>
    </div>
  );
}
