import { useState, useEffect } from 'react';
import { Activity, Server, Wifi, WifiOff, Users, MessageSquare, RefreshCw } from 'lucide-react';
import { Card, CardHeader, CardTitle, CardContent } from '../components/ui/card';
import { Badge } from '../components/ui/badge';
import { getActiveConnection } from '../services/connectionStore';
import * as channel from '../services/clawChannel';
import { getUserId } from '../App';
import { motion } from 'motion/react';

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
};

const CACHE_KEY = 'openclaw.channelStatus';

function loadCachedStatus(): ChannelStatus | null {
  try {
    const raw = localStorage.getItem(CACHE_KEY);
    return raw ? JSON.parse(raw) : null;
  } catch { return null; }
}

function cacheStatus(s: ChannelStatus) {
  try { localStorage.setItem(CACHE_KEY, JSON.stringify(s)); } catch { /* ignore */ }
}

export default function Dashboard() {
  const cached = loadCachedStatus();
  const [status, setStatus] = useState<ChannelStatus | null>(cached);
  const [loading, setLoading] = useState(!cached);
  const [wsStatus, setWsStatus] = useState(channel.getStatus());
  const activeConn = getActiveConnection();

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
        try {
          channel.sendRaw({
            type: 'channel.status.get',
            data: { requestId: `status-${Date.now()}`, includeChats: false },
          });
        } catch { /* ignore */ }
      }
      if (packet.type === 'channel.status') {
        const s = packet.data as unknown as ChannelStatus;
        setStatus(s);
        cacheStatus(s);
        setLoading(false);
      }
    });

    const unsubStatus = channel.onStatus((s) => {
      setWsStatus(s);
      if (s === 'connected') {
        try {
          channel.sendRaw({
            type: 'channel.status.get',
            data: { requestId: `status-${Date.now()}`, includeChats: false },
          });
        } catch { /* ignore */ }
      }
    });

    const interval = setInterval(() => {
      try {
        channel.sendRaw({
          type: 'channel.status.get',
          data: { requestId: `status-${Date.now()}`, includeChats: false },
        });
      } catch { /* ignore */ }
    }, 10000);

    return () => {
      unsubMsg();
      unsubStatus();
      clearInterval(interval);
    };
  }, [activeConn?.id]);

  return (
    <div className="flex flex-col h-full pb-32 px-6 pt-12 max-w-4xl mx-auto w-full">
      <div className="flex items-center justify-between mb-6">
        <h1 className="text-3xl font-bold tracking-tight">Resources</h1>
        <div className="flex items-center gap-2">
          {activeConn && (
            <motion.button
              whileTap={{ scale: 0.9 }}
              onClick={() => {
                setLoading(true);
                try {
                  channel.sendRaw({
                    type: 'channel.status.get',
                    data: { requestId: `status-${Date.now()}`, includeChats: false },
                  });
                } catch { /* ignore */ }
              }}
              className="p-2 text-[#2D3436]/30 dark:text-[#e2e8f0]/30 hover:text-[#67B88B] transition-colors"
            >
              <RefreshCw size={16} className={loading ? 'animate-spin' : ''} />
            </motion.button>
          )}
          {activeConn && (
            <Badge variant={wsStatus === 'connected' ? 'success' : 'warning'}>
              {wsStatus === 'connected' ? 'Live' : 'Offline'}
            </Badge>
          )}
        </div>
      </div>

      <div className="flex flex-col gap-4">
        {/* Channel Status */}
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Server size={18} className="text-[#67B88B]" /> Channel Status
            </CardTitle>
          </CardHeader>
          <CardContent>
            {loading && !status ? (
              <div className="grid grid-cols-2 gap-3">
                <SkeletonItem /><SkeletonItem /><SkeletonItem /><SkeletonItem />
              </div>
            ) : status ? (
              <div className="grid grid-cols-2 gap-3">
                <StatusItem
                  icon={<Wifi size={16} className="text-[#67B88B]" />}
                  label="Mode"
                  value={status.mode}
                />
                <StatusItem
                  icon={<Activity size={16} className="text-[#67B88B]" />}
                  label="Running"
                  value={status.running ? 'Yes' : 'No'}
                />
                <StatusItem
                  icon={<Users size={16} className="text-[#5B8DEF]" />}
                  label="Active Chats"
                  value={String(status.connectedChatCount)}
                />
                <StatusItem
                  icon={<MessageSquare size={16} className="text-[#5B8DEF]" />}
                  label="Connections"
                  value={String(status.connectedSocketCount)}
                />
              </div>
            ) : activeConn ? (
              <div className="grid grid-cols-2 gap-3">
                <SkeletonItem /><SkeletonItem /><SkeletonItem /><SkeletonItem />
              </div>
            ) : (
              <div className="flex items-center justify-center py-8 text-[#2D3436]/30 dark:text-[#e2e8f0]/30 text-[14px]">
                Connect a server to view status
              </div>
            )}
          </CardContent>
        </Card>

        {/* Connection Info */}
        {activeConn && (
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Activity size={18} className="text-[#67B88B]" /> Connection Details
              </CardTitle>
            </CardHeader>
            <CardContent>
              {status ? (
                <div className="space-y-2 text-[14px]">
                  <div className="flex justify-between">
                    <span className="text-[#2D3436]/50 dark:text-[#e2e8f0]/50">Server</span>
                    <span className="font-medium truncate ml-4">{activeConn.name}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-[#2D3436]/50 dark:text-[#e2e8f0]/50">Port</span>
                    <span className="font-medium">{status.port}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-[#2D3436]/50 dark:text-[#e2e8f0]/50">Path</span>
                    <span className="font-medium">{status.path}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-[#2D3436]/50 dark:text-[#e2e8f0]/50">This Chat Connections</span>
                    <span className="font-medium">{status.currentChatConnectionCount}</span>
                  </div>
                </div>
              ) : (
                <div className="space-y-3">
                  <SkeletonLine /><SkeletonLine /><SkeletonLine /><SkeletonLine />
                </div>
              )}
            </CardContent>
          </Card>
        )}
      </div>
    </div>
  );
}

function StatusItem({ icon, label, value }: { icon: React.ReactNode; label: string; value: string }) {
  return (
    <div className="bg-[#F8FAFB] dark:bg-[#1a1b2e] p-3 rounded-[16px] border border-[#EDF2F0] dark:border-[#2d3748]">
      <div className="flex items-center gap-2 mb-1">{icon}<span className="text-[12px] text-[#2D3436]/50 dark:text-[#e2e8f0]/50">{label}</span></div>
      <div className="text-[16px] font-bold">{value}</div>
    </div>
  );
}

function SkeletonItem() {
  return (
    <div className="bg-[#F8FAFB] dark:bg-[#1a1b2e] p-3 rounded-[16px] border border-[#EDF2F0] dark:border-[#2d3748] animate-pulse">
      <div className="flex items-center gap-2 mb-2">
        <div className="w-4 h-4 rounded-full bg-[#EDF2F0] dark:bg-[#2d3748]" />
        <div className="h-3 w-12 rounded bg-[#EDF2F0] dark:bg-[#2d3748]" />
      </div>
      <div className="h-5 w-16 rounded bg-[#EDF2F0] dark:bg-[#2d3748]" />
    </div>
  );
}

function SkeletonLine() {
  return (
    <div className="flex justify-between animate-pulse">
      <div className="h-4 w-24 rounded bg-[#EDF2F0] dark:bg-[#2d3748]" />
      <div className="h-4 w-16 rounded bg-[#EDF2F0] dark:bg-[#2d3748]" />
    </div>
  );
}
