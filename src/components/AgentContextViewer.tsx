import { useEffect, useState } from 'react';
import { motion } from 'motion/react';
import { Clock3, FileText, Loader2, RefreshCw, X } from 'lucide-react';

import type { AgentContext } from '../services/clawChannel';
import { cn } from '../lib/utils';
import MarkdownRenderer from './MarkdownRenderer';

function formatTabLabel(name: string) {
  const baseName = name.replace(/\.[^.]+$/, '');
  return baseName.toUpperCase();
}

function formatUpdatedAt(updatedAt?: number) {
  if (!updatedAt) {
    return '';
  }

  const diffMs = Date.now() - updatedAt;
  const diffMinutes = Math.floor(diffMs / 60000);
  if (diffMinutes < 1) {
    return 'Updated just now';
  }
  if (diffMinutes < 60) {
    return `Updated: ${diffMinutes} min ago`;
  }

  const diffHours = Math.floor(diffMinutes / 60);
  if (diffHours < 24) {
    return `Updated: ${diffHours} hr ago`;
  }

  const diffDays = Math.floor(diffHours / 24);
  if (diffDays < 7) {
    return `Updated: ${diffDays} day${diffDays === 1 ? '' : 's'} ago`;
  }

  return `Updated: ${new Date(updatedAt).toLocaleDateString()}`;
}

type AgentContextViewerProps = {
  agentName: string;
  context: AgentContext | null;
  isLoading: boolean;
  isOpen: boolean;
  onClose: () => void;
  onRefresh: () => void;
};

