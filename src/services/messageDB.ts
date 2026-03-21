import { getConnections } from './connectionStore';
import { loadCachedAgents } from './clawChannel';

const DATABASE_NAME = 'clawline-messages';
const DATABASE_VERSION = 1;
const STORE_MESSAGES = 'messages';
const LOCAL_STORAGE_PREFIX = 'openclaw.messages.';
const DEFAULT_LOAD_LIMIT = 200;
const DEFAULT_SEARCH_LIMIT = 100;

const INDEX_BY_AGENT = 'by-agent';
const INDEX_BY_AGENT_TIMESTAMP = 'by-agent-timestamp';
const INDEX_BY_TIMESTAMP = 'by-timestamp';
const INDEX_BY_TEXT = 'by-text';
const INDEX_BY_SCOPE = 'by-scope';
const INDEX_BY_SCOPE_TIMESTAMP = 'by-scope-timestamp';

export type MessageRecord = {
  id: string;
  connectionId: string;
  agentId: string;
  sender: 'user' | 'ai';
  text: string;
  timestamp: number;
  reactions: string[];
  mediaType?: string;
  mediaUrl?: string;
  replyTo?: string;
  isStreaming?: boolean;
  chatId?: string;
};

export type MessageInput = {
  id: string;
  sender: 'user' | 'ai';
  text: string;
  timestamp?: number;
  reactions?: string[];
  mediaType?: string;
  mediaUrl?: string;
  replyTo?: string;
  isStreaming?: boolean;
};

type StoredMessageRecord = MessageRecord & {
  key: string;
  scopeId: string;
};

export type MessageSearchOptions = {
  connectionId?: string;
  agentId?: string;
  sender?: MessageRecord['sender'];
  mediaType?: string;
  commandOnly?: boolean;
  limit?: number;
};

export type AgentMessageRef = {
  connectionId: string;
  agentId: string;
};

type MessagePreview = {
  text: string;
  timestamp?: number;
};

type ConversationScopeOptions = {
  chatId?: string | null;
  limit?: number;
};

export type MessageStats = {
  sentCount: number;
  receivedCount: number;
  activeAgents: string[];
  mostActiveAgent: string | null;
  lastActivityTime: number | null;
};

let databasePromise: Promise<IDBDatabase> | null = null;

function hasIndexedDBSupport() {
  return typeof window !== 'undefined' && typeof window.indexedDB !== 'undefined';
}

function waitForTransaction(transaction: IDBTransaction) {
  return new Promise<void>((resolve, reject) => {
    transaction.oncomplete = () => resolve();
    transaction.onabort = () => reject(transaction.error ?? new Error('IndexedDB transaction aborted.'));
    transaction.onerror = () => reject(transaction.error ?? new Error('IndexedDB transaction failed.'));
  });
}

function buildScopeId(agentId: string, chatId?: string | null) {
  return chatId || agentId || 'default';
}

function buildRecordKey(connectionId: string, scopeId: string, messageId: string) {
  return `${connectionId}::${scopeId}::${messageId}`;
}

function normalizeMessage(
  connectionId: string,
  agentId: string,
  message: MessageInput,
  chatId?: string | null,
): StoredMessageRecord {
  const scopeId = buildScopeId(agentId, chatId);
  const timestamp = typeof message.timestamp === 'number' ? message.timestamp : Date.now();
  return {
    key: buildRecordKey(connectionId, scopeId, message.id),
    scopeId,
    id: message.id,
    connectionId,
    agentId,
    sender: message.sender,
    text: message.text ?? '',
    timestamp,
    reactions: Array.isArray(message.reactions) ? message.reactions : [],
    mediaType: message.mediaType,
    mediaUrl: message.mediaUrl,
    replyTo: message.replyTo,
    isStreaming: message.isStreaming,
    chatId: chatId || undefined,
  };
}

function toPublicMessage(record: StoredMessageRecord): MessageRecord {
  return {
    id: record.id,
    connectionId: record.connectionId,
    agentId: record.agentId,
    sender: record.sender,
    text: record.text,
    timestamp: record.timestamp,
    reactions: record.reactions,
    mediaType: record.mediaType,
    mediaUrl: record.mediaUrl,
    replyTo: record.replyTo,
    isStreaming: record.isStreaming,
    chatId: record.chatId,
  };
}

