/**
 * D13 — collapse legacy `openclaw.*` localStorage keys into the
 * `clawline.*` namespace. One-time migration on app startup.
 *
 * Behaviour: copy old → new (only if new is unset), then remove old.
 * Idempotent: if no `openclaw.*` keys remain, the function returns
 * immediately. No permanent dual-read.
 */

const EXACT_KEY_RENAMES: Record<string, string> = {
  'openclaw.connections': 'clawline.connections',
  'openclaw.activeConnectionId': 'clawline.activeConnectionId',
  'openclaw.userId': 'clawline.userId',
  'openclaw.userName': 'clawline.userName',
  'openclaw.darkMode': 'clawline.darkMode',
  'openclaw.outbox': 'clawline.outbox',
  'openclaw.sidebar.width': 'clawline.sidebar.width',
  'openclaw.split.enabled': 'clawline.split.enabled',
  'openclaw.inbox.cache': 'clawline.inbox.cache',
  'openclaw.iosInstallDismissed': 'clawline.iosInstallDismissed',
  'openclaw.soundEnabled': 'clawline.soundEnabled',
  'openclaw.pushNotif': 'clawline.pushNotif',
  'openclaw.inAppNotif': 'clawline.inAppNotif',
  'openclaw.streaming.enabled': 'clawline.streaming.enabled',
  'openclaw.suggestions.enabled': 'clawline.suggestions.enabled',
  'openclaw.suggestions.prompt': 'clawline.suggestions.prompt',
  'openclaw.replyDraft.prompt': 'clawline.replyDraft.prompt',
  'openclaw.voiceRefine.enabled': 'clawline.voiceRefine.enabled',
  'openclaw.voiceRefine.prompt': 'clawline.voiceRefine.prompt',
  'openclaw.chatlist.expandedIds': 'clawline.chatlist.expandedIds',
  'openclaw.chatlist.viewMode': 'clawline.chatlist.viewMode',
  'openclaw.chatlist.agentOrder': 'clawline.chatlist.agentOrder',
  'openclaw.agentAvatars': 'clawline.agentAvatars',
};

const PREFIX_RENAMES: Array<[string, string]> = [
  ['openclaw.agentList.', 'clawline.agentList.'],
  ['openclaw.channelStatus.', 'clawline.channelStatus.'],
  ['openclaw.agentPreview.', 'clawline.agentPreview.'],
  ['openclaw.chatlist.agentOrder.', 'clawline.chatlist.agentOrder.'],
];

export function migrateKeyspace(): void {
  try {
    const keys = Object.keys(localStorage);
    if (!keys.some((k) => k.startsWith('openclaw.'))) return;

    for (const oldKey of keys) {
      let newKey: string | null = null;

      if (EXACT_KEY_RENAMES[oldKey]) {
        newKey = EXACT_KEY_RENAMES[oldKey];
      } else {
        for (const [oldPrefix, newPrefix] of PREFIX_RENAMES) {
          if (oldKey.startsWith(oldPrefix)) {
            newKey = newPrefix + oldKey.slice(oldPrefix.length);
            break;
          }
        }
      }

      if (!newKey) continue;

      const oldVal = localStorage.getItem(oldKey);
      if (oldVal !== null && localStorage.getItem(newKey) === null) {
        localStorage.setItem(newKey, oldVal);
      }
      localStorage.removeItem(oldKey);
    }
  } catch {
    // localStorage may be unavailable (private mode / quota); silently skip.
  }
}
