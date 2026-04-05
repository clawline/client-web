import { useState, useEffect, useCallback, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { Activity, ArrowUpRight, Server, Users, RefreshCw, Bot, Cpu, Zap, Clock, Radio, Shield } from 'lucide-react';
import { Card, CardHeader, CardTitle, CardContent } from '../components/ui/card';
import { Badge } from '../components/ui/badge';
import { cn } from '../lib/utils';
import { getActiveConnection, getConnections, setActiveConnectionId } from '../services/connectionStore';
import * as channel from '../services/clawChannel';
import type { AgentInfo } from '../services/clawChannel';
import { getUserId } from '../App';
import { motion, AnimatePresence } from 'motion/react';
import EmptyState from '../components/EmptyState';
import { getMessageStats, getRecentMessages, type MessageRecord, type MessageStats } from '../services/messageDB';

/* ── Types ────────────────────────────────────────────────── */

type ChannelStatus = {
  configured: boolean;
  enabled: boolean;
  running: boolean;
  mode: string;
  port: number;
  path: string;
  currentChatId: string;
  currentChatConnectionCount: number;
  connectedChatCount: number;
  connectedSocketCount: number;
  timestamp?: number;
  server?: {
    uptime: number;
    node: string;
    platform: string;
    memory: { rss: number; heapTotal: number; heapUsed: number; external: number };
    pid: number;
    time: string;
  };
};

type RelayHealth = {
  ok: boolean;
  backendCount: number;
  clientCount: number;
  channels: { channelId: string; label: string; backendConnected: boolean; clientCount: number }[];
  timestamp: number;
};

function getTodayStartTimestamp() {
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  return today.getTime();
}

function formatSummaryDate(date = new Date()) {
  return date.toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  });
}

function formatLastActivity(timestamp: number | null) {
  if (!timestamp) return 'No activity yet';
  return new Date(timestamp).toLocaleTimeString([], {
    hour: '2-digit',
    minute: '2-digit',
  });
}

function formatTimelineTime(timestamp: number) {
  return new Date(timestamp).toLocaleTimeString([], {
    hour: '2-digit',
    minute: '2-digit',
  });
}

function getMessagePreview(message: MessageRecord) {
  const source = message.text?.trim() || message.mediaType || 'Attachment';
  return source.length > 80 ? `${source.slice(0, 80)}…` : source;
}

function getAgentDisplayName(agentId: string | null, connectionId?: string) {
  if (!agentId) return 'Unknown agent';

  if (connectionId) {
    const matchedAgent = channel.loadCachedAgents(connectionId).find((agent) => agent.id === agentId);
    if (matchedAgent) {
      return `${matchedAgent.identityEmoji || '🤖'} ${matchedAgent.identityName || matchedAgent.name}`;
    }
  }

  for (const connection of getConnections()) {
    const matchedAgent = channel.loadCachedAgents(connection.id).find((agent) => agent.id === agentId);
    if (matchedAgent) {
      return `${matchedAgent.identityEmoji || '🤖'} ${matchedAgent.identityName || matchedAgent.name}`;
    }
  }

  return agentId;
}

/* ── Component ────────────────────────────────────────────── */

