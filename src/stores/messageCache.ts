/**
 * In-memory message cache — populated once per connection on app startup,
 * then kept fresh by WebSocket events. NOT persisted.
 *
 * Architecture: Supabase is the source of truth. This cache avoids
 * repeated HTTP calls when navigating between agents/screens.
 *
 * Indexed by (connId, agentId). Each message carries an optional chatId so
 * multi-conversation agents can be filtered per-chat at read time without
 * fragmenting the bucket (HTTP/SyncMessage doesn't surface chat_id, so HTTP-
 * loaded messages stay un-tagged and remain visible in every chat for that
 * agent — see getMessages).
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
  chatId?: string;
  meta?: Record<string, unknown>;
};

const cache = new Map<string, Map<string, CachedMessage[]>>();
const warmedConnections = new Set<string>();

const WARM_LIMIT = 500;
const MAX_CACHED_PER_AGENT = 500;

function bucket(connId: string, agentId: string): CachedMessage[] | undefined {
  return cache.get(connId)?.get(agentId);
}

function ensureBucket(connId: string, agentId: string): CachedMessage[] {
  let connMap = cache.get(connId);
  if (!connMap) { connMap = new Map(); cache.set(connId, connMap); }
  let msgs = connMap.get(agentId);
  if (!msgs) { msgs = []; connMap.set(agentId, msgs); }
  return msgs;
}

/** Read messages for an agent. If chatId is provided, returns only messages
 *  whose chatId matches OR is undefined (HTTP-loaded messages without a chatId
 *  stamp). */
export function getMessages(connId: string, agentId: string, chatId?: string): CachedMessage[] {
  const msgs = bucket(connId, agentId);
  if (!msgs) return [];
  if (!chatId) return [...msgs];
  return msgs.filter((m) => !m.chatId || m.chatId === chatId);
}

export function appendMessage(connId: string, agentId: string, msg: CachedMessage): void {
  const msgs = ensureBucket(connId, agentId);
  // Single dedup point — id is the conversation-wide unique key.
  if (msgs.some((m) => m.id === msg.id)) return;
  // Stamp a sortable timestamp at insert (N1) so callers don't need to fall
  // back to Date.now() at sort time.
  if (!msg.timestamp) msg.timestamp = Date.now();
  msgs.push(msg);
  if (msgs.length > MAX_CACHED_PER_AGENT) msgs.splice(0, msgs.length - MAX_CACHED_PER_AGENT);
}

export function getLastMessage(connId: string, agentId: string): CachedMessage | undefined {
  const msgs = bucket(connId, agentId);
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

  const result = await fetchOlderMessages(channelId, Date.now() + 1, undefined, WARM_LIMIT, connId);

  const byAgent = new Map<string, SyncMessage[]>();
  for (const msg of result.messages) {
    const agId = msg.agent_id || 'unknown';
    const list = byAgent.get(agId);
    if (list) list.push(msg);
    else byAgent.set(agId, [msg]);
  }

  for (const [agId, msgs] of byAgent) {
    for (const m of msgs) {
      appendMessage(connId, agId, syncMessageToLocal(m));
    }
    // Keep timestamp order after merging warm-load with any WS messages that
    // raced ahead.
    const merged = ensureBucket(connId, agId);
    merged.sort((a, b) => a.timestamp - b.timestamp);
    saveAgentPreview(agId, connId, merged);
  }

  warmedConnections.add(connId);
}
