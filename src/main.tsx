import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { ErrorBoundary } from './components/ErrorBoundary.tsx';
import SafeLogtoProvider from './components/SafeLogtoProvider.tsx';
import App from './App.tsx';
import { migrateLastReadKeys } from './migrations/lastRead-merge.ts';
import { migrateKeyspace } from './migrations/keyspace-migration.ts';
import './index.css';

// D13: rename all legacy `openclaw.*` localStorage keys to `clawline.*`. Must
// run before any module reads from those keys (dark-mode init below included).
migrateKeyspace();

// D12: collapse legacy openclaw.lastRead.* + openclaw.inbox.lastRead.* into
// the single clawline.lastRead.* namespace before any code reads from them.
migrateLastReadKeys();

// Dark mode: null/missing = follow OS (prefers-color-scheme) | '1' = always dark | '0' = always light
(function applyDarkMode() {
  const stored = localStorage.getItem('clawline.darkMode');
  const isDark = stored === '1' ? true : stored === '0' ? false
    : window.matchMedia('(prefers-color-scheme: dark)').matches;
  document.documentElement.classList.toggle('dark', isDark);
})();
// Auto mode: keep in sync with OS changes
window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', (e) => {
  const stored = localStorage.getItem('clawline.darkMode');
  if (!stored || stored === 'auto') {
    document.documentElement.classList.toggle('dark', e.matches);
  }
});

// Console easter egg for devs
if (typeof console !== 'undefined') {
  console.log(
    '%c🐾 Clawline %cv' + (import.meta.env.VITE_APP_VERSION || 'dev'),
    'font-size:18px;font-weight:bold;color:#EF5A23;',
    'font-size:12px;color:#888;margin-left:4px;',
  );
  console.log(
    '%cPowered by OpenClaw • https://github.com/openclaw/openclaw',
    'font-size:11px;color:#5B8DEF;',
  );
}

const logtoConfig = {
  endpoint: 'https://logto.dr.restry.cn',
  appId: 'j760nuoz0h3jr5g9ysogi',
};

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <ErrorBoundary>
      <SafeLogtoProvider config={logtoConfig}>
        <App />
      </SafeLogtoProvider>
    </ErrorBoundary>
  </StrictMode>,
);
