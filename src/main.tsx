import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { ErrorBoundary } from './components/ErrorBoundary.tsx';
import SafeLogtoProvider from './components/SafeLogtoProvider.tsx';
import App from './App.tsx';
import './index.css';

// Dark mode: 'auto' (CST 18:00-06:00 = dark) | '1' = always dark | '0' = always light
function getCSTHour() {
  return (new Date().getUTCHours() + 8) % 24;
}
function isCSTPeakDark() {
  const h = getCSTHour();
  return h >= 18 || h < 6;
}
(function applyDarkMode() {
  const stored = localStorage.getItem('openclaw.darkMode');
  const isDark = stored === '1' ? true : stored === '0' ? false : isCSTPeakDark();
  document.documentElement.classList.toggle('dark', isDark);
})();
// Re-evaluate every minute when in auto mode
setInterval(() => {
  if (localStorage.getItem('openclaw.darkMode') === null ||
      localStorage.getItem('openclaw.darkMode') === 'auto') {
    document.documentElement.classList.toggle('dark', isCSTPeakDark());
  }
}, 60_000);

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
