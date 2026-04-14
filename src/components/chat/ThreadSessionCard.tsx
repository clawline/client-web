import { useState, useMemo } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { ChevronDown, ChevronRight, Zap, Square } from 'lucide-react';
import type { Message, AgentInfo } from './types';
import { formatRelativeTime } from './utils';
import MarkdownRenderer from '../MarkdownRenderer';

interface ThreadSessionCardProps {
  threadId: string;
  messages: Message[];
  agentInfo: AgentInfo | null;
  isActive: boolean;
  defaultExpanded?: boolean;
  onCloseSession?: (threadId: string) => void;
}

const MAX_VISIBLE_MESSAGES = 10;

function parseSpawnInfo(messages: Message[]): {
  sessionKey?: string;
  mode?: string;
  backend?: string;
} {
  const spawnMsg = messages.find(
    (m) => m.sender === 'ai' && m.text.includes('Spawned ACP session'),
  );
  if (!spawnMsg) return {};
  const keyMatch = spawnMsg.text.match(/agent:[^\s)]+/);
  const modeMatch = spawnMsg.text.match(/\((\w+),/);
  const backendMatch = spawnMsg.text.match(/backend\s+(\w+)/);
  return {
    sessionKey: keyMatch?.[0],
    mode: modeMatch?.[1],
    backend: backendMatch?.[1],
  };
}

export function ThreadSessionCard({
  threadId,
  messages,
  agentInfo,
  isActive,
  defaultExpanded = true,
  onCloseSession,
}: ThreadSessionCardProps) {
  const [expanded, setExpanded] = useState(defaultExpanded);

  const lastMessage = messages[messages.length - 1];
  const lastTimestamp = lastMessage?.timestamp;
  const hasStreaming = messages.some((m) => m.isStreaming);
  const statusLabel = hasStreaming ? 'Streaming' : isActive ? 'Running' : 'Ended';
  const shortThreadId = threadId.replace(/^clawline-thread-/, '').slice(0, 8);
  const spawnInfo = useMemo(() => parseSpawnInfo(messages), [messages]);

  const visibleMessages = useMemo(() => {
    if (messages.length <= MAX_VISIBLE_MESSAGES) return messages;
    return messages.slice(-MAX_VISIBLE_MESSAGES);
  }, [messages]);

  const hiddenCount = messages.length - visibleMessages.length;

  return (
    <motion.div
      initial={{ opacity: 0, y: 6 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.2 }}
      className="my-2 mx-1 rounded-xl border border-primary/15 bg-primary/[0.04] dark:border-primary/20 dark:bg-primary/[0.06]"
    >
      {/* Header */}
      <button
        type="button"
        onClick={() => setExpanded((v) => !v)}
        className="flex w-full items-center gap-2 px-3 py-2.5 text-left transition-colors hover:bg-primary/[0.04] dark:hover:bg-primary/[0.04]"
      >
        <Zap size={14} className="shrink-0 text-primary" />
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-1.5 text-[13px] font-semibold text-primary">
            <span>ACP Session</span>
            {agentInfo?.name && (
              <>
                <span className="text-text/25 dark:text-text-inv/25">&middot;</span>
                <span className="truncate font-medium text-text/70 dark:text-text-inv/60">
                  {agentInfo.name}
                </span>
              </>
            )}
            {spawnInfo.mode && (
              <>
                <span className="text-text/25 dark:text-text-inv/25">&middot;</span>
                <span className="truncate text-[11px] font-normal text-text/50 dark:text-text-inv/40">
                  {spawnInfo.mode}
                </span>
              </>
            )}
            {!expanded && (
              <>
                <span className="text-text/25 dark:text-text-inv/25">&middot;</span>
                <span className="text-[11px] font-normal text-text/40 dark:text-text-inv/35">
                  {messages.length} message{messages.length !== 1 ? 's' : ''}
                </span>
              </>
            )}
          </div>
          <div className="mt-0.5 flex items-center gap-2 text-[11px]">
            <span className="flex items-center gap-1">
              <span
                className={`inline-block h-1.5 w-1.5 rounded-full ${
                  isActive || hasStreaming
                    ? 'bg-emerald-500 status-breathe'
                    : 'bg-text/20 dark:bg-text-inv/20'
                }`}
              />
              <span className={isActive || hasStreaming ? 'text-emerald-600 dark:text-emerald-400' : 'text-text/40 dark:text-text-inv/35'}>
                {statusLabel}
              </span>
            </span>
            {expanded && (
              <>
                <span className="text-text/20 dark:text-text-inv/15">&middot;</span>
                <span className="text-text/40 dark:text-text-inv/35">
                  {messages.length} message{messages.length !== 1 ? 's' : ''}
                </span>
              </>
            )}
            {lastTimestamp && (
              <>
                <span className="text-text/20 dark:text-text-inv/15">&middot;</span>
                <span className="text-text/40 dark:text-text-inv/35">
                  {formatRelativeTime(lastTimestamp)}
                </span>
              </>
            )}
            <span className="text-text/20 dark:text-text-inv/15">&middot;</span>
            <span className="font-mono text-text/25 dark:text-text-inv/20">{shortThreadId}</span>
          </div>
        </div>
        <div className="flex shrink-0 items-center gap-1">
          {isActive && onCloseSession && (
            <span
              role="button"
              tabIndex={0}
              onClick={(e) => {
                e.stopPropagation();
                onCloseSession(threadId);
              }}
              onKeyDown={(e) => {
                if (e.key === 'Enter') { e.stopPropagation(); onCloseSession(threadId); }
              }}
              className="rounded p-1 text-text/30 transition-colors hover:bg-red-500/10 hover:text-red-500 dark:text-text-inv/25 dark:hover:text-red-400"
              title="End ACP session"
            >
              <Square size={13} />
            </span>
          )}
          <span className="text-text/30 dark:text-text-inv/25">
            {expanded ? <ChevronDown size={16} /> : <ChevronRight size={16} />}
          </span>
        </div>
      </button>

      {/* Expanded message list */}
      <AnimatePresence initial={false}>
        {expanded && messages.length > 0 && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: 'auto', opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.2 }}
            className="overflow-hidden"
          >
            <div className="border-t border-primary/10 dark:border-primary/15">
              {hiddenCount > 0 && (
                <div className="px-3 py-1.5 text-center text-[11px] text-text/35 dark:text-text-inv/30">
                  {hiddenCount} earlier message{hiddenCount !== 1 ? 's' : ''} hidden
                </div>
              )}
              <div className="divide-y divide-primary/[0.06] dark:divide-primary/[0.08]">
                {visibleMessages.map((msg) => (
                  <div key={msg.id} className="px-3 py-2">
                    <div className="flex items-start gap-2">
                      <span className="mt-0.5 shrink-0 text-[12px]">
                        {msg.sender === 'ai' ? (agentInfo?.identityEmoji || '\uD83E\uDD16') : '\uD83D\uDC64'}
                      </span>
                      <div className="min-w-0 flex-1 text-[13px] leading-relaxed text-text dark:text-text-inv">
                        {msg.isStreaming ? (
                          <span>
                            {msg.text}
                            <span className="ml-0.5 inline-block h-3.5 w-1.5 animate-pulse bg-primary/50 align-middle" />
                          </span>
                        ) : msg.text.length > 200 ? (
                          <MarkdownRenderer content={msg.text} />
                        ) : (
                          <span className="whitespace-pre-wrap">{msg.text}</span>
                        )}
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </motion.div>
  );
}
