import { useCallback } from 'react';
import { MessageCircle, User } from 'lucide-react';
import { useThreadStore } from '../../stores/threadStore';

/**
 * Formats a relative time string from an ISO date string.
 * e.g., "2m ago", "3h ago", "yesterday"
 */
function relativeTime(iso: string | null): string {
  if (!iso) return '';
  const diff = Date.now() - new Date(iso).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  if (days === 1) return 'yesterday';
  if (days < 7) return `${days}d ago`;
  return new Date(iso).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}

/** Overlapping avatar circles (max 3 shown) — compact variant for preview bar */
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
            className="flex h-5 w-5 items-center justify-center rounded-full border-[1.5px] border-white bg-gradient-to-br from-info to-accent text-[8px] text-white dark:border-surface-dark"
          >
            <User size={10} />
          </div>
        ))}
      </div>
      {extra > 0 && (
        <span className="ml-0.5 text-[10px] font-medium text-text/40 dark:text-text-inv/40">
          +{extra}
        </span>
      )}
    </div>
  );
}

interface ThreadPreviewBarProps {
  messageId: string;
  connectionId?: string;
}

/**
 * Thread preview bar shown below main chat messages that are thread parents.
 * Looks up the thread from the store by parentMessageId and renders a compact preview.
 * Clicking opens the thread panel.
 */
export function ThreadPreviewBar({ messageId, connectionId }: ThreadPreviewBarProps) {
  // Find thread where this message is the parent
  const thread = useThreadStore((s) => {
    for (const t of s.threads.values()) {
      if (t.parentMessageId === messageId && t.status !== 'deleted') return t;
    }
    return null;
  });
  const preview = useThreadStore((s) => thread ? s.threadReplyPreviews.get(thread.id) : undefined);

  const handleClick = useCallback(() => {
    if (!thread) return;
    useThreadStore.getState().openThread(thread.id, connectionId);
  }, [thread, connectionId]);

  if (!thread || thread.replyCount === 0) return null;

  const truncatedPreview = preview ? (preview.length > 60 ? preview.slice(0, 60) + '...' : preview) : null;

  return (
    <button
      type="button"
      onClick={handleClick}
      className="mt-1 flex w-full items-center gap-2 rounded-md border-l-2 border-l-info/50 bg-info/[0.04] px-2.5 py-1.5 text-left transition-colors hover:bg-info/[0.08] dark:bg-info/[0.06] dark:hover:bg-info/[0.10]"
    >
      <MiniAvatars ids={thread.participantIds} />

      <div className="flex min-w-0 flex-1 items-center gap-1.5">
        <MessageCircle size={13} className="flex-shrink-0 text-info/70" />
        <span className="text-[12px] font-semibold text-info">
          {thread.replyCount} {thread.replyCount === 1 ? 'reply' : 'replies'}
        </span>

        {thread.lastReplyAt && (
          <span className="text-[11px] text-text/40 dark:text-text-inv/35">
            {relativeTime(thread.lastReplyAt)}
          </span>
        )}

        {truncatedPreview && (
          <span className="min-w-0 flex-1 truncate text-[12px] text-text/50 dark:text-text-inv/40">
            {truncatedPreview}
          </span>
        )}
      </div>
    </button>
  );
}
