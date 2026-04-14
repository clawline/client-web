/**
 * Offline message outbox — queues messages when WS is disconnected,
 * auto-flushes when connection restores.
 *
 * Storage: In-memory Map backed by sessionStorage so unsent messages
 * survive page refresh within the same browser tab.
 *
 * Note: The async API (`enqueue`, `dequeue`, `getAll`, etc.) is retained
 * for backward compatibility. All operations are synchronous under the hood.
 */

const MAX_PENDING = 200;
const STORAGE_KEY = 'openclaw.outbox';

export type OutboxEntry = {
  id: string;
  connectionId: string;
  agentId: string;
  content: string;
  type: 'text' | 'media' | 'file';
  mediaUrl?: string;
  mimeType?: string;
  fileName?: string;
  replyTo?: string;
  quotedText?: string;
  timestamp: number;
};

const store = new Map<string, OutboxEntry>();

// ── Rehydrate from sessionStorage on module load ──

try {
  const raw = sessionStorage.getItem(STORAGE_KEY);
  if (raw) {
    const entries: OutboxEntry[] = JSON.parse(raw);
    for (const entry of entries) {
      if (entry.id) store.set(entry.id, entry);
    }
  }
} catch {
  // Corrupted or unavailable — start empty
}

function persist(): void {
  try {
    sessionStorage.setItem(STORAGE_KEY, JSON.stringify([...store.values()]));
  } catch {
    // sessionStorage full or unavailable — ignore
  }
}

export const OUTBOX_OVERFLOW_EVENT = 'openclaw:outbox-overflow';

export async function enqueue(entry: OutboxEntry): Promise<void> {
  if (!store.has(entry.id) && store.size >= MAX_PENDING) {
    // Evict oldest
    let oldestKey: string | undefined;
    let oldestTs = Infinity;
    for (const [k, v] of store) {
      if (v.timestamp < oldestTs) { oldestTs = v.timestamp; oldestKey = k; }
    }
    if (oldestKey) store.delete(oldestKey);
    window.dispatchEvent(new CustomEvent(OUTBOX_OVERFLOW_EVENT, {
      detail: { dropped: 1, total: store.size, connectionId: entry.connectionId, agentId: entry.agentId },
    }));
  }
  store.set(entry.id, entry);
  persist();
}

export async function dequeue(id: string): Promise<void> {
  store.delete(id);
  persist();
}

export async function getAll(): Promise<OutboxEntry[]> {
  return [...store.values()].sort((a, b) => a.timestamp - b.timestamp);
}

export async function getByConnection(connectionId: string): Promise<OutboxEntry[]> {
  return [...store.values()]
    .filter((e) => e.connectionId === connectionId)
    .sort((a, b) => a.timestamp - b.timestamp);
}

export async function clear(): Promise<void> {
  store.clear();
  persist();
}
