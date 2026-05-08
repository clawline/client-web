import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { ErrorBoundary } from './components/ErrorBoundary.tsx';
import App from './App.tsx';
import './index.css';

// Dark mode: null/missing = follow OS (prefers-color-scheme) | '1' = always dark | '0' = always light
(function applyDarkMode() {
  const stored = localStorage.getItem('openclaw.darkMode');
  const isDark = stored === '1' ? true : stored === '0' ? false
    : window.matchMedia('(prefers-color-scheme: dark)').matches;
  document.documentElement.classList.toggle('dark', isDark);
})();
// Auto mode: keep in sync with OS changes
window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', (e) => {
  const stored = localStorage.getItem('openclaw.darkMode');
  if (!stored || stored === 'auto') {
    document.documentElement.classList.toggle('dark', e.matches);
  }
});

// Console easter egg for devs
if (typeof console !== 'undefined') {
  console.log(
    '%c🐾 Clawline %cv' + (import.meta.env.VITE_APP_VERSION || 'dev'),
    'font-size:18px;font-weight:bold;color:#F5A623;',
    'font-size:12px;color:#888;margin-left:4px;',
  );
  console.log(
    '%cPowered by OpenClaw • https://github.com/openclaw/openclaw',
    'font-size:11px;color:#5B8DEF;',
  );
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <ErrorBoundary>
      <App />
    </ErrorBoundary>
  </StrictMode>,
);
