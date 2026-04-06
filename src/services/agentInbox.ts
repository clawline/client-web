/**
 * Agent Inbox — unified status tracking service
 *
 * Registers listeners on ALL active connections via clawChannel.ts,
 * tracks per-agent status, emits `openclaw:inbox-updated` events,
 * and persists last-read timestamps to localStorage.
 */

import { getConnections, type ServerConnection } from './connectionStore';
import * as channel from './clawChannel';
import type { AgentInfo } from './clawChannel';
import { loadConversationMessages } from './messageDB';

// ── Types ──

export type AgentStatus = 'idle' | 'thinking' | 'pending_reply' | 'offline';

export type InboxItem = {
  connectionId: string;
  connectionName: string;
  agentId: string;
  agentName: string;
  agentEmoji: string;
  status: AgentStatus;
  lastMessage?: { text: string; timestamp: number; messageId: string };
  unreadCount: number;
  suggestedReply?: string;
};

// ── Constants ──

const INBOX_UPDATED_EVENT = 'openclaw:inbox-updated';
const LAST_READ_PREFIX = 'openclaw.inbox.lastRead.';
const INBOX_CACHE_KEY = 'openclaw.inbox.cache';
const AGENT_NAMES_KEY = 'clawline.agentNames';
const IDLE_TIMEOUT_MS = 30 * 60 * 1000; // 30 minutes

// ── State ──

const items = new Map<string, InboxItem>();
const unsubscribers: Array<() => void> = [];
let initialized = false;

// ── Helpers ──

function itemKey(connectionId: string, agentId: string): string {
  return `${connectionId}:${agentId}`;
}

function getLastReadTimestamp(connectionId: string, agentId: string): number {
  try {
    const raw = localStorage.getItem(`${LAST_READ_PREFIX}${connectionId}.${agentId}`);
    return raw ? parseInt(raw, 10) || 0 : 0;
  } catch {
    return 0;
  }
}

function getCustomAgentName(connectionId: string, agentId: string): string | null {
  try {
    const raw = localStorage.getItem(AGENT_NAMES_KEY);
    if (!raw) return null;
    const names = JSON.parse(raw);
    return names[`${connectionId}:${agentId}`] || null;
  } catch {
    return null;
  }
}

function persistCache() {
  try {
    const data = [...items.values()].map(item => ({
      ...item,
      suggestedReply: undefined, // don't cache suggestions
    }));
    localStorage.setItem(INBOX_CACHE_KEY, JSON.stringify(data));
  } catch { /* ignore */ }
}

function loadCache() {
  try {
    const raw = localStorage.getItem(INBOX_CACHE_KEY);
    if (!raw) return;
    const data = JSON.parse(raw) as InboxItem[];
    for (const item of data) {
      const key = itemKey(item.connectionId, item.agentId);
      if (!items.has(key)) {
        items.set(key, item);
      }
    }
  } catch { /* ignore */ }
}

function setLastReadTimestamp(connectionId: string, agentId: string, timestamp: number) {
  try {
    localStorage.setItem(`${LAST_READ_PREFIX}${connectionId}.${agentId}`, String(timestamp));
  } catch {
    // ignore storage errors
  }
}

function emitUpdate() {
  persistCache();
  window.dispatchEvent(new CustomEvent(INBOX_UPDATED_EVENT));
}

function statusPriority(status: AgentStatus): number {
  switch (status) {
    case 'pending_reply': return 0;
    case 'thinking': return 1;
    case 'idle': return 2;
    case 'offline': return 3;
  }
}

function getOrCreateItem(
  connectionId: string,
  connectionName: string,
  agentId: string,
  agentName: string,
  agentEmoji: string,
): InboxItem {
  const key = itemKey(connectionId, agentId);
  let item = items.get(key);
  if (!item) {
    item = {
      connectionId,
      connectionName,
      agentId,
      agentName,
      agentEmoji,
      status: 'idle',
      unreadCount: 0,
    };
    items.set(key, item);
  }
  return item;
}

