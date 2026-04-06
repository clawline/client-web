import { memo } from 'react';
import { motion } from 'motion/react';
import { ChevronLeft, MoreHorizontal, Columns2, X, Loader2, WifiOff, RefreshCw } from 'lucide-react';
import { cn } from '../../lib/utils';
import type { AgentInfo } from '../../services/clawChannel';
import { formatLastSeen } from './utils';

type WsStatus = 'connected' | 'connecting' | 'reconnecting' | 'disconnected';

interface ChatHeaderProps {
  agentInfo: AgentInfo | null;
  agentId?: string | null;
  connectionName: string;
  wsStatus: WsStatus;
  presence: { status: string; lastSeen?: number } | null;
  isDesktop?: boolean;
  isSplitPane?: boolean;
  splitActive?: boolean;
  showSplitButton?: boolean;
  onBack: () => void;
  onMenuOpen: () => void;
  onToggleSplit?: () => void;
  onCloseSplit?: () => void;
  onAvatarClick?: () => void;
  onReconnect?: () => void;
}

const BTN =
  'flex h-10 w-10 items-center justify-center rounded-xl text-text/70 transition-colors ' +
  'hover:bg-slate-900/[0.05] active:scale-95 dark:text-text-inv/70 dark:hover:bg-white/[0.07]';

function ChatHeaderInner({
  agentInfo,
  agentId,
  connectionName,
  wsStatus,
  presence,
  isDesktop,
  isSplitPane,
  splitActive,
  showSplitButton,
  onBack,
  onMenuOpen,
  onToggleSplit,
  onCloseSplit,
  onAvatarClick,
  onReconnect,
}: ChatHeaderProps) {
  const displayName = agentInfo
    ? `${agentInfo.identityEmoji || '🤖'} ${agentInfo.name}`
    : agentId || 'OpenClaw Bot';

  const isOffline = presence?.status === 'offline';

  function renderStatusBadge() {
    if (wsStatus === 'connected' && presence) {
      return (
        <span
          className={cn(
            'inline-flex items-center gap-1 text-[11px] font-medium',
            isOffline ? 'text-rose-400' : 'text-emerald-500',
          )}
        >
          <span
            className={cn(
              'inline-block h-1.5 w-1.5 rounded-full',
              isOffline ? 'bg-rose-400' : 'bg-emerald-400 status-breathe',
            )}
          />
          {isOffline ? (formatLastSeen(presence.lastSeen) || 'offline') : 'online'}
        </span>
      );
    }
    if (wsStatus === 'connecting' || wsStatus === 'reconnecting') {
      return (
        <span className="inline-flex items-center gap-1 text-[11px] font-medium text-amber-500">
          <Loader2 size={10} className="animate-spin" />
          {wsStatus}
        </span>
      );
    }
    if (wsStatus === 'disconnected') {
      return (
        <button
          onClick={onReconnect}
          className="inline-flex items-center gap-1 text-[11px] font-medium text-rose-400 transition-colors hover:text-rose-500"
          aria-label="Tap to reconnect"
        >
          <RefreshCw size={10} />
          tap to reconnect
        </button>
      );
    }
    return null;
  }

  return (
    /* Outer sticky wrapper — background matches page exactly */
    <div
      className="sticky top-0 z-20 bg-white dark:bg-[#11161d]"
    >
      {/* Content row */}
      <div className="flex items-center gap-1 px-1 py-1">
        {/* Back */}
        {!isDesktop && (
          <motion.button whileTap={{ scale: 0.9 }} onClick={onBack} className={BTN} aria-label="Go back">
            <ChevronLeft size={26} />
          </motion.button>
        )}

        {/* Avatar (tappable → detail sheet) */}
        <button
          onClick={onAvatarClick}
          className="flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-[10px] border border-primary/15 bg-gradient-to-br from-primary/10 via-white to-primary/5 text-lg transition-transform active:scale-95 dark:from-primary/16 dark:via-card-alt dark:to-primary/7"
          aria-label="Show agent details"
        >
          {agentInfo?.identityEmoji || '🤖'}
        </button>

        {/* Title + status */}
        <div className="flex flex-1 flex-col items-start px-2 min-w-0">
          <span className="max-w-full truncate text-[16px] font-semibold leading-tight text-text dark:text-text-inv">
            {displayName}
          </span>
          <div className="flex items-center gap-1.5 text-text/45 dark:text-text-inv/45">
            <span className="text-[11px] truncate">{connectionName}</span>
            {agentInfo?.model && (
              <>
                <span className="text-[10px]">·</span>
                <span className="text-[11px] truncate">{agentInfo.model.split('/').pop()}</span>
              </>
            )}
            {renderStatusBadge() && (
              <>
                <span className="text-[10px]">·</span>
                {renderStatusBadge()}
              </>
            )}
          </div>
        </div>

        {/* Right actions */}
        {!isSplitPane && showSplitButton && onToggleSplit && (
          <motion.button
            whileTap={{ scale: 0.9 }}
            onClick={onToggleSplit}
            className={cn(BTN, splitActive && 'text-primary')}
            aria-label="Toggle split view"
          >
            <Columns2 size={19} />
          </motion.button>
        )}
        {isSplitPane && onCloseSplit && (
          <motion.button whileTap={{ scale: 0.9 }} onClick={onCloseSplit} className={BTN} aria-label="Close split view">
            <X size={20} />
          </motion.button>
        )}
        <motion.button whileTap={{ scale: 0.9 }} onClick={onMenuOpen} className={cn(BTN, 'mr-1')} aria-label="More options">
          <MoreHorizontal size={22} />
        </motion.button>
      </div>

      {/* Gradient fade — overlaps scroll content, no hard line */}
      <div
        className="pointer-events-none absolute left-0 right-0 top-full h-8 bg-gradient-to-b from-white to-transparent dark:from-[#11161d] dark:to-transparent"
        aria-hidden="true"
      />
    </div>
  );
}

export const ChatHeader = memo(ChatHeaderInner);
