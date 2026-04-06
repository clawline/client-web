/**
 * AI-powered suggestion service — calls Gateway POST /api/suggestions
 *
 * Primary: Gateway endpoint (derives HTTP URL from active WS connection)
 * Fallback: Local LLM API if configured in localStorage
 */

import { getActiveConnection, getConnectionById } from './connectionStore';

let lastContextHash = '';
let lastSuggestions: string[] = [];
let pendingRequest: Promise<string[]> | null = null;

const SUGGESTION_ENABLED_KEY = 'openclaw.suggestions.enabled';
const SUGGESTION_PROMPT_KEY = 'openclaw.suggestions.prompt';
const VOICE_REFINE_ENABLED_KEY = 'openclaw.voiceRefine.enabled';
const VOICE_REFINE_PROMPT_KEY = 'openclaw.voiceRefine.prompt';

// ── Preferences helpers ──

export function isSuggestionsEnabled(): boolean {
  return localStorage.getItem(SUGGESTION_ENABLED_KEY) !== 'false'; // default: enabled
}

export function setSuggestionsEnabled(enabled: boolean): void {
  localStorage.setItem(SUGGESTION_ENABLED_KEY, enabled ? 'true' : 'false');
}

export function getSuggestionCustomPrompt(): string {
  return localStorage.getItem(SUGGESTION_PROMPT_KEY) || '';
}

export function setSuggestionCustomPrompt(prompt: string): void {
  localStorage.setItem(SUGGESTION_PROMPT_KEY, prompt);
}

export function isVoiceRefineEnabled(): boolean {
  return localStorage.getItem(VOICE_REFINE_ENABLED_KEY) !== 'false'; // default: enabled
}

export function setVoiceRefineEnabled(enabled: boolean): void {
  localStorage.setItem(VOICE_REFINE_ENABLED_KEY, enabled ? 'true' : 'false');
}

export function getVoiceRefineCustomPrompt(): string {
  return localStorage.getItem(VOICE_REFINE_PROMPT_KEY) || '';
}

export function setVoiceRefineCustomPrompt(prompt: string): void {
  localStorage.setItem(VOICE_REFINE_PROMPT_KEY, prompt);
}

// ── Gateway URL derivation ──

