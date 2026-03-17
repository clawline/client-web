import { useState, useEffect, useCallback, useRef } from 'react';
import { motion } from 'motion/react';
import { Search, Bot, Server, WifiOff, Loader2, RefreshCw } from 'lucide-react';
import { Input } from '../components/ui/input';
import { Button } from '../components/ui/button';
import { Badge } from '../components/ui/badge';
import { cn } from '../lib/utils';
import { getActiveConnection } from '../services/connectionStore';
import * as channel from '../services/clawChannel';
import type { AgentInfo } from '../services/clawChannel';
import { getUserId } from '../App';

function loadCachedAgents(): AgentInfo[] {
  try {
    const raw = localStorage.getItem('openclaw.agentList');
    return raw ? JSON.parse(raw) : [];
  } catch { return []; }
}

export default function ChatList({ onOpenChat, onAddServer, compact, activeAgentId }: { onOpenChat: (agentId: string) => void; onAddServer: () => void; compact?: boolean; activeAgentId?: string | null }) {
  const [searchQuery, setSearchQuery] = useState('');
  const cached = loadCachedAgents();
  const [agents, setAgents] = useState<AgentInfo[]>(cached);
  const [wsStatus, setWsStatus] = useState<string>(channel.getStatus());
  const [loading, setLoading] = useState(cached.length === 0);
  const [activeConnId, setActiveConnId] = useState(() => getActiveConnection()?.id ?? null);
  const activeConn = getActiveConnection();
  const hasFetched = useRef(false);
  const [refreshing, setRefreshing] = useState(false);

  const fetchAgents = useCallback(() => {
    const conn = getActiveConnection();
    if (!conn) { setLoading(false); return; }

    setRefreshing(true);
    channel.connect({
      chatId: conn.chatId,
      senderId: conn.senderId || getUserId(),
      senderName: conn.displayName,
      serverUrl: conn.serverUrl,
      token: conn.token,
    });

    // If already connected (connect skipped due to same target),
    // status/connection.open callbacks won't fire — request agents directly
    if (channel.getStatus() === 'connected') {
      try { channel.requestAgentList(); } catch { /* ignore */ }
    }
  }, []);

  // Connect only on first mount or when activeConnId changes
  useEffect(() => {
    if (!activeConnId) { setLoading(false); return; }

    // If we have cached agents and already fetched, skip
    if (agents.length > 0 && hasFetched.current) return;

    fetchAgents();
    hasFetched.current = true;

    const unsubMsg = channel.onMessage((packet) => {
      if (packet.type === 'connection.open') {
        try { channel.requestAgentList(); } catch { /* ignore */ }
      }
      if (packet.type === 'agent.list') {
        const data = packet.data as { agents?: AgentInfo[] };
        if (Array.isArray(data.agents)) {
          setAgents(data.agents);
          try { localStorage.setItem('openclaw.agentList', JSON.stringify(data.agents)); } catch {}
        }
        setLoading(false);
        setRefreshing(false);
      }
    });

    const unsubStatus = channel.onStatus((status) => {
      setWsStatus(status);
      if (status === 'connected') {
        try { channel.requestAgentList(); } catch { /* ignore */ }
      }
    });

    return () => {
      unsubMsg();
      unsubStatus();
    };
  }, [activeConnId]);

  // If no agent.list response within 5s, show default agent
  useEffect(() => {
    if (!activeConn) return;
    const timer = setTimeout(() => {
      if (agents.length === 0) {
        setAgents([{ id: 'main', name: 'Claw', isDefault: true }]);
        setLoading(false);
      }
    }, 5000);
    return () => clearTimeout(timer);
  }, [activeConnId, agents.length]);

  const filtered = agents.filter((a) =>
    a.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
    a.id.toLowerCase().includes(searchQuery.toLowerCase())
  );

  // No active server
  if (!activeConn) {
    return (
      <div className={cn("flex flex-col h-full", !compact && "pb-32")}>
        <div className={cn("px-6 pb-4", compact ? "pt-4" : "pt-12")}>
          {!compact && <h1 className="text-3xl font-bold tracking-tight mb-6">Chats</h1>}
        </div>
        <div className="flex-1 flex flex-col items-center justify-center px-8 text-center">
          <div className="w-16 h-16 bg-[#EDF2F0] dark:bg-[#2d3748] rounded-full flex items-center justify-center mb-4">
            <Server size={28} className="text-[#2D3436]/30 dark:text-[#e2e8f0]/30" />
          </div>
          <p className="text-[#2D3436]/50 dark:text-[#e2e8f0]/50 text-[15px] mb-1">No server connected</p>
          <p className="text-[#2D3436]/30 dark:text-[#e2e8f0]/30 text-[13px] mb-6">Add a server in Profile to get started</p>
          <Button onClick={onAddServer}>
            <Server size={16} /> Add Server
          </Button>
        </div>
      </div>
    );
  }

  return (
    <div className={cn("flex flex-col h-full", !compact && "pb-32")}>
      <div className={cn(
        "sticky top-0 bg-[#F8FAFB]/80 dark:bg-[#1a1b2e]/80 backdrop-blur-xl z-10",
        compact ? "px-4 pt-3 pb-3" : "px-6 pt-12 pb-4"
      )}>
        <div className="flex justify-between items-center mb-2">
          {!compact && <h1 className="text-3xl font-bold tracking-tight">Chats</h1>}
          <div className={cn("flex items-center gap-2", compact && "w-full")}>
            {compact && (
              <span className="font-semibold text-[15px] flex-1 truncate">{activeConn.name}</span>
            )}
            <motion.button
              whileTap={{ scale: 0.9 }}
              onClick={() => { hasFetched.current = false; fetchAgents(); }}
              className="p-2 text-[#2D3436]/30 dark:text-[#e2e8f0]/30 hover:text-[#67B88B] transition-colors"
            >
              <RefreshCw size={16} className={refreshing ? 'animate-spin' : ''} />
            </motion.button>
            <Badge variant={wsStatus === 'connected' ? 'success' : 'warning'} className="text-[11px]">
              {wsStatus === 'connected' ? (compact ? '●' : activeConn.name) : wsStatus === 'connecting' ? '…' : 'Offline'}
            </Badge>
          </div>
        </div>
        {!compact && <p className="text-[12px] text-[#2D3436]/40 dark:text-[#e2e8f0]/40 mb-4 truncate">{activeConn.serverUrl}</p>}

        <div className="relative">
          <Search className="absolute left-4 top-1/2 -translate-y-1/2 text-[#2D3436]/40 dark:text-[#e2e8f0]/40" size={compact ? 16 : 20} />
          <Input
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="Search agents..."
            className={cn("pl-12 rounded-full bg-white dark:bg-[#232437]", compact && "pl-10 py-1.5 text-[13px]")}
          />
        </div>
      </div>

      <div className={cn("flex flex-col gap-2", compact ? "px-2" : "px-4")}>
        {loading ? (
          <div className="flex flex-col items-center justify-center py-16">
            <Loader2 size={28} className="text-[#67B88B] animate-spin mb-3" />
            <p className="text-[#2D3436]/40 dark:text-[#e2e8f0]/40 text-[14px]">Loading agents…</p>
          </div>
        ) : filtered.length > 0 ? filtered.map((agent, index) => {
          const isActive = compact && activeAgentId === agent.id;
          return (
          <motion.div
            key={agent.id}
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: index * 0.05 }}
            whileTap={{ scale: 0.98 }}
            onClick={() => onOpenChat(agent.id)}
            className={cn(
              "bg-white dark:bg-[#232437] rounded-[24px] flex items-center gap-4 shadow-sm border cursor-pointer transition-colors",
              compact ? "p-3 rounded-[16px] gap-3" : "p-4",
              isActive
                ? "border-[#67B88B] bg-[#67B88B]/5 dark:bg-[#67B88B]/10"
                : "border-[#EDF2F0]/50 dark:border-[#2d3748]/50 hover:border-[#67B88B]/30"
            )}
          >
            <div className={cn(
              "rounded-full bg-gradient-to-br from-[#67B88B] to-[#4a9a70] flex-shrink-0 flex items-center justify-center text-white shadow-sm",
              compact ? "w-10 h-10 text-lg" : "w-14 h-14 text-2xl"
            )}>
              {agent.identityEmoji || <Bot size={compact ? 18 : 24} />}
            </div>
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2 mb-0.5">
                <h3 className={cn("font-semibold truncate", compact ? "text-[14px]" : "text-[16px]")}>{agent.name}</h3>
                {agent.isDefault && (
                  <Badge className="text-[10px]">default</Badge>
                )}
              </div>
              <p className={cn("text-[#2D3436]/40 dark:text-[#e2e8f0]/40 truncate", compact ? "text-[12px]" : "text-[13px]")}>{agent.model || `Agent: ${agent.id}`}</p>
            </div>
          </motion.div>
          );
        }) : (
          <div className="text-center text-[#2D3436]/40 dark:text-[#e2e8f0]/40 mt-10">No agents found</div>
        )}
      </div>
    </div>
  );
}
