import { memo } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { Plus, X, MessageSquare, Loader2 } from 'lucide-react';
import { cn } from '../../lib/utils';
import { formatRelativeTime } from './utils';
import type { AgentInfo } from './types';

export interface ConversationItem {
  chatId: string;
  title?: string;
  lastMessage?: string;
  lastContent?: string;
  timestamp?: number;
  lastTimestamp?: number;
}

interface HistoryDrawerProps {
  isOpen: boolean;
  isDesktop?: boolean;
  loading: boolean;
  conversations: ConversationItem[];
  currentChatId?: string | null;
  agentName?: string;
  onClose: () => void;
  onNewConversation: () => void;
  onSwitchConversation: (chatId: string) => void;
}

function HistoryDrawerInner({
  isOpen, isDesktop, loading, conversations, currentChatId,
  agentName, onClose, onNewConversation, onSwitchConversation,
}: HistoryDrawerProps) {
  return (
    <AnimatePresence>
      {isOpen && (
        <>
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-30 bg-black/25 backdrop-blur-[2px]"
            onClick={onClose}
          />
          <motion.div
            initial={isDesktop ? { opacity: 0, x: 32 } : { opacity: 0, y: 32 }}
            animate={isDesktop ? { opacity: 1, x: 0 } : { opacity: 1, y: 0 }}
            exit={isDesktop ? { opacity: 0, x: 32 } : { opacity: 0, y: 32 }}
            transition={{ type: 'spring', stiffness: 320, damping: 30 }}
            className={cn(
              'fixed z-40 border border-border/75 bg-white/96 shadow-[0_30px_60px_-28px_rgba(15,23,42,0.4)] backdrop-blur-xl dark:border-border-dark/75 dark:bg-card-alt/96 dark:shadow-[0_30px_60px_-28px_rgba(2,6,23,0.82)]',
              isDesktop
                ? 'top-0 right-0 h-full w-[360px] max-w-[88vw] rounded-l-[28px]'
                : 'left-0 right-0 bottom-0 max-h-[78vh] rounded-t-[28px]'
            )}
          >
            <div className="flex items-center justify-between border-b border-border/70 px-5 py-4 dark:border-border-dark/70">
              <div>
                <h3 className="text-[15px] font-semibold text-text dark:text-text-inv">Conversation History</h3>
                <p className="text-[12px] text-slate-500 dark:text-slate-400">{agentName || 'Agent'}</p>
              </div>
              <div className="flex items-center gap-1">
                <motion.button
                  whileTap={{ scale: 0.9 }}
                  onClick={onNewConversation}
                  className="rounded-xl bg-primary/10 p-2 text-primary shadow-sm transition-colors hover:bg-primary/15"
                  title="New conversation"
                >
                  <Plus size={18} />
                </motion.button>
                <motion.button whileTap={{ scale: 0.9 }} onClick={onClose} className="rounded-xl bg-slate-900/[0.04] p-2 text-slate-500 shadow-sm transition-colors hover:bg-slate-900/[0.08] hover:text-text dark:bg-white/[0.06] dark:text-slate-400 dark:hover:bg-white/[0.1] dark:hover:text-text-inv">
                  <X size={18} />
                </motion.button>
              </div>
            </div>

            <div className="overflow-y-auto p-3 space-y-2 max-h-[calc(78vh-76px)] md:max-h-[calc(100vh-76px)]">
              {loading ? (
                <div className="flex flex-col items-center justify-center py-16">
                  <Loader2 size={24} className="text-primary animate-spin mb-3" />
                  <p className="text-[13px] text-text/40 dark:text-text-inv/40">Loading conversations…</p>
                </div>
              ) : conversations.length > 0 ? conversations.map((conversation) => (
                <button
                  key={conversation.chatId}
                  type="button"
                  onClick={() => onSwitchConversation(conversation.chatId)}
                  className={cn(
                    'w-full rounded-[20px] border px-4 py-3 text-left shadow-[0_16px_28px_-26px_rgba(15,23,42,0.28)] transition-colors',
                    currentChatId === conversation.chatId
                      ? 'border-primary/25 bg-primary/7 dark:bg-primary/10'
                      : 'border-border/70 bg-white/78 hover:border-primary/20 hover:bg-white dark:border-border-dark/70 dark:bg-white/[0.04] dark:hover:bg-white/[0.07]'
                  )}
                >
                  <div className="flex items-center justify-between gap-3 mb-1">
                    <p className="truncate text-[14px] font-medium text-text dark:text-text-inv">{conversation.title || conversation.lastMessage || conversation.lastContent || conversation.chatId}</p>
                    {(conversation.timestamp || conversation.lastTimestamp) && (
                      <span className="shrink-0 text-[11px] font-normal text-slate-400 dark:text-slate-500">
                        {formatRelativeTime((conversation.timestamp || conversation.lastTimestamp)!)}
                      </span>
                    )}
                  </div>
                  <p className="line-clamp-2 text-[12px] text-slate-500 dark:text-slate-400">
                    {conversation.lastMessage || conversation.lastContent || 'No messages yet'}
                  </p>
                </button>
              )) : (
                <div className="flex flex-col items-center justify-center text-center py-16 px-6">
                  <div className="w-14 h-14 rounded-full bg-primary/10 dark:bg-primary/15 flex items-center justify-center mb-4">
                    <MessageSquare size={22} className="text-primary" />
                  </div>
                  <p className="text-[15px] font-medium text-text dark:text-text-inv mb-1">No saved conversations</p>
                  <p className="text-[13px] text-text/40 dark:text-text-inv/40">This agent has no conversation history yet.</p>
                </div>
              )}
            </div>
          </motion.div>
        </>
      )}
    </AnimatePresence>
  );
}

export const HistoryDrawer = memo(HistoryDrawerInner);
