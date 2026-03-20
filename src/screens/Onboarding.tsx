import { useState, useRef, useEffect, useCallback } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { ArrowRight, MessageSquare, Server, Zap, Shield } from 'lucide-react';
import { useLogto } from '@logto/react';
import { Button } from '../components/ui/button';

const SLIDES = [
  {
    icon: MessageSquare,
    color: 'from-[#67B88B] to-[#4a9a70]',
    shadow: 'shadow-[#67B88B]/30',
    title: 'Real-time Chat',
    desc: 'Chat with OpenClaw agents in real time via WebSocket. Get instant code reviews, explanations, and deployments.',
  },
  {
    icon: Server,
    color: 'from-[#5B8DEF] to-[#3A6BD5]',
    shadow: 'shadow-[#5B8DEF]/30',
    title: 'Multi-Server',
    desc: 'Connect to multiple OpenClaw workspaces simultaneously. Switch between projects without losing context.',
  },
  {
    icon: Zap,
    color: 'from-[#F59E0B] to-[#D97706]',
    shadow: 'shadow-[#F59E0B]/30',
    title: 'Slash Commands',
    desc: 'Use /help, /model, /think, /status and more to trigger specialized workflows at your fingertips.',
  },
  {
    icon: Shield,
    color: 'from-[#8B5CF6] to-[#7C3AED]',
    shadow: 'shadow-[#8B5CF6]/30',
    title: 'Secure & Local',
    desc: 'All connection data stays on your device. No cloud accounts needed — pair directly to your own server.',
  },
];

export default function Onboarding({ onGetStarted }: { onGetStarted: () => void }) {
  const [activeSlide, setActiveSlide] = useState(0);
  const touchStartX = useRef(0);
  const touchDelta = useRef(0);
  const autoTimer = useRef<ReturnType<typeof setInterval> | null>(null);
  const { signIn, isAuthenticated } = useLogto();

  const handleGetStarted = () => {
    if (isAuthenticated) {
      onGetStarted();
    } else {
      signIn(`${window.location.origin}/callback`);
    }
  };

  const goTo = useCallback((index: number) => {
    setActiveSlide((index + SLIDES.length) % SLIDES.length);
  }, []);

  // auto-advance
  useEffect(() => {
    autoTimer.current = setInterval(() => goTo(activeSlide + 1), 4000);
    return () => { if (autoTimer.current) clearInterval(autoTimer.current); };
  }, [activeSlide, goTo]);

  const onTouchStart = (e: React.TouchEvent) => { touchStartX.current = e.touches[0].clientX; };
  const onTouchMove = (e: React.TouchEvent) => { touchDelta.current = e.touches[0].clientX - touchStartX.current; };
  const onTouchEnd = () => {
    if (Math.abs(touchDelta.current) > 50) {
      goTo(activeSlide + (touchDelta.current < 0 ? 1 : -1));
    }
    touchDelta.current = 0;
  };

  const slide = SLIDES[activeSlide];
  const Icon = slide.icon;

  return (
    <div className="flex items-center justify-center h-full bg-[#F8FAFB] dark:bg-[#131420]">
      {/* Phone-style container - centered on all screens */}
      <div className="w-full max-w-[420px] flex flex-col items-center justify-center px-6 relative">
        {/* Brand logo - top right corner (absolute to parent) */}
        <motion.div
          initial={{ opacity: 0, y: -10 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.1 }}
          className="absolute top-0 right-6 flex items-center gap-2"
          style={{ top: '-40px' }}
        >
          <div className="w-7 h-7 bg-gradient-to-br from-[#67B88B] to-[#4a9a70] rounded-[8px] flex items-center justify-center shadow-sm">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
              <path d="M12 2v20M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6" />
            </svg>
          </div>
          <span className="text-[13px] font-semibold text-[#2D3436]/60 dark:text-[#e2e8f0]/60">Clawline</span>
        </motion.div>

        {/* Feature Carousel */}
        <motion.div
          initial={{ y: 30, opacity: 0 }}
          animate={{ y: 0, opacity: 1 }}
          transition={{ delay: 0.2 }}
          className="flex flex-col items-center"
          onTouchStart={onTouchStart}
          onTouchMove={onTouchMove}
          onTouchEnd={onTouchEnd}
        >
          <AnimatePresence mode="wait">
            <motion.div
              key={activeSlide}
              initial={{ opacity: 0, x: 60 }}
              animate={{ opacity: 1, x: 0 }}
              exit={{ opacity: 0, x: -60 }}
              transition={{ type: 'spring', stiffness: 300, damping: 30 }}
              className="flex flex-col items-center"
            >
              <div className={`w-20 h-20 rounded-[24px] bg-gradient-to-br ${slide.color} flex items-center justify-center shadow-lg ${slide.shadow} mb-6`}>
                <Icon size={36} className="text-white" />
              </div>
              <h2 className="text-xl font-bold text-center mb-3">{slide.title}</h2>
              <p className="text-center text-[#2D3436]/55 dark:text-[#e2e8f0]/55 text-[15px] leading-relaxed max-w-[280px]">
                {slide.desc}
              </p>
            </motion.div>
          </AnimatePresence>

          {/* Dots */}
          <div className="flex items-center gap-2 mt-8">
            {SLIDES.map((_, i) => (
              <button
                key={i}
                onClick={() => goTo(i)}
                className={`rounded-full transition-all duration-300 ${
                  i === activeSlide ? 'w-6 h-2 bg-[#67B88B]' : 'w-2 h-2 bg-[#2D3436]/15 dark:bg-[#e2e8f0]/15'
                }`}
              />
            ))}
          </div>

          {/* Get Started button - part of the centered group */}
          <motion.div
            initial={{ y: 20, opacity: 0 }}
            animate={{ y: 0, opacity: 1 }}
            transition={{ delay: 0.3 }}
            className="w-full mt-10"
          >
            <Button size="lg" className="w-full text-lg" onClick={handleGetStarted}>
              Get Started
              <ArrowRight size={20} />
            </Button>
          </motion.div>
        </motion.div>
      </div>
    </div>
  );
}