function ensureIndexes(store: IDBObjectStore) {
  if (!store.indexNames.contains(INDEX_BY_AGENT)) {
    store.createIndex(INDEX_BY_AGENT, ['connectionId', 'agentId'], { unique: false });
  }
  if (!store.indexNames.contains(INDEX_BY_AGENT_TIMESTAMP)) {
    store.createIndex(INDEX_BY_AGENT_TIMESTAMP, ['connectionId', 'agentId', 'timestamp'], { unique: false });
  }
  if (!store.indexNames.contains(INDEX_BY_TIMESTAMP)) {
    store.createIndex(INDEX_BY_TIMESTAMP, 'timestamp', { unique: false });
  }
  if (!store.indexNames.contains(INDEX_BY_TEXT)) {
    store.createIndex(INDEX_BY_TEXT, 'text', { unique: false });
  }
  if (!store.indexNames.contains(INDEX_BY_SCOPE)) {
    store.createIndex(INDEX_BY_SCOPE, ['connectionId', 'scopeId'], { unique: false });
  }
  if (!store.indexNames.contains(INDEX_BY_SCOPE_TIMESTAMP)) {
    store.createIndex(INDEX_BY_SCOPE_TIMESTAMP, ['connectionId', 'scopeId', 'timestamp'], { unique: false });
  }
}

async function openDatabase() {
  if (!hasIndexedDBSupport()) {
    throw new Error('IndexedDB is not supported in this environment.');
  }

  if (!databasePromise) {
    databasePromise = new Promise<IDBDatabase>((resolve, reject) => {
      const request = window.indexedDB.open(DATABASE_NAME, DATABASE_VERSION);

      request.onupgradeneeded = () => {
        const database = request.result;
        const store = database.objectStoreNames.contains(STORE_MESSAGES)
          ? request.transaction?.objectStore(STORE_MESSAGES)
          : database.createObjectStore(STORE_MESSAGES, { keyPath: 'key' });

        if (!store) {
          throw new Error('Failed to initialize IndexedDB object store.');
        }

        ensureIndexes(store);
      };

      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error ?? new Error('Failed to open IndexedDB.'));
    });
  }

  return databasePromise;
}

async function withStore<T>(
  mode: IDBTransactionMode,
  run: (store: IDBObjectStore, transaction: IDBTransaction) => Promise<T>,
) {
  const database = await openDatabase();
  const transaction = database.transaction(STORE_MESSAGES, mode);
  const store = transaction.objectStore(STORE_MESSAGES);
  return run(store, transaction);
}

async function loadByScope(connectionId: string, scopeId: string, limit = DEFAULT_LOAD_LIMIT) {
  if (!connectionId || !scopeId || !hasIndexedDBSupport()) {
    return [];
  }

  return withStore('readonly', async (store) => {
    const index = store.index(INDEX_BY_SCOPE_TIMESTAMP);
    const range = IDBKeyRange.bound(
      [connectionId, scopeId, Number.MIN_SAFE_INTEGER],
      [connectionId, scopeId, Number.MAX_SAFE_INTEGER],
    );
    const request = index.openCursor(range, 'prev');

    return new Promise<MessageRecord[]>((resolve, reject) => {
      const rows: StoredMessageRecord[] = [];

      request.onerror = () => reject(request.error ?? new Error('Failed to load messages.'));
      request.onsuccess = () => {
        const cursor = request.result;
        if (!cursor || rows.length >= limit) {
          resolve(rows.reverse().map(toPublicMessage));
          return;
        }

        rows.push(cursor.value as StoredMessageRecord);
        cursor.continue();
      };
    });
  });
}

async function clearByScope(connectionId: string, scopeId: string) {
  if (!connectionId || !scopeId || !hasIndexedDBSupport()) {
    return;
  }

  await withStore('readwrite', async (store, transaction) => {
    const index = store.index(INDEX_BY_SCOPE);
    const range = IDBKeyRange.only([connectionId, scopeId]);
    const request = index.openCursor(range);

    await new Promise<void>((resolve, reject) => {
      request.onerror = () => reject(request.error ?? new Error('Failed to clear messages.'));
      request.onsuccess = () => {
        const cursor = request.result;
        if (!cursor) {
          resolve();
          return;
        }

        cursor.delete();
        cursor.continue();
      };
    });

    await waitForTransaction(transaction);
  });
}

export async function saveConversationMessages(
  connectionId: string,
  agentId: string,
  messages: MessageInput[],
  options?: Pick<ConversationScopeOptions, 'chatId'>,
) {
  if (!connectionId || !agentId || !Array.isArray(messages) || messages.length === 0 || !hasIndexedDBSupport()) {
    return;
  }

  await withStore('readwrite', async (store, transaction) => {
    messages.forEach((message) => {
      store.put(normalizeMessage(connectionId, agentId, message, options?.chatId));
    });
    await waitForTransaction(transaction);
  });
}

export async function saveMessages(connectionId: string, agentId: string, messages: MessageInput[]) {
  await saveConversationMessages(connectionId, agentId, messages);
}

