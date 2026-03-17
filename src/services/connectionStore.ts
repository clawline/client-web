const STORAGE_KEY = 'openclaw.connections';
const ACTIVE_KEY = 'openclaw.activeConnectionId';

export type ServerConnection = {
  id: string;
  name: string;
  displayName: string;
  serverUrl: string;
  token?: string;
  chatId?: string;
  senderId?: string;
};

function readAll(): ServerConnection[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw ? JSON.parse(raw) : [];
  } catch {
    return [];
  }
}

function writeAll(list: ServerConnection[]) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(list));
}

export function getConnections(): ServerConnection[] {
  return readAll();
}

export function getConnectionById(id: string): ServerConnection | undefined {
  return readAll().find((c) => c.id === id);
}

export function addConnection(name: string, serverUrl: string, displayName: string, token?: string, chatId?: string, senderId?: string): ServerConnection {
  const list = readAll();
  const conn: ServerConnection = {
    id: `conn-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
    name,
    displayName,
    serverUrl: serverUrl.replace(/\/+$/, ''),
    token: token || undefined,
    chatId: chatId || undefined,
    senderId: senderId || undefined,
  };
  list.push(conn);
  writeAll(list);
  // auto-activate if first connection
  if (list.length === 1) setActiveConnectionId(conn.id);
  return conn;
}

export function removeConnection(id: string) {
  writeAll(readAll().filter((c) => c.id !== id));
  if (getActiveConnectionId() === id) {
    const remaining = readAll();
    setActiveConnectionId(remaining.length > 0 ? remaining[0].id : null);
  }
}

export function getActiveConnectionId(): string | null {
  return localStorage.getItem(ACTIVE_KEY);
}

export function setActiveConnectionId(id: string | null) {
  if (id) {
    localStorage.setItem(ACTIVE_KEY, id);
  } else {
    localStorage.removeItem(ACTIVE_KEY);
  }
}

export function getActiveConnection(): ServerConnection | undefined {
  const id = getActiveConnectionId();
  return id ? getConnectionById(id) : undefined;
}

export function updateConnection(id: string, updates: Partial<Omit<ServerConnection, 'id'>>) {
  const list = readAll();
  const idx = list.findIndex((c) => c.id === id);
  if (idx === -1) return;
  list[idx] = { ...list[idx], ...updates };
  writeAll(list);
}
