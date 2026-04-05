import { memo } from 'react';
import { motion } from 'motion/react';
import { ChevronLeft, MoreHorizontal, Columns2, X } from 'lucide-react';
import { cn } from '../../lib/utils';

interface FloatingNavButtonsProps {
  /** Controlled opacity (0–1). Apply via CSS transition for smooth fade. */
  opacity: number;
  transitionMs: number;
  /** Whether we're on desktop (hides back button) */
  isDesktop?: boolean;
  /** Whether this pane is inside a split view */
  isSplitPane?: boolean;
  /** Whether split view is active */
  splitActive?: boolean;
  /** Show the split toggle button */
  showSplitButton?: boolean;
  onBack: () => void;
  onMenuOpen: () => void;
  onToggleSplit?: () => void;
  onCloseSplit?: () => void;
}

const BUTTON_CLASS =
  'flex h-11 w-11 items-center justify-center rounded-full shadow-md ' +
  'bg-black/30 text-white backdrop-blur-sm transition-colors ' +
  'hover:bg-black/40 active:scale-95';

function FloatingNavButtonsInner({
  opacity,
  transitionMs,
  isDesktop,
  isSplitPane,
  splitActive,
  showSplitButton,
  onBack,
  onMenuOpen,
  onToggleSplit,
  onCloseSplit,
}: FloatingNavButtonsProps) {
  const style = {
    opacity,
    transition: `opacity ${transitionMs}ms ease`,
    // iOS safe-area + 8px breathing room
    top: 'calc(env(safe-area-inset-top, 0px) + 8px)',
  } as React.CSSProperties;

  return (
    <>
      {/* Left: back button */}
      {!isDesktop && (
        <div className="pointer-events-auto absolute left-4 z-30" style={style}>
          <motion.button
            whileTap={{ scale: 0.9 }}
            onClick={onBack}
            className={BUTTON_CLASS}
            aria-label="Go back"
          >
            <ChevronLeft size={24} />
          </motion.button>
        </div>
      )}

      {/* Right: menu + split buttons */}
      <div
        className="pointer-events-auto absolute right-4 z-30 flex flex-col gap-2"
        style={style}
      >
        {/* Split pane close */}
        {isSplitPane && onCloseSplit && (
          <motion.button
            whileTap={{ scale: 0.9 }}
            onClick={onCloseSplit}
            className={BUTTON_CLASS}
            aria-label="Close split view"
          >
            <X size={20} />
          </motion.button>
        )}

        {/* Split toggle */}
        {!isSplitPane && showSplitButton && onToggleSplit && (
          <motion.button
            whileTap={{ scale: 0.9 }}
            onClick={onToggleSplit}
            className={cn(BUTTON_CLASS, splitActive && 'bg-primary/80 hover:bg-primary/90')}
            aria-label="Toggle split view"
          >
            <Columns2 size={18} />
          </motion.button>
        )}

        {/* More / menu */}
        <motion.button
          whileTap={{ scale: 0.9 }}
          onClick={onMenuOpen}
          className={BUTTON_CLASS}
          aria-label="More options"
        >
          <MoreHorizontal size={22} />
        </motion.button>
      </div>
    </>
  );
}

export const FloatingNavButtons = memo(FloatingNavButtonsInner);
