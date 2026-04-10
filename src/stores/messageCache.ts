/**
 * In-memory message cache — populated once per connection on app startup,
 * then kept fresh by WebSocket events. NOT persisted.
 *
 * Architecture: Supabase is the source of truth. This cache avoids
 * repeated HTTP calls when navigating between agents/screens.
 */
import { syncMissedMessages, syncMessageToLocal, type SyncMessage } from '../services/suggestions';

export type CachedMessage = {
  id: string;
  sender: 'user' | 'ai';
  text: string;
  timestamp: number;
  mediaType?: string;
  mediaUrl?: string;
};

// connectionId → agentId → CachedMessage[]
const cache = new Map<string, Map<string, CachedMessage[]>>();

// Track which connections completed a full warm (separate from cache data)
const warmedConnections = new Set<string>();

const WARM_HOURS = 5;
const WARM_LIMIT = 500;
const MAX_CACHED_PER_AGENT = 500;

export function getMessages(connId: string, agentId: string): CachedMessage[] {
  return [...(cache.get(connId)?.get(agentId) ?? [])];
}

export function setMessages(connId: string, agentId: string, msgs: CachedMessage[]): void {
  let connMap = cache.get(connId);
  if (!connMap) { connMap = new Map(); cache.set(connId, connMap); }
  connMap.set(agentId, msgs);
}

export function appendMessage(connId: string, agentId: string, msg: CachedMessage): void {
  let connMap = cache.get(connId);
  if (!connMap) { connMap = new Map(); cache.set(connId, connMap); }
  const msgs = connMap.get(agentId) ?? [];
  if (msgs.some((m) => m.id === msg.id)) return;
  msgs.push(msg);
  // Evict oldest if over cap
  if (msgs.length > MAX_CACHED_PER_AGENT) msgs.splice(0, msgs.length - MAX_CACHED_PER_AGENT);
  connMap.set(agentId, msgs);
}

export function getLastMessage(connId: string, agentId: string): CachedMessage | undefined {
  const msgs = cache.get(connId)?.get(agentId);
  return msgs && msgs.length > 0 ? msgs[msgs.length - 1] : undefined;
}

export function getAllAgentIds(connId: string): string[] {
  const connMap = cache.get(connId);
  return connMap ? [...connMap.keys()] : [];
}

export function clearConnection(connId: string): void {
  cache.delete(connId);
  warmedConnections.delete(connId);
}

export function isWarmed(connId: string): boolean {
  return warmedConnections.has(connId);
}

/**
 * Bulk-load last 5 hours of messages for a connection (all agents).
 * Called once per connection on app startup. WS events arriving before
 * this completes do NOT prevent the bulk load (separate warmed flag).
 */
export async function warmCache(connId: string, channelId: string): Promise<void> {
  if (warmedConnections.has(connId)) return;

  const afterTs = Date.now() - WARM_HOURS * 3600 * 1000;

  // Paginate to get all messages (not just first 500)
  const allMessages: SyncMessage[] = [];
  let cursor = afterTs;
  for (let page = 0; page < 5; page++) {
    const result = await syncMissedMessages(channelId, cursor, WARM_LIMIT, connId);
    if (result.messages.length === 0) break;
    allMessages.push(...result.messages);
    if (!result.hasMore) break;
    cursor = result.messages[result.messages.length - 1].timestamp;
  }

  // Group by agent_id
  const byAgent = new Map<string, SyncMessage[]>();
  for (const msg of allMessages) {
    const agId = msg.agent_id || 'unknown';
    const list = byAgent.get(agId);
    if (list) list.push(msg);
    else byAgent.set(agId, [msg]);
  }

  // Convert and merge with any WS messages that arrived during fetch
  let connMap = cache.get(connId);
  if (!connMap) { connMap = new Map(); cache.set(connId, connMap); }

  for (const [agId, msgs] of byAgent) {
    const existing = connMap.get(agId) ?? [];
    const existingIds = new Set(existing.map((m) => m.id));
    const converted = msgs.map(syncMessageToLocal);
    // Merge: bulk data + any WS messages that arrived during fetch
    const merged = [...converted.filter((m) => !existingIds.has(m.id)), ...existing];
    merged.sort((a, b) => a.timestamp - b.timestamp);
    if (merged.length > MAX_CACHED_PER_AGENT) merged.splice(0, merged.length - MAX_CACHED_PER_AGENT);
    connMap.set(agId, merged);
  }

  warmedConnections.add(connId);
}
