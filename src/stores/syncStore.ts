import { create } from 'zustand';
import { getConnections, getConnectionById } from '../services/connectionStore';
import * as channel from '../services/clawChannel';
import { syncMissedMessages, type SyncMessage } from '../services/suggestions';
import { saveConversationMessages, loadConversationMessages } from '../services/messageDB';

const SYNC_COMPLETED_EVENT = 'openclaw:sync-completed';
const MIN_SYNC_INTERVAL_MS = 30_000; // Don't re-sync same connection within 30s
const DEBOUNCE_MS = 5_000;

export interface SyncState {
  syncStatus: Record<string, 'idle' | 'syncing' | 'done' | 'error'>;
  lastSyncTime: Record<string, number>;
  syncConnection: (connectionId: string) => Promise<number>;
  syncAll: () => Promise<void>;
}

let syncAllTimer: ReturnType<typeof setTimeout> | null = null;

function syncMessageToLocal(msg: SyncMessage) {
  return {
    id: msg.message_id || msg.id,
    sender: (msg.direction === 'outbound' ? 'ai' : 'user') as 'user' | 'ai',
    text: msg.content || '',
    timestamp: msg.timestamp,
    mediaType: msg.content_type !== 'text' ? msg.content_type : undefined,
    mediaUrl: msg.media_url || undefined,
  };
}

export const useSyncStore = create<SyncState>()((set, get) => ({
  syncStatus: {},
  lastSyncTime: {},

  syncConnection: async (connectionId: string) => {
    const state = get();

    // Throttle: skip if synced recently
    const lastSync = state.lastSyncTime[connectionId] || 0;
    if (Date.now() - lastSync < MIN_SYNC_INTERVAL_MS) return 0;

    // Lock: skip if already syncing
    if (state.syncStatus[connectionId] === 'syncing') return 0;

    const conn = getConnectionById(connectionId);
    if (!conn?.channelId) return 0;

    set((s) => ({ syncStatus: { ...s.syncStatus, [connectionId]: 'syncing' } }));

    let totalSynced = 0;

    try {
      // Find the oldest local message timestamp across all agents for this connection
      const agents = channel.loadCachedAgents(connectionId);
      let oldestLastTs = Date.now();
      for (const agent of agents) {
        const localMsgs = await loadConversationMessages(connectionId, agent.id, { limit: 1 });
        const ts = localMsgs.length > 0
          ? Math.max(...localMsgs.map((m) => m.timestamp || 0))
          : Date.now() - 24 * 60 * 60 * 1000;
        if (ts < oldestLastTs) oldestLastTs = ts;
      }

      // Sync once per channel (not per agent)
      const remoteMsgs = await syncMissedMessages(conn.channelId, oldestLastTs, 200, connectionId);
      if (remoteMsgs.length === 0) {
        set((s) => ({
          syncStatus: { ...s.syncStatus, [connectionId]: 'done' },
          lastSyncTime: { ...s.lastSyncTime, [connectionId]: Date.now() },
        }));
        return 0;
      }

      // Group messages by agent_id
      const byAgent = new Map<string, typeof remoteMsgs>();
      for (const msg of remoteMsgs) {
        const agentId = msg.agent_id || 'unknown';
        const list = byAgent.get(agentId);
        if (list) list.push(msg);
        else byAgent.set(agentId, [msg]);
      }

      // Save each agent's messages separately
      const { saveAgentPreview } = await import('../components/chat/utils');
      for (const [agentId, msgs] of byAgent) {
        try {
          const localFormat = msgs.map((m) => syncMessageToLocal(m));
          await saveConversationMessages(connectionId, agentId, localFormat);
          if (localFormat.length > 0) {
            saveAgentPreview(agentId, connectionId, localFormat);
          }
          totalSynced += localFormat.length;
        } catch {
          // Skip failed agent
        }
      }

      set((s) => ({
        syncStatus: { ...s.syncStatus, [connectionId]: 'done' },
        lastSyncTime: { ...s.lastSyncTime, [connectionId]: Date.now() },
      }));
    } catch {
      set((s) => ({ syncStatus: { ...s.syncStatus, [connectionId]: 'error' } }));
    }

    if (totalSynced > 0) {
      window.dispatchEvent(new CustomEvent(SYNC_COMPLETED_EVENT, {
        detail: { connectionId, count: totalSynced },
      }));
    }

    return totalSynced;
  },

  syncAll: async () => {
    // Debounce
    if (syncAllTimer) clearTimeout(syncAllTimer);
    await new Promise<void>((resolve) => {
      syncAllTimer = setTimeout(resolve, DEBOUNCE_MS);
    });

    const connections = getConnections();
    const connected = connections.filter(
      (c) => channel.getStatus(c.id) === 'connected',
    );

    await Promise.allSettled(
      connected.map((c) => get().syncConnection(c.id)),
    );
  },
}));

export { SYNC_COMPLETED_EVENT };
