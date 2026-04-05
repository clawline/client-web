import { memo, useState, useEffect, useRef, useCallback } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { FileText, Puzzle, Sparkles } from 'lucide-react';
import { QUICK_COMMANDS } from './utils';
import { requestSuggestions } from '../../services/clawChannel';
import { getSuggestions, isSuggestionServiceAvailable, clearSuggestionCache } from '../../services/suggestions';
import type { Message } from './types';

/** Hook for long-press detection (800ms) */
function useLongPress(onLongPress: () => void, onClick: () => void, ms = 800) {
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const firedRef = useRef(false);
  const onStart = useCallback(() => {
    firedRef.current = false;
    timerRef.current = setTimeout(() => { firedRef.current = true; onLongPress(); }, ms);
  }, [onLongPress, ms]);
  const onEnd = useCallback(() => {
    if (timerRef.current) { clearTimeout(timerRef.current); timerRef.current = null; }
    if (!firedRef.current) onClick();
  }, [onClick]);
  const onCancel = useCallback(() => {
    if (timerRef.current) { clearTimeout(timerRef.current); timerRef.current = null; }
  }, []);
  return { onTouchStart: onStart, onTouchEnd: onEnd, onTouchCancel: onCancel, onMouseDown: onStart, onMouseUp: onEnd, onMouseLeave: onCancel };
}

interface SuggestionBarProps {
  messages: Message[];
  isThinking: boolean;
  showSlashMenu: boolean;
  showEmojiPicker: boolean;
  skillCount: number;
  connectionId?: string;
  onOpenSlashMenu: () => void;
  onOpenContextViewer: () => void;
  onSetInputValue: (value: string) => void;
  onQuickSend: (text: string) => void;
}

/** Detect language from recent messages — if majority are CJK, use Chinese fallback */
function detectLanguage(messages: Message[]): 'zh' | 'en' {
  const recent = messages.slice(-4);
  const text = recent.map(m => m.text || '').join('');
  const cjkCount = (text.match(/[\u4e00-\u9fff\u3000-\u303f\uff00-\uffef]/g) || []).length;
  return cjkCount > text.length * 0.15 ? 'zh' : 'en';
}

