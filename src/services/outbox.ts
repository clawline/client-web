/**
 * Offline message outbox — queues messages when WS is disconnected,
 * auto-flushes when connection restores.
 *
 * Storage: IndexedDB 'clawline-outbox' store
 * Each entry = one unsent message with full payload to replay via sendText/sendMedia.
 */

const DB_NAME = 'clawline-outbox';
const DB_VERSION = 2; // v2: added connectionId index
const STORE_NAME = 'pending';
const MAX_PENDING = 200; // soft cap to prevent unbounded growth

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
  quotedText?: string;
  timestamp: number;
};

// S5: Clear cached promise on error so subsequent calls can retry
// S6: Handle db.onclose / db.onversionchange for zombie references
let dbPromise: Promise<IDBDatabase> | null = null;

function openDB(): Promise<IDBDatabase> {
  if (dbPromise) return dbPromise;
  dbPromise = new Promise<IDBDatabase>((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        const store = db.createObjectStore(STORE_NAME, { keyPath: 'id' });
        store.createIndex('connectionId', 'connectionId', { unique: false });
      } else {
        // v2 migration: add index if missing
        const tx = req.transaction!;
        const store = tx.objectStore(STORE_NAME);
        if (!store.indexNames.contains('connectionId')) {
          store.createIndex('connectionId', 'connectionId', { unique: false });
        }
      }
    };
    req.onsuccess = () => {
      const db = req.result;
      // S6: reset on unexpected close / version change
      db.onclose = () => { dbPromise = null; };
      db.onversionchange = () => { db.close(); dbPromise = null; };
      resolve(db);
    };
    req.onerror = () => {
      dbPromise = null; // S5: allow retry on next call
      reject(req.error);
    };
  });
  return dbPromise;
}

export async function enqueue(entry: OutboxEntry): Promise<void> {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, 'readwrite');
    const store = tx.objectStore(STORE_NAME);

    // Nit: enforce soft cap — evict oldest if over limit
    const countReq = store.count();
    countReq.onsuccess = () => {
      if (countReq.result >= MAX_PENDING) {
        // Delete oldest entry by cursor
        const cursor = store.openCursor();
        cursor.onsuccess = () => {
          if (cursor.result) cursor.result.delete();
        };
      }
      store.put(entry);
    };

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
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, 'readonly');
    const index = tx.objectStore(STORE_NAME).index('connectionId');
    const req = index.getAll(connectionId);
    req.onsuccess = () => {
      const entries = (req.result || []) as OutboxEntry[];
      resolve(entries.sort((a, b) => a.timestamp - b.timestamp));
    };
    req.onerror = () => reject(req.error);
  });
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
