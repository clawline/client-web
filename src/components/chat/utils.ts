import type { Message } from './types';

export const PREVIEW_KEY_PREFIX = 'openclaw.agentPreview.';
export const MESSAGE_PREVIEW_UPDATED_EVENT = 'openclaw:message-preview-updated';
export const EMOJI_LIST = ['👍', '❤️', '😂', '🔥', '✨', '👀', '💯', '🚀'];

export const QUICK_COMMANDS = [
  { label: '/status', emoji: '📊', desc: 'Session status' },
  { label: '/models', emoji: '🤖', desc: 'List models' },
  { label: '/help', emoji: '❓', desc: 'Show help' },
  { label: '/new', emoji: '✨', desc: 'New session' },
  { label: '/reset', emoji: '🔄', desc: 'Reset context' },
];

export const CONTEXT_SUGGESTIONS = [
  { label: 'Explain more', emoji: '💡' },
  { label: 'Summarize', emoji: '📝' },
  { label: 'Try again', emoji: '🔄' },
];

// --- Formatting ---

export function formatTime(ts?: number) {
  if (!ts) return '';
  const d = new Date(ts);
  const h = d.getHours().toString().padStart(2, '0');
  const m = d.getMinutes().toString().padStart(2, '0');
  return `${h}:${m}`;
}

export function formatDate(ts: number) {
  const d = new Date(ts);
  const now = new Date();
  if (d.toDateString() === now.toDateString()) return 'Today';
  const yesterday = new Date(now);
  yesterday.setDate(yesterday.getDate() - 1);
  if (d.toDateString() === yesterday.toDateString()) return 'Yesterday';
  return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: d.getFullYear() !== now.getFullYear() ? 'numeric' : undefined });
}

export function formatRelativeTime(ts?: number) {
  if (!ts) return '';
  const diff = Date.now() - ts;
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return 'now';
  if (mins < 60) return `${mins}m`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h`;
  const days = Math.floor(hours / 24);
  if (days < 7) return `${days}d`;
  return new Date(ts).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}

export function formatLastSeen(ts?: number): string {
  if (!ts) return '';
  const diff = Date.now() - ts;
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return 'seen just now';
  if (mins < 60) return `seen ${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `seen ${hours}h ago`;
  return `seen ${Math.floor(hours / 24)}d ago`;
}

export function formatToolName(name: string): string {
  return name
    .replace(/([A-Z])/g, ' $1')
    .replace(/[_-]/g, ' ')
    .trim()
    .replace(/\b\w/g, (c) => c.toUpperCase());
}

/** Extract a short one-line arg snippet for tool status display (max ~40 chars) */
/** Parse tool result summary — extract readable text from JSON content blocks */
export function formatResultSummary(raw: string, maxLen = 60): string {
  if (!raw) return '';
  const trimmed = raw.trim();
  // Try to parse as JSON content block array: {"content":[{"type":"text","text":"..."}]}
  if (trimmed.startsWith('{')) {
    try {
      const parsed = JSON.parse(trimmed);
      if (parsed?.content && Array.isArray(parsed.content)) {
        const texts = parsed.content
          .filter((b: Record<string, unknown>) => b.type === 'text' && typeof b.text === 'string')
          .map((b: Record<string, unknown>) => b.text as string);
        if (texts.length > 0) {
          const joined = texts.join(' ').replace(/\n/g, ' ').trim();
          return joined.length > maxLen ? joined.slice(0, maxLen) + '…' : joined;
        }
      }
      // Generic JSON — try to extract meaningful values
      if (typeof parsed === 'object' && parsed !== null) {
        const text = parsed.text ?? parsed.message ?? parsed.result ?? parsed.output ?? parsed.summary;
        if (typeof text === 'string') {
          const oneline = text.replace(/\n/g, ' ').trim();
          return oneline.length > maxLen ? oneline.slice(0, maxLen) + '…' : oneline;
        }
      }
    } catch { /* not JSON, fall through */ }
  }
  // Plain text
  const oneline = trimmed.replace(/\n/g, ' ');
  return oneline.length > maxLen ? oneline.slice(0, maxLen) + '…' : oneline;
}

export function formatToolArgSnippet(args?: Record<string, unknown>): string {
  if (!args) return '';
  // Prioritize the most meaningful arg
  const val = args.command ?? args.path ?? args.file_path ?? args.url ?? args.query ?? args.text ?? args.message;
  if (val == null) return '';
  const raw = typeof val === 'string' ? val : JSON.stringify(val);
  // Single line, truncated
  const oneline = raw.replace(/\n/g, ' ').trim();
  return oneline.length > 40 ? oneline.slice(0, 40) + '…' : oneline;
}

export function isDifferentDay(ts1?: number, ts2?: number) {
  if (!ts1 || !ts2) return true;
  return new Date(ts1).toDateString() !== new Date(ts2).toDateString();
}

export function isGroupedWithPrev(messages: Message[], index: number): boolean {
  if (index === 0) return false;
  const cur = messages[index];
  const prev = messages[index - 1];
  if (!cur || !prev) return false;
  return prev.sender === cur.sender && !isDifferentDay(prev.timestamp, cur.timestamp);
}

export function humanizeError(error: { code: string; message: string }): { title: string; body: string } {
  const { code, message } = error;
  if (code === 'AGENT_ID_MISSING') return { title: 'Agent routing error', body: 'Server could not resolve the target agent for this message. Please check server configuration.' };
  if (code === 'DELIVERY_FAILED') return { title: 'Delivery failed', body: message || 'The message could not be delivered.' };
  if (code === 'RATE_LIMIT') return { title: 'Slow down', body: 'Too many requests. Try again in a moment.' };
  if (code === 'TOKEN_LIMIT') return { title: 'Message too long', body: 'Try shortening your message.' };
  if (code === 'AUTH_FAILED') return { title: 'Auth error', body: 'Please reconnect.' };
  if (code === 'CONNECTION_FAILED') return { title: 'Cannot reach server', body: 'Please check your network or try again later.' };
  if (code === 'OUTBOX_FULL') return { title: 'Offline queue full', body: 'Oldest queued message was removed to make room.' };
  if (code === 'NETWORK_ERROR' || message?.includes('fetch')) return { title: 'Network issue', body: 'Check your connection and try again.' };
  if (code === 'SERVER_ERROR' || message?.includes('500')) return { title: 'Server error', body: 'The server encountered an issue. Try again later.' };
  return { title: 'Something went wrong', body: message || 'Please try again.' };
}

export function fileToDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result as string);
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}