function SuggestionBarInner({
  messages, isThinking, showSlashMenu, showEmojiPicker, skillCount,
  connectionId,
  onOpenSlashMenu, onOpenContextViewer, onSetInputValue, onQuickSend,
}: SuggestionBarProps) {
  const [aiSuggestions, setAiSuggestions] = useState<string[]>([]);
  const [loading, setLoading] = useState(false);
  const abortRef = useRef<AbortController | null>(null);

  const lastMsg = messages.length > 0 ? messages[messages.length - 1] : null;
  const isFreshChat = messages.length === 0;
  const isLastAi = lastMsg?.sender === 'ai';
  const isLastUser = lastMsg?.sender === 'user';
  const waitingTooLong = isLastUser && lastMsg?.timestamp && (Date.now() - (lastMsg.timestamp || 0)) > 120000 && !isThinking;

  const lang = detectLanguage(messages);

  // On-demand AI suggestion fetch — only triggered by button click
  const fetchAiSuggestions = useCallback(async () => {
    if (loading) return;

    // Cancel previous request
    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;
    setLoading(true);

    const conversationMsgs = messages
      .filter(m => m.text && m.text.length > 0)
      .slice(-6)
      .map(m => ({
        role: m.sender === 'user' ? 'user' : 'assistant',
        text: m.text!,
      }));

    if (conversationMsgs.length === 0) {
      setLoading(false);
      return;
    }

    // Try 1: WS server-side suggestions (no API key needed on client)
    try {
      const wsSuggestions = await requestSuggestions(conversationMsgs, connectionId);
      if (!controller.signal.aborted && wsSuggestions.length > 0) {
        setAiSuggestions(wsSuggestions);
        setLoading(false);
        return;
      }
    } catch {
      // WS not available, fall through
    }

    // Try 2: Local API key (localStorage config)
    if (isSuggestionServiceAvailable()) {
      try {
        const localSuggestions = await getSuggestions(messages, controller.signal);
        if (!controller.signal.aborted && localSuggestions.length > 0) {
          setAiSuggestions(localSuggestions);
          setLoading(false);
          return;
        }
      } catch {
        // Local API failed, fall through
      }
    }

    // Both failed
    if (!controller.signal.aborted) {
      setAiSuggestions([]);
      setLoading(false);
    }
  }, [messages, connectionId, loading]);

  // Clear suggestions on conversation reset
  useEffect(() => {
    if (messages.length === 0) {
      setAiSuggestions([]);
      clearSuggestionCache();
    }
  }, [messages.length]);

  // Clear AI suggestions when a new message arrives (user types something)
  useEffect(() => {
    setAiSuggestions([]);
  }, [messages.length]);

  // Cleanup on unmount
  useEffect(() => {
    return () => { abortRef.current?.abort(); };
  }, []);

  // Hide content when slash menu / emoji picker is open, but keep icon buttons visible
  // so users can always tap them without waiting for AnimatePresence re-entry animation.
  const hideContent = showSlashMenu || showEmojiPicker;

  return (
    <div className="flex items-center gap-1.5 px-0.5">
      {/* Fixed left icons — always visible, never hidden by slash menu */}
      <div className="flex items-center gap-1.5 shrink-0">
        <IconButtons skillCount={skillCount} onOpenSlashMenu={onOpenSlashMenu} onOpenContextViewer={onOpenContextViewer} />
      </div>

      <AnimatePresence mode="popLayout">
      {!hideContent && isFreshChat && (
        <motion.div
          key="fresh-chat"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          className="flex-1"
        />
      )}

      {!hideContent && isLastAi && (
        <motion.div
          key="ai-suggestions"
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: 10 }}
          className="flex items-center gap-1.5 flex-1 min-w-0"
        >
          <div className="h-5 w-px bg-border dark:bg-border-dark mx-0.5 shrink-0" />

          {/* Scrollable suggestion area */}
          <div className="flex-1 overflow-x-auto scrollbar-hide">
            <div className="flex items-center gap-1.5">
              {/* AI sparkle button — click to generate suggestions */}
              {aiSuggestions.length === 0 && !loading && (
                <motion.button
                  whileTap={{ scale: 0.9 }}
                  onClick={fetchAiSuggestions}
                  className="flex-shrink-0 inline-flex items-center gap-1 rounded-full border border-primary/20 bg-primary/6 px-2.5 py-1 text-[11px] font-medium text-primary/80 transition-colors hover:bg-primary/10 hover:text-primary active:bg-primary/15"
                  title={lang === 'zh' ? 'AI 智能建议' : 'AI suggestions'}
                >
                  <Sparkles size={12} />
                  <span>{lang === 'zh' ? '建议' : 'Suggest'}</span>
                </motion.button>
              )}

              {/* Loading state */}
              {loading && aiSuggestions.length === 0 && (
                <span className="flex items-center gap-1 px-2 text-[11px] text-slate-400 dark:text-slate-500">
                  <Sparkles size={11} className="animate-pulse text-primary/50" />
                  <span>{lang === 'zh' ? '生成中…' : 'Thinking…'}</span>
                </span>
              )}

              {/* AI-generated suggestions */}
              {aiSuggestions.length > 0 && aiSuggestions.map((sug, i) => (
                <SuggestionPill
                  key={`ai-${i}-${sug}`}
                  text={sug}
                  delay={i * 0.05}
                  onTap={() => onSetInputValue(sug)}
                  onLongPress={() => onQuickSend(sug)}
                />
              ))}

              {/* Refresh button when suggestions are shown */}
              {aiSuggestions.length > 0 && !loading && (
                <motion.button
                  whileTap={{ scale: 0.9 }}
                  onClick={fetchAiSuggestions}
                  className="flex-shrink-0 inline-flex h-6 w-6 items-center justify-center rounded-full text-primary/40 transition-colors hover:bg-primary/8 hover:text-primary/70 active:bg-primary/15"
                  title={lang === 'zh' ? '换一批' : 'Refresh'}
                >
                  <Sparkles size={11} />
                </motion.button>
              )}
            </div>
          </div>

          <div className="h-5 w-px bg-border dark:bg-border-dark mx-0.5 shrink-0" />

          <div className="max-w-[44%] overflow-x-auto scrollbar-hide shrink-0">
            <div className="flex items-center gap-1">
              {QUICK_COMMANDS.map((cmd) => (
                <QuickCommandPill
                  key={cmd.label}
                  emoji={cmd.emoji}
                  label={cmd.label}
                  onTap={() => onSetInputValue(cmd.label)}
                  onLongPress={() => onQuickSend(cmd.label)}
                />
              ))}
            </div>
          </div>
        </motion.div>
      )}

      {!hideContent && isLastUser && waitingTooLong && (
        <motion.div
          key="nudge"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          className="flex items-center gap-1.5 flex-1 min-w-0"
        >
          <div className="h-5 w-px bg-border dark:bg-border-dark mx-0.5 shrink-0" />

          {/* Scrollable commands */}
          <div className="flex-1 overflow-x-auto scrollbar-hide">
            <div className="flex items-center gap-1.5">
              <motion.button
                initial={{ opacity: 0, scale: 0.9 }}
                animate={{ opacity: 1, scale: 1 }}
                whileTap={{ scale: 0.95 }}
                onClick={() => {
                  onQuickSend(`进度怎么样了？上次我说的是："${lastMsg?.text?.slice(0, 50) || ''}"`);
                }}
                className="status-breathe flex-shrink-0 inline-flex items-center gap-1 rounded-full border border-amber-300/60 bg-amber-100/85 px-3 py-1.5 text-[12px] font-medium text-amber-700 transition-colors active:bg-amber-100 dark:border-amber-700/40 dark:bg-amber-900/20 dark:text-amber-300"
              >
                <span className="text-[12px]">👋</span>
                催一下
              </motion.button>
            </div>
          </div>
        </motion.div>
      )}
    </AnimatePresence>
    </div>
  );
}

