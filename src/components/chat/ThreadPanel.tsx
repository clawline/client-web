import { memo, useEffect, useMemo, useRef, useCallback, useState } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { X, ArrowLeft, MessageSquareText, MoreVertical, MessageCircle, Users, User, Loader2, ArrowDown } from 'lucide-react';
import { useThreadStore } from '../../stores/threadStore';
import { getMessages as getCachedMessages } from '../../stores/messageCache';
import { formatTime } from './utils';
import MarkdownRenderer from '../MarkdownRenderer';
import { MessageItem } from './MessageItem';
import type { AgentInfo } from './types';

interface ThreadPanelProps {
  /** Whether the viewport is >=768px wide */
  isWide: boolean;
  /** Connection ID for looking up parent message from cache */
  connId?: string;
  /** Agent ID for looking up parent message from cache */
  agentId?: string;
}

/** Overlapping avatar circles for thread participants (max 3 shown) */
function ParticipantAvatars({ participantIds }: { participantIds: string[] }) {
  const shown = participantIds.slice(0, 3);
  const extra = participantIds.length - 3;

  if (shown.length === 0) return null;

  return (
    <div className="flex items-center">
      <div className="flex -space-x-2">
        {shown.map((id) => (
          <div
            key={id}
            className="flex h-6 w-6 items-center justify-center rounded-full border-2 border-white bg-gradient-to-br from-info to-accent text-[10px] text-white dark:border-surface-dark"
            title={id}
          >
            <User size={12} />
          </div>
        ))}
      </div>
      {extra > 0 && (
        <span className="ml-1 text-[11px] font-medium text-text/50 dark:text-text-inv/50">
          +{extra}
        </span>
      )}
    </div>
  );
}

/** Threshold in pixels — if user is within this distance from bottom, auto-scroll on new messages */
const AUTO_SCROLL_THRESHOLD = 80;

/**
 * Adaptive thread panel — sidebar on wide screens, fullscreen overlay on narrow.
 * US-010: Shell. US-011: Header with parent message. US-012: Message list with scroll loading.
 */
