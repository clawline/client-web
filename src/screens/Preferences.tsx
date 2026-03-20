import { useState } from 'react';
import { motion } from 'motion/react';
import { ChevronLeft, Save, User, Sliders } from 'lucide-react';
import { Button } from '../components/ui/button';
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
        <motion.button whileTap={{ scale: 0.9 }} onClick={onBack} className="p-2 -ml-2 text-text dark:text-text-inv">
          <ChevronLeft size={28} />
        </motion.button>
        <h2 className="font-semibold text-[17px]">Preferences</h2>
        <div className="w-10" />
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
            <Sliders size={16} /> AI Configuration
          </h3>
          <Card className="p-5 space-y-5">
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

            <div>
              <label className="block text-[13px] font-medium text-text/70 dark:text-text-inv/70 mb-1.5">Default Model</label>
              <div className="relative">
                <select className="w-full appearance-none bg-surface dark:bg-surface-dark border border-border dark:border-border-dark rounded-[16px] px-4 py-3 text-[15px] text-text dark:text-text-inv focus:outline-none focus:ring-2 focus:ring-primary/20 transition-all">
                  <option>Claude 3.5 Sonnet</option>
                  <option>GPT-4o</option>
                  <option>Gemini 1.5 Pro</option>
                </select>
                <div className="absolute right-4 top-1/2 -translate-y-1/2 pointer-events-none text-text/40 dark:text-text-inv/40">
                  ▼
                </div>
              </div>
            </div>
            
            <div>
              <div className="flex justify-between mb-1.5">
                <label className="text-[13px] font-medium text-text/70 dark:text-text-inv/70">Creativity (Temperature)</label>
                <span className="text-[13px] font-bold text-primary">0.7</span>
              </div>
              <input 
                type="range" 
                min="0" max="1" step="0.1" defaultValue="0.7"
                className="w-full accent-primary"
              />
              <div className="flex justify-between text-[11px] text-text/40 dark:text-text-inv/40 mt-1">
                <span>Precise</span>
                <span>Creative</span>
              </div>
            </div>

            <div>
              <label className="block text-[13px] font-medium text-text/70 dark:text-text-inv/70 mb-1.5">Custom System Prompt</label>
              <textarea 
                rows={3}
                placeholder="E.g., Always answer in TypeScript..."
                className="w-full bg-surface dark:bg-surface-dark border border-border dark:border-border-dark rounded-[16px] px-4 py-3 text-[15px] text-text dark:text-text-inv focus:outline-none focus:ring-2 focus:ring-primary/20 transition-all resize-none placeholder:text-text/35 dark:placeholder:text-text-inv/35"
              ></textarea>
            </div>
          </Card>
        </section>

        <Button size="lg" className="w-full">
          <Save size={20} />
          Save Preferences
        </Button>
      </div>
    </div>
  );
}
