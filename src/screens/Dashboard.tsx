import { useState, useEffect, useCallback, useRef } from 'react';
import { Activity, Server, Wifi, WifiOff, Users, MessageSquare, RefreshCw, Bot, Cpu, Zap, Clock, Radio, Shield } from 'lucide-react';
import { Card, CardHeader, CardTitle, CardContent } from '../components/ui/card';
import { Badge } from '../components/ui/badge';
import { getActiveConnection } from '../services/connectionStore';
import * as channel from '../services/clawChannel';
import type { AgentInfo } from '../services/clawChannel';
import { getUserId } from '../App';
import { motion, AnimatePresence } from 'motion/react';
import EmptyState from '../components/EmptyState';

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

/* ── Cache helpers ────────────────────────────────────────── */

const CACHE_KEY = 'openclaw.channelStatus';
const AGENT_CACHE_KEY = 'openclaw.agentList';

function loadCachedStatus(): ChannelStatus | null {
  try { const raw = localStorage.getItem(CACHE_KEY); return raw ? JSON.parse(raw) : null; } catch { return null; }
}
function cacheStatus(s: ChannelStatus) {
  try { localStorage.setItem(CACHE_KEY, JSON.stringify(s)); } catch { /* ignore */ }
}
function loadCachedAgents(): AgentInfo[] {
  try { const raw = localStorage.getItem(AGENT_CACHE_KEY); return raw ? JSON.parse(raw) : []; } catch { return []; }
}

/* ── Component ────────────────────────────────────────────── */

export default function Dashboard() {
  const cached = loadCachedStatus();
  const [status, setStatus] = useState<ChannelStatus | null>(cached);
  const [loading, setLoading] = useState(!cached);
  const [wsStatus, setWsStatus] = useState(channel.getStatus());
  const [agents, setAgents] = useState<AgentInfo[]>(loadCachedAgents());
  const [relayHealth, setRelayHealth] = useState<RelayHealth | null>(null);
  const [uptimeStr, setUptimeStr] = useState('');
  const activeConn = getActiveConnection();
  const connectedSince = useRef<number | null>(null);

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

  /* ── WebSocket listeners ────────────────────────────────── */
  useEffect(() => {
    if (!activeConn) return;

    channel.connect({
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
          channel.sendRaw({ type: 'channel.status.get', data: { requestId: `st-${Date.now()}`, includeChats: true } });
          channel.requestAgentList();
        } catch { /* ignore */ }
      }
      if (packet.type === 'channel.status') {
        const s = packet.data as unknown as ChannelStatus;
        setStatus(s);
        cacheStatus(s);
        setLoading(false);
      }
      if (packet.type === 'agent.list') {
        const list = (packet.data as { agents?: AgentInfo[] })?.agents ?? [];
        setAgents(list);
      }
    });

    const unsubStatus = channel.onStatus((s) => {
      setWsStatus(s);
      if (s === 'connected') {
        connectedSince.current = Date.now();
        try {
          channel.sendRaw({ type: 'channel.status.get', data: { requestId: `st-${Date.now()}`, includeChats: true } });
          channel.requestAgentList();
        } catch { /* ignore */ }
      }
    });

    fetchRelayHealth();

    const pollInterval = setInterval(() => {
      try { channel.sendRaw({ type: 'channel.status.get', data: { requestId: `st-${Date.now()}`, includeChats: false } }); } catch { /* ignore */ }
      fetchRelayHealth();
    }, 15000);

    return () => { unsubMsg(); unsubStatus(); clearInterval(pollInterval); };
  }, [activeConn?.id, fetchRelayHealth]);

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
    try {
      channel.sendRaw({ type: 'channel.status.get', data: { requestId: `st-${Date.now()}`, includeChats: true } });
      channel.requestAgentList();
    } catch { /* ignore */ }
    fetchRelayHealth();
  };

  const isConnected = wsStatus === 'connected';

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
    <div className="flex flex-col h-full pb-32 px-6 pt-12 max-w-4xl mx-auto w-full overflow-y-auto">
      {/* Header */}
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Dashboard</h1>
          <p className="text-[13px] text-text/40 dark:text-text-inv/40 mt-0.5">{activeConn.name || 'Server'}</p>
        </div>
        <div className="flex items-center gap-2">
          <motion.button whileTap={{ scale: 0.9 }} onClick={refresh} className="p-2 text-text/50 dark:text-text-inv/50 hover:text-primary transition-colors">
            <RefreshCw size={16} className={loading ? 'animate-spin' : ''} />
          </motion.button>
          <StatusPill connected={isConnected} uptime={uptimeStr} />
        </div>
      </div>

      <div className="flex flex-col gap-4">
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
                  <div key={ch.channelId} className="flex items-center justify-between px-3 py-2.5 rounded-xl bg-surface dark:bg-[#131420] border border-border dark:border-border-dark">
                    <div className="flex items-center gap-2">
                      <PulseDot active={ch.backendConnected} />
                      <span className="font-medium text-[14px]">{ch.label || ch.channelId}</span>
                    </div>
                    <div className="flex items-center gap-3 text-[12px] text-text/50 dark:text-text-inv/50">
                      <span>{ch.backendConnected ? '🟢 Backend' : '🔴 Disconnected'}</span>
                      <span>👥 {ch.clientCount}</span>
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
      </div>
    </div>
  );
}