export default function AgentContextViewer({
  agentName,
  context,
  isLoading,
  isOpen,
  onClose,
  onRefresh,
}: AgentContextViewerProps) {
  const [activeFileName, setActiveFileName] = useState<string | null>(null);

  useEffect(() => {
    if (!isOpen) {
      return;
    }

    const files = context?.files ?? [];
    if (files.length === 0) {
      setActiveFileName(null);
      return;
    }

    const hasActiveFile = activeFileName && files.some((file) => file.name === activeFileName);
    if (!hasActiveFile) {
      setActiveFileName(files[0]?.name ?? null);
    }
  }, [activeFileName, context, isOpen]);

  if (!isOpen) {
    return null;
  }

  const files = context?.files ?? [];
  const activeFile = files.find((file) => file.name === activeFileName) ?? files[0] ?? null;

  return (
    <>
      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        className="fixed inset-0 z-40 bg-black/35 backdrop-blur-sm"
        onClick={onClose}
      />
      <div className="fixed inset-0 z-50 flex items-end justify-center p-4 md:items-center">
        <motion.div
          initial={{ opacity: 0, y: 28, scale: 0.98 }}
          animate={{ opacity: 1, y: 0, scale: 1 }}
          exit={{ opacity: 0, y: 20, scale: 0.98 }}
          transition={{ type: 'spring', stiffness: 320, damping: 28 }}
          className="flex max-h-[70vh] w-full max-w-lg flex-col overflow-hidden rounded-[28px] border border-border/80 bg-white/96 shadow-[0_30px_60px_-28px_rgba(15,23,42,0.42)] backdrop-blur-[20px] dark:border-border-dark/80 dark:bg-card-alt/96 dark:shadow-[0_34px_64px_-28px_rgba(2,6,23,0.82)]"
          onClick={(event) => event.stopPropagation()}
        >
          <div className="flex items-center justify-between gap-3 border-b border-border/80 px-5 py-4 dark:border-border-dark/80">
            <div className="min-w-0">
              <div className="flex items-center gap-2 text-[15px] font-semibold text-text dark:text-text-inv">
                <FileText size={16} className="text-primary" />
                <span>Agent Context</span>
              </div>
              <p className="truncate text-[12px] text-slate-500 dark:text-slate-400">{agentName}</p>
            </div>
            <div className="flex items-center gap-1">
              <button
                type="button"
                onClick={onRefresh}
                className="flex h-9 w-9 items-center justify-center rounded-xl bg-slate-900/[0.04] text-slate-500 shadow-sm transition-colors hover:bg-slate-900/[0.08] hover:text-text dark:bg-white/[0.06] dark:text-slate-400 dark:hover:bg-white/[0.1] dark:hover:text-text-inv"
                aria-label="Refresh agent context"
              >
                <RefreshCw size={16} className={cn(isLoading && 'animate-spin')} />
              </button>
              <button
                type="button"
                onClick={onClose}
                className="flex h-9 w-9 items-center justify-center rounded-xl bg-slate-900/[0.04] text-slate-500 shadow-sm transition-colors hover:bg-slate-900/[0.08] hover:text-text dark:bg-white/[0.06] dark:text-slate-400 dark:hover:bg-white/[0.1] dark:hover:text-text-inv"
                aria-label="Close context viewer"
              >
                <X size={18} />
              </button>
            </div>
          </div>

          {files.length > 0 && (
            <div className="border-b border-border/80 px-3 py-3 dark:border-border-dark/80">
              <div className="flex gap-2 overflow-x-auto scrollbar-hide">
                {files.map((file) => (
                  <button
                    key={file.name}
                    type="button"
                    onClick={() => setActiveFileName(file.name)}
                    className={cn(
                      'shrink-0 rounded-full border px-3 py-1.5 text-[12px] font-medium shadow-sm transition-colors',
                      activeFile?.name === file.name
                        ? 'border-primary/30 bg-primary/10 text-primary'
                        : 'border-border/80 bg-white text-slate-600 hover:border-primary/20 hover:text-text dark:border-border-dark/80 dark:bg-white/[0.04] dark:text-slate-300 dark:hover:text-text-inv'
                    )}
                  >
                    {formatTabLabel(file.name)}
                  </button>
                ))}
              </div>
            </div>
          )}

          <div className="min-h-0 flex-1 overflow-y-auto px-5 py-4">
            {isLoading && files.length === 0 ? (
              <div className="flex h-full min-h-[240px] flex-col items-center justify-center text-center">
                <Loader2 size={24} className="mb-3 animate-spin text-primary" />
                <p className="text-[13px] text-text/45 dark:text-text-inv/45">Loading agent context…</p>
              </div>
            ) : activeFile ? (
              <div className="space-y-3">
                {activeFile.updatedAt && (
                  <div className="inline-flex items-center gap-1.5 rounded-full border border-border/70 bg-white px-3 py-1 text-[11px] font-medium text-slate-500 shadow-sm dark:border-border-dark/70 dark:bg-white/[0.04] dark:text-slate-400">
                    <Clock3 size={12} />
                    <span>{formatUpdatedAt(activeFile.updatedAt)}</span>
                  </div>
                )}
                <div className="rounded-[22px] border border-border/70 bg-slate-50/92 p-4 shadow-[0_16px_30px_-26px_rgba(15,23,42,0.22)] dark:border-border-dark/70 dark:bg-[#141b24] dark:shadow-[0_18px_32px_-26px_rgba(2,6,23,0.68)]">
                  <MarkdownRenderer content={activeFile.content} className="text-[14px]" />
                </div>
              </div>
            ) : (
              <div className="flex h-full min-h-[240px] flex-col items-center justify-center text-center">
                <div className="mb-4 flex h-14 w-14 items-center justify-center rounded-full bg-primary/10 text-primary dark:bg-primary/15">
                  <FileText size={22} />
                </div>
                <p className="text-[15px] font-medium text-text dark:text-text-inv">No context files yet</p>
                <p className="mt-1 max-w-[260px] text-[13px] text-text/45 dark:text-text-inv/45">
                  Request a fresh snapshot to inspect the active agent&apos;s markdown context files.
                </p>
              </div>
            )}
          </div>

          {context?.timestamp ? (
            <div className="flex items-center justify-end gap-1.5 border-t border-border/70 px-5 py-3 text-[11px] text-slate-500 dark:border-border-dark/70 dark:text-slate-400">
              <Clock3 size={12} />
              <span>Snapshot: {new Date(context.timestamp).toLocaleTimeString()}</span>
            </div>
          ) : null}
        </motion.div>
      </div>
    </>
  );
}
