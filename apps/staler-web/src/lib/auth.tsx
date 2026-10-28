import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { applySession, clearSession, post, get, refreshSession, session } from './api';

export interface User {
  id: string;
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
  const lastActivity = useRef(Date.now());

  useEffect(() => session.onChange((u) => setUser(u)), []);
  useEffect(() => {
    refreshSession().finally(() => setReady(true));
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
        setIdle(true);
        void logout();
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
    [user, ready, signedOutForIdle, logout],
  );
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useAuth() {
  const v = useContext(Ctx);
  if (!v) throw new Error('AuthProvider missing');
  return v;
}
