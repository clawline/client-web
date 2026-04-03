import { useEffect, useState, useRef } from 'react';

interface PWAUpdateState {
  updateAvailable: boolean;
  registration: ServiceWorkerRegistration | null;
}

/**
 * Hook for detecting and handling PWA updates
 * Checks for service worker updates and provides methods to apply them
 */
export function usePWAUpdate() {
  const [updateState, setUpdateState] = useState<PWAUpdateState>({
    updateAvailable: false,
    registration: null,
  });

  const refreshingRef = useRef(false);

  useEffect(() => {
    if (!('serviceWorker' in navigator)) return;

    let updateInterval: ReturnType<typeof setInterval> | undefined;

    // Controller change handler - only reload once per session
    const handleControllerChange = () => {
      if (refreshingRef.current) return;
      refreshingRef.current = true;
      window.location.reload();
    };

    // Register service worker and listen for updates
    navigator.serviceWorker.register('/sw.js')
      .then((reg) => {
        // If a waiting worker already exists on page load, show update banner immediately
        if (reg.waiting && navigator.serviceWorker.controller) {
          setUpdateState({ updateAvailable: true, registration: reg });
        }

        // Check for updates on page load
        reg.update();

        // Check for updates every 5 minutes (frequent deploys)
        updateInterval = setInterval(() => {
          reg.update();
        }, 5 * 60 * 1000);

        // Listen for new service worker waiting
        reg.addEventListener('updatefound', () => {
          const newWorker = reg.installing;
          if (!newWorker) return;

          newWorker.addEventListener('statechange', () => {
            if (newWorker.state === 'installed' && navigator.serviceWorker.controller) {
              // New service worker is installed and ready
              setUpdateState({
                updateAvailable: true,
                registration: reg,
              });
            }
          });
        });
      })
      .catch(() => {
        // Service worker registration failed, ignore
      });

    // Listen for controller change (new SW activated)
    navigator.serviceWorker.addEventListener('controllerchange', handleControllerChange);

    // Cleanup function - properly cleanup interval and listener
    return () => {
      if (updateInterval) {
        clearInterval(updateInterval);
      }
      navigator.serviceWorker.removeEventListener('controllerchange', handleControllerChange);
    };
  }, []);

  const applyUpdate = () => {
    if (updateState.registration?.waiting) {
      // Tell the waiting service worker to skip waiting and activate
      updateState.registration.waiting.postMessage({ type: 'SKIP_WAITING' });
    }
  };

  const dismissUpdate = () => {
    setUpdateState({
      updateAvailable: false,
      registration: null,
    });
  };

  return {
    updateAvailable: updateState.updateAvailable,
    applyUpdate,
    dismissUpdate,
  };
}
