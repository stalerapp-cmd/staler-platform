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
  profile_image_original?: string | null;
  home_city?: string | null;
  language: 'en' | 'ar' | null;
  theme?: 'light' | 'dark' | null;
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
  // Who the idle timer is counting for: a fresh sign-in starts the clock again.
  const idleFor = useRef<string | null>(null);

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
  const userId = user?.id ?? null;
  useEffect(() => {
    if (!userId) {
      idleFor.current = null;
      return;
    }
    // Just signed in (or switched account): time spent on the sign-in page before isn't inactivity.
    if (idleFor.current !== userId) {
      idleFor.current = userId;
      lastActivity.current = Date.now();
    }
    // Away longer than the limit (laptop shut, phone in a pocket): the first touch on return must not
    // count as activity — it ends the session instead.
    const expire = () => {
      lastActivity.current = Date.now();
      if (bio.current) setLocked(true); // fingerprint unlock on: lock instead of signing out
      else {
        setIdle(true);
        void logout();
      }
    };
    const bump = () => {
      if (Date.now() - lastActivity.current > IDLE_MS) return expire();
      lastActivity.current = Date.now();
    };
    const onShow = () => {
      if (document.visibilityState === 'visible' && Date.now() - lastActivity.current > IDLE_MS) expire();
    };
    document.addEventListener('visibilitychange', onShow);
    window.addEventListener('focus', onShow);
    const events = ['pointerdown', 'keydown', 'scroll', 'touchstart'];
    events.forEach((e) => window.addEventListener(e, bump, { passive: true }));
    const timer = window.setInterval(() => {
      if (Date.now() - lastActivity.current > IDLE_MS) expire();
    }, 30_000);
    return () => {
      events.forEach((e) => window.removeEventListener(e, bump));
      document.removeEventListener('visibilitychange', onShow);
      window.removeEventListener('focus', onShow);
      window.clearInterval(timer);
    };
  }, [userId, logout]);

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
