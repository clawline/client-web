import { useState, useEffect, useCallback, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { ArrowLeft, Inbox as InboxIcon, Send, Sparkles, ExternalLink, Loader2 } from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import { cn } from '../lib/utils';
import { Card } from '../components/ui/card';
import MarkdownRenderer from '../components/MarkdownRenderer';
import {
  getInboxItems,
  markAsRead,
  recordUserMessage,
  isContentMessage,
  onInboxUpdate,
  refreshInbox,
  type InboxItem,
  type AgentStatus,
} from '../services/agentInbox';
import * as channel from '../services/clawChannel';
import { loadConversationMessages } from '../services/messageDB';
import { draftReply } from '../services/suggestions';
import { setActiveConnectionId } from '../services/connectionStore';
import EmptyState from '../components/EmptyState';

// ── Helpers ──

function formatRelativeTime(timestamp: number): string {
  const diff = Date.now() - timestamp;
  const seconds = Math.floor(diff / 1000);
  if (seconds < 60) return 'just now';
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  return `${days}d ago`;
}

function truncateText(text: string, maxLen: number): string {
  if (text.length <= maxLen) return text;
  return text.slice(0, maxLen).trimEnd() + '...';
}

function statusConfig(status: AgentStatus): { color: string; dotClass: string; label: string; animate?: boolean } {
  switch (status) {
    case 'pending_reply':
      return { color: 'text-orange-600 dark:text-orange-400', dotClass: 'bg-orange-500', label: 'Awaiting Reply', animate: true };
    case 'thinking':
      return { color: 'text-cyan-600 dark:text-cyan-400', dotClass: 'bg-cyan-500', label: 'Thinking', animate: true };
    case 'idle':
      return { color: 'text-slate-500 dark:text-slate-400', dotClass: 'bg-slate-400 dark:bg-slate-500', label: 'Idle' };
    case 'offline':
      return { color: 'text-red-500 dark:text-red-400', dotClass: 'bg-red-500', label: 'Offline' };
  }
}

// ── Summary bar ──

function SummaryBar({ items }: { items: InboxItem[] }) {
  const counts = { pending_reply: 0, thinking: 0, idle: 0, offline: 0 };
  let totalUnread = 0;
  for (const item of items) {
    counts[item.status]++;
    totalUnread += item.unreadCount;
  }
  const online = counts.pending_reply + counts.thinking + counts.idle;

  return (
    <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
      <div className={cn(
        'rounded-xl px-3 py-2 text-center',
        counts.pending_reply > 0
          ? 'bg-orange-50 dark:bg-orange-500/10 ring-1 ring-orange-200 dark:ring-orange-500/20'
          : 'bg-slate-50 dark:bg-white/[0.03]'
      )}>
        <div className={cn('text-lg font-bold', counts.pending_reply > 0 ? 'text-orange-600 dark:text-orange-400' : 'text-text/30 dark:text-text-inv/30')}>
          {counts.pending_reply}
        </div>
        <div className="text-[11px] text-text/50 dark:text-text-inv/40">待回复</div>
      </div>
      <div className={cn(
        'rounded-xl px-3 py-2 text-center',
        counts.thinking > 0
          ? 'bg-cyan-50 dark:bg-cyan-500/10 ring-1 ring-cyan-200 dark:ring-cyan-500/20'
          : 'bg-slate-50 dark:bg-white/[0.03]'
      )}>
        <div className={cn('text-lg font-bold', counts.thinking > 0 ? 'text-cyan-600 dark:text-cyan-400' : 'text-text/30 dark:text-text-inv/30')}>
          {counts.thinking}
        </div>
        <div className="text-[11px] text-text/50 dark:text-text-inv/40">思考中</div>
      </div>
      <div className="rounded-xl px-3 py-2 text-center bg-slate-50 dark:bg-white/[0.03]">
        <div className="text-lg font-bold text-text/60 dark:text-text-inv/50">{online}</div>
        <div className="text-[11px] text-text/50 dark:text-text-inv/40">在线</div>
      </div>
      <div className="rounded-xl px-3 py-2 text-center bg-slate-50 dark:bg-white/[0.03]">
        <div className="text-lg font-bold text-text/60 dark:text-text-inv/50">{totalUnread}</div>
        <div className="text-[11px] text-text/50 dark:text-text-inv/40">未读消息</div>
      </div>
    </div>
  );
}

// ── Expanded item detail ──

function InboxItemDetail({
  item,
  onSend,
  onOpenChat,
  onClose,
}: {
  item: InboxItem;
  onSend: (text: string) => void;
  onOpenChat: () => void;
  onClose: () => void;
}) {
  const [recentMessages, setRecentMessages] = useState<Array<{ id: string; sender: string; text: string; timestamp?: number }>>([]);
  const [suggestedReply, setSuggestedReply] = useState('');
  const [replyText, setReplyText] = useState('');
  const [suggesting, setSuggesting] = useState(false);
  const [suggestError, setSuggestError] = useState('');
  const [sending, setSending] = useState(false);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const scrollRef = useRef<HTMLDivElement>(null);

  // Load recent conversation messages (both user and AI)
  useEffect(() => {
    let cancelled = false;
    void loadConversationMessages(item.connectionId, item.agentId, { limit: 20 }).then((allMessages) => {
      if (cancelled) return;
      const messages = allMessages.filter(isContentMessage);
      // Take last 5 messages for conversation context
      setRecentMessages(messages.slice(-5));
    });
    return () => { cancelled = true; };
  }, [item.connectionId, item.agentId, item.lastMessage?.messageId]);

  // Auto-scroll to bottom when messages change
  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [recentMessages]);

  const handleSuggest = useCallback(async () => {
    setSuggesting(true);
    setSuggestError('');
    try {
      const allMessages = await loadConversationMessages(item.connectionId, item.agentId, { limit: 20 });
      const messages = allMessages.filter(isContentMessage);
      if (messages.length === 0) {
        setSuggestError('No messages to draft from');
        return;
      }
      const mapped = messages.map((m) => ({ sender: m.sender === 'user' ? 'user' : 'ai', text: m.text }));
      const reply = await draftReply(mapped, item.connectionId);
      if (reply) {
        setSuggestedReply(reply);
        setReplyText(reply);
        setTimeout(() => textareaRef.current?.focus(), 100);
      } else {
        setSuggestError('Failed to generate reply — check console for details');
      }
    } catch (err) {
      setSuggestError(String(err instanceof Error ? err.message : err));
    } finally {
      setSuggesting(false);
    }
  }, [item.connectionId, item.agentId]);

  const handleSend = useCallback(() => {
    const text = replyText.trim();
    if (!text || sending) return;
    setSending(true);
    onSend(text);
    // Save to IndexedDB with correct chatId scope so ChatRoom can find it
    const chatId = channel.getChatId(item.connectionId) || undefined;
    const msgId = `inbox-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
    const ts = Date.now();
    const msgEntry = { id: msgId, sender: 'user' as const, text, timestamp: ts };
    void import('../services/messageDB').then(({ saveConversationMessages }) => {
      void saveConversationMessages(item.connectionId, item.agentId, [msgEntry], { chatId });
    });
    // Add to local display immediately
    setRecentMessages((prev) => [...prev, { id: msgId, sender: 'user', text, timestamp: ts }]);
    setTimeout(() => {
      setReplyText('');
      setSuggestedReply('');
      setSending(false);
    }, 300);
  }, [replyText, sending, onSend, item.connectionId, item.agentId]);

  const handleKeyDown = useCallback((e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    } else if (e.key === 'Escape') {
      onClose();
    }
  }, [handleSend, onClose]);

  return (
    <motion.div
      initial={{ height: 0, opacity: 0 }}
      animate={{ height: 'auto', opacity: 1 }}
      exit={{ height: 0, opacity: 0 }}
      transition={{ type: 'spring', stiffness: 400, damping: 30 }}
      className="overflow-hidden"
    >
      <div className="px-4 pb-4 pt-1 space-y-3">
        {/* Conversation messages */}
        {recentMessages.length > 0 && (
          <div ref={scrollRef} className="max-h-96 overflow-y-auto space-y-2 rounded-2xl bg-slate-50/80 dark:bg-white/[0.03] px-3 py-3">
            {recentMessages.filter((msg, idx, arr) => arr.findIndex(m => m.id === msg.id) === idx).map((msg) => (
              <div key={msg.id} className={cn('flex', msg.sender === 'user' ? 'justify-end' : 'justify-start')}>
                <div className={cn(
                  'max-w-[85%] rounded-2xl px-3 py-2 text-[13px] leading-relaxed',
                  msg.sender === 'user'
                    ? 'bg-primary/10 text-text dark:text-text-inv'
                    : 'bg-white dark:bg-white/[0.06] text-text/80 dark:text-text-inv/80 shadow-sm'
                )}>
                  <MarkdownRenderer content={msg.text} className="text-[13px] leading-relaxed [&_p]:my-0.5 [&_pre]:text-[11px]" />
                </div>
              </div>
            ))}
          </div>
        )}

        {/* Suggest + Open Chat + input */}
        <div className="space-y-2">
          <div className="flex items-center gap-2">
            <button
              onClick={handleSuggest}
              disabled={suggesting}
              className={cn(
                'flex items-center gap-1.5 rounded-xl px-3 py-1.5 text-[12px] font-medium transition-all',
                suggesting
                  ? 'bg-primary/10 text-primary/60 cursor-wait'
                  : 'bg-primary/10 text-primary hover:bg-primary/18 active:scale-95'
              )}
            >
              {suggesting ? (
                <Loader2 size={13} className="animate-spin" />
              ) : (
                <Sparkles size={13} />
              )}
              {suggesting ? 'Drafting...' : 'Suggest Reply'}
            </button>

            <button
              onClick={onOpenChat}
              className="flex items-center gap-1 rounded-xl px-3 py-1.5 text-[12px] font-medium text-text/50 dark:text-text-inv/50 hover:text-text/70 dark:hover:text-text-inv/70 hover:bg-slate-100 dark:hover:bg-white/[0.06] transition-all"
            >
              <ExternalLink size={12} />
              Open Chat
            </button>
          </div>

          {suggestError && (
            <p className="text-[11px] text-red-500 dark:text-red-400 px-1">{suggestError}</p>
          )}

          {/* Reply input */}
          <div className="flex items-end gap-2">
            <textarea
              ref={textareaRef}
              value={replyText}
              onChange={(e) => setReplyText(e.target.value)}
              onKeyDown={handleKeyDown}
              placeholder={suggestedReply ? '' : 'Type a reply...'}
              rows={2}
              className="flex-1 resize-none rounded-2xl border border-border/70 dark:border-border-dark/70 bg-white/80 dark:bg-white/[0.04] px-4 py-2.5 text-[13px] text-text dark:text-text-inv placeholder:text-text/30 dark:placeholder:text-text-inv/30 focus:outline-none focus:border-primary/50 transition-colors"
            />
            <motion.button
              whileTap={{ scale: 0.9 }}
              onClick={handleSend}
              disabled={!replyText.trim() || sending}
              className={cn(
                'flex items-center justify-center w-10 h-10 rounded-2xl transition-all shrink-0',
                replyText.trim() && !sending
                  ? 'bg-primary text-white shadow-sm shadow-primary/30 hover:bg-primary-deep'
                  : 'bg-slate-100 dark:bg-white/[0.06] text-text/25 dark:text-text-inv/25 cursor-not-allowed'
              )}
            >
              {sending ? (
                <Loader2 size={16} className="animate-spin" />
              ) : (
                <Send size={16} />
              )}
            </motion.button>
          </div>
        </div>
      </div>
    </motion.div>
  );
}

// ── Inbox item card ──

function InboxItemCard({
  item,
  isExpanded,
  onToggle,
  onNavigateToChat,
}: {
  item: InboxItem;
  isExpanded: boolean;
  onToggle: () => void;
  onNavigateToChat: (connectionId: string, agentId: string) => void;
}) {
  const config = statusConfig(item.status);

  const handleSend = useCallback((text: string) => {
    try {
      // Select the agent first — same as ChatRoom does — so the server
      // routes the reply back to this WS connection instead of buffering it.
      channel.selectAgent(item.agentId, item.connectionId);
      channel.sendText(text, item.agentId, item.connectionId);
      recordUserMessage(item.connectionId, item.agentId, text);
    } catch {
      // Connection might not be ready
    }
  }, [item.connectionId, item.agentId]);

  const handleOpenChat = useCallback(() => {
    onNavigateToChat(item.connectionId, item.agentId);
  }, [item.connectionId, item.agentId, onNavigateToChat]);

  return (
    <motion.div
      layout
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: -8 }}
      transition={{ type: 'spring', stiffness: 400, damping: 30 }}
    >
      <Card
        className={cn(
          'overflow-hidden transition-all',
          item.status === 'pending_reply' && 'border-orange-500/25 dark:border-orange-500/20',
          isExpanded && 'ring-1 ring-primary/15'
        )}
      >
        {/* Clickable header */}
        <button
          onClick={onToggle}
          className="w-full px-4 py-3.5 flex items-center gap-3 text-left hover:bg-slate-50/50 dark:hover:bg-white/[0.02] transition-colors"
        >
          {/* Agent emoji */}
          <div className="w-10 h-10 rounded-2xl bg-gradient-to-br from-primary/10 to-primary/5 flex items-center justify-center text-lg shrink-0">
            {item.agentEmoji || '🤖'}
          </div>

          {/* Info */}
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2">
              <span className="text-[14px] font-semibold text-text dark:text-text-inv truncate">
                {item.agentName}
              </span>
              {/* Status badge */}
              <span className={cn('flex items-center gap-1 text-[11px] font-medium shrink-0', config.color)}>
                <span className={cn('w-2 h-2 rounded-full', config.dotClass,
                  config.animate && 'animate-pulse'
                )} />
                {config.label}
              </span>
            </div>
            <div className="text-[11px] text-text/40 dark:text-text-inv/40 truncate mt-0.5">
              {item.connectionName}
            </div>
            {item.lastMessage && !isExpanded && (
              <div className="flex items-center gap-2 mt-1">
                <span className="text-[12px] text-text/55 dark:text-text-inv/55 truncate flex-1">
                  {truncateText(item.lastMessage.text, 60)}
                </span>
                <span className="text-[10px] text-text/30 dark:text-text-inv/30 shrink-0">
                  {formatRelativeTime(item.lastMessage.timestamp)}
                </span>
              </div>
            )}
          </div>

          {/* Unread badge */}
          {item.unreadCount > 0 && (
            <span className="min-w-[20px] h-5 flex items-center justify-center rounded-full bg-primary text-white text-[10px] font-bold px-1.5 shadow-sm shadow-primary/30 shrink-0">
              {item.unreadCount > 99 ? '99+' : item.unreadCount}
            </span>
          )}
        </button>

        {/* Expanded detail */}
        <AnimatePresence>
          {isExpanded && (
            <InboxItemDetail
              item={item}
              onSend={handleSend}
              onOpenChat={handleOpenChat}
              onClose={onToggle}
            />
          )}
        </AnimatePresence>
      </Card>
    </motion.div>
  );
}

// ── Main screen ──

export default function AgentInbox() {
  const navigate = useNavigate();
  const [items, setItems] = useState<InboxItem[]>(() => getInboxItems());
  const [expandedKey, setExpandedKey] = useState<string | null>(null);

  // Subscribe to inbox updates
  useEffect(() => {
    const refresh = () => setItems(getInboxItems());
    const unsub = onInboxUpdate(refresh);
    // Also refresh on mount
    refresh();
    return unsub;
  }, []);

  // Refresh inbox data on screen mount
  useEffect(() => {
    void refreshInbox();
  }, []);

  const handleToggle = useCallback((connectionId: string, agentId: string) => {
    const key = `${connectionId}:${agentId}`;
    setExpandedKey((prev) => (prev === key ? null : key));
    // Mark as read outside setState to avoid updating AppShell during render
    setTimeout(() => markAsRead(connectionId, agentId), 0);
  }, []);

  const handleNavigateToChat = useCallback((connectionId: string, agentId: string) => {
    setActiveConnectionId(connectionId);
    const params = new URLSearchParams();
    params.set('connectionId', connectionId);
    navigate({
      pathname: `/chat/${encodeURIComponent(agentId)}`,
      search: `?${params.toString()}`,
    });
  }, [navigate]);

  const handleBack = useCallback(() => {
    navigate('/chats');
  }, [navigate]);

  return (
    <div className="flex flex-col h-full pb-32 px-5 pt-12 max-w-6xl mx-auto w-full overflow-y-auto">
      {/* Header */}
      <div className="flex items-center gap-3 mb-5">
        <motion.button
          whileTap={{ scale: 0.9 }}
          onClick={handleBack}
          className="w-9 h-9 rounded-xl bg-white/85 dark:bg-white/[0.06] flex items-center justify-center text-text/60 dark:text-text-inv/60 shadow-sm hover:bg-white dark:hover:bg-white/[0.1] transition-colors"
        >
          <ArrowLeft size={18} />
        </motion.button>
        <div className="flex-1">
          <h1 className="text-2xl font-bold tracking-tight text-text dark:text-text-inv">Inbox</h1>
        </div>
      </div>

      {/* Summary bar */}
      <div className="mb-4">
        <SummaryBar items={items} />
      </div>

      {/* Items list */}
      {items.length === 0 ? (
        <EmptyState
          icon={InboxIcon}
          title="No Agents Yet"
          description="Connect to a server and start chatting with agents. Their status will appear here."
        />
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
          <AnimatePresence mode="popLayout">
            {items.map((item) => {
              const key = `${item.connectionId}:${item.agentId}`;
              const isExpanded = expandedKey === key;
              return (
                <div key={key} className={isExpanded ? 'col-span-full' : ''}>
                  <InboxItemCard
                    item={item}
                    isExpanded={isExpanded}
                    onToggle={() => handleToggle(item.connectionId, item.agentId)}
                    onNavigateToChat={handleNavigateToChat}
                  />
                </div>
              );
            })}
          </AnimatePresence>
        </div>
      )}
    </div>
  );
}
