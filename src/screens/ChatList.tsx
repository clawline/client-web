import { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { AnimatePresence, motion } from 'motion/react';
import { Search, Server, Loader2, RefreshCw, Plus, ChevronDown, LayoutGrid, List, ChevronUp, Pencil } from 'lucide-react';
import { Input } from '../components/ui/input';
import { cn } from '../lib/utils';
import { CONNECTIONS_UPDATED_EVENT, getConnections, setActiveConnectionId, type ServerConnection } from '../services/connectionStore';
import * as channel from '../services/clawChannel';
import type { AgentInfo, ConversationSummary, ChannelStatus } from '../services/clawChannel';
import { getUserId } from '../App';

const PREVIEW_KEY_PREFIX = 'openclaw.agentPreview.';
const VIEW_MODE_KEY = 'openclaw.chatlist.viewMode';
const AGENT_ORDER_KEY = 'openclaw.chatlist.agentOrder';
const SIDEBAR_WIDTH_KEY = 'openclaw.sidebar.width';
const AGENT_AVATAR_KEY = 'openclaw.agentAvatars';

type ViewMode = 'list' | 'grid';

// Custom avatar storage
function getCustomAvatars(): Record<string, string> {
  try { const raw = localStorage.getItem(AGENT_AVATAR_KEY); return raw ? JSON.parse(raw) : {}; } catch { return {}; }
}
function setCustomAvatar(agentId: string, url: string) {
  const avatars = getCustomAvatars();
  avatars[agentId] = url;
  localStorage.setItem(AGENT_AVATAR_KEY, JSON.stringify(avatars));
}
function removeCustomAvatar(agentId: string) {
  const avatars = getCustomAvatars();
  delete avatars[agentId];
  localStorage.setItem(AGENT_AVATAR_KEY, JSON.stringify(avatars));
}

// Typing indicator dots component
function TypingDots() {
  return (
    <span className="inline-flex items-center gap-[3px]">
      {[0, 1, 2].map((i) => (
        <span
          key={i}
          className="w-1 h-1 rounded-full bg-current animate-bounce"
          style={{ animationDelay: `${i * 150}ms`, animationDuration: '600ms' }}
        />
      ))}
    </span>
  );
}

// Distinct avatar colors per agent — hash name to a palette position
const AVATAR_PALETTES = [
  { from: '#67B88B', to: '#4a9a70' }, // green (brand)
  { from: '#5B8DEF', to: '#3b6fd0' }, // blue
  { from: '#8B5CF6', to: '#6D28D9' }, // purple
  { from: '#F59E0B', to: '#D97706' }, // amber
  { from: '#EC4899', to: '#BE185D' }, // pink
  { from: '#14B8A6', to: '#0D9488' }, // teal
  { from: '#F97316', to: '#EA580C' }, // orange
  { from: '#6366F1', to: '#4F46E5' }, // indigo
] as const;

function hashString(str: string): number {
  let hash = 0;
  for (let i = 0; i < str.length; i++) {
    hash = ((hash << 5) - hash) + str.charCodeAt(i);
    hash |= 0;
  }
  return Math.abs(hash);
}

function getAgentPalette(agentId: string) {
  return AVATAR_PALETTES[hashString(agentId) % AVATAR_PALETTES.length];
}

type PendingOpen = {
  agentId: string;
};

type AgentResult = {
  agent: AgentInfo;
  connection: ServerConnection;
  status: ChannelStatus;
};

function formatRelativeTime(ts?: number): string {
  if (!ts) return '';
  const diff = Date.now() - ts;
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return 'now';
  if (mins < 60) return `${mins}m`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h`;
  const days = Math.floor(hours / 24);
  if (days < 7) return `${days}d`;
  return new Date(ts).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}

function getPreviewKey(connectionId: string, agentId: string) {
  return `${PREVIEW_KEY_PREFIX}${connectionId}.${agentId}`;
}

function getLastMessagePreview(agentId: string, connectionId: string): { text: string; timestamp?: number } | null {
  try {
    const cachedPreview = localStorage.getItem(getPreviewKey(connectionId, agentId));
    if (cachedPreview) {
      return JSON.parse(cachedPreview) as { text: string; timestamp?: number };
    }

    const raw = localStorage.getItem(`openclaw.messages.${connectionId}.${agentId}`);
    if (!raw) return null;
    const msgs = JSON.parse(raw) as Array<{ text?: string; timestamp?: number }>;
    if (msgs.length === 0) return null;
    const last = msgs[msgs.length - 1];
    return { text: last?.text ?? '', timestamp: last?.timestamp };
  } catch {
    return null;
  }
}

function getConnectionLabel(connection: ServerConnection) {
  return connection.name || connection.displayName || 'Server';
}

function getConnectionTitle(connection: ServerConnection) {
  return `🖥️ ${getConnectionLabel(connection)}`;
}

function getStatusClasses(status: ChannelStatus) {
  if (status === 'connected') return 'bg-primary';
  if (status === 'connecting' || status === 'reconnecting') return 'bg-amber-400';
  return 'bg-text/20 dark:bg-text-inv/20';
}

function buildAgentMap(connections: ServerConnection[]) {
  return Object.fromEntries(
    connections.map((connection) => [connection.id, channel.loadCachedAgents(connection.id)])
  ) as Record<string, AgentInfo[]>;
}

function buildStatusMap(connections: ServerConnection[]) {
  return Object.fromEntries(
    connections.map((connection) => [connection.id, channel.getStatus(connection.id)])
  ) as Record<string, ChannelStatus>;
}

function buildLoadingMap(connections: ServerConnection[]) {
  return Object.fromEntries(
    connections.map((connection) => [connection.id, channel.loadCachedAgents(connection.id).length === 0])
  ) as Record<string, boolean>;
}

export default function ChatList({
  onOpenChat,
  onAddServer,
  compact,
  activeAgentId,
  activeConnectionId,
}: {
  onOpenChat: (connectionId: string, agentId: string, chatId?: string) => void;
  onAddServer: () => void;
  compact?: boolean;
  activeAgentId?: string | null;
  activeConnectionId?: string | null;
}) {
  const [connections, setConnections] = useState<ServerConnection[]>(() => getConnections());
  const [searchQuery, setSearchQuery] = useState('');
  const [viewMode, setViewMode] = useState<ViewMode>(() => {
    try { return (localStorage.getItem(VIEW_MODE_KEY) as ViewMode) || 'list'; } catch { return 'list'; }
  });
  const [expandedIds, setExpandedIds] = useState<string[]>(() => {
    const initialConnections = getConnections();
    if (initialConnections.length <= 1) {
      return initialConnections[0] ? [initialConnections[0].id] : [];
    }
    return activeConnectionId ? [activeConnectionId] : [];
  });
  const [agentMap, setAgentMap] = useState<Record<string, AgentInfo[]>>(() => buildAgentMap(getConnections()));
  const [statusMap, setStatusMap] = useState<Record<string, ChannelStatus>>(() => buildStatusMap(getConnections()));
  const [loadingMap, setLoadingMap] = useState<Record<string, boolean>>(() => buildLoadingMap(getConnections()));
  const [refreshingMap, setRefreshingMap] = useState<Record<string, boolean>>({});
  const [attemptedMap, setAttemptedMap] = useState<Record<string, boolean>>({});
  const [typingAgents, setTypingAgents] = useState<Set<string>>(new Set());
  const [draggedAgent, setDraggedAgent] = useState<string | null>(null);
  const [editMode, setEditMode] = useState(false);
  const [customOrder, setCustomOrder] = useState<Record<string, string[]>>(() => {
    try { const raw = localStorage.getItem(AGENT_ORDER_KEY); return raw ? JSON.parse(raw) : {}; } catch { return {}; }
  });
  const [customAvatars, setCustomAvatarsState] = useState<Record<string, string>>(() => getCustomAvatars());
  const [avatarMenuAgent, setAvatarMenuAgent] = useState<{ agentId: string; x: number; y: number } | null>(null);

  const handleAvatarContextMenu = (e: React.MouseEvent, agentId: string) => {
    e.preventDefault();
    e.stopPropagation();
    setAvatarMenuAgent({ agentId, x: e.clientX, y: e.clientY });
  };

  // Touch long-press for mobile avatar customization
  const longPressTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const handleAvatarTouchStart = (e: React.TouchEvent, agentId: string) => {
    const touch = e.touches[0];
    const x = touch.clientX;
    const y = touch.clientY;
    longPressTimerRef.current = setTimeout(() => {
      setAvatarMenuAgent({ agentId, x, y });
    }, 500);
  };
  const handleAvatarTouchEnd = () => {
    if (longPressTimerRef.current) { clearTimeout(longPressTimerRef.current); longPressTimerRef.current = null; }
  };

  const handleSetCustomAvatar = (agentId: string) => {
    const url = prompt('Enter avatar image URL:');
    if (url && url.trim()) {
      setCustomAvatar(agentId, url.trim());
      setCustomAvatarsState(getCustomAvatars());
    }
    setAvatarMenuAgent(null);
  };

  const handleRemoveCustomAvatar = (agentId: string) => {
    removeCustomAvatar(agentId);
    setCustomAvatarsState(getCustomAvatars());
    setAvatarMenuAgent(null);
  };

  // Close context menu on click outside
  useEffect(() => {
    if (!avatarMenuAgent) return;
    const close = () => setAvatarMenuAgent(null);
    document.addEventListener('click', close);
    return () => document.removeEventListener('click', close);
  }, [avatarMenuAgent]);

  const pendingOpenRef = useRef<Record<string, PendingOpen | undefined>>({});
  const agentMapRef = useRef(agentMap);

  useEffect(() => {
    agentMapRef.current = agentMap;
  }, [agentMap]);

  const syncConnections = useCallback(() => {
    const nextConnections = getConnections();
    setConnections(nextConnections);
    setAgentMap((prev) => {
      const next = { ...prev };
      Object.keys(next).forEach((key) => {
        if (!nextConnections.some((connection) => connection.id === key)) {
          delete next[key];
        }
      });
      nextConnections.forEach((connection) => {
        if (!next[connection.id]) {
          next[connection.id] = channel.loadCachedAgents(connection.id);
        }
      });
      return next;
    });
    setStatusMap((prev) => {
      const next: Record<string, ChannelStatus> = {};
      nextConnections.forEach((connection) => {
        next[connection.id] = prev[connection.id] || channel.getStatus(connection.id);
      });
      return next;
    });
    setLoadingMap((prev) => {
      const next: Record<string, boolean> = {};
      nextConnections.forEach((connection) => {
        next[connection.id] = prev[connection.id] ?? channel.loadCachedAgents(connection.id).length === 0;
      });
      return next;
    });
    setRefreshingMap((prev) => {
      const next: Record<string, boolean> = {};
      nextConnections.forEach((connection) => {
        next[connection.id] = prev[connection.id] ?? false;
      });
      return next;
    });
    setAttemptedMap((prev) => {
      const next: Record<string, boolean> = {};
      nextConnections.forEach((connection) => {
        next[connection.id] = prev[connection.id] ?? false;
      });
      return next;
    });
    setExpandedIds((prev) => {
      if (nextConnections.length <= 1) {
        return nextConnections[0] ? [nextConnections[0].id] : [];
      }

      const filtered = prev.filter((id) => nextConnections.some((connection) => connection.id === id));
      if (filtered.length > 0) return filtered;
      return activeConnectionId && nextConnections.some((connection) => connection.id === activeConnectionId)
        ? [activeConnectionId]
        : [];
    });
  }, [activeConnectionId]);

  useEffect(() => {
    syncConnections();
    const handleConnectionsUpdated = () => {
      syncConnections();
    };

    window.addEventListener(CONNECTIONS_UPDATED_EVENT, handleConnectionsUpdated);
    return () => {
      window.removeEventListener(CONNECTIONS_UPDATED_EVENT, handleConnectionsUpdated);
    };
  }, [syncConnections]);

  const ensureAgentsLoaded = useCallback((connection: ServerConnection, force = false) => {
    setAttemptedMap((prev) => ({ ...prev, [connection.id]: true }));
    setLoadingMap((prev) => ({
      ...prev,
      [connection.id]: force ? true : prev[connection.id] && (agentMapRef.current[connection.id]?.length ?? 0) === 0,
    }));
    setRefreshingMap((prev) => ({ ...prev, [connection.id]: true }));

    channel.connect({
      connectionId: connection.id,
      chatId: connection.chatId,
      senderId: connection.senderId || getUserId(),
      senderName: connection.displayName,
      serverUrl: connection.serverUrl,
      token: connection.token,
    });

    if (channel.getStatus(connection.id) === 'connected') {
      try {
        channel.requestAgentList(connection.id);
      } catch {
        setRefreshingMap((prev) => ({ ...prev, [connection.id]: false }));
        setLoadingMap((prev) => ({ ...prev, [connection.id]: false }));
      }
    }
  }, []);

  useEffect(() => {
    if (connections.length === 1 && connections[0]) {
      ensureAgentsLoaded(connections[0]);
      return;
    }

    if (searchQuery.trim()) {
      connections.forEach((connection) => ensureAgentsLoaded(connection));
      return;
    }

    expandedIds.forEach((connectionId) => {
      const connection = connections.find((item) => item.id === connectionId);
      if (connection) ensureAgentsLoaded(connection);
    });
  }, [connections, ensureAgentsLoaded, expandedIds, searchQuery]);

  useEffect(() => {
    const cleanups = connections.map((connection) => {
      const unsubscribeMessage = channel.onMessage((packet) => {
        if (packet.type === 'connection.open') {
          if (pendingOpenRef.current[connection.id]) {
            try {
              channel.requestConversationList(pendingOpenRef.current[connection.id]?.agentId, connection.id);
            } catch {
              setRefreshingMap((prev) => ({ ...prev, [connection.id]: false }));
            }
          } else if (searchQuery.trim() || expandedIds.includes(connection.id) || connections.length === 1) {
            try {
              channel.requestAgentList(connection.id);
            } catch {
              setRefreshingMap((prev) => ({ ...prev, [connection.id]: false }));
              setLoadingMap((prev) => ({ ...prev, [connection.id]: false }));
            }
          }
        } else if (packet.type === 'agent.list') {
          const agents = Array.isArray((packet.data as { agents?: AgentInfo[] }).agents)
            ? ((packet.data as { agents?: AgentInfo[] }).agents as AgentInfo[])
            : [];
          setAgentMap((prev) => ({ ...prev, [connection.id]: agents }));
          channel.saveCachedAgents(connection.id, agents);
          setLoadingMap((prev) => ({ ...prev, [connection.id]: false }));
          setRefreshingMap((prev) => ({ ...prev, [connection.id]: false }));
        } else if (packet.type === 'conversation.list') {
          const pendingOpen = pendingOpenRef.current[connection.id];
          if (!pendingOpen) return;

          const conversations = (Array.isArray((packet.data as { conversations?: ConversationSummary[] }).conversations)
            ? ((packet.data as { conversations?: ConversationSummary[] }).conversations as ConversationSummary[])
            : []
          ).slice().sort((a, b) => (b.timestamp || 0) - (a.timestamp || 0));

          pendingOpenRef.current[connection.id] = undefined;
          setRefreshingMap((prev) => ({ ...prev, [connection.id]: false }));
          setActiveConnectionId(connection.id);
          onOpenChat(connection.id, pendingOpen.agentId, conversations[0]?.chatId);
        } else if (packet.type === 'typing') {
          const data = packet.data as { agentId?: string; isTyping?: boolean };
          if (data.agentId) {
            const key = `${connection.id}:${data.agentId}`;
            setTypingAgents((prev) => {
              const next = new Set(prev);
              if (data.isTyping) next.add(key); else next.delete(key);
              return next;
            });
          }
        }
      }, connection.id);

      const unsubscribeStatus = channel.onStatus((status) => {
        setStatusMap((prev) => ({ ...prev, [connection.id]: status }));
        if (status === 'connected' && pendingOpenRef.current[connection.id]) {
          try {
            channel.requestConversationList(pendingOpenRef.current[connection.id]?.agentId, connection.id);
          } catch {
            setRefreshingMap((prev) => ({ ...prev, [connection.id]: false }));
          }
        }
        if (status === 'disconnected') {
          setRefreshingMap((prev) => ({ ...prev, [connection.id]: false }));
          setLoadingMap((prev) => ({ ...prev, [connection.id]: false }));
        }
      }, connection.id);

      return () => {
        unsubscribeMessage();
        unsubscribeStatus();
      };
    });

    return () => {
      cleanups.forEach((cleanup) => cleanup());
    };
  }, [connections, expandedIds, onOpenChat, searchQuery]);

  const filteredResults = useMemo<AgentResult[]>(() => {
    const query = searchQuery.trim().toLowerCase();
    if (!query) return [];

    return connections.flatMap((connection) => {
      const agents = agentMap[connection.id] || [];
      return agents
        .filter((agent) =>
          agent.name.toLowerCase().includes(query) ||
          agent.id.toLowerCase().includes(query)
        )
        .map((agent) => ({
          agent,
          connection,
          status: statusMap[connection.id] || 'disconnected',
        }));
    });
  }, [agentMap, connections, searchQuery, statusMap]);

  const connectedCount = connections.filter((connection) => statusMap[connection.id] === 'connected').length;
  const showGroupedView = connections.length > 1 && !searchQuery.trim();

  const handleRefresh = () => {
    const targets = searchQuery.trim()
      ? connections
      : connections.length === 1
        ? connections
        : connections.filter((connection) => expandedIds.includes(connection.id));

    targets.forEach((connection) => ensureAgentsLoaded(connection, true));
  };

  const handleToggleGroup = (connectionId: string) => {
    setExpandedIds((prev) => {
      if (prev.includes(connectionId)) {
        return prev.filter((id) => id !== connectionId);
      }
      return [...prev, connectionId];
    });
  };

  const handleAgentClick = (connection: ServerConnection, agent: AgentInfo) => {
    const status = statusMap[connection.id] || 'disconnected';
    if (attemptedMap[connection.id] && status === 'disconnected') return;

    pendingOpenRef.current[connection.id] = { agentId: agent.id };
    setRefreshingMap((prev) => ({ ...prev, [connection.id]: true }));

    channel.connect({
      connectionId: connection.id,
      chatId: connection.chatId,
      senderId: connection.senderId || getUserId(),
      senderName: connection.displayName,
      serverUrl: connection.serverUrl,
      token: connection.token,
      agentId: agent.id,
    });

    if (channel.getStatus(connection.id) === 'connected') {
      try {
        channel.requestConversationList(agent.id, connection.id);
      } catch {
        pendingOpenRef.current[connection.id] = undefined;
        setRefreshingMap((prev) => ({ ...prev, [connection.id]: false }));
      }
    }
  };

  const toggleViewMode = () => {
    const next: ViewMode = viewMode === 'list' ? 'grid' : 'list';
    setViewMode(next);
    try { localStorage.setItem(VIEW_MODE_KEY, next); } catch { /* noop */ }
  };

  // Effective view: grid in both mobile and compact (sidebar) when user selects it
  const effectiveView: ViewMode = viewMode;

  // Sort agents with custom order
  const sortAgents = useCallback((connectionId: string, agents: AgentInfo[]): AgentInfo[] => {
    const order = customOrder[connectionId];
    if (!order || order.length === 0) return agents;
    return [...agents].sort((a, b) => {
      const ai = order.indexOf(a.id);
      const bi = order.indexOf(b.id);
      if (ai === -1 && bi === -1) return 0;
      if (ai === -1) return 1;
      if (bi === -1) return -1;
      return ai - bi;
    });
  }, [customOrder]);

  // Drag-and-drop handlers (HTML5 native)
  const handleDragStart = (agentId: string) => {
    setDraggedAgent(agentId);
  };

  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
  };

  const handleDrop = (connectionId: string, targetAgentId: string, agents: AgentInfo[]) => {
    if (!draggedAgent || draggedAgent === targetAgentId) {
      setDraggedAgent(null);
      return;
    }
    const currentOrder = customOrder[connectionId] || agents.map((a) => a.id);
    const fromIdx = currentOrder.indexOf(draggedAgent);
    const toIdx = currentOrder.indexOf(targetAgentId);
    if (fromIdx === -1 || toIdx === -1) { setDraggedAgent(null); return; }
    const next = [...currentOrder];
    next.splice(fromIdx, 1);
    next.splice(toIdx, 0, draggedAgent);
    const updated = { ...customOrder, [connectionId]: next };
    setCustomOrder(updated);
    try { localStorage.setItem(AGENT_ORDER_KEY, JSON.stringify(updated)); } catch { /* noop */ }
    setDraggedAgent(null);
  };

  const handleDragEnd = () => { setDraggedAgent(null); };

  // Mobile: move agent up/down in edit mode
  const handleMoveAgent = (connectionId: string, agentId: string, direction: 'up' | 'down', agents: AgentInfo[]) => {
    const currentOrder = customOrder[connectionId] || agents.map((a) => a.id);
    const idx = currentOrder.indexOf(agentId);
    if (idx === -1) return;
    const targetIdx = direction === 'up' ? idx - 1 : idx + 1;
    if (targetIdx < 0 || targetIdx >= currentOrder.length) return;
    const next = [...currentOrder];
    [next[idx], next[targetIdx]] = [next[targetIdx], next[idx]];
    const updated = { ...customOrder, [connectionId]: next };
    setCustomOrder(updated);
    try { localStorage.setItem(AGENT_ORDER_KEY, JSON.stringify(updated)); } catch { /* noop */ }
  };

  const renderAgentCard = (connection: ServerConnection, agent: AgentInfo, index: number, showSource = false) => {
    const status = statusMap[connection.id] || 'disconnected';
    const isDisabled = attemptedMap[connection.id] && status === 'disconnected';
    const isActive = activeConnectionId === connection.id && activeAgentId === agent.id;
    const lastMessage = getLastMessagePreview(agent.id, connection.id);
    const preview = lastMessage?.text
      ? (lastMessage.text.length > 50 ? `${lastMessage.text.slice(0, 50)}…` : lastMessage.text)
      : null;
    const palette = getAgentPalette(agent.id);
    const initials = agent.name.slice(0, 2).toUpperCase();
    const isTyping = typingAgents.has(`${connection.id}:${agent.id}`);
    const isDragging = draggedAgent === agent.id;
    const agents = agentMap[connection.id] || [];
    const sortedOrder = customOrder[connection.id] || agents.map((a) => a.id);
    const sortedIdx = sortedOrder.indexOf(agent.id);
    const isFirst = sortedIdx === 0;
    const isLast = sortedIdx === sortedOrder.length - 1;

    return (
      <motion.div
        key={`${connection.id}-${agent.id}`}
        initial={{ opacity: 0, y: 6 }}
        animate={{ opacity: isDragging ? 0.5 : 1, y: 0 }}
        transition={{ delay: Math.min(index * 0.02, 0.12), duration: 0.18 }}
        layout={editMode}
        draggable={compact && !editMode}
        onDragStart={compact ? () => handleDragStart(agent.id) : undefined}
        onDragOver={compact ? handleDragOver : undefined}
        onDrop={compact ? () => handleDrop(connection.id, agent.id, agents) : undefined}
        onDragEnd={compact ? handleDragEnd : undefined}
      >
        <div className="flex items-center">
          {/* Edit mode: reorder buttons (mobile only) */}
          {editMode && !compact && (
            <div className="flex flex-col mr-1 shrink-0">
              <button
                type="button"
                onClick={(e) => { e.stopPropagation(); handleMoveAgent(connection.id, agent.id, 'up', agents); }}
                disabled={isFirst}
                className={cn('p-0.5 rounded', isFirst ? 'text-text/15' : 'text-text/40 active:bg-text/10')}
              >
                <ChevronUp size={14} />
              </button>
              <button
                type="button"
                onClick={(e) => { e.stopPropagation(); handleMoveAgent(connection.id, agent.id, 'down', agents); }}
                disabled={isLast}
                className={cn('p-0.5 rounded', isLast ? 'text-text/15' : 'text-text/40 active:bg-text/10')}
              >
                <ChevronDown size={14} />
              </button>
            </div>
          )}
          <button
          type="button"
          onClick={() => handleAgentClick(connection, agent)}
          disabled={isDisabled}
          className={cn(
            'relative w-full text-left flex items-center gap-3 transition-all duration-150',
            compact ? 'px-2.5 py-2' : 'px-4 py-2.5',
            'rounded-lg',
            isDisabled && 'opacity-40 cursor-not-allowed',
            !isDisabled && 'cursor-pointer',
            isActive
              ? 'bg-primary/10 dark:bg-primary/15 border-l-2 border-l-primary'
              : 'border-l-2 border-l-transparent hover:bg-text/[0.04] dark:hover:bg-text-inv/[0.04]'
          )}
        >
          {/* Avatar with typing indicator */}
          <div className="relative flex-shrink-0" onContextMenu={(e) => handleAvatarContextMenu(e, agent.id)} onTouchStart={(e) => handleAvatarTouchStart(e, agent.id)} onTouchEnd={handleAvatarTouchEnd} onTouchMove={handleAvatarTouchEnd}>
            {customAvatars[agent.id] ? (
              <img
                src={customAvatars[agent.id]}
                alt={agent.name}
                className={cn(
                  'object-cover',
                  compact ? 'w-8 h-8 rounded-lg' : 'w-10 h-10 rounded-xl'
                )}
                onError={(e) => { (e.target as HTMLImageElement).style.display = 'none'; }}
              />
            ) : (
              <div
                className={cn(
                  'flex items-center justify-center text-white font-semibold',
                  compact ? 'w-8 h-8 text-[11px] rounded-lg' : 'w-10 h-10 text-[13px] rounded-xl'
                )}
                style={{ background: `linear-gradient(135deg, ${palette.from}, ${palette.to})` }}
              >
                {agent.identityEmoji || initials}
              </div>
            )}
            {isTyping && (
              <span className={cn(
                'absolute -bottom-0.5 -right-0.5 bg-primary rounded-full border-2 border-white dark:border-surface-dark flex items-center justify-center',
                compact ? 'w-3 h-3' : 'w-3.5 h-3.5'
              )}>
                <span className="w-1.5 h-1.5 bg-white rounded-full animate-pulse" />
              </span>
            )}
          </div>

          {/* Content */}
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-1.5">
              <h3 className={cn('font-semibold truncate', compact ? 'text-[13px] text-text/90 dark:text-text-inv/90' : 'text-[15px]')}>
                {agent.name}
              </h3>
              {agent.isDefault && (
                <span className="text-[8px] font-medium text-text/40 dark:text-text-inv/35 bg-text/[0.05] dark:bg-text-inv/[0.05] rounded px-1 py-px leading-none shrink-0">
                  default
                </span>
              )}
              {agent.model && (
                <span className={cn('text-[9px] truncate ml-auto shrink-0', compact ? 'text-text/40 dark:text-text-inv/35' : 'text-text/30 dark:text-text-inv/30')}>
                  {agent.model.split('/').pop()}
                </span>
              )}
            </div>
            {isTyping ? (
              <p className={cn('mt-0.5 text-primary flex items-center gap-1', compact ? 'text-[11px]' : 'text-[13px]')}>
                typing <TypingDots />
              </p>
            ) : preview ? (
              <p className={cn('truncate mt-0.5', compact ? 'text-[11px] text-text/55 dark:text-text-inv/50' : 'text-[13px] text-text/50 dark:text-text-inv/45')}>
                {preview}
              </p>
            ) : (
              <p className={cn('truncate mt-0.5', compact ? 'text-[11px] text-text/30 dark:text-text-inv/25' : 'text-[13px] text-text/30 dark:text-text-inv/25')}>
                Start a conversation
              </p>
            )}
            {showSource && (
              <p className="mt-0.5 text-[10px] text-text/35 dark:text-text-inv/30 truncate">
                {getConnectionLabel(connection)}
              </p>
            )}
          </div>

          {/* Timestamp */}
          {lastMessage?.timestamp && (
            <span className={cn('text-[10px] shrink-0 self-start mt-0.5', compact ? 'text-text/40 dark:text-text-inv/35' : 'text-text/35 dark:text-text-inv/30')}>
              {formatRelativeTime(lastMessage.timestamp)}
            </span>
          )}
        </button>
        </div>
      </motion.div>
    );
  };

  const renderAgentGridCard = (connection: ServerConnection, agent: AgentInfo, index: number) => {
    const status = statusMap[connection.id] || 'disconnected';
    const isDisabled = attemptedMap[connection.id] && status === 'disconnected';
    const isActive = activeConnectionId === connection.id && activeAgentId === agent.id;
    const palette = getAgentPalette(agent.id);
    const initials = agent.name.slice(0, 2).toUpperCase();
    const lastMessage = getLastMessagePreview(agent.id, connection.id);
    const isTyping = typingAgents.has(`${connection.id}:${agent.id}`);
    const isDragging = draggedAgent === agent.id;

    return (
      <motion.div
        key={`${connection.id}-${agent.id}`}
        initial={{ opacity: 0, scale: 0.95 }}
        animate={{ opacity: isDragging ? 0.5 : 1, scale: 1 }}
        transition={{ delay: Math.min(index * 0.03, 0.15), duration: 0.2 }}
        layout={editMode}
        draggable={compact && !editMode}
        onDragStart={compact ? () => handleDragStart(agent.id) : undefined}
        onDragOver={compact ? handleDragOver : undefined}
        onDrop={compact ? () => handleDrop(connection.id, agent.id, agentMap[connection.id] || []) : undefined}
        onDragEnd={compact ? handleDragEnd : undefined}
      >
        <button
          type="button"
          onClick={() => handleAgentClick(connection, agent)}
          disabled={isDisabled}
          className={cn(
            'relative w-full flex flex-col items-center text-center p-3 pb-2.5 rounded-2xl transition-all duration-150',
            'bg-white/60 dark:bg-card-alt/40',
            isDisabled && 'opacity-40 cursor-not-allowed',
            !isDisabled && 'cursor-pointer active:scale-[0.96]',
            isActive
              ? 'ring-2 ring-primary/30 bg-primary/5 dark:bg-primary/10'
              : 'hover:bg-text/[0.02] dark:hover:bg-text-inv/[0.02]'
          )}
        >
          {/* Avatar */}
          <div className="relative mb-2" onContextMenu={(e) => handleAvatarContextMenu(e, agent.id)} onTouchStart={(e) => handleAvatarTouchStart(e, agent.id)} onTouchEnd={handleAvatarTouchEnd} onTouchMove={handleAvatarTouchEnd}>
            {customAvatars[agent.id] ? (
              <img
                src={customAvatars[agent.id]}
                alt={agent.name}
                className="w-12 h-12 rounded-2xl object-cover shadow-sm"
                onError={(e) => { (e.target as HTMLImageElement).style.display = 'none'; }}
              />
            ) : (
              <div
                className="w-12 h-12 rounded-2xl flex items-center justify-center text-white font-bold text-base shadow-sm"
                style={{ background: `linear-gradient(135deg, ${palette.from}, ${palette.to})` }}
              >
                {agent.identityEmoji || initials}
              </div>
            )}
            {/* Typing indicator dot */}
            {isTyping && (
              <span className="absolute -bottom-0.5 -right-0.5 w-3.5 h-3.5 bg-primary rounded-full border-2 border-white dark:border-card-alt flex items-center justify-center">
                <span className="w-1.5 h-1.5 bg-white rounded-full animate-pulse" />
              </span>
            )}
          </div>

          {/* Name */}
          <h3 className="text-[12px] font-semibold truncate w-full leading-tight">
            {agent.name}
          </h3>

          {/* Message bubble or typing or model */}
          {isTyping ? (
            <div className="mt-1.5 px-2 py-1 rounded-lg bg-text/[0.04] dark:bg-text-inv/[0.04] text-[10px] text-primary flex items-center gap-1">
              <TypingDots />
            </div>
          ) : lastMessage?.text ? (
            <div className="mt-1.5 px-2 py-1 rounded-lg bg-text/[0.04] dark:bg-text-inv/[0.04] text-[10px] text-text/50 dark:text-text-inv/40 truncate w-full max-w-full">
              {lastMessage.text.length > 24 ? `${lastMessage.text.slice(0, 24)}…` : lastMessage.text}
            </div>
          ) : agent.model ? (
            <span className="text-[9px] text-text/30 dark:text-text-inv/25 truncate w-full mt-1">
              {agent.model.split('/').pop()}
            </span>
          ) : null}

          {/* Default badge */}
          {agent.isDefault && (
            <span className="text-[7px] font-medium text-text/35 dark:text-text-inv/30 bg-text/[0.04] dark:bg-text-inv/[0.04] rounded px-1 py-px mt-1">
              default
            </span>
          )}
        </button>
      </motion.div>
    );
  };

  if (connections.length === 0) {
    return (
      <div className={cn('flex flex-col h-full', !compact && 'pb-24')}>
        <div className={cn('px-5 pb-3', compact ? 'pt-3' : 'pt-10')}>
          {!compact && <h1 className="text-2xl font-bold tracking-tight mb-4">Chats</h1>}
        </div>
        <div className="flex-1 flex flex-col items-center justify-center px-8">
          <div className="w-12 h-12 rounded-2xl bg-text/[0.04] dark:bg-text-inv/[0.04] flex items-center justify-center mb-4">
            <Server size={20} className="text-text/25 dark:text-text-inv/20" />
          </div>
          <p className="text-[15px] font-medium text-text/60 dark:text-text-inv/50 mb-1">No servers connected</p>
          <p className="text-[13px] text-text/30 dark:text-text-inv/25 mb-5 text-center">Add a server to start chatting with agents</p>
          <button
            onClick={onAddServer}
            className="px-5 py-2 rounded-lg bg-primary text-white text-[13px] font-medium hover:bg-primary-deep transition-colors"
          >
            Add Server
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className={cn('flex flex-col h-full min-h-0', !compact && 'pb-24')}>
      <div className={cn(
        'sticky top-0 bg-surface/90 dark:bg-surface-dark/90 backdrop-blur-lg z-10',
        compact ? 'px-3 pt-3 pb-2' : 'px-5 pt-10 pb-3'
      )}>
        <div className="flex justify-between items-center mb-3 gap-3">
          <div className="min-w-0 flex-1">
            {!compact && <h1 className="text-2xl font-bold tracking-tight">Chats</h1>}
            {compact && <span className="font-semibold text-[15px] block truncate">Chats</span>}
          </div>
          <div className="flex items-center gap-1.5 shrink-0">
            {!compact && (
              <motion.button
                whileTap={{ scale: 0.9 }}
                onClick={() => setEditMode(!editMode)}
                className={cn('p-1.5 transition-colors', editMode ? 'text-primary' : 'text-text/35 dark:text-text-inv/30 hover:text-primary')}
                title={editMode ? 'Done editing' : 'Reorder agents'}
              >
                <Pencil size={14} />
              </motion.button>
            )}
            <motion.button
              whileTap={{ scale: 0.9 }}
              onClick={toggleViewMode}
              className="p-1.5 text-text/35 dark:text-text-inv/30 hover:text-primary transition-colors"
              title={viewMode === 'list' ? 'Grid view' : 'List view'}
            >
              {viewMode === 'list' ? <LayoutGrid size={14} /> : <List size={14} />}
            </motion.button>
            <motion.button
              whileTap={{ scale: 0.9 }}
              onClick={handleRefresh}
              className="p-1.5 text-text/40 dark:text-text-inv/40 hover:text-primary transition-colors"
            >
              <RefreshCw size={14} className={Object.values(refreshingMap).some(Boolean) ? 'animate-spin' : ''} />
            </motion.button>
            <span className={cn(
              'text-[10px] font-medium px-1.5 py-0.5 rounded-full',
              connectedCount > 0
                ? 'text-primary/70 bg-primary/8'
                : 'text-text/30 dark:text-text-inv/25 bg-text/5 dark:bg-text-inv/5'
            )}>
              {connectedCount}/{connections.length}
            </span>
          </div>
        </div>

        <div className="relative">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-text/30 dark:text-text-inv/30" size={compact ? 14 : 16} />
          <Input
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="Search agents…"
            className={cn(
              'pl-9 rounded-lg bg-text/[0.04] dark:bg-text-inv/[0.04] border-0 placeholder:text-text/30 dark:placeholder:text-text-inv/25',
              compact ? 'py-1.5 text-[12px] pl-8' : 'py-2 text-[13px]'
            )}
          />
        </div>
      </div>

      <div className={cn('flex-1 overflow-y-auto', compact ? 'px-1 pb-2' : 'px-2 pb-4')}>
        {searchQuery.trim() ? (
          <div className={effectiveView === 'grid' ? 'grid gap-2 px-1' : 'space-y-0.5'} style={effectiveView === 'grid' ? { gridTemplateColumns: 'repeat(auto-fill, minmax(68px, 1fr))' } : undefined}>
            {filteredResults.length > 0 ? filteredResults.map(({ agent, connection }, index) => (
              effectiveView === 'grid'
                ? renderAgentGridCard(connection, agent, index)
                : renderAgentCard(connection, agent, index, true)
            )) : (
              <div className={cn('text-center text-text/30 dark:text-text-inv/30 text-[13px]', effectiveView === 'grid' ? 'col-span-full mt-10' : 'mt-10')}>No agents found</div>
            )}
          </div>
        ) : showGroupedView ? (
          <div className="space-y-1">
            {connections.map((connection) => {
              const isExpanded = expandedIds.includes(connection.id);
              const agents = agentMap[connection.id] || [];
              const status = statusMap[connection.id] || 'disconnected';
              const isLoading = loadingMap[connection.id] && agents.length === 0;

              return (
                <div key={connection.id}>
                  <button
                    type="button"
                    onClick={() => {
                      handleToggleGroup(connection.id);
                      if (!isExpanded) ensureAgentsLoaded(connection);
                    }}
                    className="w-full flex items-center gap-2 px-3 py-2 text-left group"
                  >
                    <span className={cn('inline-flex h-2 w-2 rounded-full shrink-0', getStatusClasses(status))} />
                    <span className="text-[11px] font-medium uppercase tracking-wider text-text/40 dark:text-text-inv/35 truncate flex-1">
                      {getConnectionLabel(connection)}
                    </span>
                    <ChevronDown
                      size={12}
                      className={cn('shrink-0 text-text/25 dark:text-text-inv/20 transition-transform duration-200', isExpanded && 'rotate-180')}
                    />
                  </button>

                  <AnimatePresence initial={false}>
                    {isExpanded && (
                      <motion.div
                        initial={{ height: 0, opacity: 0 }}
                        animate={{ height: 'auto', opacity: 1 }}
                        exit={{ height: 0, opacity: 0 }}
                        transition={{ duration: 0.2 }}
                        className="overflow-hidden"
                      >
                        <div className={effectiveView === 'grid' ? 'grid gap-2 px-1 pb-1' : 'space-y-0.5 pb-1'} style={effectiveView === 'grid' ? { gridTemplateColumns: 'repeat(auto-fill, minmax(68px, 1fr))' } : undefined}>
                          {isLoading ? (
                            <div className={cn('flex items-center justify-center gap-2 py-6', effectiveView === 'grid' && 'col-span-full')}>
                              <Loader2 size={16} className="text-text/30 animate-spin" />
                              <span className="text-text/30 dark:text-text-inv/25 text-[12px]">Loading…</span>
                            </div>
                          ) : agents.length > 0 ? agents.map((agent, index) => (
                            effectiveView === 'grid'
                              ? renderAgentGridCard(connection, agent, index)
                              : renderAgentCard(connection, agent, index)
                          )) : (
                            <div className={cn('text-center text-text/25 dark:text-text-inv/20 py-6 text-[12px]', effectiveView === 'grid' && 'col-span-full')}>No agents</div>
                          )}
                        </div>
                      </motion.div>
                    )}
                  </AnimatePresence>
                </div>
              );
            })}
          </div>
        ) : (
          <div className={effectiveView === 'grid' ? 'grid gap-2 px-1' : 'space-y-0.5'} style={effectiveView === 'grid' ? { gridTemplateColumns: 'repeat(auto-fill, minmax(68px, 1fr))' } : undefined}>
            {loadingMap[connections[0].id] && (agentMap[connections[0].id] || []).length === 0 ? (
              <div className={cn('flex items-center justify-center gap-2 py-12', effectiveView === 'grid' && 'col-span-full')}>
                <Loader2 size={18} className="text-text/30 animate-spin" />
                <span className="text-text/30 dark:text-text-inv/25 text-[13px]">Loading agents…</span>
              </div>
            ) : (agentMap[connections[0].id] || []).length > 0 ? (
              (agentMap[connections[0].id] || []).map((agent, index) =>
                effectiveView === 'grid'
                  ? renderAgentGridCard(connections[0], agent, index)
                  : renderAgentCard(connections[0], agent, index)
              )
            ) : (
              <div className={cn('text-center text-text/25 dark:text-text-inv/20 mt-10 text-[13px]', effectiveView === 'grid' && 'col-span-full')}>No agents</div>
            )}
          </div>
        )}

        <button
          onClick={onAddServer}
          className={cn(
            'w-full mt-3 py-2.5 flex items-center justify-center gap-1.5',
            'text-[12px] font-medium text-text/30 dark:text-text-inv/25',
            'rounded-lg border border-dashed border-text/10 dark:border-text-inv/10',
            'hover:border-text/20 dark:hover:border-text-inv/15 hover:text-text/45 dark:hover:text-text-inv/35',
            'transition-colors'
          )}
        >
          <Plus size={13} />
          Add Server
        </button>
      </div>

      {/* Avatar context menu */}
      {avatarMenuAgent && (
        <div
          className="fixed z-50 bg-white dark:bg-card-alt rounded-lg shadow-lg border border-border/60 dark:border-border-dark/60 py-1 min-w-[140px]"
          style={{ left: avatarMenuAgent.x, top: avatarMenuAgent.y }}
          onClick={(e) => e.stopPropagation()}
        >
          <button
            className="w-full text-left px-3 py-1.5 text-[12px] hover:bg-text/[0.04] dark:hover:bg-text-inv/[0.04] transition-colors"
            onClick={() => handleSetCustomAvatar(avatarMenuAgent.agentId)}
          >
            {customAvatars[avatarMenuAgent.agentId] ? 'Change avatar' : 'Set custom avatar'}
          </button>
          {customAvatars[avatarMenuAgent.agentId] && (
            <button
              className="w-full text-left px-3 py-1.5 text-[12px] text-red-500 hover:bg-text/[0.04] dark:hover:bg-text-inv/[0.04] transition-colors"
              onClick={() => handleRemoveCustomAvatar(avatarMenuAgent.agentId)}
            >
              Remove avatar
            </button>
          )}
        </div>
      )}
    </div>
  );
}
