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
          initial={{ y: -100, opacity: 0 }}
          animate={{ y: 0, opacity: 1 }}
          exit={{ y: -100, opacity: 0 }}
          transition={{ type: 'spring', stiffness: 300, damping: 30 }}
          className="fixed top-0 left-0 right-0 z-50 flex justify-center p-4 pointer-events-none"
        >
          <div className="w-full max-w-md pointer-events-auto">
            <div className="bg-[#67B88B] dark:bg-[#67B88B] text-white rounded-2xl shadow-lg p-4 flex items-center justify-between">
              <div className="flex items-center gap-3 flex-1">
                <div className="w-10 h-10 bg-white/20 rounded-full flex items-center justify-center">
                  <RefreshCw className="w-5 h-5" />
                </div>
                <div className="flex-1">
                  <div className="font-semibold text-sm">Update Available</div>
                  <div className="text-xs text-white/80">A new version is ready to install</div>
                </div>
              </div>
              <div className="flex items-center gap-2">
                <motion.button
                  whileTap={{ scale: 0.9 }}
                  onClick={onUpdate}
                  className="px-4 py-2 bg-white text-[#67B88B] rounded-full font-medium text-sm hover:bg-white/90 transition-colors"
                >
                  Update
                </motion.button>
                <motion.button
                  whileTap={{ scale: 0.9 }}
                  onClick={onDismiss}
                  className="w-8 h-8 flex items-center justify-center rounded-full hover:bg-white/10 transition-colors"
                  aria-label="Dismiss"
                >
                  <X className="w-5 h-5" />
                </motion.button>
              </div>
            </div>
          </div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
