/**
 * Message cache — in-memory Map for synchronous reads, backed by IndexedDB
 * for persistence across page reloads and offline access.
 *
 * Read path: synchronous from memory (zero-latency UI).
 * Write path: memory immediately + async IndexedDB write (fire-and-forget).
 * Boot path: hydrate memory from IndexedDB before app renders chats.
 *
 * Indexed by (connId, agentId). Each message carries an optional chatId for
 * multi-conversation filtering at read time.
 */
import { openDB, type IDBPDatabase } from 'idb';
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

const DB_NAME = 'clawline';
const DB_VERSION = 1;
const STORE = 'messages';

const cache = new Map<string, Map<string, CachedMessage[]>>();
const warmedConnections = new Set<string>();

const WARM_LIMIT = 500;
const MAX_CACHED_PER_AGENT = 500;

let dbPromise: Promise<IDBPDatabase> | null = null;

function getDB(): Promise<IDBPDatabase> {
  if (!dbPromise) {
    dbPromise = openDB(DB_NAME, DB_VERSION, {
      upgrade(db) {
        if (!db.objectStoreNames.contains(STORE)) {
          // Composite key: `${connId}|${agentId}|${id}` so we can query by prefix.
          db.createObjectStore(STORE, { keyPath: 'key' });
        }
      },
    }).catch((err) => {
      console.warn('[messageCache] IndexedDB unavailable, falling back to in-memory only', err);
      throw err;
    });
  }
  return dbPromise;
}

function makeKey(connId: string, agentId: string, id: string): string {
  return `${connId}|${agentId}|${id}`;
}

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

/** Persist a message to IndexedDB. Fire-and-forget — failures don't block. */
async function persistMessage(connId: string, agentId: string, msg: CachedMessage): Promise<void> {
  try {
    const db = await getDB();
    await db.put(STORE, { key: makeKey(connId, agentId, msg.id), connId, agentId, ...msg });
  } catch { /* IndexedDB write failed — in-memory copy still valid */ }
}

/** Trim oldest messages from IndexedDB when bucket exceeds cap. */
async function trimPersistedBucket(connId: string, agentId: string): Promise<void> {
  try {
    const db = await getDB();
    const all = await db.getAll(STORE);
    const bucketEntries = all
      .filter((e: { connId: string; agentId: string }) => e.connId === connId && e.agentId === agentId)
      .sort((a: { timestamp: number }, b: { timestamp: number }) => a.timestamp - b.timestamp);
    const excess = bucketEntries.length - MAX_CACHED_PER_AGENT;
    if (excess <= 0) return;
    const tx = db.transaction(STORE, 'readwrite');
    for (let i = 0; i < excess; i++) {
      await tx.store.delete(bucketEntries[i].key);
    }
    await tx.done;
  } catch { /* ignore */ }
}

/** Read messages for an agent. If chatId is provided, returns only messages
 *  whose chatId matches OR is undefined. */
export function getMessages(connId: string, agentId: string, chatId?: string): CachedMessage[] {
  const msgs = bucket(connId, agentId);
  if (!msgs) return [];
  if (!chatId) return [...msgs];
  return msgs.filter((m) => !m.chatId || m.chatId === chatId);
}

export function appendMessage(connId: string, agentId: string, msg: CachedMessage): void {
  const msgs = ensureBucket(connId, agentId);
  if (msgs.some((m) => m.id === msg.id)) return;
  if (!msg.timestamp) msg.timestamp = Date.now();
  msgs.push(msg);
  let trimmed = false;
  if (msgs.length > MAX_CACHED_PER_AGENT) {
    msgs.splice(0, msgs.length - MAX_CACHED_PER_AGENT);
    trimmed = true;
  }
  // Persist async — never block UI
  void persistMessage(connId, agentId, msg);
  if (trimmed) void trimPersistedBucket(connId, agentId);
}

export function getLastMessage(connId: string, agentId: string): CachedMessage | undefined {
  const msgs = bucket(connId, agentId);
  return msgs && msgs.length > 0 ? msgs[msgs.length - 1] : undefined;
}

export function getAllAgentIds(connId: string): string[] {
  const connMap = cache.get(connId);
  return connMap ? [...connMap.keys()] : [];
}

export async function clearConnection(connId: string): Promise<void> {
  cache.delete(connId);
  warmedConnections.delete(connId);
  // Also purge from IndexedDB
  try {
    const db = await getDB();
    const all = await db.getAll(STORE);
    const tx = db.transaction(STORE, 'readwrite');
    for (const entry of all as Array<{ key: string; connId: string }>) {
      if (entry.connId === connId) await tx.store.delete(entry.key);
    }
    await tx.done;
  } catch { /* ignore */ }
}

export function isWarmed(connId: string): boolean {
  return warmedConnections.has(connId);
}

/**
 * Hydrate the in-memory cache from IndexedDB for a connection.
 * Call this on app boot — it's the "instant load" path.
 */
export async function hydrateFromDB(connId: string): Promise<void> {
  if (cache.has(connId)) return; // already loaded
  try {
    const db = await getDB();
    const all = await db.getAll(STORE);
    const byAgent = new Map<string, CachedMessage[]>();
    for (const entry of all as Array<CachedMessage & { key: string; connId: string; agentId: string }>) {
      if (entry.connId !== connId) continue;
      const list = byAgent.get(entry.agentId);
      const cleaned: CachedMessage = {
        id: entry.id, sender: entry.sender, text: entry.text, timestamp: entry.timestamp,
        mediaType: entry.mediaType, mediaUrl: entry.mediaUrl,
        threadId: entry.threadId, chatId: entry.chatId, meta: entry.meta,
      };
      if (list) list.push(cleaned);
      else byAgent.set(entry.agentId, [cleaned]);
    }
    for (const [agId, msgs] of byAgent) {
      msgs.sort((a, b) => a.timestamp - b.timestamp);
      ensureBucket(connId, agId).push(...msgs);
      saveAgentPreview(agId, connId, msgs);
    }
  } catch { /* IndexedDB unavailable — warmCache will load from network */ }
}

/**
 * Bulk-load recent messages from network. Call after hydrateFromDB to fill any gap.
 */
export async function warmCache(connId: string, channelId: string, mySenderId?: string | null): Promise<void> {
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
      appendMessage(connId, agId, syncMessageToLocal(m, mySenderId));
    }
    const merged = ensureBucket(connId, agId);
    merged.sort((a, b) => a.timestamp - b.timestamp);
    saveAgentPreview(agId, connId, merged);
  }

  warmedConnections.add(connId);
}