export async function loadConversationMessages(
  connectionId: string,
  agentId: string,
  options?: ConversationScopeOptions,
) {
  if (!connectionId || !agentId) {
    return [];
  }

  return loadByScope(connectionId, buildScopeId(agentId, options?.chatId), options?.limit ?? DEFAULT_LOAD_LIMIT);
}

export async function loadMessages(connectionId: string, agentId: string, limit = DEFAULT_LOAD_LIMIT) {
  return loadConversationMessages(connectionId, agentId, { limit });
}

export async function searchMessages(query: string, options?: MessageSearchOptions) {
  if (!hasIndexedDBSupport()) {
    return [];
  }

  const normalizedQuery = query.trim().toLowerCase();
  const limit = options?.limit ?? DEFAULT_SEARCH_LIMIT;

  return withStore('readonly', async (store) => {
    const index = store.index(INDEX_BY_TIMESTAMP);
    const request = index.openCursor(null, 'prev');

    return new Promise<MessageRecord[]>((resolve, reject) => {
      const matches: MessageRecord[] = [];

      request.onerror = () => reject(request.error ?? new Error('Failed to search messages.'));
      request.onsuccess = () => {
        const cursor = request.result;
        if (!cursor || matches.length >= limit) {
          resolve(matches);
          return;
        }

        const record = cursor.value as StoredMessageRecord;
        const text = record.text ?? '';
        const matchesQuery = normalizedQuery.length === 0 || text.toLowerCase().includes(normalizedQuery);
        const matchesConnection = !options?.connectionId || record.connectionId === options.connectionId;
        const matchesAgent = !options?.agentId || record.agentId === options.agentId;
        const matchesSender = !options?.sender || record.sender === options.sender;
        const matchesMedia = !options?.mediaType || record.mediaType === options.mediaType;
        const matchesCommand = !options?.commandOnly || text.trim().startsWith('/');

        if (matchesQuery && matchesConnection && matchesAgent && matchesSender && matchesMedia && matchesCommand) {
          matches.push(toPublicMessage(record));
        }

        cursor.continue();
      };
    });
  });
}

export async function getMessageStats(since: number): Promise<MessageStats> {
  if (!hasIndexedDBSupport()) {
    return {
      sentCount: 0,
      receivedCount: 0,
      activeAgents: [],
      mostActiveAgent: null,
      lastActivityTime: null,
    };
  }

  return withStore('readonly', async (store) => {
    const index = store.index(INDEX_BY_TIMESTAMP);
    const request = index.openCursor(IDBKeyRange.lowerBound(since), 'next');

    return new Promise<MessageStats>((resolve, reject) => {
      let sentCount = 0;
      let receivedCount = 0;
      let lastActivityTime: number | null = null;
      const activeAgents = new Set<string>();
      const messageCountByAgent = new Map<string, number>();

      request.onerror = () => reject(request.error ?? new Error('Failed to load message stats.'));
      request.onsuccess = () => {
        const cursor = request.result;
        if (!cursor) {
          let mostActiveAgent: string | null = null;
          let mostActiveCount = -1;

          messageCountByAgent.forEach((count, agentId) => {
            if (count > mostActiveCount) {
              mostActiveCount = count;
              mostActiveAgent = agentId;
            }
          });

          resolve({
            sentCount,
            receivedCount,
            activeAgents: [...activeAgents],
            mostActiveAgent,
            lastActivityTime,
          });
          return;
        }

        const record = cursor.value as StoredMessageRecord;
        if (!record.isStreaming) {
          if (record.sender === 'user') {
            sentCount += 1;
          } else if (record.sender === 'ai') {
            receivedCount += 1;
          }

          activeAgents.add(record.agentId);
          messageCountByAgent.set(record.agentId, (messageCountByAgent.get(record.agentId) ?? 0) + 1);
          lastActivityTime = record.timestamp;
        }

        cursor.continue();
      };
    });
  });
}

export async function getRecentMessages(limit: number): Promise<MessageRecord[]> {
  if (!hasIndexedDBSupport() || limit <= 0) {
    return [];
  }

  return withStore('readonly', async (store) => {
    const index = store.index(INDEX_BY_TIMESTAMP);
    const request = index.openCursor(null, 'prev');

    return new Promise<MessageRecord[]>((resolve, reject) => {
      const rows: MessageRecord[] = [];

      request.onerror = () => reject(request.error ?? new Error('Failed to load recent messages.'));
      request.onsuccess = () => {
        const cursor = request.result;
        if (!cursor || rows.length >= limit) {
          resolve(rows);
          return;
        }

        const record = cursor.value as StoredMessageRecord;
        if (!record.isStreaming) {
          rows.push(toPublicMessage(record));
        }
        cursor.continue();
      };
    });
  });
}

