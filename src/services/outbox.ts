/**
 * Offline message outbox — queues messages when WS is disconnected,
 * auto-flushes when connection restores.
 *
 * Storage: IndexedDB 'clawline-outbox' store
 * Each entry = one unsent message with full payload to replay via sendText/sendMedia.
 */

const DB_NAME = 'clawline-outbox';
const DB_VERSION = 1;
const STORE_NAME = 'pending';

export type OutboxEntry = {
  id: string; // messageId (same as displayed in UI)
  connectionId: string;
  agentId: string;
  content: string;
  type: 'text' | 'media' | 'file';
  mediaUrl?: string;
  mimeType?: string;
  fileName?: string;
  replyTo?: string;
  timestamp: number;
};

let dbPromise: Promise<IDBDatabase> | null = null;

function openDB(): Promise<IDBDatabase> {
  if (dbPromise) return dbPromise;
  dbPromise = new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        db.createObjectStore(STORE_NAME, { keyPath: 'id' });
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
  return dbPromise;
}

export async function enqueue(entry: OutboxEntry): Promise<void> {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, 'readwrite');
    tx.objectStore(STORE_NAME).put(entry);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

export async function dequeue(id: string): Promise<void> {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, 'readwrite');
    tx.objectStore(STORE_NAME).delete(id);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

export async function getAll(): Promise<OutboxEntry[]> {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, 'readonly');
    const req = tx.objectStore(STORE_NAME).getAll();
    req.onsuccess = () => resolve((req.result || []) as OutboxEntry[]);
    req.onerror = () => reject(req.error);
  });
}

export async function getByConnection(connectionId: string): Promise<OutboxEntry[]> {
  const all = await getAll();
  return all.filter((e) => e.connectionId === connectionId).sort((a, b) => a.timestamp - b.timestamp);
}

export async function clear(): Promise<void> {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, 'readwrite');
    tx.objectStore(STORE_NAME).clear();
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}
