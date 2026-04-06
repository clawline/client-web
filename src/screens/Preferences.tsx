import { useState } from 'react';
import { motion } from 'motion/react';
import { ChevronLeft, User, Sliders, Sparkles, Mic, Bell } from 'lucide-react';
import { Input } from '../components/ui/input';
import { Card } from '../components/ui/card';
import { getUserName, setUserName } from '../App';
import {
  isSuggestionsEnabled, setSuggestionsEnabled, getSuggestionCustomPrompt, setSuggestionCustomPrompt,
  isVoiceRefineEnabled, setVoiceRefineEnabled, getVoiceRefineCustomPrompt, setVoiceRefineCustomPrompt,
} from '../services/suggestions';
import { useNotificationPermission } from '../hooks/useNotificationPermission';

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

  const [suggestionsOn, setSuggestionsOn] = useState(() => isSuggestionsEnabled());
  const [suggestionPrompt, setSuggestionPromptVal] = useState(() => getSuggestionCustomPrompt());
  const [voiceRefineOn, setVoiceRefineOn] = useState(() => isVoiceRefineEnabled());
  const [voiceRefinePrompt, setVoiceRefinePromptVal] = useState(() => getVoiceRefineCustomPrompt());
  const { permission, active, requestPermission, optOut, optIn } = useNotificationPermission();

  const handleStreamingToggle = (checked: boolean) => {
    setStreamingEnabled(checked);
    localStorage.setItem(STREAMING_OUTPUT_KEY, checked ? 'true' : 'false');
  };

  const handleSuggestionsToggle = (checked: boolean) => {
    setSuggestionsOn(checked);
    setSuggestionsEnabled(checked);
  };

  const handleSuggestionPromptChange = (value: string) => {
    setSuggestionPromptVal(value);
    setSuggestionCustomPrompt(value);
  };

  const handleVoiceRefineToggle = (checked: boolean) => {
    setVoiceRefineOn(checked);
    setVoiceRefineEnabled(checked);
  };

  const handleVoiceRefinePromptChange = (value: string) => {
    setVoiceRefinePromptVal(value);
    setVoiceRefineCustomPrompt(value);
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

        <section>
          <h3 className="text-sm font-semibold text-text/50 dark:text-text-inv/50 mb-4 uppercase tracking-wider flex items-center gap-2">
            <Sparkles size={16} /> AI Suggestions
          </h3>
          <Card className="p-5 space-y-5">
            <motion.div
              layout
              className="flex items-center justify-between gap-4 rounded-[24px] border border-border dark:border-border-dark bg-surface/80 dark:bg-surface-dark/80 px-4 py-4"
            >
              <div className="min-w-0">
                <label htmlFor="suggestions-toggle" className="block text-[15px] font-semibold text-text dark:text-text-inv">
                  Smart Suggestions
                </label>
                <p className="mt-1 text-[13px] text-text/50 dark:text-text-inv/50">
                  AI-generated follow-up suggestions after messages
                </p>
              </div>
              <input
                id="suggestions-toggle"
                type="checkbox"
                className="ios-toggle shrink-0"
                checked={suggestionsOn}
                onChange={(e) => handleSuggestionsToggle(e.target.checked)}
                aria-label="Toggle AI suggestions"
              />
            </motion.div>

            {suggestionsOn && (
              <motion.div initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: 'auto' }} exit={{ opacity: 0, height: 0 }}>
                <label className="block text-[13px] font-medium text-text/70 dark:text-text-inv/70 mb-1.5">Custom Prompt</label>
                <textarea
                  rows={3}
                  value={suggestionPrompt}
                  onChange={(e) => handleSuggestionPromptChange(e.target.value)}
                  placeholder="Additional instructions for suggestion generation (appended to global prompt)..."
                  className="w-full bg-surface dark:bg-surface-dark border border-border dark:border-border-dark rounded-[16px] px-4 py-3 text-[15px] text-text dark:text-text-inv focus:outline-none focus:ring-2 focus:ring-primary/20 transition-all resize-none placeholder:text-text/35 dark:placeholder:text-text-inv/35"
                />
                <p className="mt-1.5 text-[11px] text-text/40 dark:text-text-inv/40">
                  This prompt is combined with the server's global prompt, not a replacement.
                </p>
              </motion.div>
            )}
          </Card>
        </section>

        <section>
          <h3 className="text-sm font-semibold text-text/50 dark:text-text-inv/50 mb-4 uppercase tracking-wider flex items-center gap-2">
            <Mic size={16} /> Voice Refinement
          </h3>
          <Card className="p-5 space-y-5">
            <motion.div
              layout
              className="flex items-center justify-between gap-4 rounded-[24px] border border-border dark:border-border-dark bg-surface/80 dark:bg-surface-dark/80 px-4 py-4"
            >
              <div className="min-w-0">
                <label htmlFor="voice-refine-toggle" className="block text-[15px] font-semibold text-text dark:text-text-inv">
                  Voice Text Refinement
                </label>
                <p className="mt-1 text-[13px] text-text/50 dark:text-text-inv/50">
                  AI cleans up voice input before sending
                </p>
              </div>
              <input
                id="voice-refine-toggle"
                type="checkbox"
                className="ios-toggle shrink-0"
                checked={voiceRefineOn}
                onChange={(e) => handleVoiceRefineToggle(e.target.checked)}
                aria-label="Toggle voice text refinement"
              />
            </motion.div>

            {voiceRefineOn && (
              <motion.div initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: 'auto' }} exit={{ opacity: 0, height: 0 }}>
                <label className="block text-[13px] font-medium text-text/70 dark:text-text-inv/70 mb-1.5">Custom Prompt</label>
                <textarea
                  rows={3}
                  value={voiceRefinePrompt}
                  onChange={(e) => handleVoiceRefinePromptChange(e.target.value)}
                  placeholder="Additional instructions for voice text refinement (appended to global prompt)..."
                  className="w-full bg-surface dark:bg-surface-dark border border-border dark:border-border-dark rounded-[16px] px-4 py-3 text-[15px] text-text dark:text-text-inv focus:outline-none focus:ring-2 focus:ring-primary/20 transition-all resize-none placeholder:text-text/35 dark:placeholder:text-text-inv/35"
                />
                <p className="mt-1.5 text-[11px] text-text/40 dark:text-text-inv/40">
                  This prompt is combined with the server's global prompt, not a replacement.
                </p>
              </motion.div>
            )}
          </Card>
        </section>

        {/* Notifications */}
        <section>
          <h3 className="text-sm font-semibold text-text/50 dark:text-text-inv/50 mb-4 uppercase tracking-wider flex items-center gap-2">
            <Bell size={16} /> Notifications
          </h3>
          <Card className="p-5 space-y-4">
            <div className="flex items-center justify-between gap-4">
              <div className="flex-1 min-w-0">
                <p className="text-[15px] font-medium text-text dark:text-text-inv">Push Notifications</p>
                <p className="text-[12px] text-text/50 dark:text-text-inv/50 mt-0.5">
                  {permission === 'denied'
                    ? 'Blocked by browser — enable in browser settings'
                    : permission === 'unsupported'
                    ? 'Not supported in this browser'
                    : active
                    ? 'On — notified when a message arrives in background'
                    : 'Off — tap to enable'}
                </p>
              </div>
              {permission === 'denied' || permission === 'unsupported' ? (
                <div className="w-12 h-6 rounded-full bg-text/10 dark:bg-text-inv/10 flex-shrink-0" />
              ) : (
                <button
                  role="switch"
                  aria-checked={active}
                  onClick={() => { if (active) { optOut(); } else { void optIn(); } }}
                  className={`relative inline-flex h-6 w-11 flex-shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors duration-200 focus:outline-none focus:ring-2 focus:ring-primary/20 ${
                    active ? 'bg-primary' : 'bg-text/20 dark:bg-text-inv/20'
                  }`}
                >
                  <span className={`pointer-events-none inline-block h-5 w-5 transform rounded-full bg-white shadow ring-0 transition duration-200 ease-in-out ${
                    active ? 'translate-x-5' : 'translate-x-0'
                  }`} />
                </button>
              )}
            </div>
          </Card>
        </section>

      </div>
    </div>
  );
}
