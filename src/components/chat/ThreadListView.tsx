import { memo, useState, useEffect, useRef, useCallback } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { MessageSquareText, MessageCircle, User, Loader2 } from 'lucide-react';
import { useThreadStore, type Thread, type ThreadStatus } from '../../stores/threadStore';
import * as channel from '../../services/clawChannel';
import { formatRelativeTime } from './utils';

type FilterTab = 'all' | 'mine' | 'unread' | 'archived';

const FILTER_TABS: { key: FilterTab; label: string }[] = [
  { key: 'all', label: 'All' },
  { key: 'mine', label: 'My Threads' },
  { key: 'unread', label: 'Unread' },
  { key: 'archived', label: 'Archived' },
];

/** Overlapping participant avatars (max 3) — reused from ThreadPanel */
function MiniAvatars({ ids }: { ids: string[] }) {
  const shown = ids.slice(0, 3);
  const extra = ids.length - 3;
  if (shown.length === 0) return null;
  return (
    <div className="flex items-center">
      <div className="flex -space-x-1.5">
        {shown.map((id) => (
          <div
            key={id}
            className="flex h-5 w-5 items-center justify-center rounded-full border-[1.5px] border-white bg-gradient-to-br from-info to-accent text-[9px] text-white dark:border-surface-dark"
          >
            <User size={10} />
          </div>
        ))}
      </div>
      {extra > 0 && (
        <span className="ml-0.5 text-[10px] text-text/40 dark:text-text-inv/40">+{extra}</span>
      )}
    </div>
  );
}

interface ThreadListViewProps {
  connId?: string;
  channelId?: string;
}

