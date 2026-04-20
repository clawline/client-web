const STORAGE_KEY = 'clawline.connections';
const ACTIVE_KEY = 'clawline.activeConnectionId';
export const CONNECTIONS_UPDATED_EVENT = 'openclaw:connections-updated';

function emitConnectionsUpdated() {
  window.dispatchEvent(new CustomEvent(CONNECTIONS_UPDATED_EVENT));
}

export type ServerConnection = {
  id: string;
  name: string;
  displayName: string;
  serverUrl: string;
  token?: string;
  chatId?: string;
  channelId?: string;
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
  emitConnectionsUpdated();
}

export function getConnections(): ServerConnection[] {
  return readAll();
}

export function getConnectionById(id: string): ServerConnection | undefined {
  return readAll().find((c) => c.id === id);
}

export function addConnection(name: string, serverUrl: string, displayName: string, token?: string, chatId?: string, senderId?: string, channelId?: string): ServerConnection {
  const list = readAll();
  const conn: ServerConnection = {
    id: `conn-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
    name,
    displayName,
    serverUrl: serverUrl.replace(/\/+$/, ''),
    token: token || undefined,
    chatId: chatId || undefined,
    channelId: channelId || undefined,
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
  emitConnectionsUpdated();
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

export function moveConnection(id: string, direction: -1 | 1) {
  const list = readAll();
  const idx = list.findIndex((c) => c.id === id);
  const nextIdx = idx + direction;
  if (idx === -1 || nextIdx < 0 || nextIdx >= list.length) return;

  const [item] = list.splice(idx, 1);
  list.splice(nextIdx, 0, item);
  writeAll(list);
}
