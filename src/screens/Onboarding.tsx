import { useState, useRef, useEffect, useCallback } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { ArrowRight, Github, Mail, MessageSquare, Server, Zap, Shield } from 'lucide-react';
import { getUserId } from '../App';
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

  const handleGetStarted = () => {
    getUserId();
    onGetStarted();
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
    <div className="flex flex-col h-full px-8 py-10 justify-between">
      {/* Logo + Title */}
      <div className="flex flex-col items-center mt-8">
        <motion.div
          initial={{ scale: 0.8, opacity: 0 }}
          animate={{ scale: 1, opacity: 1 }}
          transition={{ duration: 0.5 }}
          className="w-16 h-16 bg-gradient-to-br from-[#67B88B] to-[#4a9a70] rounded-[20px] flex items-center justify-center shadow-lg shadow-[#67B88B]/30 mb-5"
        >
          <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M12 2v20M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6" />
          </svg>
        </motion.div>
        <motion.h1
          initial={{ y: 20, opacity: 0 }}
          animate={{ y: 0, opacity: 1 }}
          transition={{ delay: 0.1 }}
          className="text-3xl font-bold tracking-tight text-center mb-2"
        >
          OpenClaw
        </motion.h1>
        <motion.p
          initial={{ y: 20, opacity: 0 }}
          animate={{ y: 0, opacity: 1 }}
          transition={{ delay: 0.15 }}
          className="text-center text-[#2D3436]/50 dark:text-[#e2e8f0]/50 text-[15px]"
        >
          Intelligent development companion
        </motion.p>
      </div>

      {/* Feature Carousel */}
      <motion.div
        initial={{ y: 40, opacity: 0 }}
        animate={{ y: 0, opacity: 1 }}
        transition={{ delay: 0.25 }}
        className="flex-1 flex flex-col items-center justify-center my-6"
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
            className="w-full flex flex-col items-center"
          >
            <div className={`w-20 h-20 rounded-[24px] bg-gradient-to-br ${slide.color} flex items-center justify-center shadow-lg ${slide.shadow} mb-6`}>
              <Icon size={36} className="text-white" />
            </div>
            <h2 className="text-xl font-bold text-center mb-3">{slide.title}</h2>
            <p className="text-center text-[#2D3436]/55 dark:text-[#e2e8f0]/55 text-[15px] leading-relaxed max-w-[300px]">
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
      </motion.div>

      {/* Actions */}
      <motion.div
        initial={{ y: 40, opacity: 0 }}
        animate={{ y: 0, opacity: 1 }}
        transition={{ delay: 0.4 }}
        className="flex flex-col gap-3"
      >
        <Button size="lg" className="w-full text-lg" onClick={handleGetStarted}>
          Get Started
          <ArrowRight size={20} />
        </Button>

        <div className="flex gap-3 mt-1">
          <Button variant="outline" size="sm" className="flex-1">
            <Github size={18} />
            GitHub
          </Button>
          <Button variant="outline" size="sm" className="flex-1">
            <Mail size={18} />
            Email
          </Button>
        </div>
      </motion.div>
    </div>
  );
}
