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
      const agents = channel.loadCachedAgents(connectionId);

      for (const agent of agents) {
        try {
          // Get last local message timestamp for this agent
          const localMsgs = await loadConversationMessages(connectionId, agent.id, { limit: 1 });
          const lastTs = localMsgs.length > 0
            ? Math.max(...localMsgs.map((m) => m.timestamp || 0))
            : Date.now() - 24 * 60 * 60 * 1000; // Default: last 24h

          const remoteMsgs = await syncMissedMessages(conn.channelId, lastTs, 100, connectionId);
          if (remoteMsgs.length === 0) continue;

          // Convert to local format and save to IndexedDB
          const localFormat = remoteMsgs.map((m) => syncMessageToLocal(m));
          await saveConversationMessages(connectionId, agent.id, localFormat);

          // Update ChatList preview via event
          if (localFormat.length > 0) {
            const { saveAgentPreview } = await import('../components/chat/utils');
            saveAgentPreview(agent.id, connectionId, localFormat);
          }

          totalSynced += localFormat.length;
        } catch {
          // Skip failed agent, continue with others
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
