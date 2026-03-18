/**
 * useAuth — unified authentication hook.
 *
 * When Logto is available (secure context), delegates to @logto/react.
 * When Logto is NOT available (HTTP dev environments), returns a stub
 * that treats the user as authenticated so the app is still usable.
 *
 * Components should import { useAuth, AuthProvider } from here instead of
 * using @logto/react directly.
 */
import {
  createContext,
  useContext,
  type ReactNode,
} from 'react';
import {
  LogtoProvider,
  useLogto,
  useHandleSignInCallback,
  type LogtoConfig,
} from '@logto/react';
import type { IdTokenClaims } from '@logto/react';

/* ------------------------------------------------------------------ */
/*  Detect whether we can safely use Logto (requires crypto.subtle)   */
/* ------------------------------------------------------------------ */

const CAN_USE_LOGTO: boolean =
  typeof window !== 'undefined' &&
  (window.isSecureContext ||
    location.protocol === 'https:' ||
    location.hostname === 'localhost' ||
    location.hostname === '127.0.0.1');

/* ------------------------------------------------------------------ */
/*  Dev‑mode stub context (no Logto)                                   */
/* ------------------------------------------------------------------ */

interface AuthContextValue {
  /** Whether Logto is active (false in dev HTTP mode) */
  logtoAvailable: boolean;
  isAuthenticated: boolean;
  isLoading: boolean;
  signIn: (redirectUri: string) => void;
  signOut: (postLogoutRedirectUri?: string) => void;
  getIdTokenClaims: () => Promise<IdTokenClaims | undefined>;
}

const DevAuthContext = createContext<AuthContextValue>({
  logtoAvailable: false,
  isAuthenticated: true,
  isLoading: false,
  signIn: () => {
    console.warn('[useAuth] signIn called in dev mode — no-op');
  },
  signOut: () => {
    console.warn('[useAuth] signOut called in dev mode — reloading');
    window.location.reload();
  },
  getIdTokenClaims: async () => undefined,
});

/* ------------------------------------------------------------------ */
/*  AuthProvider — wraps LogtoProvider only when safe                  */
/* ------------------------------------------------------------------ */

export function AuthProvider({
  config,
  children,
}: {
  config: LogtoConfig;
  children: ReactNode;
}) {
  if (CAN_USE_LOGTO) {
    return <LogtoProvider config={config}>{children}</LogtoProvider>;
  }

  // Dev HTTP mode — skip Logto entirely
  console.info(
    '[AuthProvider] Non-secure context detected (%s) — Logto SSO skipped, running in dev mode.',
    location.origin,
  );
  return (
    <DevAuthContext.Provider
      value={{
        logtoAvailable: false,
        isAuthenticated: true,
        isLoading: false,
        signIn: () => {},
        signOut: () => window.location.reload(),
        getIdTokenClaims: async () => undefined,
      }}
    >
      {children}
    </DevAuthContext.Provider>
  );
}

/* ------------------------------------------------------------------ */
/*  useAuth — drop-in replacement for useLogto                        */
/* ------------------------------------------------------------------ */

export function useAuth(): AuthContextValue {
  if (CAN_USE_LOGTO) {
    // eslint-disable-next-line react-hooks/rules-of-hooks
    const logto = useLogto();
    return {
      logtoAvailable: true,
      isAuthenticated: logto.isAuthenticated,
      isLoading: logto.isLoading,
      signIn: logto.signIn,
      signOut: logto.signOut,
      getIdTokenClaims: logto.getIdTokenClaims,
    };
  }
  // eslint-disable-next-line react-hooks/rules-of-hooks
  return useContext(DevAuthContext);
}

/* ------------------------------------------------------------------ */
/*  useAuthCallback — drop-in replacement for useHandleSignInCallback */
/* ------------------------------------------------------------------ */

export function useAuthCallback(onSuccess: () => void) {
  if (CAN_USE_LOGTO) {
    // eslint-disable-next-line react-hooks/rules-of-hooks
    return useHandleSignInCallback(onSuccess);
  }
  // In dev mode, just call success immediately
  // (callback route shouldn't be reached in dev mode, but just in case)
  return { isLoading: false, error: undefined };
}

export { CAN_USE_LOGTO };
