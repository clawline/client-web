import { memo } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { FileText, Puzzle } from 'lucide-react';
import { CONTEXT_SUGGESTIONS, QUICK_COMMANDS } from './utils';
import type { Message } from './types';

interface SuggestionBarProps {
  messages: Message[];
  isThinking: boolean;
  showSlashMenu: boolean;
  showEmojiPicker: boolean;
  skillCount: number;
  onOpenSlashMenu: () => void;
  onOpenContextViewer: () => void;
  onSetInputValue: (value: string) => void;
  onQuickSend: (text: string) => void;
}

function SuggestionBarInner({
  messages, isThinking, showSlashMenu, showEmojiPicker, skillCount,
  onOpenSlashMenu, onOpenContextViewer, onSetInputValue, onQuickSend,
}: SuggestionBarProps) {
  if (showSlashMenu || showEmojiPicker) return null;

  const lastMsg = messages.length > 0 ? messages[messages.length - 1] : null;
  const isLastAi = lastMsg?.sender === 'ai';
  const isLastUser = !lastMsg || lastMsg.sender === 'user';
  const waitingTooLong = isLastUser && lastMsg?.timestamp && (Date.now() - (lastMsg.timestamp || 0)) > 120000 && !isThinking;

  return (
    <AnimatePresence mode="popLayout">
      {isLastAi && (
        <motion.div
          key="ctx-suggestions"
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: 10 }}
          className="flex items-center gap-1.5 overflow-x-auto px-0.5 scrollbar-hide"
        >
          <IconButtons skillCount={skillCount} onOpenSlashMenu={onOpenSlashMenu} onOpenContextViewer={onOpenContextViewer} />
          <div className="h-5 w-px bg-border dark:bg-border-dark mx-0.5 shrink-0" />
          {CONTEXT_SUGGESTIONS.map((sug) => (
            <motion.button
              key={sug.label}
              whileTap={{ scale: 0.95 }}
              onClick={() => onSetInputValue(sug.label)}
              className="flex-shrink-0 inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-[11px] font-medium text-text/60 dark:text-text-inv/55 hover:bg-text/5 dark:hover:bg-text-inv/5 active:bg-text/10 transition-colors"
            >
              <span>{sug.emoji}</span>
              {sug.label}
            </motion.button>
          ))}
        </motion.div>
      )}

      {isLastUser && (
        <motion.div
          key="quick-commands"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          className="flex items-center gap-1.5 overflow-x-auto px-0.5 scrollbar-hide"
        >
          <IconButtons skillCount={skillCount} onOpenSlashMenu={onOpenSlashMenu} onOpenContextViewer={onOpenContextViewer} />
          <div className="h-5 w-px bg-border dark:bg-border-dark mx-0.5 shrink-0" />
          {waitingTooLong && (
            <motion.button
              initial={{ opacity: 0, scale: 0.9 }}
              animate={{ opacity: 1, scale: 1 }}
              whileTap={{ scale: 0.95 }}
              onClick={() => {
                onQuickSend(`进度怎么样了？上次我说的是："${lastMsg?.text?.slice(0, 50) || ''}"`);
              }}
              className="flex-shrink-0 inline-flex items-center gap-1 px-3 py-1.5 bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-700/40 rounded-full text-[12px] font-medium text-amber-600 dark:text-amber-400 active:bg-amber-100 transition-colors animate-pulse"
            >
              <span>👋</span>
              催一下
            </motion.button>
          )}
          {QUICK_COMMANDS.map((cmd) => (
            <motion.button
              key={cmd.label}
              whileTap={{ scale: 0.95 }}
              onClick={() => onQuickSend(cmd.label)}
              className="flex-shrink-0 inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-[11px] font-medium text-text/60 dark:text-text-inv/55 hover:bg-text/5 dark:hover:bg-text-inv/5 active:bg-text/10 transition-colors"
            >
              <span>{cmd.emoji}</span>
              {cmd.label}
            </motion.button>
          ))}
        </motion.div>
      )}
    </AnimatePresence>
  );
}

/** Shared icon buttons for Skills + Context */
function IconButtons({ skillCount, onOpenSlashMenu, onOpenContextViewer }: {
  skillCount: number;
  onOpenSlashMenu: () => void;
  onOpenContextViewer: () => void;
}) {
  return (
    <>
      <motion.button
        whileTap={{ scale: 0.95 }}
        onClick={onOpenSlashMenu}
        className="flex-shrink-0 inline-flex items-center gap-1 w-7 h-7 justify-center bg-primary/12 border border-primary/20 rounded-full text-primary transition-colors active:bg-primary/20"
        title={`Skills (${skillCount})`}
      >
        <Puzzle size={15} />
      </motion.button>
      <motion.button
        whileTap={{ scale: 0.95 }}
        onClick={onOpenContextViewer}
        className="flex-shrink-0 inline-flex items-center justify-center w-7 h-7 bg-primary/12 border border-primary/20 rounded-full text-primary transition-colors active:bg-primary/20"
        title="Context"
      >
        <FileText size={15} />
      </motion.button>
    </>
  );
}

export const SuggestionBar = memo(SuggestionBarInner);