export function getPreviewKey(connectionId: string, agentId: string) {
  return `${PREVIEW_KEY_PREFIX}${connectionId}.${agentId}`;
}

export function emitPreviewUpdated(connectionId: string, agentId: string) {
  window.dispatchEvent(new CustomEvent(MESSAGE_PREVIEW_UPDATED_EVENT, {
    detail: { connectionId, agentId },
  }));
}

function isPreviewableText(text?: string | null): boolean {
  const t = text?.trim();
  if (!t) return false;
  if (t.startsWith('🐾')) return false;
  if (t === '[Image]' || t === '[image]') return false;
  if (t.startsWith('📎')) return false;
  if (t.endsWith('*[cancelled]*')) return false;
  if (/Model:\s/.test(t) && /Tokens:\s/.test(t)) return false;
  if (/Session:\s/.test(t) && /Runtime:\s/.test(t)) return false;
  return true;
}

export function saveAgentPreview(agentId: string | null | undefined, connectionId: string, messages: Message[]) {
  if (!agentId || !connectionId || messages.length === 0) return;
  const lastMeaningfulMessage = [...messages].reverse().find(
    (message) => !message.isStreaming && (isPreviewableText(message.text) || !!message.mediaType)
  );
  if (!lastMeaningfulMessage) return;

  try {
    localStorage.setItem(getPreviewKey(connectionId, agentId), JSON.stringify({
      text: lastMeaningfulMessage.text || lastMeaningfulMessage.mediaType || 'Attachment',
      timestamp: lastMeaningfulMessage.timestamp,
    }));
    emitPreviewUpdated(connectionId, agentId);
  } catch {
    // ignore storage failures
  }
}

export function mergeMessages(cachedMessages: Message[], liveMessages: Message[]) {
  const merged = new Map<string, Message>();
  cachedMessages.forEach((message) => merged.set(message.id, message));
  liveMessages.forEach((message) => merged.set(message.id, message));
  return [...merged.values()].sort((left, right) => (left.timestamp ?? 0) - (right.timestamp ?? 0));
}

export function getConnectionDisplayName(name?: string, fallbackName?: string) {
  return name || fallbackName || 'Server';
}

export function getSkillDescription(skillName: string) {
  return `${skillName} is available in this agent.`;
}
