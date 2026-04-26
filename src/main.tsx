import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { ErrorBoundary } from './components/ErrorBoundary.tsx';
import App from './App.tsx';
import { migrateLastReadKeys } from './migrations/lastRead-merge.ts';
import { migrateKeyspace } from './migrations/keyspace-migration.ts';
import './index.css';

migrateKeyspace();
migrateLastReadKeys();

// Dark mode: null/missing = follow OS (prefers-color-scheme) | '1' = always dark | '0' = always light
(function applyDarkMode() {
  const stored = localStorage.getItem('clawline.darkMode');
  const isDark = stored === '1' ? true : stored === '0' ? false
    : window.matchMedia('(prefers-color-scheme: dark)').matches;
  document.documentElement.classList.toggle('dark', isDark);
})();
window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', (e) => {
  const stored = localStorage.getItem('clawline.darkMode');
  if (!stored || stored === 'auto') {
    document.documentElement.classList.toggle('dark', e.matches);
  }
});

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

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <ErrorBoundary>
      <App />
    </ErrorBoundary>
  </StrictMode>,
);
