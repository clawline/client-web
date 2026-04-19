/**
 * D12 — merge dual lastRead localStorage namespaces into a single
 * `clawline.lastRead.{conn}.{agent}` key, value = max(old).
 *
 * Old keys (both kept as fallbacks before this migration):
 *   - openclaw.lastRead.{conn}.{agent}        (ChatList / ChatRoom writer)
 *   - openclaw.inbox.lastRead.{conn}.{agent}  (AgentInbox writer)
 *
 * New canonical key:
 *   - clawline.lastRead.{conn}.{agent}
 *
 * Behaviour:
 *   - For every old key, compute the merged value as max(oldValue, anyExistingNew).
 *   - Write the merged value to the new key.
 *   - Remove the old key.
 *   - Idempotent: running twice is a no-op once old keys are gone.
 *
 * Does not touch unrelated `openclaw.*` keys (darkMode, connections, outbox, …).
 */

const NEW_PREFIX = 'clawline.lastRead.';
const OLD_CHAT_PREFIX = 'openclaw.lastRead.';
const OLD_INBOX_PREFIX = 'openclaw.inbox.lastRead.';

function asInt(v: string | null): number {
  if (v == null) return 0;
  const n = parseInt(v, 10);
  return Number.isFinite(n) ? n : 0;
}

export function migrateLastReadKeys(): void {
  try {
    const all = Object.keys(localStorage);
    const oldChat = all.filter((k) => k.startsWith(OLD_CHAT_PREFIX) && !k.startsWith(OLD_INBOX_PREFIX));
    const oldInbox = all.filter((k) => k.startsWith(OLD_INBOX_PREFIX));
    if (oldChat.length === 0 && oldInbox.length === 0) return;

    for (const k of [...oldChat, ...oldInbox]) {
      const suffix = k.replace(/^openclaw\.(inbox\.)?lastRead\./, '');
      const newKey = `${NEW_PREFIX}${suffix}`;
      const oldVal = asInt(localStorage.getItem(k));
      const existingNew = asInt(localStorage.getItem(newKey));
      const winner = Math.max(oldVal, existingNew);
      if (winner > 0) localStorage.setItem(newKey, String(winner));
      localStorage.removeItem(k);
    }
  } catch {
    // localStorage may be unavailable (private mode / quota); silently ignore.
  }
}
