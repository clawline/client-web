/**
 * Tauri integration helpers — no-op when running in plain browser.
 *
 * Calls Tauri plugins via the runtime's `invoke` channel directly, NOT via
 * `import('@tauri-apps/plugin-*')` — Vite-bundled dynamic imports of Tauri
 * plugin packages tend to silently fail in the webview, but invoke() is
 * exposed on `window.__TAURI_INTERNALS__` and always works.
 */

interface TauriInternals {
  invoke<T = unknown>(cmd: string, args?: Record<string, unknown>): Promise<T>;
}

const tauriInternals: TauriInternals | null =
  typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window
    ? (window as unknown as { __TAURI_INTERNALS__: TauriInternals }).__TAURI_INTERNALS__
    : null;

const isTauri = tauriInternals !== null;

export function inTauri(): boolean {
  return isTauri;
}

export interface NotifyOptions {
  title: string;
  body: string;
  agentId?: string;
  chatId?: string;
}

let permissionPromise: Promise<boolean> | null = null;

async function ensureTauriNotificationPermission(): Promise<boolean> {
  if (!tauriInternals) return false;
  if (permissionPromise) return permissionPromise;
  permissionPromise = (async () => {
    try {
      const granted = await tauriInternals.invoke<boolean>('plugin:notification|is_permission_granted');
      if (granted) return true;
      const result = await tauriInternals.invoke<string>('plugin:notification|request_permission');
      return result === 'granted';
    } catch {
      return false;
    }
  })();
  return permissionPromise;
}

/**
 * Send a notification. Native OS under Tauri, Web Notification fallback in browser.
 * Skips when the window is currently focused (user is reading — no point).
 */
export async function notify(opts: NotifyOptions): Promise<void> {
  if (typeof document !== 'undefined' && document.visibilityState === 'visible' && document.hasFocus()) {
    return;
  }

  if (tauriInternals) {
    const granted = await ensureTauriNotificationPermission();
    if (!granted) return;
    try {
      await tauriInternals.invoke('plugin:notification|notify', {
        options: { title: opts.title, body: opts.body },
      });
      incrementUnread();
    } catch (err) {
      console.warn('[tauri] notify failed', err);
    }
    return;
  }

  if (typeof Notification !== 'undefined' && Notification.permission === 'granted') {
    try {
      new Notification(opts.title, { body: opts.body });
    } catch { /* ignore */ }
  }
}

/**
 * Check for updates (Tauri only). Prompts user before downloading.
 */
export async function checkForUpdates(): Promise<void> {
  if (!tauriInternals) return;
  try {
    type UpdateCheck = {
      available: boolean;
      version?: string;
      body?: string;
    };
    const update = await tauriInternals.invoke<UpdateCheck | null>('plugin:updater|check');
    if (!update || !update.available) return;
    const ok = window.confirm(
      `New version available: ${update.version}\n\n${update.body || ''}\n\nUpdate now?`,
    );
    if (!ok) return;
    await tauriInternals.invoke('plugin:updater|download_and_install');
  } catch (err) {
    console.warn('[tauri] update check failed', err);
  }
}

/**
 * Eagerly request notification permission on app start so the OS prompt
 * appears at a predictable time, not during the first incoming message.
 */
export function primeNotificationPermission(): void {
  if (!tauriInternals) return;
  void ensureTauriNotificationPermission();
}

// ── Unread badge tracking ──

let unreadCount = 0;

async function syncUnreadToTauri(): Promise<void> {
  if (!tauriInternals) return;
  try {
    await tauriInternals.invoke('set_unread_count', { count: unreadCount });
  } catch (err) {
    console.warn('[tauri] set_unread_count failed', err);
  }
}

/** Increment the unread counter (called from notify path) and update the OS surfaces. */
export function incrementUnread(): void {
  unreadCount += 1;
  void syncUnreadToTauri();
}

/** Reset unread counter to zero — called when the user focuses the window. */
export function resetUnread(): void {
  if (unreadCount === 0) return;
  unreadCount = 0;
  void syncUnreadToTauri();
}

/** Wire window focus events to auto-reset the badge. Idempotent. */
let unreadWired = false;
export function wireUnreadAutoReset(): void {
  if (unreadWired || typeof window === 'undefined') return;
  unreadWired = true;
  const reset = () => resetUnread();
  window.addEventListener('focus', reset);
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') reset();
  });
}

