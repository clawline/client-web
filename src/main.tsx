import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import ErrorBoundary from './components/ErrorBoundary.tsx';
import SafeLogtoProvider from './components/SafeLogtoProvider.tsx';
import App from './App.tsx';
import './index.css';

// Dark mode persistence
if (localStorage.getItem('openclaw.darkMode') === '1') {
  document.documentElement.classList.add('dark');
}

// Console easter egg for devs
if (typeof console !== 'undefined') {
  console.log(
    '%c🐾 Clawline %cv' + (import.meta.env.VITE_APP_VERSION || 'dev'),
    'font-size:18px;font-weight:bold;color:#67B88B;',
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