function ThreadPanelInner({ isWide, connId, agentId }: ThreadPanelProps) {
  const {
    isThreadPanelOpen, activeThreadId, closeThread, threads,
    threadMessages, isLoadingMessages, isLoadingOlderMessages,
    hasMoreMessages, loadOlderMessages,
  } = useThreadStore();

  const activeThread = activeThreadId ? threads.get(activeThreadId) ?? null : null;
  const messages = activeThreadId ? threadMessages.get(activeThreadId) ?? [] : [];

  // Refs for scroll management
  const scrollContainerRef = useRef<HTMLDivElement>(null);
  const bottomRef = useRef<HTMLDivElement>(null);
  const topSentinelRef = useRef<HTMLDivElement>(null);
  const [isNearBottom, setIsNearBottom] = useState(true);
  const [hasNewMessages, setHasNewMessages] = useState(false);
  const prevMessageCountRef = useRef(0);
  const didInitialScrollRef = useRef(false);

  // Look up the parent message from the main message cache
  const parentMessage = useMemo(() => {
    if (!activeThread?.parentMessageId || !connId) return null;
    const cached = getCachedMessages(connId, agentId || '');
    return cached.find((m) => m.id === activeThread.parentMessageId) ?? null;
  }, [activeThread?.parentMessageId, connId, agentId]);

  // Minimal agentInfo for MessageItem (thread messages don't have full agent context)
  const threadAgentInfo: AgentInfo | null = useMemo(() => {
    if (!agentId) return null;
    return { id: agentId, name: 'Bot', isDefault: false };
  }, [agentId]);

  // Scroll to bottom helper
  const scrollToBottom = useCallback((smooth = false) => {
    bottomRef.current?.scrollIntoView({ behavior: smooth ? 'smooth' : 'instant' });
  }, []);

  // Initial scroll to bottom when thread opens / messages first load
  useEffect(() => {
    if (activeThreadId && messages.length > 0 && !isLoadingMessages && !didInitialScrollRef.current) {
      // Wait for DOM render
      requestAnimationFrame(() => {
        scrollToBottom(false);
        didInitialScrollRef.current = true;
      });
    }
  }, [activeThreadId, messages.length, isLoadingMessages, scrollToBottom]);

  // Reset initial scroll ref when thread changes
  useEffect(() => {
    didInitialScrollRef.current = false;
    setHasNewMessages(false);
    setIsNearBottom(true);
    prevMessageCountRef.current = 0;
  }, [activeThreadId]);

  // Track new incoming messages for auto-scroll / pill
  useEffect(() => {
    if (messages.length > prevMessageCountRef.current && prevMessageCountRef.current > 0 && didInitialScrollRef.current) {
      if (isNearBottom) {
        requestAnimationFrame(() => scrollToBottom(true));
      } else {
        setHasNewMessages(true);
      }
    }
    prevMessageCountRef.current = messages.length;
  }, [messages.length, isNearBottom, scrollToBottom]);

  // Scroll event handler — track proximity to bottom
  const handleScroll = useCallback(() => {
    const el = scrollContainerRef.current;
    if (!el) return;
    const distFromBottom = el.scrollHeight - el.scrollTop - el.clientHeight;
    const nearBottom = distFromBottom < AUTO_SCROLL_THRESHOLD;
    setIsNearBottom(nearBottom);
    if (nearBottom) setHasNewMessages(false);
  }, []);

  // IntersectionObserver to load older messages when top sentinel is visible
  useEffect(() => {
    const sentinel = topSentinelRef.current;
    const container = scrollContainerRef.current;
    if (!sentinel || !container || !activeThreadId) return;

    const observer = new IntersectionObserver(
      (entries) => {
        if (entries[0].isIntersecting && hasMoreMessages && !isLoadingOlderMessages && didInitialScrollRef.current) {
          loadOlderMessages(connId);
        }
      },
      { root: container, threshold: 0.1 },
    );
    observer.observe(sentinel);
    return () => observer.disconnect();
  }, [activeThreadId, hasMoreMessages, isLoadingOlderMessages, loadOlderMessages, connId]);

  // Preserve scroll position after older messages are prepended
  const prevScrollHeightRef = useRef(0);
  useEffect(() => {
    const el = scrollContainerRef.current;
    if (!el) return;
    // Save before render
    prevScrollHeightRef.current = el.scrollHeight;
  });
  useEffect(() => {
    if (!isLoadingOlderMessages && prevScrollHeightRef.current > 0) {
      const el = scrollContainerRef.current;
      if (!el) return;
      const newScrollHeight = el.scrollHeight;
      const diff = newScrollHeight - prevScrollHeightRef.current;
      if (diff > 0) {
        el.scrollTop += diff;
      }
    }
  }, [isLoadingOlderMessages, messages.length]);

  // Close on Escape key
  useEffect(() => {
    if (!isThreadPanelOpen) return;
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') closeThread();
    };
    window.addEventListener('keydown', handleKey);
    return () => window.removeEventListener('keydown', handleKey);
  }, [isThreadPanelOpen, closeThread]);

  if (!isThreadPanelOpen) return null;

  // ── Header title: thread title or truncated parent message ──
  const headerTitle = activeThread
    ? activeThread.title || (parentMessage?.text ? parentMessage.text.slice(0, 50) + (parentMessage.text.length > 50 ? '...' : '') : `Thread`)
    : 'Thread';

  // ── Header content (shared between wide/narrow) ──
  const headerMeta = activeThread ? (
    <div className="flex items-center gap-3 text-[12px] text-text/50 dark:text-text-inv/50">
      <span className="flex items-center gap-1">
        <MessageCircle size={12} />
        {activeThread.replyCount} {activeThread.replyCount === 1 ? 'reply' : 'replies'}
      </span>
      <span className="flex items-center gap-1">
        <Users size={12} />
        {activeThread.participantIds.length}
      </span>
      <ParticipantAvatars participantIds={activeThread.participantIds} />
    </div>
  ) : null;

  // ── Pinned parent message ──
  const parentMessageView = activeThread && parentMessage ? (
    <div className="border-b border-border/70 bg-slate-50/80 px-4 py-3 dark:border-border-dark/70 dark:bg-white/[0.03]">
      <div className="rounded-lg border-l-[3px] border-l-primary/60 bg-white py-2 pl-3 pr-3 shadow-sm dark:bg-surface-dark/80">
        {/* Sender row */}
        <div className="mb-1 flex items-center gap-2">
          <div className={`flex h-6 w-6 items-center justify-center rounded-full text-[10px] text-white shadow-sm ${
            parentMessage.sender === 'user'
              ? 'bg-gradient-to-br from-info to-accent'
              : 'bg-gradient-to-br from-primary to-primary-deep'
          }`}>
            <User size={12} />
          </div>
          <span className={`text-[13px] font-semibold ${
            parentMessage.sender === 'user' ? 'text-info' : 'text-primary'
          }`}>
            {parentMessage.sender === 'user' ? 'You' : 'Bot'}
          </span>
          {parentMessage.timestamp && (
            <span className="text-[10px] text-text/30 dark:text-text-inv/25 tabular-nums">
              {formatTime(parentMessage.timestamp)}
            </span>
          )}
        </div>
        {/* Message content */}
        <div className="text-[14px] leading-relaxed text-text dark:text-text-inv">
          {parentMessage.sender === 'user' ? (
            <span className="whitespace-pre-wrap break-words">{parentMessage.text}</span>
          ) : (
            <MarkdownRenderer content={parentMessage.text} />
          )}
        </div>
      </div>
    </div>
  ) : activeThread ? (
    // Parent message not found in cache — show minimal placeholder
    <div className="border-b border-border/70 bg-slate-50/80 px-4 py-3 dark:border-border-dark/70 dark:bg-white/[0.03]">
      <div className="rounded-lg border-l-[3px] border-l-primary/60 bg-white py-2 pl-3 pr-3 shadow-sm dark:bg-surface-dark/80">
        <div className="flex items-center gap-2">
          <div className="flex h-6 w-6 items-center justify-center rounded-full bg-gradient-to-br from-slate-300 to-slate-400 text-[10px] text-white shadow-sm">
            <User size={12} />
          </div>
          <span className="text-[13px] italic text-text/40 dark:text-text-inv/40">
            Original message
          </span>
        </div>
      </div>
    </div>
  ) : null;

  // ── No-op handlers for MessageItem (thread context — simplified interactions) ──
  const noop = () => {};
  const noopMsg = (_msg: unknown) => {};
  const noopStr = (_s: string) => {};
  const noopCopy = (_id: string, _text: string) => {};
  const noopReaction = (_msgId: string, _emoji: string, _hasIt: boolean) => {};
  const noopReactionRemove = (_msgId: string, _emoji: string) => {};

  // ── Body content: thread message list or empty/loading state ──
  const body = activeThreadId ? (
    <div className="relative flex flex-1 flex-col overflow-hidden">
      {/* Scrollable message list */}
      <div
        ref={scrollContainerRef}
        onScroll={handleScroll}
        className="flex-1 overflow-y-auto px-2 py-2"
      >
        {/* Top sentinel for loading older messages */}
        <div ref={topSentinelRef} className="h-1" />

        {/* Loading older spinner */}
        {isLoadingOlderMessages && (
          <div className="flex justify-center py-3">
            <Loader2 size={20} className="animate-spin text-text/30 dark:text-text-inv/30" />
          </div>
        )}

        {/* No more messages indicator */}
        {!hasMoreMessages && messages.length > 0 && (
          <div className="flex justify-center py-2">
            <span className="text-[11px] text-text/30 dark:text-text-inv/25">Thread start</span>
          </div>
        )}

        {/* Initial loading state */}
        {isLoadingMessages && messages.length === 0 ? (
          <div className="flex flex-1 flex-col items-center justify-center gap-3 py-12">
            <Loader2 size={24} className="animate-spin text-primary/50" />
            <span className="text-[13px] text-text/40 dark:text-text-inv/40">Loading messages...</span>
          </div>
        ) : messages.length === 0 ? (
          <div className="flex flex-1 flex-col items-center justify-center gap-3 py-12">
            <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-primary/10">
              <MessageSquareText size={24} className="text-primary" />
            </div>
            <p className="text-center text-[13px] text-text/50 dark:text-text-inv/50">
              No replies yet
            </p>
          </div>
        ) : (
          /* Message list */
          messages.map((msg, i) => (
            <MessageItem
              key={msg.id}
              msg={msg}
              index={i}
              messages={messages}
              agentInfo={threadAgentInfo}
              copiedMsgId={null}
              runtimeConnId={connId || ''}
              onTouchStart={noopStr}
              onTouchEnd={noop}
              onRetry={noopMsg}
              onReply={noopMsg}
              onEdit={noopMsg}
              onDelete={noopStr}
              onCopy={noopCopy}
              onQuickSend={noopStr}
              onReactionToggle={noopReaction}
              onReactionRemove={noopReactionRemove}
              onOpenReactionPicker={noopStr}
            />
          ))
        )}

        {/* Bottom anchor for scrollToBottom */}
        <div ref={bottomRef} />
      </div>

      {/* "New messages" pill */}
      <AnimatePresence>
        {hasNewMessages && !isNearBottom && (
          <motion.button
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: 10 }}
            transition={{ duration: 0.2 }}
            onClick={() => { scrollToBottom(true); setHasNewMessages(false); }}
            className="absolute bottom-3 left-1/2 z-10 -translate-x-1/2 rounded-full bg-primary px-3 py-1.5 text-[12px] font-medium text-white shadow-lg transition-colors hover:bg-primary-deep"
          >
            <span className="flex items-center gap-1">
              <ArrowDown size={14} />
              New messages
            </span>
          </motion.button>
        )}
      </AnimatePresence>
    </div>
  ) : (
    <div className="flex flex-1 flex-col items-center justify-center gap-3 px-6">
      <div className="flex h-14 w-14 items-center justify-center rounded-2xl bg-primary/10">
        <MessageSquareText size={28} className="text-primary" />
      </div>
      <p className="text-center text-[14px] font-medium text-text/60 dark:text-text-inv/60">
        Select a message to view thread
      </p>
    </div>
  );

  // ── Wide screen: in-flow right sidebar ──
  if (isWide) {
    return (
      <motion.div
        initial={{ width: 0, opacity: 0 }}
        animate={{ width: 400, opacity: 1 }}
        exit={{ width: 0, opacity: 0 }}
        transition={{ type: 'spring', stiffness: 320, damping: 30 }}
        className="relative flex h-full flex-shrink-0 flex-col overflow-hidden border-l border-border/70 bg-white dark:border-border-dark/70 dark:bg-surface-dark"
      >
        {/* Header */}
        <div className="flex flex-col border-b border-border/70 px-4 py-3 dark:border-border-dark/70">
          <div className="flex items-center justify-between">
            <h3 className="flex-1 truncate text-[15px] font-semibold text-text dark:text-text-inv">
              {headerTitle}
            </h3>
            <div className="flex items-center gap-1">
              <motion.button
                whileTap={{ scale: 0.9 }}
                className="rounded-xl bg-slate-900/[0.04] p-2 text-slate-500 transition-colors hover:bg-slate-900/[0.08] hover:text-text dark:bg-white/[0.06] dark:text-slate-400 dark:hover:bg-white/[0.1] dark:hover:text-text-inv"
                title="Thread options"
              >
                <MoreVertical size={16} />
              </motion.button>
              <motion.button
                whileTap={{ scale: 0.9 }}
                onClick={closeThread}
                className="rounded-xl bg-slate-900/[0.04] p-2 text-slate-500 transition-colors hover:bg-slate-900/[0.08] hover:text-text dark:bg-white/[0.06] dark:text-slate-400 dark:hover:bg-white/[0.1] dark:hover:text-text-inv"
              >
                <X size={18} />
              </motion.button>
            </div>
          </div>
          {headerMeta && <div className="mt-1.5">{headerMeta}</div>}
        </div>

        {/* Pinned parent message */}
        {parentMessageView}

        {/* Body (thread messages) */}
        {body}
      </motion.div>
    );
  }

  // ── Narrow screen: fullscreen overlay ──
  return (
    <motion.div
      initial={{ x: '100%' }}
      animate={{ x: 0 }}
      exit={{ x: '100%' }}
      transition={{ type: 'spring', stiffness: 320, damping: 30 }}
      className="fixed inset-0 z-50 flex flex-col bg-white dark:bg-surface-dark"
    >
      {/* Header with back button */}
      <div className="flex flex-col border-b border-border/70 px-3 py-3 dark:border-border-dark/70">
        <div className="flex items-center gap-3">
          <motion.button
            whileTap={{ scale: 0.9 }}
            onClick={closeThread}
            className="rounded-xl bg-slate-900/[0.04] p-2 text-slate-500 transition-colors hover:bg-slate-900/[0.08] hover:text-text dark:bg-white/[0.06] dark:text-slate-400 dark:hover:bg-white/[0.1] dark:hover:text-text-inv"
          >
            <ArrowLeft size={18} />
          </motion.button>
          <h3 className="flex-1 truncate text-[15px] font-semibold text-text dark:text-text-inv">
            {headerTitle}
          </h3>
          <motion.button
            whileTap={{ scale: 0.9 }}
            className="rounded-xl bg-slate-900/[0.04] p-2 text-slate-500 transition-colors hover:bg-slate-900/[0.08] hover:text-text dark:bg-white/[0.06] dark:text-slate-400 dark:hover:bg-white/[0.1] dark:hover:text-text-inv"
            title="Thread options"
          >
            <MoreVertical size={16} />
          </motion.button>
        </div>
        {headerMeta && <div className="mt-1.5 pl-12">{headerMeta}</div>}
      </div>

      {/* Pinned parent message */}
      {parentMessageView}

      {/* Body (thread messages) */}
      {body}
    </motion.div>
  );
}

export const ThreadPanel = memo(ThreadPanelInner);
