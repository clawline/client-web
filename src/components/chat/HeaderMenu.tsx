import { memo, useEffect, useState } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { MessageSquare, Paperclip, Cpu, Trash2, Columns2, Brain, ChevronRight, Info } from 'lucide-react';
import { cn } from '../../lib/utils';

interface HeaderMenuProps {
  isOpen: boolean;
  onClose: () => void;
  onOpenHistory: () => void;
  onOpenFiles: () => void;
  onOpenMemory: () => void;
  onOpenAgentDetail: () => void;
  onClearChat: () => void;
  showSplitOption?: boolean;
  splitActive?: boolean;
  onToggleSplit?: () => void;
  onSendCommand?: (cmd: string) => void;
  thinkLevel?: string;
}

const THINK_OPTIONS = ['off', 'low', 'medium', 'high'] as const;

function HeaderMenuInner({
  isOpen,
  onClose,
  onOpenHistory,
  onOpenFiles,
  onOpenMemory,
  onOpenAgentDetail,
  onClearChat,
  showSplitOption = false,
  splitActive = false,
  onToggleSplit,
  onSendCommand,
  thinkLevel = 'off',
}: HeaderMenuProps) {
  const [showThinkOptions, setShowThinkOptions] = useState(false);

  useEffect(() => {
    if (!isOpen) {
      setShowThinkOptions(false);
    }
  }, [isOpen]);

  return (
    <AnimatePresence>
      {isOpen && (
        <>
          <motion.div
            initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
            className="fixed inset-0 z-30"
            onClick={onClose}
          />
          <motion.div
            initial={{ opacity: 0, y: -10, scale: 0.95 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: -10, scale: 0.95 }}
            className="fixed right-4 z-40 min-w-[180px] rounded-2xl border border-border/75 bg-white/96 p-1.5 shadow-[0_24px_48px_-26px_rgba(15,23,42,0.38)] backdrop-blur-xl dark:border-border-dark/75 dark:bg-card-alt/96 dark:shadow-[0_24px_48px_-26px_rgba(2,6,23,0.76)]"
            style={{ top: 'calc(env(safe-area-inset-top, 0px) + 56px)' }}
          >
            <button
              onClick={onOpenHistory}
              className="flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-left text-[14px] text-text transition-colors hover:bg-slate-50 dark:text-text-inv dark:hover:bg-white/[0.05]"
            >
              <MessageSquare size={16} />
              Conversation History
            </button>
            <button
              onClick={onOpenFiles}
              className="flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-left text-[14px] text-text transition-colors hover:bg-slate-50 dark:text-text-inv dark:hover:bg-white/[0.05]"
            >
              <Paperclip size={16} />
              Files &amp; Media
            </button>
            {showSplitOption && onToggleSplit && (
              <button
                onClick={() => {
                  onToggleSplit();
                  onClose();
                }}
                className={cn(
                  'flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-left text-[14px] transition-colors hover:bg-slate-50 dark:hover:bg-white/[0.05]',
                  splitActive ? 'text-primary dark:text-primary' : 'text-text dark:text-text-inv'
                )}
              >
                <Columns2 size={16} />
                Split View
              </button>
            )}
            <button
              onClick={onOpenMemory}
              className="flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-left text-[14px] text-text transition-colors hover:bg-slate-50 dark:text-text-inv dark:hover:bg-white/[0.05]"
            >
              <Cpu size={16} />
              View Memory
            </button>
            <button
              onClick={onOpenAgentDetail}
              className="flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-left text-[14px] text-text transition-colors hover:bg-slate-50 dark:text-text-inv dark:hover:bg-white/[0.05]"
            >
              <Info size={16} />
              Agent Info
            </button>
            <div className="mt-0.5">
              <button
                onClick={() => setShowThinkOptions((prev) => !prev)}
                className="flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-left text-[14px] text-text transition-colors hover:bg-slate-50 dark:text-text-inv dark:hover:bg-white/[0.05]"
              >
                <Brain size={16} />
                <span className="flex-1">Thinking Mode</span>
                <span className="text-[11px] font-medium uppercase tracking-[0.08em] text-text/40 dark:text-text-inv/40">
                  {thinkLevel}
                </span>
                <ChevronRight
                  size={14}
                  className={cn('transition-transform duration-200', showThinkOptions && 'rotate-90')}
                />
              </button>
              <AnimatePresence initial={false}>
                {showThinkOptions && (
                  <motion.div
                    initial={{ height: 0, opacity: 0 }}
                    animate={{ height: 'auto', opacity: 1 }}
                    exit={{ height: 0, opacity: 0 }}
                    className="overflow-hidden"
                  >
                    <div className="space-y-0.5 px-2 pb-1 pl-9">
                      {THINK_OPTIONS.map((level) => {
                        const active = thinkLevel === level;
                        return (
                          <button
                            key={level}
                            onClick={() => {
                              onSendCommand?.(`/think ${level}`);
                              onClose();
                            }}
                            className={cn(
                              'flex w-full items-center gap-2 rounded-xl px-3 py-2 text-left text-[13px] transition-colors hover:bg-slate-50 dark:hover:bg-white/[0.05]',
                              active ? 'text-primary dark:text-primary' : 'text-text/70 dark:text-text-inv/70'
                            )}
                          >
                            <span
                              className={cn(
                                'h-2 w-2 rounded-full border border-current/15',
                                active ? 'bg-primary border-primary' : 'bg-transparent'
                              )}
                            />
                            <span className="capitalize">{level}</span>
                          </button>
                        );
                      })}
                    </div>
                  </motion.div>
                )}
              </AnimatePresence>
            </div>
            <button
              onClick={onClearChat}
              className="flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-left text-[14px] text-red-500 transition-colors hover:bg-red-50 dark:hover:bg-red-900/20"
            >
              <Trash2 size={16} />
              Clear Chat
            </button>
          </motion.div>
        </>
      )}
    </AnimatePresence>
  );
}

export const HeaderMenu = memo(HeaderMenuInner);
