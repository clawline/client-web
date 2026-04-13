/**
 * In-memory message cache — populated once per connection on app startup,
 * then kept fresh by WebSocket events. NOT persisted.
 *
 * Architecture: Supabase is the source of truth. This cache avoids
 * repeated HTTP calls when navigating between agents/screens.
 */
import { fetchOlderMessages, syncMessageToLocal, type SyncMessage } from '../services/suggestions';
import { saveAgentPreview } from '../components/chat/utils';

export type CachedMessage = {
  id: string;
  sender: 'user' | 'ai';
  text: string;
  timestamp: number;
  mediaType?: string;
  mediaUrl?: string;
  threadId?: string;
};

// connectionId → agentId → CachedMessage[]
const cache = new Map<string, Map<string, CachedMessage[]>>();

// Track which connections completed a full warm (separate from cache data)
const warmedConnections = new Set<string>();

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
 * Bulk-load recent messages for a connection (all agents, no time filter).
 * Uses `before=now` to fetch the most recent N messages regardless of age,
 * ensuring every agent with history gets its last message for previews.
 */
export async function warmCache(connId: string, channelId: string): Promise<void> {
  if (warmedConnections.has(connId)) return;

  // Fetch most recent messages (no time filter — uses `before=now`, desc order)
  const result = await fetchOlderMessages(channelId, Date.now() + 1, undefined, WARM_LIMIT, connId);

  // Group by agent_id
  const byAgent = new Map<string, SyncMessage[]>();
  for (const msg of result.messages) {
    const agId = msg.agent_id || 'unknown';
    const list = byAgent.get(agId);
    if (list) list.push(msg);
    else byAgent.set(agId, [msg]);
  }

  // Convert, merge with WS messages, and update ChatList previews
  let connMap = cache.get(connId);
  if (!connMap) { connMap = new Map(); cache.set(connId, connMap); }

  for (const [agId, msgs] of byAgent) {
    const existing = connMap.get(agId) ?? [];
    const existingIds = new Set(existing.map((m) => m.id));
    const converted = msgs.map(syncMessageToLocal);
    const merged = [...converted.filter((m) => !existingIds.has(m.id)), ...existing];
    merged.sort((a, b) => a.timestamp - b.timestamp);
    if (merged.length > MAX_CACHED_PER_AGENT) merged.splice(0, merged.length - MAX_CACHED_PER_AGENT);
    connMap.set(agId, merged);

    // Update ChatList sidebar preview for this agent
    saveAgentPreview(agId, connId, merged);
  }

  warmedConnections.add(connId);
}
