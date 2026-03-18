import { Component, type ReactNode, type ErrorInfo } from 'react';

interface Props {
  children: ReactNode;
  fallback?: ReactNode;
}

interface State {
  hasError: boolean;
  error: Error | null;
}

/**
 * Global error boundary. Catches render errors (including from LogtoProvider)
 * and shows a visible fallback instead of a white screen.
 */
export default class ErrorBoundary extends Component<Props, State> {
  constructor(props: Props) {
    super(props);
    this.state = { hasError: false, error: null };
  }

  static getDerivedStateFromError(error: Error): State {
    return { hasError: true, error };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error('[ErrorBoundary] Caught render error:', error, info.componentStack);
  }

  render() {
    if (this.state.hasError) {
      if (this.props.fallback) return this.props.fallback;

      return (
        <div style={{
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          justifyContent: 'center',
          height: '100dvh',
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
            Something went wrong
          </h1>
          <p style={{ fontSize: 14, color: '#2D3436aa', maxWidth: 400, margin: '0 0 16px' }}>
            {this.state.error?.message || 'An unexpected error occurred.'}
          </p>
          <button
            onClick={() => window.location.reload()}
            style={{
              padding: '10px 24px', borderRadius: 12, border: 'none',
              background: '#67B88B', color: 'white', fontWeight: 600,
              fontSize: 14, cursor: 'pointer',
            }}
          >
            Reload
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
