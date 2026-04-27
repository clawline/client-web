/**
 * Tauri integration helpers — no-op when running in plain browser.
 *
 * Notification + unread badge use raw `invoke` via `__TAURI_INTERNALS__`
 * because they call simple commands with primitive args.
 *
 * Updater + getVersion use the official `@tauri-apps/plugin-updater` and
 * `@tauri-apps/api/app` packages — these are statically imported, which
 * Vite bundles correctly. Static imports of Tauri packages are safe; the
 * historical concern was only about *dynamic* import('@tauri-apps/...')
 * which can silently fail in the webview.
 */

import { check as updaterCheck } from '@tauri-apps/plugin-updater';
import { getVersion } from '@tauri-apps/api/app';

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
 * Read app version from Tauri. Returns null in browser environment.
 */
export async function getCurrentVersion(): Promise<string | null> {
  if (!tauriInternals) return null;
  try {
    return await getVersion();
  } catch (err) {
    console.warn('[tauri] getVersion failed', err);
    return null;
  }
}

export type UpdateCheckResult =
  | { status: 'no-update'; version: string }
  | { status: 'updated'; version: string }
  | { status: 'declined'; version: string }
  | { status: 'error'; error: string }
  | { status: 'not-tauri' };

interface CheckOptions {
  /** When true, prompt user via confirm() and return structured result. Default: false (silent). */
  interactive?: boolean;
}

let checkInFlight: Promise<UpdateCheckResult> | null = null;

/**
 * Check for updates (Tauri only).
 *
 * - Silent mode (default): startup-style check. Prompts user if an update is found,
 *   otherwise silently returns. Errors are logged, not surfaced.
 * - Interactive mode: returns a structured result so the UI can show feedback
 *   ("已是最新版" / "发现新版" / "出错了").
 */
export async function checkForUpdates(opts: CheckOptions = {}): Promise<UpdateCheckResult> {
  if (!tauriInternals) return { status: 'not-tauri' };
  if (checkInFlight) return checkInFlight;

  const interactive = opts.interactive === true;

  checkInFlight = (async (): Promise<UpdateCheckResult> => {
    try {
      const update = await updaterCheck();
      if (!update) {
        const current = await getCurrentVersion();
        return { status: 'no-update', version: current ?? '' };
      }

      const newVersion = update.version;
      const current = update.currentVersion;
      const promptMsg = `发现新版本 ${newVersion}（当前 ${current}）\n\n${update.body || ''}\n\n是否立即更新？`;
      const ok = window.confirm(promptMsg);
      if (!ok) {
        return { status: 'declined', version: newVersion };
      }

      await update.downloadAndInstall((event) => {
        if (event.event === 'Started' || event.event === 'Finished') {
          console.info('[tauri] update', event);
        }
      });
      // After install on most platforms the app process exits; user manually relaunches.
      // (We deliberately avoid plugin-process to keep the Rust side lean.)
      window.alert('更新已下载安装。请手动重启应用以完成更新。');
      return { status: 'updated', version: newVersion };
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      if (interactive) {
        return { status: 'error', error: msg };
      }
      console.warn('[tauri] update check failed', err);
      return { status: 'error', error: msg };
    } finally {
      checkInFlight = null;
    }
  })();

  return checkInFlight;
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