/** Suggestion pill — tap to fill input, long-press (800ms) to send directly */
function SuggestionPill({ text, delay = 0, onTap, onLongPress }: {
  text: string; delay?: number; onTap: () => void; onLongPress: () => void;
}) {
  const lp = useLongPress(onLongPress, onTap);
  return (
    <motion.button
      initial={{ opacity: 0, scale: 0.9 }}
      animate={{ opacity: 1, scale: 1 }}
      transition={{ delay }}
      whileTap={{ scale: 0.95 }}
      {...lp}
      className="flex-shrink-0 inline-flex items-center gap-1 rounded-full border border-transparent px-2.5 py-1 text-[11px] font-medium text-slate-600 transition-colors hover:border-border/40 hover:bg-slate-100 dark:text-slate-300 dark:hover:border-border-dark/40 dark:hover:bg-white/[0.06] select-none"
    >
      {text}
    </motion.button>
  );
}

/** Quick command pill — tap to fill input, long-press (800ms) to send directly */
function QuickCommandPill({ emoji, label, onTap, onLongPress }: {
  emoji: string; label: string; onTap: () => void; onLongPress: () => void;
}) {
  const lp = useLongPress(onLongPress, onTap);
  return (
    <motion.button
      whileTap={{ scale: 0.95 }}
      {...lp}
      className="flex-shrink-0 inline-flex items-center gap-1 rounded-full px-2.5 py-1 text-[11px] font-medium text-slate-600 transition-colors hover:bg-slate-100 dark:text-slate-300 dark:hover:bg-white/[0.06] select-none"
    >
      <span className="text-[12px] leading-none">{emoji}</span>
      {label}
    </motion.button>
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
      <button
        onPointerDown={(e) => { e.stopPropagation(); onOpenSlashMenu(); }}
        className="flex-shrink-0 inline-flex h-9 w-9 items-center justify-center rounded-full border border-primary/20 bg-primary/12 text-primary transition-colors active:scale-95 active:bg-primary/20"
        title={`Skills (${skillCount})`}
      >
        <Puzzle size={15} />
      </button>
      <button
        onPointerDown={(e) => { e.stopPropagation(); onOpenContextViewer(); }}
        className="flex-shrink-0 inline-flex h-9 w-9 items-center justify-center rounded-full border border-primary/20 bg-primary/12 text-primary transition-colors active:scale-95 active:bg-primary/20"
        title="Context"
      >
        <FileText size={15} />
      </button>
    </>
  );
}

export const SuggestionBar = memo(SuggestionBarInner);
