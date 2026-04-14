import { memo, useEffect } from 'react';
import { motion } from 'motion/react';
import { X, ArrowLeft, MessageSquareText } from 'lucide-react';
import { useThreadStore } from '../../stores/threadStore';

interface ThreadPanelProps {
  /** Whether the viewport is >=768px wide */
  isWide: boolean;
}

/**
 * Adaptive thread panel — sidebar on wide screens, fullscreen overlay on narrow.
 * This is the shell component (US-010). Inner content (header, messages, input)
 * will be added in subsequent stories (US-011–US-013).
 */
function ThreadPanelInner({ isWide }: ThreadPanelProps) {
  const { isThreadPanelOpen, activeThreadId, closeThread, threads } = useThreadStore();

  const activeThread = activeThreadId ? threads.get(activeThreadId) ?? null : null;

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

  // ── Body content ──
  const body = activeThreadId ? (
    <div className="flex flex-1 flex-col items-center justify-center gap-3 px-6">
      <div className="flex h-14 w-14 items-center justify-center rounded-2xl bg-primary/10">
        <MessageSquareText size={28} className="text-primary" />
      </div>
      <p className="text-center text-[14px] font-semibold text-text dark:text-text-inv">
        Thread
      </p>
      <p className="text-center text-[13px] text-text/50 dark:text-text-inv/50">
        {activeThread?.title || `Thread ${activeThreadId.slice(0, 8)}…`}
      </p>
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
        <div className="flex items-center justify-between border-b border-border/70 px-4 py-3 dark:border-border-dark/70">
          <h3 className="text-[15px] font-semibold text-text dark:text-text-inv">
            Thread
          </h3>
          <motion.button
            whileTap={{ scale: 0.9 }}
            onClick={closeThread}
            className="rounded-xl bg-slate-900/[0.04] p-2 text-slate-500 transition-colors hover:bg-slate-900/[0.08] hover:text-text dark:bg-white/[0.06] dark:text-slate-400 dark:hover:bg-white/[0.1] dark:hover:text-text-inv"
          >
            <X size={18} />
          </motion.button>
        </div>

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
      <div className="flex items-center gap-3 border-b border-border/70 px-3 py-3 dark:border-border-dark/70">
        <motion.button
          whileTap={{ scale: 0.9 }}
          onClick={closeThread}
          className="rounded-xl bg-slate-900/[0.04] p-2 text-slate-500 transition-colors hover:bg-slate-900/[0.08] hover:text-text dark:bg-white/[0.06] dark:text-slate-400 dark:hover:bg-white/[0.1] dark:hover:text-text-inv"
        >
          <ArrowLeft size={18} />
        </motion.button>
        <h3 className="text-[15px] font-semibold text-text dark:text-text-inv">
          Thread
        </h3>
      </div>

      {body}
    </motion.div>
  );
}

export const ThreadPanel = memo(ThreadPanelInner);
