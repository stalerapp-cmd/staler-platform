import { useEffect, useRef, useState } from 'react';
import { Browser } from '@capacitor/browser';
import { isNative, PUBLIC_ORIGIN } from '../lib/api';
import { usePublicConfig } from '../lib/config';
import { useI18n } from '../lib/i18n';

declare global {
  interface Window {
    google?: any;
  }
}
let loader: Promise<void> | null = null;
const loadGis = () =>
  (loader ??= new Promise<void>((resolve, reject) => {
    const s = document.createElement('script');
    s.src = 'https://accounts.google.com/gsi/client';
    s.async = true;
    s.onload = () => resolve();
    s.onerror = () => {
      loader = null;
      reject(new Error('gsi'));
    };
    document.head.appendChild(s);
  }));

// ------------------------------------------------------------ in the app
// Google does not allow its sign-in inside an app's web view, so the app opens the
// real browser on our /google-app page, which hands a one-time code back through
// the app link (taler://google?code=…). PKCE ties the code to this install.
const VERIFIER = 'st.g.verifier';
const b64url = (b: ArrayBuffer | Uint8Array) => btoa(String.fromCharCode(...new Uint8Array(b))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');

export async function startNativeGoogle(lang: string, accountType?: string) {
  const verifier = b64url(crypto.getRandomValues(new Uint8Array(32)));
  const challenge = b64url(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(verifier)));
  try {
    localStorage.setItem(VERIFIER, verifier);
  } catch {
    /* private mode */
  }
  const q = new URLSearchParams({ c: challenge, l: lang, s: 'taler' });
  if (accountType) q.set('t', accountType);
  await Browser.open({ url: `${PUBLIC_ORIGIN}/google-app?${q}`, presentationStyle: 'popover' });
}

/** Called from the app-link listener; the open sign-in screen picks it up. */
export function receiveNativeGoogle(url: string) {
  const m = /^taler:\/\/google\?(.+)$/i.exec(url);
  if (!m) return false;
  const code = new URLSearchParams(m[1]).get('code');
  if (!code) return false;
  try {
    sessionStorage.setItem('st.g.code', code);
  } catch {
    /* ignore */
  }
  void Browser.close().catch(() => {});
  window.dispatchEvent(new CustomEvent('google-code'));
  return true;
}

/** The pending code + verifier, used once. */
export function takeNativeGoogle(): { code: string; verifier: string } | null {
  try {
    const code = sessionStorage.getItem('st.g.code');
    const verifier = localStorage.getItem(VERIFIER);
    if (!code || !verifier) return null;
    sessionStorage.removeItem('st.g.code');
    localStorage.removeItem(VERIFIER);
    return { code, verifier };
  } catch {
    return null;
  }
}

const G_LOGO = (
  <svg viewBox="0 0 48 48" className="h-5 w-5" aria-hidden="true">
    <path fill="#FFC107" d="M43.6 20.5H42V20H24v8h11.3C33.7 32.7 29.2 36 24 36c-6.6 0-12-5.4-12-12s5.4-12 12-12c3.1 0 5.8 1.2 7.9 3.1l5.7-5.7C34 6.1 29.3 4 24 4 12.9 4 4 12.9 4 24s8.9 20 20 20 20-8.9 20-20c0-1.3-.1-2.4-.4-3.5z" />
    <path fill="#FF3D00" d="m6.3 14.7 6.6 4.8C14.7 15.1 19 12 24 12c3.1 0 5.8 1.2 7.9 3.1l5.7-5.7C34 6.1 29.3 4 24 4 16.3 4 9.7 8.3 6.3 14.7z" />
    <path fill="#4CAF50" d="M24 44c5.2 0 9.9-2 13.4-5.2l-6.2-5.2C29.2 35.1 26.7 36 24 36c-5.2 0-9.6-3.3-11.3-8l-6.5 5C9.5 39.6 16.2 44 24 44z" />
    <path fill="#1976D2" d="M43.6 20.5H42V20H24v8h11.3c-.8 2.2-2.2 4.2-4.1 5.6l6.2 5.2C37 39.2 44 34 44 24c0-1.3-.1-2.4-.4-3.5z" />
  </svg>
);

/**
 * "Continue with Google". On the web it is Google's own button; in the Android
 * app it opens the browser hand-off above. Hidden until a Google client ID is set.
 */
export function GoogleButton({
  onCredential,
  onNativeCode,
  accountType,
  text = 'continue_with',
}: {
  onCredential: (credential: string) => void;
  onNativeCode?: (p: { code: string; verifier: string }) => void;
  accountType?: string;
  text?: 'continue_with' | 'signup_with';
}) {
  const cfg = usePublicConfig();
  const { t, lang } = useI18n();
  const box = useRef<HTMLDivElement>(null);
  const cb = useRef(onCredential);
  cb.current = onCredential;
  const [ready, setReady] = useState(false);
  const id = cfg?.googleClientId;
  useEffect(() => {
    if (!id || isNative) return;
    let alive = true;
    loadGis()
      .then(() => {
        if (!alive || !box.current || !window.google) return;
        window.google.accounts.id.initialize({ client_id: id, callback: (r: { credential: string }) => cb.current(r.credential), ux_mode: 'popup' });
        box.current.innerHTML = '';
        window.google.accounts.id.renderButton(box.current, {
          type: 'standard',
          theme: document.documentElement.dataset.theme === 'dark' ? 'filled_black' : 'outline',
          size: 'large',
          shape: 'pill',
          text,
          locale: lang,
          width: Math.min(box.current.clientWidth || 360, 400),
        });
        setReady(true);
      })
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, [id, lang, text]);
  const nat = useRef(onNativeCode);
  nat.current = onNativeCode;
  useEffect(() => {
    if (!isNative) return;
    const pick = () => {
      const got = takeNativeGoogle();
      if (got) nat.current?.(got);
    };
    pick();
    window.addEventListener('google-code', pick);
    return () => window.removeEventListener('google-code', pick);
  }, []);
  if (!id) return null;
  if (isNative)
    return (
      <div className="mt-6">
        <div className="mb-5 flex items-center gap-3 text-xs text-muted">
          <span className="h-px flex-1 bg-line" />
          {t.auth.or}
          <span className="h-px flex-1 bg-line" />
        </div>
        <button
          type="button"
          onClick={() => void startNativeGoogle(lang, accountType)}
          className="flex h-12 w-full items-center justify-center gap-3 rounded-full border border-line bg-surface font-medium text-ink shadow-sm transition active:scale-[0.98]"
        >
          {G_LOGO}
          {text === 'signup_with' ? (lang === 'ar' ? 'التسجيل عبر Google' : 'Sign up with Google') : lang === 'ar' ? 'المتابعة باستخدام Google' : 'Continue with Google'}
        </button>
      </div>
    );
  return (
    <div className="mt-6">
      <div className="mb-5 flex items-center gap-3 text-xs text-muted">
        <span className="h-px flex-1 bg-line" />
        {t.auth.or}
        <span className="h-px flex-1 bg-line" />
      </div>
      <div ref={box} className={ready ? 'flex justify-center' : 'h-11 animate-pulse rounded-full bg-sunk'} />
    </div>
  );
}
