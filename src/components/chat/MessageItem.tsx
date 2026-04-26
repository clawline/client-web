import { memo, useCallback } from 'react';
import { motion } from 'motion/react';
import { FileText, User, SmilePlus, CornerDownLeft, Copy, Check, Pencil, Trash2, Zap, MessageSquarePlus, MessageSquare } from 'lucide-react';
import type { Message, AgentInfo } from './types';
import { DeliveryTicks } from './DeliveryTicks';
import { formatTime, formatDate, isDifferentDay, isGroupedWithPrev } from './utils';
import MarkdownRenderer from '../MarkdownRenderer';
import ActionCard from '../ActionCard';
import SlashResponseCard, { parseSlashResponse } from './SlashResponseCard';
import ApprovalCard, { parseApprovalMessage } from './ApprovalCard';
import { ThreadPreviewBar } from './ThreadPreviewBar';
import { useThreadStore } from '../../stores/threadStore';

/** Thread action button — uses store to check if thread exists, then opens or creates */
function ThreadHoverButton({ messageId, connectionId, onCreateThread }: {
  messageId: string;
  connectionId?: string;
  onCreateThread: (messageId: string) => void;
}) {
  const thread = useThreadStore((s) => {
    for (const t of s.threads.values()) {
      if (t.parentMessageId === messageId && t.status !== 'deleted') return t;
    }
    return null;
  });

  const handleClick = useCallback(() => {
    if (thread) {
      useThreadStore.getState().openThread(thread.id, connectionId);
    } else {
      onCreateThread(messageId);
    }
  }, [thread, connectionId, messageId, onCreateThread]);

  return (
    <button
      type="button"
      onClick={handleClick}
      className="w-7 h-7 flex items-center justify-center text-text/25 dark:text-text-inv/20 hover:text-primary hover:bg-primary/10 rounded-md transition-colors"
      title={thread ? 'Open Thread' : 'Create Thread'}
    >
      {thread ? <MessageSquare size={14} /> : <MessageSquarePlus size={14} />}
    </button>
  );
}

interface MessageItemProps {
  msg: Message;
  index: number;
  messages: Message[];
  agentInfo: AgentInfo | null;
  copiedMsgId: string | null;
  runtimeConnId: string;
  streamingStatus?: string;
  onTouchStart: (id: string) => void;
  onTouchEnd: () => void;
  onRetry: (msg: Message) => void;
  onReply: (msg: Message) => void;
  onEdit: (msg: Message) => void;
  onDelete: (id: string) => void;
  onCopy: (id: string, text: string) => void;
  onQuickSend: (text: string) => void;
  onReactionToggle: (msgId: string, emoji: string, hasIt: boolean) => void;
  onReactionRemove: (msgId: string, emoji: string) => void;
  onOpenReactionPicker: (msgId: string) => void;
  onCreateThread?: (messageId: string) => void;
}

