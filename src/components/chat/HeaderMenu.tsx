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
            className="absolute top-[48px] right-4 z-40 bg-white dark:bg-card-alt border border-border dark:border-border-dark rounded-2xl shadow-xl p-1.5 min-w-[180px]"
          >
            <button
              onClick={onOpenHistory}
              className="w-full flex items-center gap-3 px-3 py-2.5 rounded-xl text-left text-[14px] text-text dark:text-text-inv hover:bg-surface dark:hover:bg-surface-dark transition-colors"
            >
              <MessageSquare size={16} />
              Conversation History
            </button>
            <button
              onClick={onOpenFiles}
              className="w-full flex items-center gap-3 px-3 py-2.5 rounded-xl text-left text-[14px] text-text dark:text-text-inv hover:bg-surface dark:hover:bg-surface-dark transition-colors"
            >
              <Paperclip size={16} />
              Files &amp; Media
            </button>
            <button
              onClick={onOpenMemory}
              className="w-full flex items-center gap-3 px-3 py-2.5 rounded-xl text-left text-[14px] text-text dark:text-text-inv hover:bg-surface dark:hover:bg-surface-dark transition-colors"
            >
              <Cpu size={16} />
              View Memory
            </button>
            <button
              onClick={onClearChat}
              className="w-full flex items-center gap-3 px-3 py-2.5 rounded-xl text-left text-[14px] text-red-500 hover:bg-red-50 dark:hover:bg-red-900/20 transition-colors"
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
