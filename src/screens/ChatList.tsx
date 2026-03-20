import { useState, useEffect, useCallback, useRef } from 'react';
import { AnimatePresence, motion } from 'motion/react';
import { Search, Bot, Server, Loader2, RefreshCw, ChevronLeft, Plus } from 'lucide-react';
import { Input } from '../components/ui/input';
import { Button } from '../components/ui/button';
import { Badge } from '../components/ui/badge';
import { cn } from '../lib/utils';
import { getActiveConnection } from '../services/connectionStore';
import * as channel from '../services/clawChannel';
import type { AgentInfo, ConversationSummary } from '../services/clawChannel';
import { getUserId } from '../App';

function loadCachedAgents(): AgentInfo[] {
  try {
    const raw = localStorage.getItem('openclaw.agentList');
    return raw ? JSON.parse(raw) : [];
  } catch { return []; }
}

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

function getLastMessagePreview(agentId: string, connId: string): { text: string; timestamp?: number } | null {
  try {
    const raw = localStorage.getItem(`openclaw.messages.${connId}.${agentId}`);
    if (!raw) return null;
    const msgs = JSON.parse(raw) as Array<{ text?: string; timestamp?: number }>;
    if (msgs.length === 0) return null;
    const last = msgs[msgs.length - 1];
    return { text: last?.text ?? '', timestamp: last?.timestamp };
  } catch { return null; }
}

function connectActiveChannel() {
  const conn = getActiveConnection();
  if (!conn) return null;

  channel.connect({
    chatId: conn.chatId,
    senderId: conn.senderId || getUserId(),
    senderName: conn.displayName,
    serverUrl: conn.serverUrl,
    token: conn.token,
  });

  return conn;
}

