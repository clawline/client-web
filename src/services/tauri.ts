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

import { check as updaterCheck, type Update } from '@tauri-apps/plugin-updater';
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

// ── Updater (two-phase: check → install) ──

export type UpdateCheckResult =
  | { status: 'no-update'; version: string }
  | { status: 'update-available'; id: string; version: string; currentVersion: string; body: string }
  | { status: 'error'; error: string }
  | { status: 'not-tauri' };

export type UpdateProgressEvent =
  | { event: 'Started'; contentLength?: number }
  | { event: 'Progress'; downloaded: number; contentLength?: number }
  | { event: 'Finished' };

export const UPDATE_AVAILABLE_EVENT = 'clawline:update-available';

export interface UpdateAvailableDetail {
  id: string;
  version: string;
  currentVersion: string;
  body: string;
}

const pendingUpdates = new Map<string, Update>();

export function getPendingUpdate(id: string): Update | undefined {
  return pendingUpdates.get(id);
}

export function clearPendingUpdate(id: string): void {
  const u = pendingUpdates.get(id);
  if (u) {
    pendingUpdates.delete(id);
    void u.close().catch(() => { /* ignore */ });
  }
}

let checkInFlight: Promise<UpdateCheckResult> | null = null;

/**
 * Phase 1: check for an update without prompting. Returns metadata + an id
 * that can be used with {@link performUpdate} to download and install.
 *
 * The Update instance is held in a module-level Map so React components can
 * reference it by id (the instance has a non-serialisable Tauri resource id).
 */
export async function checkForUpdate(): Promise<UpdateCheckResult> {
  if (!tauriInternals) return { status: 'not-tauri' };
  if (checkInFlight) return checkInFlight;

  checkInFlight = (async (): Promise<UpdateCheckResult> => {
    try {
      const update = await updaterCheck();
      if (!update) {
        const current = await getCurrentVersion();
        return { status: 'no-update', version: current ?? '' };
      }
      const id = `update-${update.version}-${Date.now()}`;
      pendingUpdates.set(id, update);
      return {
        status: 'update-available',
        id,
        version: update.version,
        currentVersion: update.currentVersion,
        body: update.body || '',
      };
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.warn('[tauri] update check failed', err);
      return { status: 'error', error: msg };
    } finally {
      checkInFlight = null;
    }
  })();

  return checkInFlight;
}

/**
 * Phase 2: download and install the update referenced by `id`.
 * Progress is forwarded with cumulative `downloaded` bytes (the underlying
 * Tauri event reports per-chunk lengths; we accumulate here for the UI).
 */
export async function performUpdate(
  id: string,
  onProgress: (event: UpdateProgressEvent) => void,
): Promise<void> {
  const update = pendingUpdates.get(id);
  if (!update) throw new Error('Update no longer available — please re-check.');

  let contentLength: number | undefined;
  let downloaded = 0;

  await update.downloadAndInstall((event) => {
    if (event.event === 'Started') {
      contentLength = event.data.contentLength;
      onProgress({ event: 'Started', contentLength });
    } else if (event.event === 'Progress') {
      downloaded += event.data.chunkLength;
      onProgress({ event: 'Progress', downloaded, contentLength });
    } else if (event.event === 'Finished') {
      onProgress({ event: 'Finished' });
    }
  });
}

/**
 * Silent startup-style check. Dispatches a `clawline:update-available`
 * CustomEvent on `window` when an update is found so the React layer
 * (UpdateModal) can take over. Errors are logged, never surfaced.
 *
 * Kept for the existing 4h interval + initial mount call sites.
 */
export async function checkForUpdates(): Promise<UpdateCheckResult> {
  const result = await checkForUpdate();
  if (result.status === 'update-available' && typeof window !== 'undefined') {
    const detail: UpdateAvailableDetail = {
      id: result.id,
      version: result.version,
      currentVersion: result.currentVersion,
      body: result.body,
    };
    window.dispatchEvent(new CustomEvent<UpdateAvailableDetail>(UPDATE_AVAILABLE_EVENT, { detail }));
  }
  return result;
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
