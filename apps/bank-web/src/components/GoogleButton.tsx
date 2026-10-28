import { useEffect, useRef, useState } from 'react';
import { isNative } from '../lib/api';
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

/**
 * "Continue with Google" (Google Identity Services). Shows only when the server
 * has a Google client ID configured, and only on the web — the Android app keeps
 * e-mail sign-in.
 */
export function GoogleButton({ onCredential, text = 'continue_with' }: { onCredential: (credential: string) => void; text?: 'continue_with' | 'signup_with' }) {
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
  if (!id || isNative) return null;
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
