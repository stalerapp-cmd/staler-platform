import { useEffect, useRef } from 'react';
import { patch } from '../lib/api';
import { useAuth } from '../lib/auth';
import { useI18n } from '../lib/i18n';
import { useTheme } from '../lib/theme';

/**
 * Language and look belong to the person, not the device: when they sign in we
 * apply what their account remembers, and when they change either one anywhere
 * in the app we save it to the account, so every phone and browser matches.
 */
export function PrefsSync() {
  const { user, setUser } = useAuth();
  const { lang, setLang } = useI18n();
  const { theme, setTheme } = useTheme();
  const applied = useRef<string | null>(null);

  // On sign-in (or a different account): take the account's saved choices.
  useEffect(() => {
    if (!user || applied.current === user.id) return;
    applied.current = user.id;
    const u = user as typeof user & { theme?: 'light' | 'dark' | null };
    if (u.language && u.language !== lang) setLang(u.language);
    if (u.theme && u.theme !== theme) setTheme(u.theme);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user?.id]);
  useEffect(() => {
    if (!user) applied.current = null;
  }, [user]);

  // Any later change is saved to the account.
  useEffect(() => {
    if (!user || applied.current !== user.id) return;
    const u = user as typeof user & { theme?: 'light' | 'dark' | null };
    const body: Record<string, string> = {};
    if (u.language !== lang) body.language = lang;
    if (u.theme !== theme) body.theme = theme;
    if (!Object.keys(body).length) return;
    const h = setTimeout(() => {
      patch<{ user: typeof user }>('/api/auth/me', body)
        .then((r) => r?.user && setUser(r.user))
        .catch(() => undefined);
    }, 400);
    return () => clearTimeout(h);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [lang, theme, user?.id]);

  return null;
}