function ThreadListViewInner({ connId, channelId }: ThreadListViewProps) {
  const {
    threads, threadListTotal, isLoadingThreadList,
    threadReplyPreviews, unreadCounts,
    openThread, loadThreadList, threadListFilter,
  } = useThreadStore();

  const [activeTab, setActiveTab] = useState<FilterTab>('all');
  const scrollRef = useRef<HTMLDivElement>(null);
  const sentinelRef = useRef<HTMLDivElement>(null);

  // Compute the senderId for "My Threads" filter
  const senderId = connId ? channel.getSenderId(connId) : undefined;

  // Load threads when tab changes
  const handleTabChange = useCallback((tab: FilterTab) => {
    setActiveTab(tab);
    const base: { channelId?: string; status?: ThreadStatus | 'all'; participantId?: string; page: number; pageSize: number } = {
      channelId: channelId || threadListFilter.channelId,
      page: 1,
      pageSize: 20,
    };
    if (tab === 'all') {
      base.status = 'all';
    } else if (tab === 'mine') {
      base.status = 'all';
      base.participantId = senderId;
    } else if (tab === 'unread') {
      // Load all, filter client-side by unread
      base.status = 'all';
    } else if (tab === 'archived') {
      base.status = 'archived';
    }
    loadThreadList(base, connId);
  }, [channelId, threadListFilter.channelId, senderId, loadThreadList, connId]);

  // Initial load
  useEffect(() => {
    handleTabChange('all');
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [channelId]);

  // Get sorted thread list from Map
  const threadList = Array.from(threads.values())
    .filter((t) => {
      if (t.status === 'deleted') return false;
      if (activeTab === 'archived') return t.status === 'archived';
      if (activeTab === 'all') return t.status !== 'archived';
      if (activeTab === 'mine') return t.participantIds.includes(senderId || '') && t.status !== 'archived';
      if (activeTab === 'unread') return (unreadCounts.get(t.id) ?? 0) > 0 && t.status !== 'archived';
      return true;
    })
    .sort((a, b) => {
      const aTime = a.lastReplyAt ? new Date(a.lastReplyAt).getTime() : new Date(a.createdAt).getTime();
      const bTime = b.lastReplyAt ? new Date(b.lastReplyAt).getTime() : new Date(b.createdAt).getTime();
      return bTime - aTime;
    });

  // Scroll-based pagination
  const currentPage = threadListFilter.page;
  const hasMore = threadList.length < threadListTotal;

  useEffect(() => {
    const sentinel = sentinelRef.current;
    const container = scrollRef.current;
    if (!sentinel || !container) return;

    const observer = new IntersectionObserver(
      (entries) => {
        if (entries[0].isIntersecting && hasMore && !isLoadingThreadList) {
          loadThreadList({ page: currentPage + 1 }, connId);
        }
      },
      { root: container, threshold: 0.1 },
    );
    observer.observe(sentinel);
    return () => observer.disconnect();
  }, [hasMore, isLoadingThreadList, currentPage, loadThreadList, connId]);

  const handleClickThread = useCallback((threadId: string) => {
    openThread(threadId, connId);
  }, [openThread, connId]);

  return (
    <div className="flex flex-1 flex-col overflow-hidden">
      {/* Filter tabs */}
      <div className="flex gap-1 border-b border-border/70 px-3 py-2 dark:border-border-dark/70">
        {FILTER_TABS.map((tab) => (
          <button
            key={tab.key}
            onClick={() => handleTabChange(tab.key)}
            className={`rounded-full px-3 py-1 text-[12px] font-medium transition-colors ${
              activeTab === tab.key
                ? 'bg-primary/10 text-primary dark:bg-primary/20'
                : 'text-text/50 hover:bg-slate-100 hover:text-text/70 dark:text-text-inv/50 dark:hover:bg-white/[0.06] dark:hover:text-text-inv/70'
            }`}
          >
            {tab.label}
          </button>
        ))}
      </div>

      {/* Thread list */}
      <div ref={scrollRef} className="flex-1 overflow-y-auto">
        {isLoadingThreadList && threadList.length === 0 ? (
          <div className="flex flex-col items-center justify-center gap-3 py-16">
            <Loader2 size={24} className="animate-spin text-primary/50" />
            <span className="text-[13px] text-text/40 dark:text-text-inv/40">Loading threads...</span>
          </div>
        ) : threadList.length === 0 ? (
          <div className="flex flex-col items-center justify-center gap-3 py-16">
            <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-primary/10">
              <MessageSquareText size={24} className="text-primary" />
            </div>
            <p className="text-center text-[13px] text-text/50 dark:text-text-inv/50">
              {activeTab === 'unread' ? 'No unread threads' : activeTab === 'archived' ? 'No archived threads' : activeTab === 'mine' ? 'No threads you participated in' : 'No threads yet'}
            </p>
          </div>
        ) : (
          <div className="divide-y divide-border/40 dark:divide-border-dark/40">
            {threadList.map((thread) => (
              <ThreadListItem
                key={thread.id}
                thread={thread}
                preview={threadReplyPreviews.get(thread.id)}
                unread={unreadCounts.get(thread.id) ?? 0}
                onClick={handleClickThread}
              />
            ))}
          </div>
        )}

        {/* Load more sentinel */}
        <div ref={sentinelRef} className="h-1" />

        {/* Loading more indicator */}
        {isLoadingThreadList && threadList.length > 0 && (
          <div className="flex justify-center py-4">
            <Loader2 size={18} className="animate-spin text-text/30 dark:text-text-inv/30" />
          </div>
        )}
      </div>
    </div>
  );
}

/** Individual thread list item */
const ThreadListItem = memo(function ThreadListItem({
  thread,
  preview,
  unread,
  onClick,
}: {
  thread: Thread;
  preview?: string;
  unread: number;
  onClick: (id: string) => void;
}) {
  const displayTitle = thread.title || thread.parentMessageId?.slice(0, 20) || 'Untitled Thread';
  const lastTime = thread.lastReplyAt || thread.createdAt;
  const lastTimeMs = lastTime ? new Date(lastTime).getTime() : undefined;
  const previewText = preview || (thread.replyCount > 0 ? `${thread.replyCount} replies` : 'No replies yet');

  return (
    <button
      onClick={() => onClick(thread.id)}
      className="flex w-full items-start gap-3 px-4 py-3 text-left transition-colors hover:bg-slate-50 active:bg-slate-100 dark:hover:bg-white/[0.04] dark:active:bg-white/[0.06]"
    >
      {/* Thread icon */}
      <div className="mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-primary/10 text-primary">
        <MessageSquareText size={18} />
      </div>

      {/* Content */}
      <div className="flex min-w-0 flex-1 flex-col gap-0.5">
        {/* Title row */}
        <div className="flex items-center gap-2">
          <span className="flex-1 truncate text-[14px] font-medium text-text dark:text-text-inv">
            {displayTitle}
          </span>
          <span className="shrink-0 text-[11px] tabular-nums text-text/40 dark:text-text-inv/35">
            {formatRelativeTime(lastTimeMs)}
          </span>
        </div>

        {/* Preview text */}
        <p className="truncate text-[13px] leading-snug text-text/55 dark:text-text-inv/50">
          {previewText.length > 60 ? previewText.slice(0, 60) + '...' : previewText}
        </p>

        {/* Bottom row: avatars, reply count, unread badge */}
        <div className="mt-0.5 flex items-center gap-2.5">
          <MiniAvatars ids={thread.participantIds} />
          <span className="flex items-center gap-1 text-[11px] text-text/40 dark:text-text-inv/35">
            <MessageCircle size={11} />
            {thread.replyCount}
          </span>
          {/* Unread badge */}
          <AnimatePresence>
            {unread > 0 && (
              <motion.span
                initial={{ scale: 0.6, opacity: 0 }}
                animate={{ scale: 1, opacity: 1 }}
                exit={{ scale: 0.6, opacity: 0 }}
                className="ml-auto flex h-5 min-w-5 items-center justify-center rounded-full bg-info px-1.5 text-[10px] font-bold text-white"
              >
                {unread > 99 ? '99+' : unread}
              </motion.span>
            )}
          </AnimatePresence>
        </div>
      </div>
    </button>
  );
});

export const ThreadListView = memo(ThreadListViewInner);