// ── Core logic ──

async function populateAgentFromMessages(
  connectionId: string,
  connectionName: string,
  agent: AgentInfo,
) {
  const agentId = agent.id;
  const customName = getCustomAgentName(connectionId, agentId);
  const agentName = customName || agent.identityName || agent.name || agentId;
  const agentEmoji = agent.identityEmoji || '';
  const item = getOrCreateItem(connectionId, connectionName, agentId, agentName, agentEmoji);

  // Load recent messages to determine last message and unread count
  try {
    const messages = await loadConversationMessages(connectionId, agentId, { limit: 50 });
    if (messages.length > 0) {
      const lastMsg = messages[messages.length - 1];
      item.lastMessage = {
        text: lastMsg.text || '',
        timestamp: lastMsg.timestamp,
        messageId: lastMsg.id,
      };

      // Calculate unread count: AI messages since last read
      const lastRead = getLastReadTimestamp(connectionId, agentId);
      let unread = 0;
      for (let i = messages.length - 1; i >= 0; i--) {
        if (messages[i].timestamp <= lastRead) break;
        if (messages[i].sender === 'ai') unread++;
      }
      item.unreadCount = unread;

      // Determine status from message history
      if (lastMsg.sender === 'ai' && lastMsg.timestamp > lastRead) {
        // AI sent a message user hasn't read/responded to
        // Check if it's too old (> 30 min) to be considered pending
        if (Date.now() - lastMsg.timestamp < IDLE_TIMEOUT_MS) {
          item.status = 'pending_reply';
        } else {
          item.status = 'idle';
        }
      } else {
        item.status = 'idle';
      }
    }
  } catch {
    // ignore errors loading messages
  }

  // Override with current WS-derived status
  const connStatus = channel.getStatus(connectionId);
  if (connStatus === 'disconnected') {
    item.status = 'offline';
  }

  const thinkingAgents = channel.getThinkingAgents(connectionId);
  if (thinkingAgents.includes(agentId)) {
    item.status = 'thinking';
  }
}

function setupConnectionListeners(conn: ServerConnection) {
  const connectionId = conn.id;
  const connectionName = conn.displayName || conn.name || connectionId;

  // Listen for messages on this connection
  const unsubMsg = channel.onMessage((packet) => {
    const agentId = typeof packet.data.agentId === 'string' ? packet.data.agentId : '';
    if (!agentId) return;

    // Resolve agent info from cache
    const cachedAgents = channel.loadCachedAgents(connectionId);
    const agentInfo = cachedAgents.find((a) => a.id === agentId);
    const customName = getCustomAgentName(connectionId, agentId);
    const agentName = customName || agentInfo?.identityName || agentInfo?.name || agentId;
    const agentEmoji = agentInfo?.identityEmoji || '';

    const item = getOrCreateItem(connectionId, connectionName, agentId, agentName, agentEmoji);

    if (packet.type === 'thinking.start' || packet.type === 'thinking.update') {
      item.status = 'thinking';
      emitUpdate();
      return;
    }

    if (packet.type === 'thinking.end') {
      // Don't immediately override status — wait for message.send or re-evaluate
      // If there's a pending reply, keep it. Otherwise go idle.
      if (item.status === 'thinking') {
        item.status = item.unreadCount > 0 ? 'pending_reply' : 'idle';
        emitUpdate();
      }
      return;
    }

    if (packet.type === 'message.send') {
      // AI sent a message
      const content = typeof packet.data.content === 'string' ? packet.data.content : '';
      const messageId = typeof packet.data.messageId === 'string' ? packet.data.messageId : '';
      const timestamp = typeof packet.data.timestamp === 'number' ? packet.data.timestamp : Date.now();

      item.lastMessage = { text: content, timestamp, messageId };
      item.status = 'pending_reply';
      item.unreadCount += 1;
      item.suggestedReply = undefined;
      emitUpdate();
      return;
    }

    if (packet.type === 'message.receive') {
      // User sent a message to this agent
      const senderId = typeof packet.data.senderId === 'string' ? packet.data.senderId : '';
      // Only transition to idle if user (not another agent) sent the message
      if (senderId) {
        item.status = 'idle';
        item.unreadCount = 0;
        item.suggestedReply = undefined;
        setLastReadTimestamp(connectionId, agentId, Date.now());
        emitUpdate();
      }
      return;
    }

    // Agent list updated — refresh names/emojis
    if (packet.type === 'agent.list') {
      const agents = (packet.data as { agents?: AgentInfo[] })?.agents ?? [];
      for (const a of agents) {
        const key = itemKey(connectionId, a.id);
        const existing = items.get(key);
        if (existing) {
          existing.agentName = a.identityName || a.name || a.id;
          existing.agentEmoji = a.identityEmoji || '';
        }
      }
      emitUpdate();
    }
  }, connectionId);

  // Listen for connection status changes
  const unsubStatus = channel.onStatus((status) => {
    // Update all agents for this connection
    let changed = false;
    for (const [key, item] of items) {
      if (!key.startsWith(`${connectionId}:`)) continue;

      if (status === 'disconnected') {
        if (item.status !== 'offline') {
          item.status = 'offline';
          changed = true;
        }
      } else if (status === 'connected') {
        // Re-evaluate: if was offline, go back to idle or pending_reply
        if (item.status === 'offline') {
          item.status = item.unreadCount > 0 ? 'pending_reply' : 'idle';
          changed = true;
        }
      }
    }
    if (changed) emitUpdate();
  }, connectionId);

  unsubscribers.push(unsubMsg, unsubStatus);
}