export async function clearConversationMessages(
  connectionId: string,
  agentId: string,
  options?: Pick<ConversationScopeOptions, 'chatId'>,
) {
  if (!connectionId || !agentId) {
    return;
  }

  await clearByScope(connectionId, buildScopeId(agentId, options?.chatId));
}

export async function clearMessages(connectionId: string, agentId: string) {
  await clearConversationMessages(connectionId, agentId);
}

export async function getAllAgentIds() {
  if (!hasIndexedDBSupport()) {
    return [];
  }

  return withStore('readonly', async (store) => {
    const index = store.index(INDEX_BY_AGENT);
    const request = index.openKeyCursor(null, 'nextunique');

    return new Promise<AgentMessageRef[]>((resolve, reject) => {
      const refs: AgentMessageRef[] = [];

      request.onerror = () => reject(request.error ?? new Error('Failed to enumerate agents.'));
      request.onsuccess = () => {
        const cursor = request.result;
        if (!cursor) {
          resolve(refs);
          return;
        }

        const [connectionId, agentId] = cursor.key as [string, string];
        refs.push({ connectionId, agentId });
        cursor.continue();
      };
    });
  });
}

export async function getLatestMessagePreview(connectionId: string, agentId: string): Promise<MessagePreview | null> {
  if (!connectionId || !agentId || !hasIndexedDBSupport()) {
    return null;
  }

  return withStore('readonly', async (store) => {
    const index = store.index(INDEX_BY_AGENT_TIMESTAMP);
    const range = IDBKeyRange.bound(
      [connectionId, agentId, Number.MIN_SAFE_INTEGER],
      [connectionId, agentId, Number.MAX_SAFE_INTEGER],
    );
    const request = index.openCursor(range, 'prev');

    return new Promise<MessagePreview | null>((resolve, reject) => {
      request.onerror = () => reject(request.error ?? new Error('Failed to load latest preview.'));
      request.onsuccess = () => {
        const cursor = request.result;
        if (!cursor) {
          resolve(null);
          return;
        }

        const record = cursor.value as StoredMessageRecord;
        if (record.isStreaming) {
          cursor.continue();
          return;
        }

        resolve({
          text: record.text || record.mediaType || 'Attachment',
          timestamp: record.timestamp,
        });
      };
    });
  });
}

function getConnectionAndScope(key: string) {
  const suffix = key.slice(LOCAL_STORAGE_PREFIX.length);
  if (!suffix) {
    return null;
  }

  const knownConnectionIds = getConnections().map((connection) => connection.id).sort((left, right) => right.length - left.length);
  const matchedConnectionId = knownConnectionIds.find((connectionId) => suffix === connectionId || suffix.startsWith(`${connectionId}.`));

  if (matchedConnectionId) {
    const scopeId = suffix.slice(matchedConnectionId.length + 1);
    return scopeId ? { connectionId: matchedConnectionId, scopeId } : null;
  }

  const firstDot = suffix.indexOf('.');
  if (firstDot === -1) {
    return null;
  }

  return {
    connectionId: suffix.slice(0, firstDot),
    scopeId: suffix.slice(firstDot + 1),
  };
}

function resolveMigratedAgentId(connectionId: string, scopeId: string) {
  const cachedAgents = loadCachedAgents(connectionId);
  if (cachedAgents.some((agent) => agent.id === scopeId)) {
    return { agentId: scopeId, chatId: undefined as string | undefined };
  }

  return { agentId: scopeId, chatId: scopeId };
}

export async function migrateFromLocalStorage() {
  if (!hasIndexedDBSupport()) {
    return { migratedKeys: 0, migratedMessages: 0 };
  }

  const keys: string[] = [];
  for (let index = 0; index < window.localStorage.length; index += 1) {
    const key = window.localStorage.key(index);
    if (key?.startsWith(LOCAL_STORAGE_PREFIX)) {
      keys.push(key);
    }
  }

  let migratedKeys = 0;
  let migratedMessages = 0;

  for (const key of keys) {
    const parsed = getConnectionAndScope(key);
    if (!parsed) {
      continue;
    }

    const raw = window.localStorage.getItem(key);
    if (!raw) {
      continue;
    }

    try {
      const messages = JSON.parse(raw) as MessageInput[];
      if (!Array.isArray(messages)) {
        continue;
      }

      const { agentId, chatId } = resolveMigratedAgentId(parsed.connectionId, parsed.scopeId);
      await saveConversationMessages(parsed.connectionId, agentId, messages, { chatId });
      window.localStorage.removeItem(key);
      migratedKeys += 1;
      migratedMessages += messages.length;
    } catch {
      // Keep unreadable data untouched so users can retry a later migration.
    }
  }

  return { migratedKeys, migratedMessages };
}

export { DEFAULT_LOAD_LIMIT };
