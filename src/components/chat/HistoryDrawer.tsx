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
            className="fixed inset-0 z-30 bg-black/25"
            onClick={onClose}
          />
          <motion.div
            initial={isDesktop ? { opacity: 0, x: 32 } : { opacity: 0, y: 32 }}
            animate={isDesktop ? { opacity: 1, x: 0 } : { opacity: 1, y: 0 }}
            exit={isDesktop ? { opacity: 0, x: 32 } : { opacity: 0, y: 32 }}
            transition={{ type: 'spring', stiffness: 320, damping: 30 }}
            className={cn(
              'fixed z-40 bg-white dark:bg-card-alt shadow-2xl border border-border dark:border-border-dark',
              isDesktop
                ? 'top-0 right-0 h-full w-[360px] max-w-[88vw] rounded-l-[28px]'
                : 'left-0 right-0 bottom-0 max-h-[78vh] rounded-t-[28px]'
            )}
          >
            <div className="flex items-center justify-between px-5 py-4 border-b border-border dark:border-border-dark">
              <div>
                <h3 className="text-[15px] font-semibold">Conversation History</h3>
                <p className="text-[12px] text-text/45 dark:text-text-inv/45">{agentName || 'Agent'}</p>
              </div>
              <div className="flex items-center gap-1">
                <motion.button
                  whileTap={{ scale: 0.9 }}
                  onClick={onNewConversation}
                  className="p-2 text-primary hover:bg-primary/10 rounded-full"
                  title="New conversation"
                >
                  <Plus size={18} />
                </motion.button>
                <motion.button whileTap={{ scale: 0.9 }} onClick={onClose} className="p-2 text-text/55 dark:text-text-inv/55">
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
                    'w-full text-left rounded-[20px] border px-4 py-3 transition-colors',
                    currentChatId === conversation.chatId
                      ? 'border-primary bg-primary/5 dark:bg-primary/10'
                      : 'border-border/70 dark:border-border-dark/70 hover:border-primary/30'
                  )}
                >
                  <div className="flex items-center justify-between gap-3 mb-1">
                    <p className="font-medium text-[14px] truncate">{conversation.title || conversation.lastMessage || conversation.lastContent || conversation.chatId}</p>
                    {(conversation.timestamp || conversation.lastTimestamp) && (
                      <span className="text-[11px] text-text/40 dark:text-text-inv/40 shrink-0">
                        {formatRelativeTime((conversation.timestamp || conversation.lastTimestamp)!)}
                      </span>
                    )}
                  </div>
                  <p className="text-[12px] text-text/45 dark:text-text-inv/45 line-clamp-2">
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
