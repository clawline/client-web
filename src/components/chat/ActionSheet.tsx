import { memo } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { SmilePlus, CornerDownLeft, Copy, Pencil, Trash2, MessageSquarePlus } from 'lucide-react';
import type { Message } from './types';
import { formatTime } from './utils';

interface ActionSheetProps {
  longPressedMsgId: string | null;
  messages: Message[];
  onClose: () => void;
  onReply: (msg: Message) => void;
  onCopy: (id: string, text: string) => void;
  onEdit: (msg: Message) => void;
  onDelete: (id: string) => void;
  onReactionToggle: (msgId: string, emoji: string, hasIt: boolean) => void;
  onOpenReactionPicker: (msgId: string) => void;
  onCreateThread?: (messageId: string) => void;
}

function ActionSheetInner({
  longPressedMsgId, messages, onClose, onReply, onCopy, onEdit, onDelete,
  onReactionToggle, onOpenReactionPicker, onCreateThread,
}: ActionSheetProps) {
  if (!longPressedMsgId) return null;

  const lMsg = messages.find(m => m.id === longPressedMsgId);
  if (!lMsg) return null;
  const lIsUser = lMsg.sender === 'user';

  return (
    <AnimatePresence>
      {longPressedMsgId && (
        <>
          {/* Full-screen backdrop — z-[60] to cover everything including input bar */}
          <motion.div
            initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
            className="fixed inset-0 bg-black/40 backdrop-blur-sm z-[60] md:hidden"
            onClick={onClose}
          />
          {/* Floating message preview + emoji bar */}
          <motion.div
            initial={{ opacity: 0, scale: 0.92 }}
            animate={{ opacity: 1, scale: 1 }}
            exit={{ opacity: 0, scale: 0.92 }}
            transition={{ type: 'spring', stiffness: 400, damping: 28 }}
            className="fixed inset-x-4 top-[15vh] z-[60] md:hidden flex flex-col items-center"
          >
            {/* Emoji reaction bar */}
            <motion.div
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 0.05 }}
              className="flex items-center gap-1 bg-white dark:bg-[#1f2c34] rounded-full px-2 py-1.5 shadow-xl mb-2 border border-border/40 dark:border-transparent"
            >
              {['👍', '❤️', '😂', '😮', '😢', '🙏', '👏'].map((e) => (
                <motion.button
                  key={e}
                  whileTap={{ scale: 0.75 }}
                  onClick={() => {
                    onReactionToggle(longPressedMsgId, e, !!lMsg.reactions?.includes(e));
                    onClose();
                  }}
                  className={`w-10 h-10 text-[22px] flex items-center justify-center rounded-full transition-all ${
                    lMsg.reactions?.includes(e) ? 'bg-primary/15 dark:bg-white/20 scale-110' : 'hover:bg-text/5 dark:hover:bg-white/10'
                  }`}
                >
                  {e}
                </motion.button>
              ))}
              <motion.button
                whileTap={{ scale: 0.85 }}
                onClick={() => { onOpenReactionPicker(longPressedMsgId); onClose(); }}
                className="w-10 h-10 flex items-center justify-center rounded-full text-text/40 dark:text-white/60 hover:bg-text/5 dark:hover:bg-white/10"
              >
                <SmilePlus size={18} />
              </motion.button>
            </motion.div>

            {/* Message preview bubble */}
            <div className={`max-w-[85%] ${lIsUser ? 'self-end' : 'self-start'}`}>
              <div className={`px-4 py-3 rounded-[18px] text-[15px] leading-relaxed shadow-lg ${
                lIsUser
                  ? 'bg-primary text-white rounded-tr-[6px]'
                  : 'bg-white dark:bg-card-alt text-text dark:text-text-inv rounded-tl-[6px]'
              }`}>
                <p className="line-clamp-4">{lMsg.text}</p>
                {lMsg.timestamp && (
                  <span className={`text-[10px] float-right mt-1 ml-3 ${lIsUser ? 'text-white/60' : 'text-text/40 dark:text-text-inv/35'}`}>
                    {formatTime(lMsg.timestamp)}
                  </span>
                )}
              </div>
            </div>
          </motion.div>

          {/* Bottom action sheet — z-[60] above input bar */}
          <motion.div
            initial={{ opacity: 0, y: 100 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: 100 }}
            transition={{ type: 'spring', stiffness: 350, damping: 30 }}
            className="fixed bottom-0 left-0 right-0 z-[60] md:hidden bg-white dark:bg-[#1f2c34] rounded-t-2xl shadow-2xl safe-area-bottom border-t border-border/30 dark:border-transparent"
          >
            <div className="flex flex-col">
              <button
                onClick={() => { onReply(lMsg); onClose(); }}
                className="flex items-center gap-4 px-6 py-3.5 text-[16px] text-text/85 dark:text-white/90 active:bg-text/5 dark:active:bg-white/10 transition-colors"
              >
                <CornerDownLeft size={20} className="text-text/40 dark:text-white/60" />
                Reply
              </button>
              {/* Create Thread — only shown on non-thread-reply messages */}
              {!lMsg.threadId && onCreateThread && (
                <button
                  onClick={() => { onCreateThread(lMsg.id); onClose(); }}
                  className="flex items-center gap-4 px-6 py-3.5 text-[16px] text-text/85 dark:text-white/90 active:bg-text/5 dark:active:bg-white/10 transition-colors"
                >
                  <MessageSquarePlus size={20} className="text-text/40 dark:text-white/60" />
                  Create Thread
                </button>
              )}
              <button
                onClick={() => { onCopy(lMsg.id, lMsg.text); onClose(); }}
                className="flex items-center gap-4 px-6 py-3.5 text-[16px] text-text/85 dark:text-white/90 active:bg-text/5 dark:active:bg-white/10 transition-colors"
              >
                <Copy size={20} className="text-text/40 dark:text-white/60" />
                Copy
              </button>
              {lIsUser && (
                <>
                  <button
                    onClick={() => { onEdit(lMsg); onClose(); }}
                    className="flex items-center gap-4 px-6 py-3.5 text-[16px] text-text/85 dark:text-white/90 active:bg-text/5 dark:active:bg-white/10 transition-colors"
                  >
                    <Pencil size={20} className="text-text/40 dark:text-white/60" />
                    Edit
                  </button>
                  <button
                    onClick={() => { onDelete(lMsg.id); onClose(); }}
                    className="flex items-center gap-4 px-6 py-3.5 text-[16px] text-red-400 active:bg-white/10 transition-colors"
                  >
                    <Trash2 size={20} className="text-red-400/80" />
                    Delete
                  </button>
                </>
              )}
            </div>
          </motion.div>
        </>
      )}
    </AnimatePresence>
  );
}

export const ActionSheet = memo(ActionSheetInner);
