import { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { AnimatePresence, motion } from 'motion/react';
import { Search, Bot, Server, Loader2, RefreshCw, Plus, ChevronDown } from 'lucide-react';
import { Input } from '../components/ui/input';
import { Button } from '../components/ui/button';
import EmptyState from '../components/EmptyState';
import { Badge } from '../components/ui/badge';
import { cn } from '../lib/utils';
import { CONNECTIONS_UPDATED_EVENT, getConnections, setActiveConnectionId, type ServerConnection } from '../services/connectionStore';
import * as channel from '../services/clawChannel';
import type { AgentInfo, ConversationSummary, ChannelStatus } from '../services/clawChannel';
import { getUserId } from '../App';

const PREVIEW_KEY_PREFIX = 'openclaw.agentPreview.';

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

  const renderAgentCard = (connection: ServerConnection, agent: AgentInfo, index: number, showSource = false) => {
    const status = statusMap[connection.id] || 'disconnected';
    const isDisabled = attemptedMap[connection.id] && status === 'disconnected';
    const isActive = activeConnectionId === connection.id && activeAgentId === agent.id;
    const lastMessage = getLastMessagePreview(agent.id, connection.id);
    const preview = lastMessage?.text
      ? (lastMessage.text.length > 50 ? `${lastMessage.text.slice(0, 50)}…` : lastMessage.text)
      : 'No messages yet';

    return (
      <motion.button
        key={`${connection.id}-${agent.id}`}
        type="button"
        initial={{ opacity: 0, y: 16 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: Math.min(index * 0.03, 0.2) }}
        whileTap={isDisabled ? undefined : { scale: 0.98 }}
        onClick={() => handleAgentClick(connection, agent)}
        disabled={isDisabled}
        className={cn(
          'relative w-full text-left bg-white dark:bg-card-alt rounded-[24px] flex items-center gap-4 shadow-sm border transition-colors',
          compact ? 'p-3 rounded-[16px] gap-3' : 'p-4',
          isDisabled && 'opacity-45 cursor-not-allowed',
          !isDisabled && 'cursor-pointer',
          isActive
            ? 'border-primary bg-primary/5 dark:bg-primary/10'
            : 'border-border/50 dark:border-border-dark/50 hover:border-primary/30'
        )}
      >
        {agent.model && (
          <span className="absolute top-2 right-2 px-1.5 py-0.5 bg-info/10 text-info text-[9px] font-medium rounded">
            {agent.model.split('/').pop()}
          </span>
        )}
        <div className={cn(
          'rounded-full bg-gradient-to-br from-primary to-primary-deep flex-shrink-0 flex items-center justify-center text-white shadow-sm',
          compact ? 'w-10 h-10 text-lg' : 'w-14 h-14 text-2xl'
        )}>
          {agent.identityEmoji || <Bot size={compact ? 18 : 24} />}
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex items-center justify-between gap-2 mb-0.5">
            <div className="flex items-center gap-2 min-w-0">
              <h3 className={cn('font-semibold truncate', compact ? 'text-[14px]' : 'text-[16px]')}>{agent.name}</h3>
              {agent.isDefault && (
                <Badge className="text-[10px] shrink-0">default</Badge>
              )}
            </div>
            {lastMessage?.timestamp && (
              <span className="text-[11px] text-text/50 dark:text-text-inv/50 shrink-0">
                {formatRelativeTime(lastMessage.timestamp)}
              </span>
            )}
          </div>
          <p className={cn('text-text/40 dark:text-text-inv/40 truncate', compact ? 'text-[12px]' : 'text-[13px]')}>
            {preview}
          </p>
          {showSource && (
            <p className="mt-1 text-[11px] text-text/35 dark:text-text-inv/35 truncate">
              {getConnectionLabel(connection)}
            </p>
          )}
        </div>
      </motion.button>
    );
  };

  if (connections.length === 0) {
    return (
      <div className={cn('flex flex-col h-full', !compact && 'pb-32')}>
        <div className={cn('px-6 pb-4', compact ? 'pt-4' : 'pt-12')}>
          {!compact && <h1 className="text-3xl font-bold tracking-tight mb-6">Chats</h1>}
        </div>
        <div className="flex-1 flex flex-col items-center justify-center">
          <EmptyState
            icon={Server}
            title="No server connected"
            description="Pair with your OpenClaw gateway to start chatting"
            action={<Button onClick={onAddServer}><Server size={16} /> Add Server</Button>}
          />
        </div>
      </div>
    );
  }

  return (
    <div className={cn('flex flex-col h-full min-h-0', !compact && 'pb-32')}>
      <div className={cn(
        'sticky top-0 bg-surface/80 dark:bg-surface-dark/80 backdrop-blur-xl z-10',
        compact ? 'px-4 pt-3 pb-3' : 'px-6 pt-12 pb-4'
      )}>
        <div className="flex justify-between items-center mb-4 gap-3">
          <div className="min-w-0 flex-1">
            {!compact && <h1 className="text-3xl font-bold tracking-tight">Chats</h1>}
            {compact && <span className="font-semibold text-[15px] block truncate">Chats</span>}
          </div>
          <div className="flex items-center gap-2 shrink-0">
            <motion.button
              whileTap={{ scale: 0.9 }}
              onClick={handleRefresh}
              className="p-2 text-text/50 dark:text-text-inv/50 hover:text-primary transition-colors"
            >
              <RefreshCw size={16} className={Object.values(refreshingMap).some(Boolean) ? 'animate-spin' : ''} />
            </motion.button>
            <Badge variant={connectedCount > 0 ? 'success' : 'warning'} className="text-[11px]">
              {connectedCount}/{connections.length} online
            </Badge>
          </div>
        </div>

        <div className="relative">
          <Search className="absolute left-4 top-1/2 -translate-y-1/2 text-text/40 dark:text-text-inv/40" size={compact ? 16 : 20} />
          <Input
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="Search agents across servers..."
            className={cn('pl-12 rounded-full bg-white dark:bg-card-alt', compact && 'pl-10 py-1.5 text-[13px]')}
          />
        </div>
      </div>

      <div className={cn('flex-1 overflow-y-auto', compact ? 'px-2 pb-3' : 'px-4 pb-4')}>
        {searchQuery.trim() ? (
          <div className="space-y-2">
            {filteredResults.length > 0 ? filteredResults.map(({ agent, connection }, index) => (
              renderAgentCard(connection, agent, index, true)
            )) : (
              <div className="text-center text-text/40 dark:text-text-inv/40 mt-10">No agents found</div>
            )}
          </div>
        ) : showGroupedView ? (
          <div className="space-y-2">
            {connections.map((connection) => {
              const isExpanded = expandedIds.includes(connection.id);
              const agents = agentMap[connection.id] || [];
              const status = statusMap[connection.id] || 'disconnected';
              const isLoading = loadingMap[connection.id] && agents.length === 0;

              return (
                <div
                  key={connection.id}
                  className="rounded-[24px] border border-border/60 dark:border-border-dark/60 bg-white/70 dark:bg-card-alt/70 overflow-hidden"
                >
                  <button
                    type="button"
                    onClick={() => {
                      handleToggleGroup(connection.id);
                      if (!isExpanded) ensureAgentsLoaded(connection);
                    }}
                    className="w-full flex items-center justify-between gap-3 px-4 py-3 text-left"
                  >
                    <div className="min-w-0 flex items-center gap-2">
                      <span className={cn('inline-flex h-2.5 w-2.5 rounded-full', getStatusClasses(status))} />
                      <span className="text-xs uppercase tracking-wider text-muted-foreground/60 truncate">
                        {getConnectionTitle(connection)}
                      </span>
                    </div>
                    <ChevronDown
                      size={16}
                      className={cn('shrink-0 text-text/35 dark:text-text-inv/35 transition-transform', isExpanded && 'rotate-180')}
                    />
                  </button>

                  <AnimatePresence initial={false}>
                    {isExpanded && (
                      <motion.div
                        initial={{ height: 0, opacity: 0 }}
                        animate={{ height: 'auto', opacity: 1 }}
                        exit={{ height: 0, opacity: 0 }}
                        className="overflow-hidden"
                      >
                        <div className="px-3 pb-3 pt-1 space-y-2">
                          {isLoading ? (
                            <div className="flex flex-col items-center justify-center py-10">
                              <Loader2 size={24} className="text-primary animate-spin mb-3" />
                              <p className="text-text/40 dark:text-text-inv/40 text-[13px]">Loading agents…</p>
                            </div>
                          ) : agents.length > 0 ? agents.map((agent, index) => (
                            renderAgentCard(connection, agent, index)
                          )) : (
                            <div className="text-center text-text/40 dark:text-text-inv/40 py-8">No agents found</div>
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
          <div className="space-y-2">
            {loadingMap[connections[0].id] && (agentMap[connections[0].id] || []).length === 0 ? (
              <div className="flex flex-col items-center justify-center py-16">
                <Loader2 size={28} className="text-primary animate-spin mb-3" />
                <p className="text-text/40 dark:text-text-inv/40 text-[14px]">Loading agents…</p>
              </div>
            ) : (agentMap[connections[0].id] || []).length > 0 ? (
              (agentMap[connections[0].id] || []).map((agent, index) => renderAgentCard(connections[0], agent, index))
            ) : (
              <div className="text-center text-text/40 dark:text-text-inv/40 mt-10">No agents found</div>
            )}
          </div>
        )}

        <Button
          variant="outline"
          onClick={onAddServer}
          className="w-full mt-4 rounded-[20px] border-dashed border-border/80 dark:border-border-dark/80 bg-transparent"
        >
          <Plus size={16} />
          Add Server
        </Button>
      </div>
    </div>
  );
}
