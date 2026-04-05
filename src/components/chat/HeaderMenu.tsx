import { memo } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { MessageSquare, Paperclip, Cpu, Trash2 } from 'lucide-react';

interface HeaderMenuProps {
  isOpen: boolean;
  onClose: () => void;
  onOpenHistory: () => void;
  onOpenFiles: () => void;
  onOpenMemory: () => void;
  onClearChat: () => void;
}

function HeaderMenuInner({
  isOpen, onClose, onOpenHistory, onOpenFiles, onOpenMemory, onClearChat,
}: HeaderMenuProps) {
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
            className="absolute top-[48px] right-4 z-40 min-w-[180px] rounded-2xl border border-border/75 bg-white/96 p-1.5 shadow-[0_24px_48px_-26px_rgba(15,23,42,0.38)] backdrop-blur-xl dark:border-border-dark/75 dark:bg-card-alt/96 dark:shadow-[0_24px_48px_-26px_rgba(2,6,23,0.76)]"
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
            <button
              onClick={onOpenMemory}
              className="flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-left text-[14px] text-text transition-colors hover:bg-slate-50 dark:text-text-inv dark:hover:bg-white/[0.05]"
            >
              <Cpu size={16} />
              View Memory
            </button>
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
