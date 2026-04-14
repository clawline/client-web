import { memo } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { Zap } from 'lucide-react';
import { formatRelativeTime } from './utils';

export interface AcpSessionInfo {
  sessionKey: string;
  threadId: string;
  mode: string;
  backend: string;
  messageCount: number;
  lastTimestamp: number;
}

interface AcpSessionBarProps {
  sessions: AcpSessionInfo[];
  activeThreadId?: string;
  onSelectSession: (session: AcpSessionInfo) => void;
}

function AcpSessionBarInner({ sessions, activeThreadId, onSelectSession }: AcpSessionBarProps) {
  if (sessions.length === 0) return null;

  return (
    <AnimatePresence>
      <motion.div
        initial={{ opacity: 0, height: 0 }}
        animate={{ opacity: 1, height: 'auto' }}
        exit={{ opacity: 0, height: 0 }}
        transition={{ duration: 0.15 }}
        className="flex items-center gap-1.5 overflow-x-auto px-3 py-1.5 scrollbar-none"
      >
        <Zap size={12} className="shrink-0 text-primary/50" />
        <span className="shrink-0 text-[11px] text-text/40 dark:text-text-inv/30">ACP:</span>
        {sessions.map((s) => {
          const isActive = s.threadId === activeThreadId;
          const shortId = s.sessionKey.split(':').pop()?.slice(0, 6) || '';
          return (
            <button
              key={s.threadId}
              type="button"
              onClick={() => onSelectSession(s)}
              className={`shrink-0 rounded-full px-2.5 py-0.5 text-[11px] font-medium transition-colors ${
                isActive
                  ? 'bg-primary/15 text-primary ring-1 ring-primary/30'
                  : 'bg-surface-2/60 text-text/50 hover:bg-surface-2 dark:bg-surface-2/40 dark:text-text-inv/45 dark:hover:bg-surface-2/60'
              }`}
            >
              <span className="flex items-center gap-1">
                <span
                  className={`inline-block h-1.5 w-1.5 rounded-full ${
                    isActive ? 'bg-emerald-500 status-breathe' : 'bg-text/20 dark:bg-text-inv/15'
                  }`}
                />
                <span>{s.mode}</span>
                <span className="font-mono opacity-60">{shortId}</span>
                <span className="opacity-40">{s.messageCount}msg</span>
                {s.lastTimestamp && (
                  <span className="opacity-40">{formatRelativeTime(s.lastTimestamp)}</span>
                )}
              </span>
            </button>
          );
        })}
      </motion.div>
    </AnimatePresence>
  );
}

export const AcpSessionBar = memo(AcpSessionBarInner);