// ── Public API ──

export async function initInbox() {
  if (initialized) return;
  initialized = true;

  await refreshInbox();
}

export async function refreshInbox() {
  // Clean up existing listeners
  unsubscribers.forEach((unsub) => unsub());
  unsubscribers.length = 0;

  // Load cached state first (survives page refresh)
  loadCache();

  const connections = getConnections();

  // Set up listeners for all connections
  for (const conn of connections) {
    setupConnectionListeners(conn);
  }

  // Populate agent data from cached agent lists and message history
  const populatePromises: Promise<void>[] = [];
  for (const conn of connections) {
    const agents = channel.loadCachedAgents(conn.id);
    const connectionName = conn.displayName || conn.name || conn.id;
    for (const agent of agents) {
      populatePromises.push(populateAgentFromMessages(conn.id, connectionName, agent));
    }
  }

  await Promise.all(populatePromises);
  emitUpdate();
}

export function getInboxItems(): InboxItem[] {
  return [...items.values()].sort((a, b) => {
    // Primary sort: status priority
    const priorityDiff = statusPriority(a.status) - statusPriority(b.status);
    if (priorityDiff !== 0) return priorityDiff;

    // Secondary sort: most recent message first
    const aTime = a.lastMessage?.timestamp ?? 0;
    const bTime = b.lastMessage?.timestamp ?? 0;
    return bTime - aTime;
  });
}

export function getUnreadTotal(): number {
  let count = 0;
  for (const item of items.values()) {
    if (item.status === 'pending_reply') {
      count++;
    }
  }
  return count;
}

export function markAsRead(connectionId: string, agentId: string) {
  const key = itemKey(connectionId, agentId);
  const item = items.get(key);
  if (item) {
    item.unreadCount = 0;
    if (item.status === 'pending_reply') {
      item.status = 'idle';
    }
    setLastReadTimestamp(connectionId, agentId, Date.now());
    emitUpdate();
  }
}

export function onInboxUpdate(callback: () => void): () => void {
  const handler = () => callback();
  window.addEventListener(INBOX_UPDATED_EVENT, handler);
  return () => window.removeEventListener(INBOX_UPDATED_EVENT, handler);
}

export { INBOX_UPDATED_EVENT };
