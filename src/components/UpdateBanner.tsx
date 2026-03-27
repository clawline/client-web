import { motion, AnimatePresence } from 'motion/react';
import { RefreshCw, X } from 'lucide-react';

interface UpdateBannerProps {
  isVisible: boolean;
  onUpdate: () => void;
  onDismiss: () => void;
}

export default function UpdateBanner({ isVisible, onUpdate, onDismiss }: UpdateBannerProps) {
  return (
    <AnimatePresence>
      {isVisible && (
        <motion.div
          initial={{ y: 100, opacity: 0 }}
          animate={{ y: 0, opacity: 1 }}
          exit={{ y: 100, opacity: 0 }}
          transition={{ type: 'spring', stiffness: 300, damping: 30 }}
          className="fixed bottom-0 left-0 right-0 z-[70] flex justify-center p-3 pointer-events-none"
          style={{ paddingBottom: 'max(0.75rem, env(safe-area-inset-bottom))' }}
        >
          <div className="w-full max-w-md pointer-events-auto">
            <div className="bg-primary text-white rounded-2xl shadow-xl shadow-primary/25 px-4 py-3 flex items-center justify-between gap-3">
              <div className="flex items-center gap-3 flex-1 min-w-0">
                <div className="w-9 h-9 bg-white/20 rounded-full flex items-center justify-center flex-shrink-0">
                  <RefreshCw className="w-4 h-4" />
                </div>
                <div className="flex-1 min-w-0">
                  <div className="font-semibold text-[13px]">New version available</div>
                  <div className="text-[11px] text-white/70">Tap to update</div>
                </div>
              </div>
              <div className="flex items-center gap-1.5 flex-shrink-0">
                <motion.button
                  whileTap={{ scale: 0.9 }}
                  onClick={onUpdate}
                  className="px-4 py-1.5 bg-white text-primary rounded-full font-semibold text-[13px] hover:bg-white/90 transition-colors"
                >
                  Update
                </motion.button>
                <motion.button
                  whileTap={{ scale: 0.9 }}
                  onClick={onDismiss}
                  className="w-7 h-7 flex items-center justify-center rounded-full hover:bg-white/10 transition-colors"
                  aria-label="Dismiss"
                >
                  <X className="w-4 h-4" />
                </motion.button>
              </div>
            </div>
          </div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
