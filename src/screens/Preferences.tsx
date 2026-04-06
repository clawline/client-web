import { useState } from 'react';
import { motion } from 'motion/react';
import { ChevronLeft, User, Sliders } from 'lucide-react';
import { Input } from '../components/ui/input';
import { Card } from '../components/ui/card';
import { getUserName, setUserName } from '../App';

const STREAMING_OUTPUT_KEY = 'openclaw.streaming.enabled';

export default function Preferences({ onBack }: { onBack: () => void }) {
  const [streamingEnabled, setStreamingEnabled] = useState(() => {
    const stored = localStorage.getItem(STREAMING_OUTPUT_KEY);
    if (stored === null) {
      localStorage.setItem(STREAMING_OUTPUT_KEY, 'true');
      return true;
    }
    return stored !== 'false';
  });

  const handleStreamingToggle = (checked: boolean) => {
    setStreamingEnabled(checked);
    localStorage.setItem(STREAMING_OUTPUT_KEY, checked ? 'true' : 'false');
  };

  return (
    <div className="flex flex-col h-full bg-surface dark:bg-surface-dark">
      {/* Header */}
      <div className="px-4 py-4 sticky top-0 bg-surface/80 dark:bg-surface-dark/80 backdrop-blur-xl z-20 flex items-center justify-between">
        <motion.button whileTap={{ scale: 0.9 }} onClick={onBack} aria-label="Go back" title="Go back" className="p-2.5 min-w-[44px] min-h-[44px] flex items-center justify-center -ml-2 text-text dark:text-text-inv">
          <ChevronLeft size={28} />
        </motion.button>
        <h2 className="font-semibold text-[17px]">Preferences</h2>
        <div className="w-11" />
      </div>

      <div className="flex-1 overflow-y-auto px-6 py-4 pb-32 space-y-8 max-w-xl mx-auto w-full">

        <section>
          <h3 className="text-sm font-semibold text-text/50 dark:text-text-inv/50 mb-4 uppercase tracking-wider flex items-center gap-2">
            <User size={16} /> Personal Info
          </h3>
          <Card className="p-5 space-y-4">
            <div>
              <label className="block text-[13px] font-medium text-text/70 dark:text-text-inv/70 mb-1.5">Display Name</label>
              <Input
                defaultValue={getUserName()}
                onChange={(e) => setUserName(e.target.value)}
              />
            </div>
          </Card>
        </section>

        <section>
          <h3 className="text-sm font-semibold text-text/50 dark:text-text-inv/50 mb-4 uppercase tracking-wider flex items-center gap-2">
            <Sliders size={16} /> Chat Settings
          </h3>
          <Card className="p-5">
            <motion.div
              layout
              className="flex items-center justify-between gap-4 rounded-[24px] border border-border dark:border-border-dark bg-surface/80 dark:bg-surface-dark/80 px-4 py-4"
            >
              <div className="min-w-0">
                <label htmlFor="streaming-output-toggle" className="block text-[15px] font-semibold text-text dark:text-text-inv">
                  Streaming Output
                </label>
                <p className="mt-1 text-[13px] text-text/50 dark:text-text-inv/50">
                  Show AI responses character by character
                </p>
              </div>
              <input
                id="streaming-output-toggle"
                type="checkbox"
                className="ios-toggle shrink-0"
                checked={streamingEnabled}
                onChange={(e) => handleStreamingToggle(e.target.checked)}
                aria-label="Toggle streaming output"
              />
            </motion.div>
          </Card>
        </section>
      </div>
    </div>
  );
}
