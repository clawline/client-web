import { useEffect, useRef } from 'react';
import { useMotionValue, useSpring } from 'motion/react';

interface SwipeBackOptions {
  onSwipeBack?: () => void;
  threshold?: number;
  enabled?: boolean;
}

/**
 * Hook for handling iOS-style swipe-back gestures
 * Uses Framer Motion's useMotionValue for smooth, performant drag without React re-renders
 */
export function useSwipeBack({
  onSwipeBack,
  threshold = 100,
  enabled = true
}: SwipeBackOptions = {}) {
  // Use MotionValue for drag position - updates directly in native code without React re-renders
  const dragX = useMotionValue(0);
  const dragProgress = useMotionValue(0);

  // Smooth spring animation when releasing below threshold
  const springX = useSpring(dragX, { stiffness: 300, damping: 30 });

  const touchStartXRef = useRef(0);
  const touchStartYRef = useRef(0);
  const isValidSwipeRef = useRef(false);
  const isDraggingRef = useRef(false);
  const onSwipeBackRef = useRef(onSwipeBack);
  const thresholdRef = useRef(threshold);

  // Keep refs in sync with props
  useEffect(() => {
    onSwipeBackRef.current = onSwipeBack;
    thresholdRef.current = threshold;
  }, [onSwipeBack, threshold]);

  useEffect(() => {
    if (!enabled) {
      // Immediately reset when disabled
      dragX.set(0);
      dragProgress.set(0);
      springX.jump(0);
      return;
    }

    const handleTouchStart = (e: TouchEvent) => {
      const touch = e.touches[0];
      touchStartXRef.current = touch.clientX;
      touchStartYRef.current = touch.clientY;

      // Only activate if touch starts near the left edge (within 30px)
      isValidSwipeRef.current = touch.clientX < 30;
    };

    const handleTouchMove = (e: TouchEvent) => {
      if (!isValidSwipeRef.current) return;

      const touch = e.touches[0];
      const deltaX = touch.clientX - touchStartXRef.current;
      const deltaY = touch.clientY - touchStartYRef.current;

      // Cancel if vertical swipe is dominant
      if (Math.abs(deltaY) > Math.abs(deltaX)) {
        isValidSwipeRef.current = false;
        isDraggingRef.current = false;
        dragX.set(0);
        dragProgress.set(0);
        springX.jump(0);
        return;
      }

      // Only track right-ward swipes (back gesture)
      if (deltaX > 0) {
        // Prevent default to avoid conflicts
        if (deltaX > 10) {
          e.preventDefault();
        }

        isDraggingRef.current = true;
        const progress = Math.min(deltaX / thresholdRef.current, 1);

        // Update MotionValues directly - no React re-render
        dragX.set(deltaX);
        dragProgress.set(progress);
      }
    };

    const handleTouchEnd = () => {
      if (!isDraggingRef.current && !isValidSwipeRef.current) return;

      const currentDragX = dragX.get();

      // Trigger back navigation if threshold is exceeded
      if (currentDragX > thresholdRef.current && isValidSwipeRef.current && onSwipeBackRef.current) {
        onSwipeBackRef.current();
        // Immediately jump to 0 after navigation to prevent spring animation issues
        springX.jump(0);
      }

      // Reset state - let spring animate back smoothly if not navigating
      dragX.set(0);
      dragProgress.set(0);
      isValidSwipeRef.current = false;
      isDraggingRef.current = false;
    };

    const handleTouchCancel = () => {
      // Immediately jump to 0 on cancel to prevent stuck states
      dragX.set(0);
      dragProgress.set(0);
      springX.jump(0);
      isValidSwipeRef.current = false;
      isDraggingRef.current = false;
    };

    // Add passive: false for preventDefault to work in touchmove
    document.addEventListener('touchstart', handleTouchStart, { passive: true });
    document.addEventListener('touchmove', handleTouchMove, { passive: false });
    document.addEventListener('touchend', handleTouchEnd, { passive: true });
    document.addEventListener('touchcancel', handleTouchCancel, { passive: true });

    return () => {
      document.removeEventListener('touchstart', handleTouchStart);
      document.removeEventListener('touchmove', handleTouchMove);
      document.removeEventListener('touchend', handleTouchEnd);
      document.removeEventListener('touchcancel', handleTouchCancel);

      // Clean up: ensure spring is reset on unmount
      dragX.set(0);
      dragProgress.set(0);
      springX.jump(0);
    };
  }, [enabled, dragX, dragProgress, springX]); // Stable dependencies

  return {
    dragX: springX, // Return spring value for smooth animation on release
    dragProgress,
  };
}