function getGatewayHttpUrl(connectionId?: string): string | null {
  const conn = connectionId ? getConnectionById(connectionId) : getActiveConnection();
  if (!conn?.serverUrl) return null;

  try {
    const wsUrl = new URL(conn.serverUrl);
    const protocol = wsUrl.protocol === 'wss:' ? 'https:' : 'http:';
    // Strip /client path (relay WS endpoint) to get base
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
  // Extract token from serverUrl query params as fallback
  if (!conn?.token && conn?.serverUrl) {
    try {
      const url = new URL(conn.serverUrl);
      const token = url.searchParams.get('token');
      if (token) headers['Authorization'] = `Bearer ${token}`;
    } catch { /* ignore */ }
  }
  return headers;
}

// ── Suggestion API ──

function hashContext(text: string): string {
  let h = 0;
  for (let i = 0; i < text.length; i++) {
    h = ((h << 5) - h + text.charCodeAt(i)) | 0;
  }
  return String(h);
}

async function fetchSuggestionsFromGateway(
  messages: Array<{ role: string; text: string }>,
  signal?: AbortSignal,
): Promise<string[]> {
  const baseUrl = getGatewayHttpUrl();
  if (!baseUrl) return [];

  const res = await fetch(`${baseUrl}/api/suggestions`, {
    method: 'POST',
    headers: getAuthHeaders(),
    body: JSON.stringify({
      messages: messages.slice(-6).map(m => ({ role: m.role, text: m.text.slice(0, 300) })),
      prompt: getSuggestionCustomPrompt() || undefined,
    }),
    signal,
  });

  if (!res.ok) return [];
  const data = await res.json();
  return Array.isArray(data.suggestions) ? data.suggestions.filter((s: unknown): s is string => typeof s === 'string') : [];
}

export async function getSuggestions(
  messages: { sender: string; text?: string }[],
  signal?: AbortSignal,
): Promise<string[]> {
  if (!isSuggestionsEnabled()) return [];

  const conversationMsgs = messages
    .filter(m => m.text && m.text.length > 0)
    .map(m => ({
      role: m.sender === 'user' ? 'user' : 'assistant',
      text: m.text!,
    }));

  if (conversationMsgs.length === 0) return [];

  const contextStr = conversationMsgs.slice(-6).map(m => `${m.role}: ${m.text.slice(0, 300)}`).join('\n');
  const hash = hashContext(contextStr);

  if (hash === lastContextHash && lastSuggestions.length > 0) {
    return lastSuggestions;
  }

  if (pendingRequest) return pendingRequest;

  pendingRequest = fetchSuggestionsFromGateway(conversationMsgs, signal)
    .then(suggestions => {
      if (suggestions.length > 0) {
        lastContextHash = hash;
        lastSuggestions = suggestions;
      }
      return suggestions;
    })
    .catch(() => [] as string[])
    .finally(() => { pendingRequest = null; });

  return pendingRequest;
}

export function isSuggestionServiceAvailable(): boolean {
  return !!getGatewayHttpUrl();
}

export function clearSuggestionCache(): void {
  lastContextHash = '';
  lastSuggestions = [];
  pendingRequest = null;
}

// ── Draft Reply API (Inbox) ──

export async function draftReply(
  messages: { sender: string; text?: string }[],
  connectionId?: string,
): Promise<string> {
  const baseUrl = getGatewayHttpUrl(connectionId);
  if (!baseUrl) return '';

  const conversationMsgs = messages
    .filter((m) => m.text)
    .slice(-10)
    .map((m) => ({
      role: m.sender === 'user' ? 'user' : 'assistant',
      text: m.text!.slice(0, 300),
    }));

  if (conversationMsgs.length === 0) return '';

  try {
    const res = await fetch(`${baseUrl}/api/suggestions`, {
      method: 'POST',
      headers: getAuthHeaders(connectionId),
      body: JSON.stringify({ mode: 'reply', messages: conversationMsgs }),
    });
    if (!res.ok) return '';
    const data = await res.json();
    return typeof data.reply === 'string' ? data.reply : '';
  } catch {
    return '';
  }
}

// ── Voice Refine API ──

export async function refineVoiceText(
  text: string,
  messages?: { sender: string; text?: string }[],
): Promise<string> {
  if (!isVoiceRefineEnabled() || !text.trim()) return text;

  const baseUrl = getGatewayHttpUrl();
  if (!baseUrl) return text;

  const conversationMsgs = (messages || [])
    .filter(m => m.text && m.text.length > 0)
    .slice(-20)
    .map(m => ({ role: m.sender === 'user' ? 'user' : 'assistant', text: m.text!.slice(0, 300) }));

  try {
    const res = await fetch(`${baseUrl}/api/voice-refine`, {
      method: 'POST',
      headers: getAuthHeaders(),
      body: JSON.stringify({
        text,
        messages: conversationMsgs,
        prompt: getVoiceRefineCustomPrompt() || undefined,
      }),
    });

    if (!res.ok) return text;
    const data = await res.json();
    return typeof data.refined === 'string' && data.refined.trim() ? data.refined.trim() : text;
  } catch {
    return text;
  }
}

// ── Message Sync API (pull missed messages from DB) ──

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
};

export async function syncMissedMessages(
  channelId: string,
  afterTimestamp: number,
  limit = 100,
): Promise<SyncMessage[]> {
  const baseUrl = getGatewayHttpUrl();
  if (!baseUrl) return [];

  try {
    const params = new URLSearchParams({
      channelId,
      after: String(afterTimestamp),
      limit: String(limit),
    });
    const res = await fetch(`${baseUrl}/api/messages/sync?${params}`, {
      headers: getAuthHeaders(),
    });
    if (!res.ok) return [];
    const data = await res.json();
    return Array.isArray(data.messages) ? data.messages : [];
  } catch {
    return [];
  }
}