export default function Dashboard() {
  const navigate = useNavigate();
  const activeConn = getActiveConnection();
  const connId = activeConn?.id || '';
  const cached = activeConn ? channel.loadCachedChannelStatus<ChannelStatus>(activeConn.id) : null;
  const [status, setStatus] = useState<ChannelStatus | null>(cached);
  const [loading, setLoading] = useState(!cached);
  const [wsStatus, setWsStatus] = useState(connId ? channel.getStatus(connId) : 'disconnected');
  const [agents, setAgents] = useState<AgentInfo[]>(activeConn ? channel.loadCachedAgents(activeConn.id) : []);
  const [relayHealth, setRelayHealth] = useState<RelayHealth | null>(null);
  const [uptimeStr, setUptimeStr] = useState('');
  const [todayStats, setTodayStats] = useState<MessageStats | null>(null);
  const [recentMessages, setRecentMessages] = useState<MessageRecord[]>([]);
  const [activityLoading, setActivityLoading] = useState(true);
  const connectedSince = useRef<number | null>(null);

  useEffect(() => {
    if (!activeConn) {
      setStatus(null);
      setAgents([]);
      setLoading(false);
      setWsStatus('disconnected');
      return;
    }

    setStatus(channel.loadCachedChannelStatus<ChannelStatus>(activeConn.id));
    setAgents(channel.loadCachedAgents(activeConn.id));
    setLoading(!channel.loadCachedChannelStatus<ChannelStatus>(activeConn.id));
    setWsStatus(channel.getStatus(activeConn.id));
  }, [activeConn?.id]);

  /* ── Relay health fetch ─────────────────────────────────── */
  const fetchRelayHealth = useCallback(async () => {
    if (!activeConn) return;
    try {
      // Derive gateway URL from server URL
      const url = new URL(activeConn.serverUrl);
      const base = `${url.protocol === 'wss:' ? 'https:' : 'http:'}//${url.host}`;
      const res = await fetch(`${base}/healthz`, { signal: AbortSignal.timeout(5000) });
      if (res.ok) setRelayHealth(await res.json());
    } catch { /* ignore - gateway might not expose healthz to clients */ }
  }, [activeConn?.serverUrl]);

  const loadMessageInsights = useCallback(async (showLoading = false) => {
    if (showLoading) {
      setActivityLoading(true);
    }

    try {
      const [nextStats, nextRecentMessages] = await Promise.all([
        getMessageStats(getTodayStartTimestamp()),
        getRecentMessages(20),
      ]);
      setTodayStats(nextStats);
      setRecentMessages(nextRecentMessages);
    } catch {
      setTodayStats(null);
      setRecentMessages([]);
    } finally {
      setActivityLoading(false);
    }
  }, []);

  /* ── WebSocket listeners ────────────────────────────────── */
  useEffect(() => {
    if (!activeConn || !connId) return;

    channel.connect({
      connectionId: connId,
      chatId: activeConn.chatId,
      senderId: activeConn.senderId || getUserId(),
      senderName: activeConn.displayName,
      serverUrl: activeConn.serverUrl,
      token: activeConn.token,
    });

    const unsubMsg = channel.onMessage((packet) => {
      if (packet.type === 'connection.open') {
        connectedSince.current = Date.now();
        try {
          channel.sendRaw({ type: 'channel.status.get', data: { requestId: `st-${Date.now()}`, includeChats: true } }, connId);
          channel.requestAgentList(connId);
        } catch { /* ignore */ }
      }
      if (packet.type === 'channel.status') {
        const s = packet.data as unknown as ChannelStatus;
        setStatus(s);
        channel.saveCachedChannelStatus(connId, s);
        setLoading(false);
      }
      if (packet.type === 'agent.list') {
        const list = (packet.data as { agents?: AgentInfo[] })?.agents ?? [];
        setAgents(list);
        channel.saveCachedAgents(connId, list);
      }
    }, connId);

    const unsubStatus = channel.onStatus((s) => {
      setWsStatus(s);
      if (s === 'connected') {
        connectedSince.current = Date.now();
        try {
          channel.sendRaw({ type: 'channel.status.get', data: { requestId: `st-${Date.now()}`, includeChats: true } }, connId);
          channel.requestAgentList(connId);
        } catch { /* ignore */ }
      }
    }, connId);

    fetchRelayHealth();

    const pollInterval = setInterval(() => {
      try { channel.sendRaw({ type: 'channel.status.get', data: { requestId: `st-${Date.now()}`, includeChats: false } }, connId); } catch { /* ignore */ }
      fetchRelayHealth();
    }, 15000);

    return () => { unsubMsg(); unsubStatus(); clearInterval(pollInterval); };
  }, [activeConn?.id, connId, fetchRelayHealth]);

  useEffect(() => {
    if (!activeConn) return;

    void loadMessageInsights(true);

    const interval = setInterval(() => {
      void loadMessageInsights();
    }, 15000);

    return () => {
      clearInterval(interval);
    };
  }, [activeConn?.id, loadMessageInsights]);

  /* ── Uptime ticker ──────────────────────────────────────── */
  useEffect(() => {
    const tick = () => {
      if (wsStatus !== 'connected' || !connectedSince.current) { setUptimeStr(''); return; }
      const sec = Math.floor((Date.now() - connectedSince.current) / 1000);
      const h = Math.floor(sec / 3600);
      const m = Math.floor((sec % 3600) / 60);
      const s = sec % 60;
      setUptimeStr(h > 0 ? `${h}h ${m}m ${s}s` : m > 0 ? `${m}m ${s}s` : `${s}s`);
    };
    tick();
    const id = setInterval(tick, 1000);
    return () => clearInterval(id);
  }, [wsStatus]);

  /* ── Refresh handler ────────────────────────────────────── */
  const refresh = () => {
    setLoading(true);
    void loadMessageInsights(true);
    try {
      channel.sendRaw({ type: 'channel.status.get', data: { requestId: `st-${Date.now()}`, includeChats: true } }, connId);
      channel.requestAgentList(connId);
    } catch { /* ignore */ }
    fetchRelayHealth();
  };

  const openRecentMessage = useCallback((message: MessageRecord) => {
    if (!message.agentId) return;

    if (message.connectionId) {
      setActiveConnectionId(message.connectionId);
    }

    const params = new URLSearchParams();
    if (message.chatId) {
      params.set('chatId', message.chatId);
    }
    if (message.connectionId) {
      params.set('connectionId', message.connectionId);
    }

    navigate({
      pathname: `/chat/${encodeURIComponent(message.agentId)}`,
      search: params.toString() ? `?${params.toString()}` : '',
    });
  }, [navigate]);

  const isConnected = wsStatus === 'connected';
  const totalTodayMessages = (todayStats?.sentCount ?? 0) + (todayStats?.receivedCount ?? 0);
  const mostActiveAgentLabel = getAgentDisplayName(todayStats?.mostActiveAgent ?? null);

  /* ── Empty state ────────────────────────────────────────── */
  if (!activeConn) {
    return (
      <div className="flex flex-col items-center justify-center h-full px-6 text-center">
        <EmptyState
          icon={Server}
          title="No Server Connected"
          description="Connect to an OpenClaw server to view real-time status, agent fleet, and system health."
        />
      </div>
    );
  }

  return (
    <div className="flex flex-col h-full pb-32 px-6 pt-12 max-w-5xl mx-auto w-full overflow-y-auto">
      {/* Header */}
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-text dark:text-text-inv">Dashboard</h1>
          <p className="mt-0.5 text-[13px] text-slate-500 dark:text-slate-400">{activeConn.name || 'Server'}</p>
        </div>
        <div className="flex items-center gap-2">
          <motion.button whileTap={{ scale: 0.9 }} onClick={refresh} className="rounded-xl bg-white/85 p-2 text-slate-600 shadow-sm transition-colors hover:bg-white hover:text-text dark:bg-white/[0.06] dark:text-slate-300 dark:hover:bg-white/[0.1] dark:hover:text-text-inv">
            <RefreshCw size={16} className={loading ? 'animate-spin' : ''} />
          </motion.button>
          <StatusPill connected={isConnected} uptime={uptimeStr} />
        </div>
      </div>

      <div className="mb-4 flex flex-wrap gap-2">
        <InfoTag label="Runtime" value={status?.server?.node || 'Unknown'} />
        <InfoTag label="Mode" value={status?.mode ?? 'relay'} />
        <InfoTag label="Chats" value={String(status?.connectedChatCount ?? 0)} />
        <InfoTag label="Sockets" value={String(status?.connectedSocketCount ?? 0)} />
      </div>

      <div className="flex flex-col gap-4">
        <motion.div
          initial={{ opacity: 0, y: 14 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.26, ease: [0.22, 1, 0.36, 1] }}
        >
          <Card className="overflow-hidden border-primary/10 bg-gradient-to-r from-primary/5 to-info/5">
            <CardHeader className="pb-4">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div>
                  <CardTitle className="text-[18px]">📊 Today</CardTitle>
                  <p className="mt-1 text-[12px] text-slate-500 dark:text-slate-400">{formatSummaryDate()}</p>
                </div>
                <Badge variant="default" className="bg-white/70 dark:bg-card-alt/80 text-[11px]">
                  {activityLoading ? 'Syncing…' : `${totalTodayMessages} messages`}
                </Badge>
              </div>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
                <SummaryMetric label="Sent" value={String(todayStats?.sentCount ?? 0)} />
                <SummaryMetric label="Received" value={String(todayStats?.receivedCount ?? 0)} />
                <SummaryMetric label="Active agents" value={String(todayStats?.activeAgents.length ?? 0)} />
                <SummaryMetric
                  label="Most active"
                  value={mostActiveAgentLabel}
                  compact
                />
              </div>
              <div className="flex flex-wrap items-center justify-between gap-2 rounded-2xl bg-white/70 px-4 py-3 text-[12px] text-slate-500 shadow-sm dark:bg-card-alt/78 dark:text-slate-400">
                <span className="font-medium text-text dark:text-text-inv">Last activity</span>
                <span>{formatLastActivity(todayStats?.lastActivityTime ?? null)}</span>
              </div>
            </CardContent>
          </Card>
        </motion.div>

        {/* ── Stat Cards Row ────────────────────────────────── */}
        <div className="grid grid-cols-3 gap-3">
          <StatCard icon={<Radio size={16} />} label="Relay" value={isConnected ? (status?.mode ?? 'relay') : 'offline'} color={isConnected ? 'green' : 'red'} />
          <StatCard icon={<Users size={16} />} label="Chats" value={String(status?.connectedChatCount ?? 0)} color="blue" />
          <StatCard icon={<Zap size={16} />} label="Sockets" value={String(status?.connectedSocketCount ?? 0)} color="purple" />
        </div>

        {/* ── Agent Fleet ───────────────────────────────────── */}
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Bot size={18} className="text-primary" /> Agent Fleet
              <Badge variant="default" className="ml-auto text-[11px]">{agents.length}</Badge>
            </CardTitle>
          </CardHeader>
          <CardContent>
            {agents.length === 0 ? (
              <div className="py-4 text-center text-[13px] text-text/50 dark:text-text-inv/50">
                {loading ? 'Loading agents…' : 'No agents available'}
              </div>
            ) : (
              <div className="space-y-2">
                <AnimatePresence>
                  {agents.map((agent) => (
                    <AgentRow key={agent.id} agent={agent} />
                  ))}
                </AnimatePresence>
              </div>
            )}
          </CardContent>
        </Card>

        {/* ── Relay Channels ────────────────────────────────── */}
        {relayHealth && relayHealth.channels.length > 0 && (
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Shield size={18} className="text-info" /> Relay Channels
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="space-y-2">
                {relayHealth.channels.map((ch) => (
                  <div key={ch.channelId} className="flex items-center justify-between rounded-xl border border-border/70 bg-white/80 px-3 py-2.5 shadow-sm dark:border-border-dark/70 dark:bg-[#131420]">
                    <div className="flex items-center gap-2">
                      <PulseDot active={ch.backendConnected} />
                      <span className="text-[14px] font-medium text-text dark:text-text-inv">{ch.label || ch.channelId}</span>
                    </div>
                    <div className="flex items-center gap-2 text-[12px]">
                      <InfoPill active={ch.backendConnected}>{ch.backendConnected ? 'Backend' : 'Disconnected'}</InfoPill>
                      <span className="rounded-full border border-slate-300/70 bg-slate-900/[0.03] px-2 py-1 text-slate-500 dark:border-slate-700/70 dark:bg-white/[0.06] dark:text-slate-400">Clients {ch.clientCount}</span>
                    </div>
                  </div>
                ))}
              </div>
            </CardContent>
          </Card>
        )}

        {/* ── Server Stats ───────────────────────────────────── */}
        {status?.server && (
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Cpu size={18} className="text-[#a78bfa]" /> System
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="grid grid-cols-2 gap-x-4 gap-y-2 text-[14px]">
                <DetailRow label="Node.js" value={status.server.node} />
                <DetailRow label="Platform" value={status.server.platform} />
                <DetailRow label="PID" value={String(status.server.pid)} />
                <DetailRow label="Memory" value={`${Math.round(status.server.memory.rss / 1024 / 1024)} MB`} />
                <DetailRow label="Uptime" value={`${Math.floor(status.server.uptime / 60)}m`} />
                <DetailRow label="Time" value={new Date(status.server.time).toLocaleTimeString()} />
              </div>
            </CardContent>
          </Card>
        )}

        {/* ── Connection Details ─────────────────────────────── */}
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Activity size={18} className="text-primary" /> Connection
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="space-y-2.5 text-[14px]">
              <DetailRow label="Server" value={activeConn.name || activeConn.serverUrl} />
              <DetailRow label="Mode" value={status?.mode ?? '–'} />
              <DetailRow label="Status" value={isConnected ? '● Connected' : '○ Disconnected'} valueClass={isConnected ? 'text-primary' : 'text-red-400'} />
              {uptimeStr && <DetailRow label="Session" value={uptimeStr} />}
              <DetailRow label="This Chat" value={`${status?.currentChatConnectionCount ?? 0} connections`} />
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="flex items-center gap-2">
              <Clock size={18} className="text-primary" /> Recent Activity
              <Badge variant="default" className="ml-auto text-[11px]">{recentMessages.length}</Badge>
            </CardTitle>
          </CardHeader>
          <CardContent>
            {activityLoading ? (
              <div className="py-10 text-center text-[13px] text-text/50 dark:text-text-inv/50">
                Loading recent activity…
              </div>
            ) : recentMessages.length === 0 ? (
              <div className="py-10 text-center text-[13px] text-text/50 dark:text-text-inv/50">
                No recent messages yet.
              </div>
            ) : (
              <div className="relative pl-7">
                <div className="absolute left-2 top-1 bottom-1 w-0.5 rounded-full bg-primary/20" />
                <div className="space-y-2">
                  {recentMessages.map((message, index) => (
                    <button
                      key={`${message.connectionId}:${message.id}`}
                      type="button"
                      onClick={() => openRecentMessage(message)}
                      className={cn(
                        'relative w-full rounded-[22px] px-4 py-3 text-left transition-colors shadow-[0_14px_28px_-26px_rgba(15,23,42,0.24)]',
                        index % 2 === 0
                          ? 'bg-white hover:bg-slate-50 dark:bg-[#141b24] dark:hover:bg-[#18202a]'
                          : 'bg-slate-50/80 hover:bg-slate-100 dark:bg-[#101720] dark:hover:bg-[#141b24]'
                      )}
                    >
                      <span className="absolute -left-[21px] top-5 h-3 w-3 rounded-full border-2 border-primary bg-white dark:bg-[#11161d]" />
                      <div className="mb-1.5 flex flex-wrap items-center gap-2 text-[11px] text-slate-400 dark:text-slate-500">
                        <span>{formatTimelineTime(message.timestamp)}</span>
                        <Badge variant="default" className="bg-primary/8 text-[10px] text-primary dark:bg-primary/12">
                          {getAgentDisplayName(message.agentId, message.connectionId)}
                        </Badge>
                      </div>
                      <div className="flex items-start justify-between gap-3">
                        <p className="min-w-0 flex-1 text-[13px] text-slate-700 dark:text-slate-300">
                          {getMessagePreview(message)}
                        </p>
                        <ArrowUpRight size={14} className="mt-0.5 shrink-0 text-slate-300 dark:text-slate-500" />
                      </div>
                    </button>
                  ))}
                </div>
              </div>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}

/* ── Sub-components ───────────────────────────────────────── */

function StatusPill({ connected, uptime }: { connected: boolean; uptime: string }) {
  return (
    <div className={`flex items-center gap-1.5 px-3 py-1.5 rounded-full text-[12px] font-medium transition-colors ${
      connected
        ? 'border border-emerald-500/20 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300'
        : 'border border-red-500/20 bg-red-500/10 text-red-500 dark:text-red-300'
    }`}>
      <PulseDot active={connected} />
      {connected ? (uptime || 'Live') : 'Offline'}
    </div>
  );
}

function PulseDot({ active }: { active: boolean }) {
  return (
    <span className="relative flex h-2 w-2">
      {active && <span className="status-breathe absolute inline-flex h-full w-full rounded-full bg-emerald-500 opacity-75" />}
      <span className={`relative inline-flex rounded-full h-2 w-2 ${active ? 'bg-emerald-500' : 'bg-red-500'}`} />
    </span>
  );
}

function InfoTag({ label, value }: { label: string; value: string }) {
  return (
    <div className="inline-flex items-center gap-1.5 rounded-full border border-slate-300/75 bg-white/88 px-3 py-1.5 text-[11px] shadow-sm dark:border-slate-700/75 dark:bg-white/[0.06]">
      <span className="font-semibold uppercase tracking-[0.18em] text-slate-400 dark:text-slate-500">{label}</span>
      <span className="font-medium text-text dark:text-text-inv">{value}</span>
    </div>
  );
}

function InfoPill({ active, children }: { active: boolean; children: React.ReactNode }) {
  return (
    <span className={cn(
      'inline-flex items-center gap-1 rounded-full border px-2 py-1',
      active
        ? 'border-emerald-500/20 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300'
        : 'border-red-500/20 bg-red-500/10 text-red-500 dark:text-red-300'
    )}>
      <span className={cn('h-1.5 w-1.5 rounded-full', active ? 'bg-emerald-500' : 'bg-red-500')} />
      {children}
    </span>
  );
}

function StatCard({ icon, label, value, color }: { icon: React.ReactNode; label: string; value: string; color: 'green' | 'blue' | 'purple' | 'red' }) {
  const colors = {
    green: 'from-emerald-500/15 to-emerald-500/5 text-emerald-700 dark:text-emerald-300',
    blue: 'from-[#5B8DEF]/15 to-[#5B8DEF]/5 text-info',
    purple: 'from-[#a78bfa]/15 to-[#a78bfa]/5 text-[#a78bfa]',
    red: 'from-red-500/15 to-red-500/5 text-red-500 dark:text-red-300',
  };
  return (
    <div className={`bg-gradient-to-br ${colors[color]} rounded-2xl border border-border/60 p-3.5 shadow-[0_18px_36px_-28px_rgba(15,23,42,0.3)] dark:border-border-dark/60`}>
      <div className="mb-1.5 flex items-center gap-1.5 opacity-80">{icon}<span className="text-[11px] font-medium uppercase tracking-[0.18em]">{label}</span></div>
      <div className="text-[18px] font-bold capitalize text-text dark:text-text-inv">{value}</div>
    </div>
  );
}

function SummaryMetric({ label, value, compact = false }: { label: string; value: string; compact?: boolean }) {
  return (
    <div className="rounded-[24px] bg-white/75 px-4 py-3 shadow-sm dark:bg-card-alt/78">
      <div className="text-[11px] font-medium uppercase tracking-[0.18em] text-slate-400 dark:text-slate-500">
        {label}
      </div>
      <div className={cn(
        'mt-2 text-balance text-text dark:text-text-inv',
        compact ? 'text-lg font-semibold leading-tight' : 'text-3xl font-bold'
      )}>
        {value}
      </div>
    </div>
  );
}

function AgentRow({ agent }: { agent: AgentInfo }) {
  const emoji = agent.identityEmoji || '🤖';
  const name = agent.identityName || agent.name || agent.id;
  const model = agent.model || 'default';
  return (
    <motion.div
      initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }}
      className="flex items-center gap-3 rounded-xl border border-border/70 bg-white/80 px-3 py-2.5 shadow-[0_16px_30px_-26px_rgba(15,23,42,0.24)] transition-colors hover:border-primary/20 dark:border-border-dark/70 dark:bg-[#131420]"
    >
      <span className="text-lg">{emoji}</span>
      <div className="flex-1 min-w-0">
        <div className="truncate text-[14px] font-medium text-text dark:text-text-inv">{name}</div>
        <div className="flex items-center gap-1.5 text-[11px] text-slate-500 dark:text-slate-400">
          <Cpu size={10} /> <span className="rounded-full border border-slate-300/70 bg-slate-900/[0.03] px-2 py-0.5 text-[10px] font-medium dark:border-slate-700/70 dark:bg-white/[0.06]">{model}</span>
          {agent.isDefault && <Badge variant="success" className="text-[9px] px-1.5 py-0">default</Badge>}
        </div>
      </div>
      <PulseDot active />
    </motion.div>
  );
}

function DetailRow({ label, value, valueClass }: { label: string; value: string; valueClass?: string }) {
  return (
    <div className="flex items-center justify-between rounded-xl bg-white/62 px-3 py-2 dark:bg-white/[0.04]">
      <span className="text-slate-500 dark:text-slate-400">{label}</span>
      <span className={`ml-4 max-w-[60%] truncate text-right font-medium ${valueClass ?? 'text-text dark:text-text-inv'}`}>{value}</span>
    </div>
  );
}
