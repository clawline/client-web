/**
 * Message sync service — fetches messages from Gateway HTTP API.
 */

import { getActiveConnection, getConnectionById } from './connectionStore';

// ── Gateway URL derivation ──

function getGatewayHttpUrl(connectionId?: string): string | null {
  const conn = connectionId ? getConnectionById(connectionId) : getActiveConnection();
  if (!conn?.serverUrl) return null;

  try {
    const wsUrl = new URL(conn.serverUrl);
    const protocol = wsUrl.protocol === 'wss:' ? 'https:' : 'http:';
    const basePath = wsUrl.pathname.replace(/\/client\/?$/, '');
    return `${protocol}//${wsUrl.host}${basePath}`;
  } catch {
    return null;
  }
}

function getAuthHeaders(connectionId?: string): Record<string, string> {
  const conn = connectionId ? getConnectionById(connectionId) : getActiveConnection();
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  if (conn?.token) {
    headers['Authorization'] = `Bearer ${conn.token}`;
  }
  if (!conn?.token && conn?.serverUrl) {
    try {
      const url = new URL(conn.serverUrl);
      const token = url.searchParams.get('token');
      if (token) headers['Authorization'] = `Bearer ${token}`;
    } catch { /* ignore */ }
  }
  return headers;
}

// ── Stub for legacy callers ──

export async function draftReply(_messages: Array<{ sender: string; text: string }>, _connectionId?: string): Promise<string | null> {
  return null;
}

// ── Message Sync API ──

export type SyncMessage = {
  id: string;
  channel_id: string;
  sender_id: string | null;
  agent_id: string | null;
  message_id: string | null;
  content: string | null;
  content_type: string;
  direction: string;
  media_url: string | null;
  meta: string | null;
  timestamp: number;
  thread_id?: string | null;
};

export type SyncResult = {
  messages: SyncMessage[];
  hasMore: boolean;
};

export async function syncMissedMessages(
  channelId: string,
  afterTimestamp: number,
  limit = 100,
  connectionId?: string,
): Promise<SyncResult> {
  const baseUrl = getGatewayHttpUrl(connectionId);
  if (!baseUrl) return { messages: [], hasMore: false };

  try {
    const params = new URLSearchParams({
      channelId,
      after: String(afterTimestamp),
      limit: String(limit),
    });
    const res = await fetch(`${baseUrl}/api/messages/sync?${params}`, {
      headers: getAuthHeaders(connectionId),
    });
    if (!res.ok) return { messages: [], hasMore: false };
    const data = await res.json();
    return {
      messages: Array.isArray(data.messages) ? data.messages : [],
      hasMore: data.hasMore === true,
    };
  } catch {
    return { messages: [], hasMore: false };
  }
}

export async function fetchOlderMessages(
  channelId: string,
  beforeTimestamp: number,
  agentId?: string,
  limit = 20,
  connectionId?: string,
): Promise<SyncResult> {
  const baseUrl = getGatewayHttpUrl(connectionId);
  if (!baseUrl) return { messages: [], hasMore: false };

  try {
    const params = new URLSearchParams({
      channelId,
      before: String(beforeTimestamp),
      limit: String(limit),
    });
    if (agentId) params.set('agentId', agentId);
    const res = await fetch(`${baseUrl}/api/messages/sync?${params}`, {
      headers: getAuthHeaders(connectionId),
    });
    if (!res.ok) return { messages: [], hasMore: false };
    const data = await res.json();
    return {
      messages: Array.isArray(data.messages) ? data.messages : [],
      hasMore: data.hasMore === true,
    };
  } catch {
    return { messages: [], hasMore: false };
  }
}

export function syncMessageToLocal(msg: SyncMessage) {
  let parsedMeta: Record<string, unknown> | undefined;
  if (msg.meta) {
    try { parsedMeta = JSON.parse(msg.meta) as Record<string, unknown>; } catch { /* ignore */ }
  }
  return {
    id: msg.message_id || msg.id,
    sender: (msg.direction === 'outbound' ? 'ai' : 'user') as 'user' | 'ai',
    text: msg.content || '',
    timestamp: msg.timestamp,
    mediaType: msg.content_type !== 'text' ? msg.content_type : undefined,
    mediaUrl: msg.media_url || undefined,
    meta: parsedMeta,
    threadId: msg.thread_id || undefined,
  };
}
