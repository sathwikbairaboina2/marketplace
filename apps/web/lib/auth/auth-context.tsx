'use client';

import { createContext, useCallback, useContext, useEffect, useState } from 'react';
import { PrincipalSchema, type Principal } from '@marketplace/contracts';
import { ENGINE_URL } from '../env';
import { clearThreadIds } from '../chat/thread-storage';

const STORAGE_KEY = 'marketplace.token';

// A module-level mirror of the token. lib/api/http.ts runs outside React and
// needs the bearer on every call; threading it through props, or reading a hook
// from a non-component, would both be worse than one module-scoped cell whose
// sole writer is the provider below.
let currentToken: string | null = null;
export const getToken = (): string | null => currentToken;

interface AuthValue {
  token: string | null;
  principal: Principal | null;
  ready: boolean;
  signIn: (username: string, password: string) => Promise<void>;
  signOut: () => void;
}

const AuthContext = createContext<AuthValue | null>(null);

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [token, setToken] = useState<string | null>(null);
  const [principal, setPrincipal] = useState<Principal | null>(null);
  const [ready, setReady] = useState(false);

  const signOut = useCallback(() => {
    currentToken = null;
    sessionStorage.removeItem(STORAGE_KEY);
    // The chat threads belong to the session, not to the tab. Left behind,
    // they are resumed by whoever signs in next -- another tenant, whose
    // wizard then answers thread-not-found and drops what they type.
    clearThreadIds();
    setToken(null);
    setPrincipal(null);
  }, []);

  const adopt = useCallback(async (next: string) => {
    currentToken = next;
    const res = await fetch(`${ENGINE_URL}/me`, { headers: { Authorization: `Bearer ${next}` } });
    if (!res.ok) throw new Error('token rejected');
    const me = PrincipalSchema.parse(await res.json());
    sessionStorage.setItem(STORAGE_KEY, next);
    setToken(next);
    setPrincipal(me);
  }, []);

  useEffect(() => {
    const stored = sessionStorage.getItem(STORAGE_KEY);
    if (!stored) {
      setReady(true);
      return;
    }
    // A stored token can outlive the pool that minted it -- `docker:up` drops
    // the cognito-data volume and creates a new user pool every run. Validating
    // here sends a stale session to /login instead of letting it fail on the
    // first data call.
    adopt(stored)
      .catch(() => signOut())
      .finally(() => setReady(true));
  }, [adopt, signOut]);

  const signIn = useCallback(
    async (username: string, password: string) => {
      const res = await fetch('/api/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username, password }),
      });
      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as { detail?: string };
        throw new Error(body.detail ?? 'sign in failed');
      }
      const { token: next } = (await res.json()) as { token: string };
      await adopt(next);
    },
    [adopt],
  );

  return (
    <AuthContext.Provider value={{ token, principal, ready, signIn, signOut }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth(): AuthValue {
  const value = useContext(AuthContext);
  if (!value) throw new Error('useAuth must be used inside AuthProvider');
  return value;
}
