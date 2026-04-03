import { memo, useState, useEffect, useRef } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { FileText, Puzzle, Sparkles } from 'lucide-react';
import { QUICK_COMMANDS } from './utils';
import { getSuggestions, isSuggestionServiceAvailable, clearSuggestionCache } from '../../services/suggestions';
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
  const [aiSuggestions, setAiSuggestions] = useState<string[]>([]);
  const [loading, setLoading] = useState(false);
  const abortRef = useRef<AbortController | null>(null);
  const prevMsgCountRef = useRef(0);

  const lastMsg = messages.length > 0 ? messages[messages.length - 1] : null;
  const isLastAi = lastMsg?.sender === 'ai';
  const isLastUser = !lastMsg || lastMsg.sender === 'user';
  const waitingTooLong = isLastUser && lastMsg?.timestamp && (Date.now() - (lastMsg.timestamp || 0)) > 120000 && !isThinking;

  // Fetch AI suggestions when last message is from AI
  useEffect(() => {
    if (!isLastAi || isThinking || !isSuggestionServiceAvailable()) {
      return;
    }

    // Only refetch when message count changes (new AI reply arrived)
    if (messages.length === prevMsgCountRef.current) return;
    prevMsgCountRef.current = messages.length;

    // Cancel previous request
    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;

    setLoading(true);

    // Small delay to avoid firing during rapid streaming
    const timer = setTimeout(() => {
      getSuggestions(messages, controller.signal)
        .then(suggestions => {
          if (!controller.signal.aborted) {
            setAiSuggestions(suggestions);
          }
        })
        .finally(() => {
          if (!controller.signal.aborted) {
            setLoading(false);
          }
        });
    }, 500);

    return () => {
      clearTimeout(timer);
      controller.abort();
    };
  }, [messages.length, isLastAi, isThinking]);

  // Clear suggestions on conversation reset
  useEffect(() => {
    if (messages.length === 0) {
      setAiSuggestions([]);
      clearSuggestionCache();
      prevMsgCountRef.current = 0;
    }
  }, [messages.length]);

  // Early return AFTER all hooks to comply with Rules of Hooks
  if (showSlashMenu || showEmojiPicker) return null;

  return (
    <AnimatePresence mode="popLayout">
      {isLastAi && (
        <motion.div
          key="ai-suggestions"
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: 10 }}
          className="flex items-center gap-1.5 overflow-x-auto px-0.5 scrollbar-hide"
        >
          <IconButtons skillCount={skillCount} onOpenSlashMenu={onOpenSlashMenu} onOpenContextViewer={onOpenContextViewer} />
          <div className="h-5 w-px bg-border dark:bg-border-dark mx-0.5 shrink-0" />

          {/* AI-generated suggestions */}
          {aiSuggestions.length > 0 && aiSuggestions.map((sug, i) => (
            <motion.button
              key={`ai-${i}-${sug}`}
              initial={{ opacity: 0, scale: 0.9 }}
              animate={{ opacity: 1, scale: 1 }}
              transition={{ delay: i * 0.05 }}
              whileTap={{ scale: 0.95 }}
              onClick={() => onSetInputValue(sug)}
              className="flex-shrink-0 inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-[11px] font-medium text-text/60 dark:text-text-inv/55 hover:bg-text/5 dark:hover:bg-text-inv/5 active:bg-text/10 transition-colors border border-transparent hover:border-border/30 dark:hover:border-border-dark/30"
            >
              {sug}
            </motion.button>
          ))}

          {/* Loading state */}
          {loading && aiSuggestions.length === 0 && (
            <span className="flex items-center gap-1 text-[11px] text-text/30 dark:text-text-inv/25 px-2">
              <Sparkles size={11} className="animate-pulse" />
            </span>
          )}

          {/* Fallback when AI suggestions not available */}
          {!loading && aiSuggestions.length === 0 && !isSuggestionServiceAvailable() && (
            <>
              {FALLBACK_SUGGESTIONS.map((sug) => (
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
            </>
          )}
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

/** Fallback static suggestions when AI service is not configured */
const FALLBACK_SUGGESTIONS = [
  { label: 'Explain more', emoji: '💡' },
  { label: 'Summarize', emoji: '📝' },
  { label: 'Try again', emoji: '🔄' },
];

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
