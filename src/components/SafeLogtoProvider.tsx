import {
  Component,
  type ReactNode,
  type ErrorInfo,
} from 'react';
import { LogtoProvider, type LogtoConfig } from '@logto/react';

/**
 * SafeLogtoProvider wraps LogtoProvider with an error boundary.
 *
 * If LogtoProvider throws during render (LogtoClient constructor crash, etc.),
 * we catch the error and render children WITHOUT the Logto context.
 *
 * To prevent useLogto() from crashing when the context is missing,
 * all components that use useLogto() should be wrapped with SafeUseLogto
 * or check for context availability.
 *
 * BUT — the actual fix is simpler: we render a visible error + reload button
 * instead of a white screen. The ErrorBoundary in main.tsx handles truly
 * catastrophic failures; this one handles Logto-specific failures with a
 * more helpful message.
 */
export default function SafeLogtoProvider({
  config,
  children,
}: {
  config: LogtoConfig;
  children: ReactNode;
}) {
  return (
    <LogtoCrashBoundary fallbackChildren={children}>
      <LogtoProvider config={config}>{children}</LogtoProvider>
    </LogtoCrashBoundary>
  );
}

/* ---- Internal error boundary ---- */

interface CatcherProps {
  children: ReactNode;
  fallbackChildren: ReactNode;
}
interface CatcherState {
  hasError: boolean;
  error: Error | null;
}

class LogtoCrashBoundary extends Component<CatcherProps, CatcherState> {
  constructor(props: CatcherProps) {
    super(props);
    this.state = { hasError: false, error: null };
  }

  static getDerivedStateFromError(error: Error): CatcherState {
    return { hasError: true, error };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error(
      '[SafeLogtoProvider] LogtoProvider crashed:',
      error,
      info.componentStack,
    );
  }

  render() {
    if (this.state.hasError) {
      // Show a visible error state instead of white screen
      return (
        <div style={{
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          justifyContent: 'center',
          height: '100%',
          padding: '2rem',
          fontFamily: 'system-ui, -apple-system, sans-serif',
          background: '#F8FAFB',
          color: '#2D3436',
          textAlign: 'center',
        }}>
          <div style={{
            width: 56, height: 56, borderRadius: 16,
            background: 'linear-gradient(135deg, #67B88B, #4a9a70)',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            marginBottom: 24, fontSize: 28,
          }}>
            🐾
          </div>
          <h1 style={{ fontSize: 20, fontWeight: 700, margin: '0 0 8px' }}>
            Authentication Service Unavailable
          </h1>
          <p style={{ fontSize: 14, color: '#2D3436aa', maxWidth: 400, margin: '0 0 16px' }}>
            Could not connect to the authentication service. Please try again.
          </p>
          <button
            onClick={() => window.location.reload()}
            style={{
              padding: '10px 24px', borderRadius: 12, border: 'none',
              background: '#67B88B', color: 'white', fontWeight: 600,
              fontSize: 14, cursor: 'pointer',
            }}
          >
            Retry
          </button>
          <details style={{ marginTop: 24, fontSize: 12, color: '#2D3436aa', maxWidth: 500, textAlign: 'left' }}>
            <summary style={{ cursor: 'pointer' }}>Technical details</summary>
            <pre style={{ whiteSpace: 'pre-wrap', wordBreak: 'break-all', marginTop: 8 }}>
              {this.state.error?.stack}
            </pre>
          </details>
        </div>
      );
    }

    return this.props.children;
  }
}
