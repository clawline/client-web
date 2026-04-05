import { memo } from 'react';
import { Loader2, RefreshCw } from 'lucide-react';
import { cn } from '../../lib/utils';
import type { AgentInfo } from '../../services/clawChannel';
import { formatLastSeen } from './utils';

type WsStatus = 'connected' | 'connecting' | 'reconnecting' | 'disconnected';

interface AgentHeaderCardProps {
  agentInfo: AgentInfo | null;
  agentId?: string | null;
  /** Display name of the active connection */
  connectionName: string;
  wsStatus: WsStatus;
  presence: { status: string; lastSeen?: number } | null;
  onAvatarClick: () => void;
  onReconnect: () => void;
}

function PresenceDot({ status }: { status: string }) {
  const isOffline = status === 'offline';
  return (
    <span
      className={cn(
        'inline-block h-2.5 w-2.5 rounded-full ring-2 ring-white dark:ring-[#11161d]',
        isOffline ? 'bg-rose-400' : 'bg-emerald-400 status-breathe',
      )}
    />
  );
}

function AgentHeaderCardInner({
  agentInfo,
  agentId,
  connectionName,
  wsStatus,
  presence,
  onAvatarClick,
  onReconnect,
}: AgentHeaderCardProps) {
  const displayName = agentInfo
    ? `${agentInfo.identityEmoji || '🤖'} ${agentInfo.name}`
    : agentId || 'OpenClaw Bot';

  const isOffline = presence?.status === 'offline';

  return (
    <div className="mb-6 flex flex-col items-center gap-3 pt-16 select-none">
      {/* Tappable avatar */}
      <button
        onClick={onAvatarClick}
        className="relative flex h-16 w-16 items-center justify-center rounded-[20px] border border-primary/20 bg-gradient-to-br from-primary/12 via-white to-primary/5 text-3xl shadow-lg shadow-primary/10 transition-transform active:scale-95 dark:from-primary/18 dark:via-card-alt dark:to-primary/8"
        aria-label="Show agent details"
      >
        {agentInfo?.identityEmoji || '🤖'}
        {/* Presence indicator */}
        {wsStatus === 'connected' && presence && (
          <span className="absolute -bottom-1 -right-1">
            <PresenceDot status={presence.status} />
          </span>
        )}
      </button>

      {/* Name */}
      <div className="text-center">
        <h2 className="text-[18px] font-semibold text-text dark:text-text-inv">{displayName}</h2>

        {/* Status line */}
        <div className="mt-1 flex items-center justify-center gap-2 text-[12px] text-text/50 dark:text-text-inv/50">
          <span>{connectionName}</span>
          {agentInfo?.model && (
            <>
              <span>·</span>
              <span>{agentInfo.model.split('/').pop()}</span>
            </>
          )}

          {wsStatus === 'connected' && presence && (
            <>
              <span>·</span>
              <span className={isOffline ? 'text-rose-400' : 'text-emerald-500'}>
                {isOffline ? (formatLastSeen(presence.lastSeen) || 'offline') : 'online'}
              </span>
            </>
          )}

          {(wsStatus === 'connecting' || wsStatus === 'reconnecting') && (
            <>
              <span>·</span>
              <span className="flex items-center gap-1 text-amber-500">
                <Loader2 size={10} className="animate-spin" />
                {wsStatus === 'connecting' ? 'connecting' : 'reconnecting'}
              </span>
            </>
          )}

          {wsStatus === 'disconnected' && (
            <>
              <span>·</span>
              <button
                onClick={onReconnect}
                className="flex items-center gap-1 text-rose-400 transition-colors hover:text-rose-500"
                aria-label="Tap to reconnect"
              >
                <RefreshCw size={10} />
                reconnect
              </button>
            </>
          )}
        </div>
      </div>
    </div>
  );
}

export const AgentHeaderCard = memo(AgentHeaderCardInner);
