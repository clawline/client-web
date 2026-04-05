import { memo, useState } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { ChevronDown, User, Cpu, Wifi, WifiOff, Activity, Loader2, RefreshCw, Info } from 'lucide-react';
import { cn } from '../../lib/utils';
import type { AgentInfo } from '../../services/clawChannel';
import { formatLastSeen } from './utils';

type WsStatus = 'connected' | 'connecting' | 'reconnecting' | 'disconnected';

interface AgentDetailSheetProps {
  isOpen: boolean;
  onClose: () => void;
  agentInfo: AgentInfo | null;
  agentId?: string | null;
  connectionName: string;
  wsStatus: WsStatus;
  presence: { status: string; lastSeen?: number } | null;
  /** Raw agent context JSON for the debug section */
  contextDebug?: Record<string, unknown> | null;
}

function Row({
  icon: Icon,
  label,
  value,
  valueClass,
}: {
  icon: React.ElementType;
  label: string;
  value: React.ReactNode;
  valueClass?: string;
}) {
  return (
    <div className="flex items-center gap-3 py-2.5">
      <div className="flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-xl bg-slate-900/[0.04] text-slate-500 dark:bg-white/[0.06] dark:text-slate-400">
        <Icon size={15} />
      </div>
      <span className="flex-1 text-[14px] text-text/60 dark:text-text-inv/60">{label}</span>
      <span className={cn('text-right text-[14px] font-medium text-text dark:text-text-inv', valueClass)}>
        {value}
      </span>
    </div>
  );
}

function AgentDetailSheetInner({
  isOpen,
  onClose,
  agentInfo,
  agentId,
  connectionName,
  wsStatus,
  presence,
  contextDebug,
}: AgentDetailSheetProps) {
  const [debugExpanded, setDebugExpanded] = useState(false);

  const displayName = agentInfo
    ? `${agentInfo.identityEmoji || '🤖'} ${agentInfo.name}`
    : agentId || 'OpenClaw Bot';

  const isOffline = presence?.status === 'offline';

  function renderWsStatus() {
    switch (wsStatus) {
      case 'connected':
        return (
          <span className={cn('flex items-center gap-1', isOffline ? 'text-rose-500' : 'text-emerald-500')}>
            {isOffline ? <WifiOff size={13} /> : <Wifi size={13} />}
            {isOffline ? (formatLastSeen(presence?.lastSeen) || 'offline') : 'online'}
          </span>
        );
      case 'connecting':
      case 'reconnecting':
        return (
          <span className="flex items-center gap-1 text-amber-500">
            <Loader2 size={13} className="animate-spin" />
            {wsStatus}
          </span>
        );
      case 'disconnected':
        return (
          <span className="flex items-center gap-1 text-rose-500">
            <WifiOff size={13} />
            disconnected
          </span>
        );
    }
  }

  return (
    <AnimatePresence>
      {isOpen && (
        <>
          {/* Backdrop */}
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.2 }}
            className="fixed inset-0 z-40 bg-black/30 backdrop-blur-sm"
            onClick={onClose}
          />

          {/* Sheet */}
          <motion.div
            initial={{ y: '100%' }}
            animate={{ y: 0 }}
            exit={{ y: '100%' }}
            transition={{ type: 'spring', stiffness: 380, damping: 38 }}
            className="fixed bottom-0 left-0 right-0 z-50 rounded-t-[28px] border-t border-border/40 bg-white pb-[env(safe-area-inset-bottom,16px)] shadow-[0_-24px_48px_-12px_rgba(15,23,42,0.18)] dark:border-border-dark/40 dark:bg-card-alt dark:shadow-[0_-24px_48px_-12px_rgba(2,6,23,0.6)]"
          >
            {/* Drag handle */}
            <div className="flex justify-center pt-3 pb-1">
              <div className="h-1 w-10 rounded-full bg-slate-300 dark:bg-slate-600" />
            </div>

            <div className="px-5 pt-2 pb-6">
              {/* Agent avatar + name */}
              <div className="mb-5 flex items-center gap-4">
                <div className="flex h-14 w-14 items-center justify-center rounded-[18px] border border-primary/20 bg-gradient-to-br from-primary/12 via-white to-primary/5 text-2xl shadow-md dark:from-primary/18 dark:via-card-alt dark:to-primary/8">
                  {agentInfo?.identityEmoji || '🤖'}
                </div>
                <div>
                  <div className="text-[17px] font-semibold text-text dark:text-text-inv">{displayName}</div>
                  {agentInfo?.description && (
                    <div className="mt-0.5 text-[13px] text-text/50 dark:text-text-inv/50 line-clamp-2">
                      {agentInfo.description}
                    </div>
                  )}
                </div>
              </div>

              {/* Info rows */}
              <div className="divide-y divide-border/50 dark:divide-border-dark/50">
                <Row icon={User} label="Identity" value={agentInfo?.identityName || agentId || '—'} />
                <Row icon={Activity} label="Connection" value={connectionName} />
                {agentInfo?.model && (
                  <Row icon={Cpu} label="Model" value={agentInfo.model.split('/').pop() ?? agentInfo.model} />
                )}
                <Row
                  icon={wsStatus === 'connected' && !isOffline ? Wifi : WifiOff}
                  label="Status"
                  value={renderWsStatus()}
                />
              </div>

              {/* Debug section */}
              {contextDebug && (
                <div className="mt-4">
                  <button
                    onClick={() => setDebugExpanded((v) => !v)}
                    className="flex w-full items-center gap-2 rounded-xl px-3 py-2.5 text-left text-[13px] text-text/50 transition-colors hover:bg-slate-50 dark:text-text-inv/50 dark:hover:bg-white/[0.04]"
                  >
                    <Info size={14} />
                    <span className="flex-1">Debug Info</span>
                    <ChevronDown
                      size={14}
                      className={cn('transition-transform duration-200', debugExpanded && 'rotate-180')}
                    />
                  </button>
                  <AnimatePresence initial={false}>
                    {debugExpanded && (
                      <motion.div
                        initial={{ height: 0, opacity: 0 }}
                        animate={{ height: 'auto', opacity: 1 }}
                        exit={{ height: 0, opacity: 0 }}
                        className="overflow-hidden"
                      >
                        <pre className="mt-2 max-h-40 overflow-y-auto rounded-xl bg-slate-50 p-3 text-[11px] text-slate-600 dark:bg-slate-900/50 dark:text-slate-400">
                          {JSON.stringify(contextDebug, null, 2)}
                        </pre>
                      </motion.div>
                    )}
                  </AnimatePresence>
                </div>
              )}
            </div>
          </motion.div>
        </>
      )}
    </AnimatePresence>
  );
}

export const AgentDetailSheet = memo(AgentDetailSheetInner);
