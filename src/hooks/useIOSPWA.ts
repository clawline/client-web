import { useEffect } from 'react';

/**
 * Hook to handle iOS-specific PWA optimizations
 * - Updates theme-color meta tag based on dark mode
 * - Handles iOS standalone mode detection
 */
export function useIOSPWA() {
  useEffect(() => {
    // Update theme color based on dark mode
    const updateThemeColor = () => {
      const isDark = document.documentElement.classList.contains('dark');
      // Update all theme-color meta tags to handle both media query and non-media versions
      const themeColorMetas = document.querySelectorAll('meta[name="theme-color"]');

      themeColorMetas.forEach((meta) => {
        meta.setAttribute('content', isDark ? '#1a1b2e' : '#EF5A23');
      });
    };

    // Initial theme color update
    updateThemeColor();

    // Watch for dark mode changes
    const observer = new MutationObserver((mutations) => {
      mutations.forEach((mutation) => {
        if (mutation.attributeName === 'class') {
          updateThemeColor();
        }
      });
    });

    observer.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ['class'],
    });

    return () => {
      observer.disconnect();
    };
  }, []);

  // Detect if running in standalone mode (iOS PWA)
  const isStandalone = () => {
    return (
      window.matchMedia('(display-mode: standalone)').matches ||
      // @ts-ignore - iOS specific
      window.navigator.standalone === true
    );
  };

  // Detect if on iOS
  const isIOS = () => {
    return /iPad|iPhone|iPod/.test(navigator.userAgent) && !(window as any).MSStream;
  };

  return {
    isStandalone: isStandalone(),
    isIOS: isIOS(),
    showInstallPrompt: isIOS() && !isStandalone(),
  };
}
