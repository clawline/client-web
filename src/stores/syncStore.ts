import { create } from 'zustand';
import { getConnections, getConnectionById } from '../services/connectionStore';
import * as channel from '../services/clawChannel';
import { syncMissedMessages, type SyncMessage } from '../services/suggestions';
import { saveConversationMessages, loadConversationMessages } from '../services/messageDB';

const SYNC_COMPLETED_EVENT = 'openclaw:sync-completed';
const MIN_SYNC_INTERVAL_MS = 30_000; // Don't re-sync same connection within 30s
const DEBOUNCE_MS = 5_000;
const MAX_SYNC_PAGES = 5; // Max pagination rounds (5 × 200 = 1000 messages)

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
      const chatId = conn.chatId || conn.channelId || undefined;
      let oldestLastTs = Date.now();
      for (const agent of agents) {
        const localMsgs = await loadConversationMessages(connectionId, agent.id, { chatId, limit: 1 });
        const ts = localMsgs.length > 0
          ? Math.max(...localMsgs.map((m) => m.timestamp || 0))
          : Date.now() - 24 * 60 * 60 * 1000;
        if (ts < oldestLastTs) oldestLastTs = ts;
      }

      // Paginated sync: loop until no more messages or max pages reached
      let cursor = oldestLastTs;
      const allRemoteMsgs: SyncMessage[] = [];

      for (let page = 0; page < MAX_SYNC_PAGES; page++) {
        const result = await syncMissedMessages(conn.channelId, cursor, 200, connectionId);
        if (result.messages.length === 0) break;

        allRemoteMsgs.push(...result.messages);

        // Move cursor to the last message's timestamp
        cursor = Math.max(...result.messages.map((m) => m.timestamp));

        if (!result.hasMore) break;
      }

      if (allRemoteMsgs.length === 0) {
        set((s) => ({
          syncStatus: { ...s.syncStatus, [connectionId]: 'done' },
          lastSyncTime: { ...s.lastSyncTime, [connectionId]: Date.now() },
        }));
        return 0;
      }

      // Group messages by agent_id
      const byAgent = new Map<string, SyncMessage[]>();
      for (const msg of allRemoteMsgs) {
        const agentId = msg.agent_id || 'unknown';
        const list = byAgent.get(agentId);
        if (list) list.push(msg);
        else byAgent.set(agentId, [msg]);
      }

      // Save each agent's messages separately — use chatId for correct scope
      const { saveAgentPreview } = await import('../components/chat/utils');
      for (const [agentId, msgs] of byAgent) {
        try {
          const localFormat = msgs.map((m) => syncMessageToLocal(m));
          await saveConversationMessages(connectionId, agentId, localFormat, { chatId });
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
