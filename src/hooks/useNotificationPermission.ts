import { useState, useEffect, useCallback } from 'react';

export type NotifPermission = 'granted' | 'denied' | 'default' | 'unsupported';

const NOTIF_PREF_KEY = 'openclaw.pushNotif';

/** Whether the user has explicitly opted out (set to '0') */
export function isNotifOptedOut(): boolean {
  return localStorage.getItem(NOTIF_PREF_KEY) === '0';
}

/** Whether push notifications are active (granted + not opted out) */
export function isNotifActive(): boolean {
  return 'Notification' in window &&
    Notification.permission === 'granted' &&
    !isNotifOptedOut();
}

export function useNotificationPermission() {
  const [permission, setPermission] = useState<NotifPermission>(() => {
    if (!('Notification' in window)) return 'unsupported';
    return Notification.permission as NotifPermission;
  });

  // Track opt-out preference separately from browser permission
  const [optedOut, setOptedOut] = useState(() => isNotifOptedOut());

  // Keep permission state in sync (e.g. user changes it in browser settings)
  useEffect(() => {
    if (!('Notification' in window)) return;
    const sync = () => setPermission(Notification.permission as NotifPermission);
    // PermissionStatus.onchange (not available everywhere, best-effort)
    navigator.permissions?.query({ name: 'notifications' }).then((status) => {
      status.addEventListener('change', sync);
    }).catch(() => {});
    return () => {
      navigator.permissions?.query({ name: 'notifications' }).then((status) => {
        status.removeEventListener('change', sync);
      }).catch(() => {});
    };
  }, []);

  /** Request notification permission from browser */
  const requestPermission = useCallback(async (): Promise<NotifPermission> => {
    if (!('Notification' in window)) return 'unsupported';
    if (Notification.permission === 'granted') {
      // Already granted — just clear opt-out
      localStorage.removeItem(NOTIF_PREF_KEY);
      setOptedOut(false);
      setPermission('granted');
      return 'granted';
    }
    if (Notification.permission === 'denied') {
      setPermission('denied');
      return 'denied';
    }
    try {
      const result = await Notification.requestPermission();
      setPermission(result as NotifPermission);
      if (result === 'granted') {
        localStorage.removeItem(NOTIF_PREF_KEY);
        setOptedOut(false);
      }
      return result as NotifPermission;
    } catch {
      return 'default';
    }
  }, []);

  /** User explicitly opts out (don't revoke browser permission, just suppress) */
  const optOut = useCallback(() => {
    localStorage.setItem(NOTIF_PREF_KEY, '0');
    setOptedOut(true);
  }, []);

  /** User re-enables (clear opt-out; if browser permission is denied, they must go to browser settings) */
  const optIn = useCallback(async (): Promise<NotifPermission> => {
    localStorage.removeItem(NOTIF_PREF_KEY);
    setOptedOut(false);
    return requestPermission();
  }, [requestPermission]);

  const active = permission === 'granted' && !optedOut;

  return { permission, optedOut, active, requestPermission, optOut, optIn };
}
