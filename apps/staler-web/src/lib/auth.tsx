import { bioEnabled } from './biometric';
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { applySession, clearSession, post, get, refreshSession, session } from './api';

export interface User {
  id: string;
  admin_permissions?: string[] | null;
  email: string;
  full_name: string;
  role: 'user' | 'merchant' | 'exchange' | 'admin';
  admin_level: string | null;
  profile_image: string | null;
  phone_number: string | null;
  language: 'en' | 'ar' | null;
  totp_enabled: boolean;
  wallet_id: string;
  balance: string;
  currency: string;
  wallet_frozen: boolean;
  merchant_id: string | null;
  store_name: string | null;
  recovery_codes_left: number;
}

interface AuthState {
  user: User | null;
  ready: boolean;
  signedOutForIdle: boolean;
  /** App is locked behind fingerprint / phone PIN (Android, when enabled). */
  locked: boolean;
  unlock: () => void;
  /** Re-read the fingerprint setting after it changes in Settings. */
  refreshBio: () => void;
  login: (email: string, password: string) => Promise<{ mfaToken?: string }>;
  completeMfa: (mfaToken: string, code: string) => Promise<void>;
  finishVerification: (data: any) => Promise<void>;
  logout: () => Promise<void>;
  reload: () => Promise<void>;
  setUser: (u: User | null) => void;
}

const Ctx = createContext<AuthState | null>(null);
const IDLE_MS = 20 * 60 * 1000;

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [ready, setReady] = useState(false);
  const [signedOutForIdle, setIdle] = useState(false);
  const [locked, setLocked] = useState(false);
  const bio = useRef(false);
  const hiddenAt = useRef<number | null>(null);
  const lastActivity = useRef(Date.now());

  useEffect(() => {
    return session.onChange((u) => setUser(u)); // unsubscribe on unmount
  }, []);
  useEffect(() => {
    void (async () => {
      bio.current = await bioEnabled();
      const u = await refreshSession();
      if (u && bio.current) setLocked(true); // reopening the app: prove it's you first
      setReady(true);
    })();
  }, []);

  // Back from the background after a minute → lock again (when fingerprint unlock is on).
  useEffect(() => {
    const onVis = () => {
      if (document.visibilityState === 'hidden') hiddenAt.current = Date.now();
      else if (hiddenAt.current && Date.now() - hiddenAt.current > 60_000 && bio.current && session.user) setLocked(true);
    };
    document.addEventListener('visibilitychange', onVis);
    return () => document.removeEventListener('visibilitychange', onVis);
  }, []);

  const logout = useCallback(async () => {
    try {
      await post('/api/auth/logout');
    } catch {
      /* already gone */
    }
    await clearSession();
  }, []);

  // Sign out after inactivity — a wallet left open on a shared device is a risk.
  useEffect(() => {
    if (!user) return;
    const bump = () => (lastActivity.current = Date.now());
    const events = ['pointerdown', 'keydown', 'scroll', 'touchstart'];
    events.forEach((e) => window.addEventListener(e, bump, { passive: true }));
    const timer = window.setInterval(() => {
      if (Date.now() - lastActivity.current > IDLE_MS) {
        lastActivity.current = Date.now();
        if (bio.current) setLocked(true); // fingerprint unlock on: lock instead of signing out
        else {
          setIdle(true);
          void logout();
        }
      }
    }, 30_000);
    return () => {
      events.forEach((e) => window.removeEventListener(e, bump));
      window.clearInterval(timer);
    };
  }, [user, logout]);

  const value = useMemo<AuthState>(
    () => ({
      user,
      ready,
      signedOutForIdle,
      locked,
      unlock: () => setLocked(false),
      refreshBio: () => {
        void bioEnabled().then((on) => {
          bio.current = on;
        });
      },
      setUser,
      async login(email, password) {
        const data = await post('/api/auth/login', { email, password });
        if (data.mfaRequired) return { mfaToken: data.mfaToken };
        setIdle(false);
        await applySession(data);
        return {};
      },
      async completeMfa(mfaToken, code) {
        const data = await post('/api/auth/login/mfa', { mfaToken, code });
        setIdle(false);
        await applySession(data);
      },
      async finishVerification(data) {
        await applySession(data);
      },
      logout,
      async reload() {
        const d = await get<{ user: User }>('/api/auth/me');
        setUser(d.user);
      },
    }),
    [user, ready, signedOutForIdle, locked, logout],
  );
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useAuth() {
  const v = useContext(Ctx);
  if (!v) throw new Error('AuthProvider missing');
  return v;
}
