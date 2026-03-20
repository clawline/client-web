import { motion, AnimatePresence } from 'motion/react';
import { Share, X } from 'lucide-react';
import { useState, useEffect } from 'react';

interface IOSInstallPromptProps {
  show: boolean;
}

export default function IOSInstallPrompt({ show: showProp }: IOSInstallPromptProps) {
  const [isVisible, setIsVisible] = useState(false);
  const [isDismissed, setIsDismissed] = useState(false);

  useEffect(() => {
    // Check if user has dismissed the prompt before
    const dismissed = localStorage.getItem('openclaw.iosInstallDismissed');
    if (dismissed) {
      setIsDismissed(true);
    } else {
      // Show after a short delay
      const timer = setTimeout(() => {
        setIsVisible(showProp && !isDismissed);
      }, 2000);
      return () => clearTimeout(timer);
    }
  }, [showProp, isDismissed]);

  const handleDismiss = () => {
    setIsVisible(false);
    localStorage.setItem('openclaw.iosInstallDismissed', 'true');
    setIsDismissed(true);
  };

  return (
    <AnimatePresence>
      {isVisible && (
        <motion.div
          initial={{ y: 100, opacity: 0 }}
          animate={{ y: 0, opacity: 1 }}
          exit={{ y: 100, opacity: 0 }}
          transition={{ type: 'spring', stiffness: 300, damping: 30 }}
          className="fixed bottom-20 left-0 right-0 z-50 flex justify-center px-4 pointer-events-none"
        >
          <div className="w-full max-w-md pointer-events-auto">
            <div className="bg-white dark:bg-card-alt rounded-2xl shadow-2xl p-4 border border-border dark:border-border-dark">
              <div className="flex items-start justify-between mb-3">
                <div className="flex items-center gap-3">
                  <div className="w-12 h-12 bg-primary rounded-xl flex items-center justify-center">
                    <span className="text-white text-2xl font-bold">$</span>
                  </div>
                  <div>
                    <div className="font-semibold text-text dark:text-text-inv">
                      Install Clawline
                    </div>
                    <div className="text-xs text-[#92A0A4] dark:text-[#64748b]">
                      Add to Home Screen
                    </div>
                  </div>
                </div>
                <motion.button
                  whileTap={{ scale: 0.9 }}
                  onClick={handleDismiss}
                  className="w-8 h-8 flex items-center justify-center rounded-full hover:bg-surface dark:hover:bg-surface-dark transition-colors"
                  aria-label="Dismiss"
                >
                  <X className="w-5 h-5 text-[#92A0A4]" />
                </motion.button>
              </div>

              <div className="bg-surface dark:bg-surface-dark rounded-xl p-3 text-sm text-[#5B6669] dark:text-[#a0aec0]">
                <div className="flex items-start gap-2">
                  <span className="text-base">1.</span>
                  <span>
                    Tap the <Share className="inline w-4 h-4 mx-1 text-info" /> share button
                  </span>
                </div>
                <div className="flex items-start gap-2 mt-2">
                  <span className="text-base">2.</span>
                  <span>Scroll and tap "Add to Home Screen"</span>
                </div>
              </div>
            </div>
          </div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
