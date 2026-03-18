import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import ErrorBoundary from './components/ErrorBoundary.tsx';
import { AuthProvider } from './hooks/useAuth.tsx';
import App from './App.tsx';
import './index.css';

// Dark mode persistence
if (localStorage.getItem('openclaw.darkMode') === '1') {
  document.documentElement.classList.add('dark');
}

const logtoConfig = {
  endpoint: 'https://logto.dr.restry.cn',
  appId: 'j760nuoz0h3jr5g9ysogi',
};

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <ErrorBoundary>
      <AuthProvider config={logtoConfig}>
        <App />
      </AuthProvider>
    </ErrorBoundary>
  </StrictMode>,
);
