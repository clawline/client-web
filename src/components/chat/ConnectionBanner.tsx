import { memo, useState, useEffect, useRef } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { Loader2, WifiOff, Wifi } from 'lucide-react';

interface ConnectionBannerProps {
  wsStatus: string;
  showReconnected: boolean;
  onReconnect: () => void;
  reconnectAttempt?: number;
  reconnectMaxAttempts?: number;
  reconnectDelayMs?: number;
}

function ConnectionBannerInner({ wsStatus, showReconnected, onReconnect, reconnectAttempt = 0, reconnectMaxAttempts = 6, reconnectDelayMs = 0 }: ConnectionBannerProps) {
  const [countdown, setCountdown] = useState(0);
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // Countdown timer for reconnecting state
  useEffect(() => {
    if (intervalRef.current) { clearInterval(intervalRef.current); intervalRef.current = null; }
    if (wsStatus === 'reconnecting' && reconnectDelayMs > 0) {
      const startTime = Date.now();
      setCountdown(Math.ceil(reconnectDelayMs / 1000));
      intervalRef.current = setInterval(() => {
        const remaining = Math.max(0, Math.ceil((reconnectDelayMs - (Date.now() - startTime)) / 1000));
        setCountdown(remaining);
        if (remaining <= 0 && intervalRef.current) { clearInterval(intervalRef.current); intervalRef.current = null; }
      }, 200);
    } else {
      setCountdown(0);
    }
    return () => { if (intervalRef.current) { clearInterval(intervalRef.current); intervalRef.current = null; } };
  }, [wsStatus, reconnectDelayMs, reconnectAttempt]);

  return (
    <>
      <AnimatePresence>
        {(wsStatus === 'disconnected' || wsStatus === 'reconnecting') && (
          <motion.div
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: 'auto' }}
            exit={{ opacity: 0, height: 0 }}
            role="status"
            aria-live="polite"
            aria-atomic="true"
            className={`w-full z-20 px-4 py-2 flex items-center justify-center gap-2 text-[13px] font-medium ${
              wsStatus === 'reconnecting'
                ? 'bg-amber-50/95 dark:bg-amber-900/20 text-amber-700 dark:text-amber-300 shadow-[0_12px_24px_-20px_rgba(245,158,11,0.45)]'
                : 'bg-red-50/95 dark:bg-red-900/20 text-red-600 dark:text-red-300 shadow-[0_12px_24px_-20px_rgba(239,68,68,0.4)]'
            }`}
          >
            {wsStatus === 'reconnecting' ? (
              <>
                <Loader2 size={14} className="animate-spin" />
                Reconnecting ({reconnectAttempt}/{reconnectMaxAttempts})…
                {countdown > 0 && <span className="tabular-nums">{countdown}s</span>}
              </>
            ) : (
              <>
                <WifiOff size={14} /> Connection lost.
                <button
                  onClick={onReconnect}
                  className="underline font-semibold hover:opacity-80"
                >
                  Reconnect
                </button>
              </>
            )}
          </motion.div>
        )}
      </AnimatePresence>

      <AnimatePresence>
        {showReconnected && (
          <motion.div
            initial={{ opacity: 0, y: -10 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -10 }}
            className="absolute top-16 left-1/2 -translate-x-1/2 z-20 bg-primary text-white text-[13px] font-medium px-4 py-2 rounded-full shadow-lg shadow-primary/25 flex items-center gap-2"
          >
            <Wifi size={14} /> Back online!
          </motion.div>
        )}
      </AnimatePresence>
    </>
  );
}

export const ConnectionBanner = memo(ConnectionBannerInner);
