import { useState, useEffect } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { ArrowRight, MessageSquare, Server, Zap, Shield } from 'lucide-react';
import { Button } from '../components/ui/button';

const FEATURES = [
  { icon: MessageSquare, text: 'Real-time chat with OpenClaw agents via WebSocket', color: '#EF5A23' },
  { icon: Server, text: 'Connect to multiple workspaces at once', color: '#5B8DEF' },
  { icon: Zap, text: '/slash commands for specialized workflows', color: '#F59E0B' },
  { icon: Shield, text: 'All data stays on your device — no cloud needed', color: '#8B5CF6' },
];

export default function Onboarding({ onGetStarted }: { onGetStarted: () => void }) {
  const [visibleCount, setVisibleCount] = useState(0);

  // Stagger feature bubbles in
  useEffect(() => {
    if (visibleCount >= FEATURES.length) return;
    const timer = setTimeout(() => setVisibleCount((c) => c + 1), 600);
    return () => clearTimeout(timer);
  }, [visibleCount]);

  const allVisible = visibleCount >= FEATURES.length;

  return (
    <div className="flex items-center justify-center h-full bg-surface dark:bg-[#131420] px-6">
      <div className="w-full max-w-[440px] flex flex-col">
        {/* Logo + Greeting */}
        <motion.div
          initial={{ opacity: 0, y: 16 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.5 }}
          className="mb-8"
        >
          <div className="flex items-center gap-3 mb-6">
            <div className="w-10 h-10 bg-gradient-to-br from-primary to-primary-deep rounded-[12px] flex items-center justify-center shadow-lg shadow-primary/20">
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                <path d="M4 18V9.3a1 1 0 0 1 .2-.6L8 4m0 0h2l1 3M8 4V2m8 16V9.3a1 1 0 0 0-.2-.6L12 4m0 0h-2m2 0V2m4 16.5A2.5 2.5 0 0 1 11.5 21h-3A2.5 2.5 0 0 1 6 18.5" />
              </svg>
            </div>
            <span className="text-[15px] font-semibold text-text/70 dark:text-text-inv/70">Clawline</span>
          </div>
          <h1 className="text-3xl font-bold tracking-tight leading-tight">
            Your agents,<br />
            <span className="text-primary">one tap away.</span>
          </h1>
        </motion.div>

        {/* Feature bubbles — chat-style */}
        <div className="flex flex-col gap-3 mb-10">
          <AnimatePresence>
            {FEATURES.slice(0, visibleCount).map((feat, i) => {
              const Icon = feat.icon;
              return (
                <motion.div
                  key={i}
                  initial={{ opacity: 0, y: 20, scale: 0.95 }}
                  animate={{ opacity: 1, y: 0, scale: 1 }}
                  transition={{ type: 'spring', stiffness: 400, damping: 28 }}
                  className="flex items-center gap-3 px-4 py-3 rounded-2xl rounded-tl-lg bg-white dark:bg-card-alt border border-border dark:border-border-dark shadow-sm"
                >
                  <div
                    className="w-8 h-8 rounded-full flex items-center justify-center flex-shrink-0"
                    style={{ backgroundColor: `${feat.color}15`, color: feat.color }}
                  >
                    <Icon size={16} />
                  </div>
                  <span className="text-[14px] text-text/80 dark:text-text-inv/80 leading-snug">{feat.text}</span>
                </motion.div>
              );
            })}
          </AnimatePresence>

          {/* Typing indicator while features are still appearing */}
          {!allVisible && (
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              className="flex items-center gap-1.5 px-4 py-3"
            >
              <span className="w-1.5 h-1.5 bg-primary rounded-full animate-pulse" />
              <span className="w-1.5 h-1.5 bg-primary rounded-full animate-pulse [animation-delay:200ms]" />
              <span className="w-1.5 h-1.5 bg-primary rounded-full animate-pulse [animation-delay:400ms]" />
            </motion.div>
          )}
        </div>

        {/* CTA */}
        <motion.div
          initial={{ opacity: 0, y: 12 }}
          animate={allVisible ? { opacity: 1, y: 0 } : { opacity: 0, y: 12 }}
          transition={{ duration: 0.4, delay: 0.2 }}
        >
          <Button size="lg" className="w-full text-[16px]" onClick={onGetStarted}>
            Get Started
            <ArrowRight size={20} />
          </Button>
          <p className="text-center text-text/40 dark:text-text-inv/40 text-[12px] mt-3">
            Pair with your OpenClaw server to begin
          </p>
        </motion.div>
      </div>
    </div>
  );
}
