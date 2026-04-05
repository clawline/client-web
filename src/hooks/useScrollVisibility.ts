import { useState, useEffect, useRef, useCallback } from 'react';

interface UseScrollVisibilityOptions {
  /** Opacity when visible (default: 0.7) */
  visibleOpacity?: number;
  /** Delay in ms before buttons reappear after scrolling stops (default: 1500) */
  revealDelayMs?: number;
  /** Transition duration in ms (default: 300) */
  transitionMs?: number;
  /** Fraction of container height that triggers immediate show when tapped (default: 0.2) */
  topTapFraction?: number;
}

interface UseScrollVisibilityReturn {
  opacity: number;
  transitionMs: number;
  onScroll: () => void;
  onContainerClick: (e: React.MouseEvent<HTMLElement>) => void;
}

/**
 * Controls floating button visibility based on scroll activity.
 *
 * - Buttons fade out while scrolling.
 * - Reappear after `revealDelayMs` of scroll inactivity.
 * - Tapping the top `topTapFraction` of the container immediately shows them.
 */
export function useScrollVisibility(
  containerRef: React.RefObject<HTMLElement | null>,
  options: UseScrollVisibilityOptions = {},
): UseScrollVisibilityReturn {
  const {
    visibleOpacity = 0.7,
    revealDelayMs = 1500,
    transitionMs = 300,
    topTapFraction = 0.2,
  } = options;

  const [opacity, setOpacity] = useState(visibleOpacity);
  const revealTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const scheduleReveal = useCallback(() => {
    if (revealTimerRef.current) clearTimeout(revealTimerRef.current);
    revealTimerRef.current = setTimeout(() => setOpacity(visibleOpacity), revealDelayMs);
  }, [visibleOpacity, revealDelayMs]);

  const onScroll = useCallback(() => {
    setOpacity(0);
    scheduleReveal();
  }, [scheduleReveal]);

  const onContainerClick = useCallback((e: React.MouseEvent<HTMLElement>) => {
    const rect = e.currentTarget.getBoundingClientRect();
    const relativeY = e.clientY - rect.top;
    if (relativeY < rect.height * topTapFraction) {
      if (revealTimerRef.current) clearTimeout(revealTimerRef.current);
      setOpacity(visibleOpacity);
    }
  }, [visibleOpacity, topTapFraction]);

  // Cleanup on unmount
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    return () => {
      if (revealTimerRef.current) clearTimeout(revealTimerRef.current);
    };
  }, [containerRef]);

  return { opacity, transitionMs, onScroll, onContainerClick };
}