/* ── Sub-components ───────────────────────────────────────── */

function StatusPill({ connected, uptime }: { connected: boolean; uptime: string }) {
  return (
    <div className={`flex items-center gap-1.5 px-3 py-1.5 rounded-full text-[12px] font-medium transition-colors ${
      connected
        ? 'bg-primary/10 text-primary border border-primary/20'
        : 'bg-red-500/10 text-red-400 border border-red-500/20'
    }`}>
      <PulseDot active={connected} />
      {connected ? (uptime || 'Live') : 'Offline'}
    </div>
  );
}

function PulseDot({ active }: { active: boolean }) {
  return (
    <span className="relative flex h-2 w-2">
      {active && <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-primary opacity-75" />}
      <span className={`relative inline-flex rounded-full h-2 w-2 ${active ? 'bg-primary' : 'bg-red-400'}`} />
    </span>
  );
}

function StatCard({ icon, label, value, color }: { icon: React.ReactNode; label: string; value: string; color: 'green' | 'blue' | 'purple' | 'red' }) {
  const colors = {
    green: 'from-primary/15 to-primary/5 text-primary',
    blue: 'from-[#5B8DEF]/15 to-[#5B8DEF]/5 text-info',
    purple: 'from-[#a78bfa]/15 to-[#a78bfa]/5 text-[#a78bfa]',
    red: 'from-red-500/15 to-red-500/5 text-red-400',
  };
  return (
    <div className={`bg-gradient-to-br ${colors[color]} rounded-2xl p-3.5 border border-white/5`}>
      <div className="flex items-center gap-1.5 mb-1.5 opacity-70">{icon}<span className="text-[11px] font-medium uppercase tracking-wider">{label}</span></div>
      <div className="text-[18px] font-bold capitalize">{value}</div>
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
      className="flex items-center gap-3 px-3 py-2.5 rounded-xl bg-surface dark:bg-[#131420] border border-border dark:border-border-dark hover:border-primary/30 transition-colors"
    >
      <span className="text-xl">{emoji}</span>
      <div className="flex-1 min-w-0">
        <div className="font-medium text-[14px] truncate">{name}</div>
        <div className="text-[11px] text-text/40 dark:text-text-inv/40 flex items-center gap-1.5">
          <Cpu size={10} /> {model}
          {agent.isDefault && <Badge variant="success" className="text-[9px] px-1.5 py-0">default</Badge>}
        </div>
      </div>
      <PulseDot active />
    </motion.div>
  );
}

function DetailRow({ label, value, valueClass }: { label: string; value: string; valueClass?: string }) {
  return (
    <div className="flex justify-between items-center">
      <span className="text-text/50 dark:text-text-inv/50">{label}</span>
      <span className={`font-medium truncate ml-4 max-w-[60%] text-right ${valueClass ?? ''}`}>{value}</span>
    </div>
  );
}