export default function ChatList({ onOpenChat, onAddServer, compact, activeAgentId }: { onOpenChat: (agentId: string, chatId?: string) => void; onAddServer: () => void; compact?: boolean; activeAgentId?: string | null }) {
  const activeConn = getActiveConnection();
  const activeConnId = activeConn?.id ?? null;
  const [searchQuery, setSearchQuery] = useState('');
  const [agents, setAgents] = useState<AgentInfo[]>(() => loadCachedAgents());
  const [selectedAgent, setSelectedAgent] = useState<AgentInfo | null>(null);
  const [conversations, setConversations] = useState<ConversationSummary[]>([]);
  const [wsStatus, setWsStatus] = useState<string>(channel.getStatus());
  const [loadingAgents, setLoadingAgents] = useState(() => loadCachedAgents().length === 0);
  const [loadingConversations, setLoadingConversations] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const autoOpenNewChatRef = useRef(false);

  const requestAgents = useCallback(() => {
    if (!connectActiveChannel()) {
      setLoadingAgents(false);
      setRefreshing(false);
      return;
    }

    setRefreshing(true);
    if (channel.getStatus() === 'connected') {
      try { channel.requestAgentList(); } catch { setRefreshing(false); }
    }
  }, []);

  const requestConversations = useCallback((agent: AgentInfo, autoOpenIfEmpty = false) => {
    setSelectedAgent(agent);
    setConversations([]);
    setLoadingConversations(true);
    setRefreshing(true);
    autoOpenNewChatRef.current = autoOpenIfEmpty;

    if (!connectActiveChannel()) {
      setLoadingConversations(false);
      setRefreshing(false);
      autoOpenNewChatRef.current = false;
      return;
    }

    if (channel.getStatus() === 'connected') {
      try {
        channel.requestConversationList(agent.id);
      } catch {
        setLoadingConversations(false);
        setRefreshing(false);
        autoOpenNewChatRef.current = false;
      }
    }
  }, []);

  useEffect(() => {
    if (!activeConnId) {
      setAgents([]);
      setSelectedAgent(null);
      setConversations([]);
      setLoadingAgents(false);
      setLoadingConversations(false);
      setRefreshing(false);
      return;
    }

    const cached = loadCachedAgents();
    setAgents(cached);
    setSelectedAgent(null);
    setConversations([]);
    setLoadingAgents(cached.length === 0);
    setLoadingConversations(false);
    requestAgents();
  }, [activeConnId, requestAgents]);

  useEffect(() => {
    const requestCurrentView = () => {
      try {
        if (selectedAgent) {
          channel.requestConversationList(selectedAgent.id);
        } else {
          channel.requestAgentList();
        }
      } catch {
        setRefreshing(false);
        setLoadingAgents(false);
        setLoadingConversations(false);
      }
    };

    const unsubMsg = channel.onMessage((packet) => {
      if (packet.type === 'connection.open') {
        requestCurrentView();
      } else if (packet.type === 'agent.list') {
        const data = packet.data as { agents?: AgentInfo[] };
        if (Array.isArray(data.agents)) {
          setAgents(data.agents);
          try { localStorage.setItem('openclaw.agentList', JSON.stringify(data.agents)); } catch {}
        }
        setLoadingAgents(false);
        setRefreshing(false);
      } else if (packet.type === 'conversation.list') {
        const data = packet.data as { conversations?: ConversationSummary[] };
        const nextConversations = Array.isArray(data.conversations)
          ? [...data.conversations].sort((a, b) => (b.timestamp || 0) - (a.timestamp || 0))
          : [];

        setConversations(nextConversations);
        setLoadingConversations(false);
        setRefreshing(false);

        if (selectedAgent && autoOpenNewChatRef.current && nextConversations.length === 0) {
          autoOpenNewChatRef.current = false;
          onOpenChat(selectedAgent.id);
          return;
        }

        autoOpenNewChatRef.current = false;
      }
    });

    const unsubStatus = channel.onStatus((status) => {
      setWsStatus(status);
      if (status === 'connected') {
        requestCurrentView();
      }
      if (status === 'disconnected') {
        setRefreshing(false);
      }
    });

    return () => {
      unsubMsg();
      unsubStatus();
    };
  }, [onOpenChat, selectedAgent]);

  useEffect(() => {
    if (!activeConn || selectedAgent) return;
    const timer = setTimeout(() => {
      if (agents.length === 0) {
        setAgents([{ id: 'main', name: 'Claw', isDefault: true }]);
        setLoadingAgents(false);
        setRefreshing(false);
      }
    }, 5000);
    return () => clearTimeout(timer);
  }, [activeConn, activeConnId, agents.length, selectedAgent]);

  const filteredAgents = agents.filter((agent) =>
    agent.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
    agent.id.toLowerCase().includes(searchQuery.toLowerCase())
  );

  const handleRefresh = () => {
    if (selectedAgent) {
      requestConversations(selectedAgent, false);
      return;
    }
    requestAgents();
  };

  const handleBackToAgents = () => {
    autoOpenNewChatRef.current = false;
    setSelectedAgent(null);
    setConversations([]);
    setLoadingConversations(false);
  };

  if (!activeConn) {
    return (
      <div className={cn('flex flex-col h-full', !compact && 'pb-32')}>
        <div className={cn('px-6 pb-4', compact ? 'pt-4' : 'pt-12')}>
          {!compact && <h1 className="text-3xl font-bold tracking-tight mb-6">Chats</h1>}
        </div>
        <div className="flex-1 flex flex-col items-center justify-center px-8 text-center">
          <div className="w-16 h-16 bg-border dark:bg-border-dark rounded-full flex items-center justify-center mb-4">
            <Server size={28} className="text-text/50 dark:text-text-inv/50" />
          </div>
          <p className="text-text/50 dark:text-text-inv/50 text-[15px] mb-1">No server connected</p>
          <p className="text-text/50 dark:text-text-inv/50 text-[13px] mb-6">Pair with your OpenClaw gateway to start chatting</p>
          <Button onClick={onAddServer}>
            <Server size={16} /> Add Server
          </Button>
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
        <div className="flex justify-between items-center mb-2 gap-3">
          <div className="min-w-0 flex-1">
            {selectedAgent ? (
              <div className="flex items-center gap-2 min-w-0">
                <motion.button
                  whileTap={{ scale: 0.9 }}
                  onClick={handleBackToAgents}
                  className="p-2 -ml-2 text-text/50 dark:text-text-inv/50 hover:text-primary transition-colors"
                >
                  <ChevronLeft size={20} />
                </motion.button>
                <div className="min-w-0">
                  <h2 className={cn('font-semibold truncate', compact ? 'text-[15px]' : 'text-2xl')}>{selectedAgent.name}</h2>
                  <p className="text-[12px] text-text/40 dark:text-text-inv/40 truncate">Conversation history</p>
                </div>
              </div>
            ) : (
              <>
                {!compact && <h1 className="text-3xl font-bold tracking-tight">Chats</h1>}
                {compact && <span className="font-semibold text-[15px] block truncate">{activeConn.name}</span>}
              </>
            )}
          </div>
          <div className="flex items-center gap-2 shrink-0">
            <motion.button
              whileTap={{ scale: 0.9 }}
              onClick={handleRefresh}
              className="p-2 text-text/50 dark:text-text-inv/50 hover:text-primary transition-colors"
            >
              <RefreshCw size={16} className={refreshing ? 'animate-spin' : ''} />
            </motion.button>
            <Badge variant={wsStatus === 'connected' ? 'success' : 'warning'} className="text-[11px]">
              {wsStatus === 'connected' ? (compact ? '●' : activeConn.name) : wsStatus === 'connecting' ? '…' : 'Offline'}
            </Badge>
          </div>
        </div>

        {!selectedAgent && !compact && (
          <p className="text-[12px] text-text/40 dark:text-text-inv/40 mb-4 truncate">{activeConn.serverUrl}</p>
        )}

        {!selectedAgent && (
          <div className="relative">
            <Search className="absolute left-4 top-1/2 -translate-y-1/2 text-text/40 dark:text-text-inv/40" size={compact ? 16 : 20} />
            <Input
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Search agents..."
              className={cn('pl-12 rounded-full bg-white dark:bg-card-alt', compact && 'pl-10 py-1.5 text-[13px]')}
            />
          </div>
        )}
      </div>

      <AnimatePresence mode="wait" initial={false}>
        {selectedAgent ? (
          <motion.div
            key={`conversations-${selectedAgent.id}`}
            initial={{ opacity: 0, x: 24 }}
            animate={{ opacity: 1, x: 0 }}
            exit={{ opacity: 0, x: -24 }}
            transition={{ type: 'spring', stiffness: 280, damping: 28 }}
            className="flex-1 min-h-0 flex flex-col"
          >
            <div className={cn('flex-1 overflow-y-auto space-y-2', compact ? 'px-2' : 'px-4')}>
              {loadingConversations ? (
                <div className="flex flex-col items-center justify-center py-16">
                  <Loader2 size={28} className="text-primary animate-spin mb-3" />
                  <p className="text-text/40 dark:text-text-inv/40 text-[14px]">Loading conversations…</p>
                </div>
              ) : conversations.length > 0 ? conversations.map((conversation, index) => (
                <motion.button
                  key={`${conversation.chatId}-${index}`}
                  type="button"
                  initial={{ opacity: 0, y: 16 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ delay: index * 0.04 }}
                  whileTap={{ scale: 0.98 }}
                  onClick={() => onOpenChat(selectedAgent.id, conversation.chatId)}
                  className={cn(
                    'w-full text-left bg-white dark:bg-card-alt rounded-[24px] p-4 border border-border/70 dark:border-border-dark/70 shadow-sm hover:border-primary/40 transition-colors'
                  )}
                >
                  <div className="flex items-center justify-between gap-3 mb-2">
                    <h3 className="font-semibold text-[15px] truncate text-text dark:text-text-inv">{conversation.chatId || 'New conversation'}</h3>
                    {conversation.timestamp && (
                      <span className="text-[11px] text-text/35 dark:text-text-inv/35 shrink-0">{formatRelativeTime(conversation.timestamp)}</span>
                    )}
                  </div>
                  <p className="text-[13px] text-text/45 dark:text-text-inv/45 line-clamp-2">
                    {conversation.lastMessage || 'No messages yet'}
                  </p>
                </motion.button>
              )) : (
                <div className="flex flex-col items-center justify-center text-center py-16 px-6">
                  <div className="w-16 h-16 rounded-full bg-primary/10 dark:bg-primary/15 flex items-center justify-center mb-4">
                    <Bot size={24} className="text-primary" />
                  </div>
                  <p className="text-[15px] font-medium text-text dark:text-text-inv mb-1">No saved conversations</p>
                  <p className="text-[13px] text-text/40 dark:text-text-inv/40">Start a new chat with {selectedAgent.name}</p>
                </div>
              )}
            </div>

            <div className={cn(
              'px-4 pb-4 pt-3 border-t border-border/70 dark:border-border-dark/70 bg-surface/95 dark:bg-surface-dark/95 backdrop-blur-xl',
              !compact && 'mb-4'
            )}>
              <Button className="w-full rounded-[24px]" onClick={() => onOpenChat(selectedAgent.id)}>
                <Plus size={16} />
                New Chat
              </Button>
            </div>
          </motion.div>
        ) : (
          <motion.div
            key="agents"
            initial={{ opacity: 0, x: -24 }}
            animate={{ opacity: 1, x: 0 }}
            exit={{ opacity: 0, x: 24 }}
            transition={{ type: 'spring', stiffness: 280, damping: 28 }}
            className={cn('flex flex-col gap-2', compact ? 'px-2' : 'px-4')}
          >
            {loadingAgents ? (
              <div className="flex flex-col items-center justify-center py-16">
                <Loader2 size={28} className="text-primary animate-spin mb-3" />
                <p className="text-text/40 dark:text-text-inv/40 text-[14px]">Loading agents…</p>
              </div>
            ) : filteredAgents.length > 0 ? filteredAgents.map((agent, index) => {
              const isActive = selectedAgent?.id === agent.id || (compact && activeAgentId === agent.id);
              const connId = activeConn.id;
              const lastMsg = getLastMessagePreview(agent.id, connId);
              const preview = lastMsg?.text
                ? (lastMsg.text.length > 50 ? `${lastMsg.text.slice(0, 50)}…` : lastMsg.text)
                : 'No messages yet';

              return (
                <motion.div
                  key={agent.id}
                  initial={{ opacity: 0, y: 20 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ delay: index * 0.05 }}
                  whileTap={{ scale: 0.98 }}
                  onClick={() => requestConversations(agent, true)}
                  className={cn(
                    'relative bg-white dark:bg-card-alt rounded-[24px] flex items-center gap-4 shadow-sm border cursor-pointer transition-colors',
                    compact ? 'p-3 rounded-[16px] gap-3' : 'p-4',
                    isActive
                      ? 'border-primary bg-primary/5 dark:bg-primary/10'
                      : 'border-border/50 dark:border-border-dark/50 hover:border-primary/30'
                  )}
                >
                  {/* Model badge - small top-right indicator */}
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
                      {lastMsg?.timestamp && (
                        <span className="text-[11px] text-text/50 dark:text-text-inv/50 shrink-0">{formatRelativeTime(lastMsg.timestamp)}</span>
                      )}
                    </div>
                    <p className={cn('text-text/40 dark:text-text-inv/40 truncate', compact ? 'text-[12px]' : 'text-[13px]')}>{preview}</p>
                  </div>
                </motion.div>
              );
            }) : (
              <div className="text-center text-text/40 dark:text-text-inv/40 mt-10">No agents found</div>
            )}
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
