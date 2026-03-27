import { memo } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { Loader2, WifiOff, Wifi } from 'lucide-react';

interface ConnectionBannerProps {
  wsStatus: string;
  showReconnected: boolean;
  onReconnect: () => void;
}

function ConnectionBannerInner({ wsStatus, showReconnected, onReconnect }: ConnectionBannerProps) {
  return (
    <>
      <AnimatePresence>
        {(wsStatus === 'disconnected' || wsStatus === 'reconnecting') && (
          <motion.div
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: 'auto' }}
            exit={{ opacity: 0, height: 0 }}
            className={`w-full z-20 px-4 py-2 flex items-center justify-center gap-2 text-[13px] font-medium ${
              wsStatus === 'reconnecting'
                ? 'bg-amber-50 dark:bg-amber-900/20 text-amber-700 dark:text-amber-300 border-b border-amber-200 dark:border-amber-800/40'
                : 'bg-red-50 dark:bg-red-900/20 text-red-600 dark:text-red-300 border-b border-red-200 dark:border-red-800/40'
            }`}
          >
            {wsStatus === 'reconnecting' ? (
              <><Loader2 size={14} className="animate-spin" /> Reconnecting… Check your network.</>
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