function MessageItemInner({
  msg, index, messages, agentInfo, copiedMsgId, runtimeConnId, streamingStatus,
  onTouchStart, onTouchEnd, onRetry, onReply, onEdit, onDelete,
  onCopy, onQuickSend, onReactionToggle, onReactionRemove, onOpenReactionPicker,
  onCreateThread,
}: MessageItemProps) {
  const isUser = msg.sender === 'user';
  const isStreaming = msg.isStreaming;
  const hasCodeBlock = !isUser && msg.text?.includes('```');
  const isErrorMsg = !isUser && msg.text?.startsWith('⚠️');
  const prevMsg = index > 0 ? messages[index - 1] : null;
  const showDateSep = isDifferentDay(prevMsg?.timestamp, msg.timestamp);
  const grouped = !showDateSep && isGroupedWithPrev(messages, index);

  return (
    <div>
      {/* Date separator */}
      {showDateSep && msg.timestamp && (
        <div className="flex items-center gap-3 my-4">
          <div className="flex-1 h-px bg-border dark:bg-border-dark" />
          <span className="text-[11px] text-text/45 dark:text-text-inv/40 font-medium">{formatDate(msg.timestamp)}</span>
          <div className="flex-1 h-px bg-border dark:bg-border-dark" />
        </div>
      )}
      {/* Flat thread-style message (Slack/Discord inspired, no bubbles) */}
      <div
        className={`group/msg flex gap-3 px-2 py-0.5 rounded-lg hover:bg-black/[0.02] dark:hover:bg-white/[0.02] transition-colors relative animate-in ${grouped ? '' : 'mt-3'}`}
        onTouchStart={() => onTouchStart(msg.id)}
        onTouchEnd={onTouchEnd}
        onTouchMove={onTouchEnd}
      >
        {/* Avatar column */}
        <div className="w-8 flex-shrink-0 pt-0.5">
          {!grouped && (
            <div className={`w-8 h-8 rounded-full flex items-center justify-center text-white shadow-sm text-sm ${
              isUser
                ? 'bg-gradient-to-br from-info to-accent'
                : 'bg-gradient-to-br from-primary to-primary-deep'
            }`}>
              {isUser ? <User size={16} /> : (agentInfo?.identityEmoji || '🤖')}
            </div>
          )}
        </div>

        {/* Hover-only timestamp for grouped messages — absolutely positioned to
            avoid the layout jitter that would occur with an inline element
            appearing in the avatar column. */}
        {grouped && msg.timestamp && (
          <span className="pointer-events-none absolute right-3 top-1 hidden group-hover/msg:inline text-[10px] text-text/30 dark:text-text-inv/25 tabular-nums">
            {formatTime(msg.timestamp)}
          </span>
        )}

        {/* Content column */}
        <div className="flex-1 min-w-0 overflow-x-hidden">
          {/* Header row */}
          {!grouped && (
            <div className="flex items-baseline gap-2 mb-0.5 flex-wrap">
              <span className={`text-[14px] font-bold ${isUser ? 'text-info' : 'text-primary'}`}>
                {isUser ? 'You' : (agentInfo?.name || 'Bot')}
              </span>
              {msg.timestamp && (
                <span className="text-[10px] text-text/30 dark:text-text-inv/25 tabular-nums">
                  {formatTime(msg.timestamp)}{isUser && <DeliveryTicks status={msg.deliveryStatus} isUser={isUser} />}
                </span>
              )}
              {!isUser && agentInfo?.model && (
                <span className="text-[9px] text-text/35 dark:text-text-inv/30 font-medium bg-text/5 dark:bg-text-inv/5 rounded-full px-2 py-px">
                  {agentInfo.model.split('/').pop()}
                </span>
              )}
              {/* API direct connection badge */}
              {msg.meta?.source === 'api' && (
                <span className="inline-flex items-center gap-0.5 px-1.5 py-px rounded text-[9px] font-semibold bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400 tracking-wide">
                  <Zap size={8} />
                  API
                </span>
              )}
              {/* Inline reply reference — uses quotedText from message payload */}
              {msg.replyTo && (() => {
                const prevRef = index > 0 ? messages[index - 1] : null;
                const isDuplicateRef = prevRef && prevRef.sender === msg.sender && prevRef.replyTo === msg.replyTo;
                if (isDuplicateRef) return null;
                // Prefer quotedText carried in payload; fallback to local message lookup
                const quoted = msg.quotedText || messages.find((m) => m.id === msg.replyTo)?.text;
                if (!quoted) return null;
                const previewText = quoted.slice(0, 60) + (quoted.length > 60 ? '…' : '');
                return (
                  <div className="text-[11px] text-text/50 dark:text-text-inv/40 border-l-2 border-primary/40 pl-1.5 mt-0.5 mb-1 truncate max-w-[300px]" title={quoted.slice(0, 300)}>
                    {previewText}
                  </div>
                );
              })()}
            </div>
          )}

          {/* Message content — stops touch propagation to allow native text selection */}
          <div
            className={`text-[15px] leading-relaxed relative overflow-x-hidden ${
              isErrorMsg ? 'text-red-600 dark:text-red-400' : 'text-text dark:text-text-inv'
            } ${hasCodeBlock ? 'border-l-[3px] border-l-primary/50 pl-3' : ''}`}
            onTouchStart={(e) => e.stopPropagation()}
          >
            {(msg.mediaType === 'image' && msg.mediaUrl) ? (
              <div>
                <img src={msg.mediaUrl} alt="Message attachment" loading="lazy" className="max-w-full rounded-lg shadow-sm max-h-[300px] object-cover mt-1" />
                {msg.text && <p className="mt-1.5 text-[15px]">{msg.text}</p>}

              </div>
            ) : (msg.mediaType === 'voice' || msg.mediaType === 'audio') && msg.mediaUrl ? (
              <div className="flex flex-col gap-1">
                <div className="flex items-center gap-2 bg-surface/60 dark:bg-[#131420]/60 p-2 rounded-lg max-w-[280px]">
                  <audio src={msg.mediaUrl} controls className="h-8 w-full max-w-[240px]" />
                </div>
                {msg.text && <p className="text-[13px] opacity-80">{msg.text}</p>}
              </div>
            ) : msg.mediaType === 'file' && msg.mediaUrl ? (
              <div className="flex items-center gap-3 bg-surface dark:bg-[#131420] p-3 rounded-xl border border-border dark:border-border-dark max-w-[300px] mt-1">
                <div className="w-10 h-10 rounded-lg bg-info/10 flex items-center justify-center text-info shrink-0">
                  <FileText size={20} />
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-[14px] font-medium truncate">{msg.text || 'File'}</p>
                  <a href={msg.mediaUrl} target="_blank" rel="noopener noreferrer" className="text-[12px] text-info hover:underline">Download</a>
                </div>
              </div>
            ) : isUser ? (
              <div className="inline">
                <span className="whitespace-pre-wrap break-words">{msg.text}</span>

                {msg.deliveryStatus === 'pending' && (
                  <div className="md:hidden flex items-center gap-1 mt-1">
                    <button
                      onClick={() => onRetry(msg)}
                      className="text-[11px] text-red-500 dark:text-red-400 underline"
                    >
                      ⟳ Retry
                    </button>
                  </div>
                )}
              </div>
            ) : (
              <div>
                {(() => {
                  const approval = !isStreaming ? parseApprovalMessage(msg.text) : null;
                  if (approval) {
                    return <ApprovalCard parsed={approval} onSend={onQuickSend} />;
                  }
                  if (!isStreaming && parseSlashResponse(msg.text)) {
                    return <SlashResponseCard text={msg.text} />;
                  }
                  return <MarkdownRenderer content={msg.text} />;
                })()}
                {isStreaming && (
                  <span className="inline-flex items-center gap-1.5 align-middle ml-0.5">
                    <span className="inline-block w-2 h-4 bg-primary animate-pulse" />
                    {streamingStatus && (
                      <span className="text-[11px] text-primary/70 font-medium whitespace-nowrap">{streamingStatus}</span>
                    )}
                  </span>
                )}

              </div>
            )}
          </div>

          {/* Inline message actions */}
          {!isStreaming && (
            <div className="flex items-center gap-1.5 mt-0.5">

              {isUser && msg.deliveryStatus === 'pending' && (
                <button
                  onClick={() => onRetry(msg)}
                  className="text-[10px] text-red-400 hover:text-red-500 underline"
                >
                  ⟳ Retry
                </button>
              )}
            </div>
          )}

          {/* Reactions */}
          {msg.reactions && msg.reactions.length > 0 && (
            <div className="flex gap-1 mt-1">
              {msg.reactions.map((emoji, idx) => (
                <motion.button
                  key={idx}
                  initial={{ scale: 0 }}
                  animate={{ scale: 1 }}
                  transition={{ type: 'spring', stiffness: 600, damping: 15 }}
                  whileTap={{ scale: 0.8 }}
                  onClick={() => onReactionRemove(msg.id, emoji)}
                  className="inline-flex items-center gap-0.5 bg-surface dark:bg-[#1f2c34] rounded-full px-1.5 py-0.5 border border-border dark:border-border-dark text-[13px] hover:border-primary/30 transition-colors"
                >
                  {emoji}
                </motion.button>
              ))}
            </div>
          )}

          {/* Thread preview bar — shown on messages that are thread parents */}
          {!msg.threadId && <ThreadPreviewBar messageId={msg.id} connectionId={runtimeConnId} />}

          {/* Action Card for AI messages */}
          {!isUser && !isStreaming && <ActionCard text={msg.text} onSend={onQuickSend} />}
        </div>

        {/* Hover actions (desktop) */}
        {!isStreaming && (
          <div className="hidden md:flex items-center gap-0.5 opacity-0 group-hover/msg:opacity-100 transition-opacity absolute right-1 top-0.5">
            {/* Thread action button — not shown on thread reply messages */}
            {!msg.threadId && onCreateThread && (
              <ThreadHoverButton messageId={msg.id} connectionId={runtimeConnId} onCreateThread={onCreateThread} />
            )}
            {!isUser && (
              <div className="relative group/emoji">
                <button type="button" className="w-6 h-6 flex items-center justify-center text-text/25 dark:text-text-inv/20 hover:text-text/50 dark:hover:text-text-inv/45 rounded transition-colors">
                  <SmilePlus size={13} />
                </button>
                <div className="absolute bottom-full right-0 mb-1.5 hidden group-hover/emoji:flex items-center gap-0.5 bg-white dark:bg-card-alt rounded-full px-1.5 py-1 border border-border dark:border-border-dark shadow-lg z-20 after:content-[''] after:absolute after:inset-x-0 after:-bottom-3 after:h-3">
                  {['👍', '❤️', '😂', '🎉', '🔥', '👀'].map((e) => (
                    <button
                      key={e}
                      type="button"
                      onClick={() => onReactionToggle(msg.id, e, !!msg.reactions?.includes(e))}
                      className={`w-7 h-7 text-[15px] flex items-center justify-center rounded-full transition-all ${
                        msg.reactions?.includes(e) ? 'bg-primary/20 scale-110' : 'hover:bg-border dark:hover:bg-border-dark hover:scale-110'
                      }`}
                    >
                      {e}
                    </button>
                  ))}
                  <button
                    type="button"
                    onClick={() => onOpenReactionPicker(msg.id)}
                    className="w-7 h-7 flex items-center justify-center text-text/40 dark:text-text-inv/35 hover:text-primary rounded-full hover:bg-border dark:hover:bg-border-dark transition-colors"
                  >
                    <SmilePlus size={13} />
                  </button>
                </div>
              </div>
            )}
            <button type="button" onClick={() => onReply(msg)} className="w-7 h-7 flex items-center justify-center text-text/25 dark:text-text-inv/20 hover:text-info hover:bg-info/10 rounded-md transition-colors" title="Reply">
              <CornerDownLeft size={14} />
            </button>
            <button type="button" onClick={() => onCopy(msg.id, msg.text)} className={`w-7 h-7 flex items-center justify-center rounded-md transition-colors ${copiedMsgId === msg.id ? 'text-green-500 bg-green-500/10' : 'text-text/25 dark:text-text-inv/20 hover:text-text/60 dark:hover:text-text-inv/50 hover:bg-text/5 dark:hover:bg-text-inv/5'}`} title={copiedMsgId === msg.id ? 'Copied!' : 'Copy'}>
              {copiedMsgId === msg.id ? <Check size={14} /> : <Copy size={14} />}
            </button>
            {isUser && (
              <>
                <button type="button" onClick={() => onEdit(msg)} className="w-7 h-7 flex items-center justify-center text-text/25 dark:text-text-inv/20 hover:text-amber-500 hover:bg-amber-500/10 rounded-md transition-colors">
                  <Pencil size={14} />
                </button>
                <button type="button" onClick={() => onDelete(msg.id)} className="w-7 h-7 flex items-center justify-center text-text/25 dark:text-text-inv/20 hover:text-red-500 hover:bg-red-500/10 rounded-md transition-colors">
                  <Trash2 size={14} />
                </button>
              </>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

export const MessageItem = memo(MessageItemInner, (prev, next) => {
  // Custom comparison for performance
  if (prev.msg !== next.msg) return false;
  if (prev.copiedMsgId !== next.copiedMsgId && (prev.copiedMsgId === prev.msg.id || next.copiedMsgId === next.msg.id)) return false;
  if (prev.agentInfo !== next.agentInfo) return false;
  // Check if grouping changed (prev message changed)
  if (prev.index > 0 && next.index > 0) {
    const prevPrevMsg = prev.messages[prev.index - 1];
    const nextPrevMsg = next.messages[next.index - 1];
    if (prevPrevMsg !== nextPrevMsg) return false;
  }
  return true;
});
