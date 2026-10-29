import { useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { Smartphone } from 'lucide-react';
import { post } from '../lib/api';
import { useI18n } from '../lib/i18n';
import { GoogleButton } from '../components/GoogleButton';
import { Button, ErrorNote } from '../components/ui';

/**
 * Opened in the phone's browser by the Android app: signs in with Google here
 * (Google refuses to run inside app web views), then sends a one-time code back
 * to the app through its own link.
 */
export default function GoogleApp() {
  const { lang, err } = useI18n();
  const [q] = useSearchParams();
  const challenge = q.get('c') ?? '';
  const scheme = ['taler', 'talerbank'].includes(q.get('s') ?? '') ? q.get('s')! : null;
  const accountType = ['user', 'merchant', 'exchange'].includes(q.get('t') ?? '') ? q.get('t')! : undefined;
  const [back, setBack] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const ar = (q.get('l') ?? lang) === 'ar';
  const ok = scheme && /^[A-Za-z0-9_-]{43,128}$/.test(challenge);
  return (
    <div dir={ar ? 'rtl' : 'ltr'} className="app-ground grid min-h-dvh place-items-center p-5">
      <div className="sewn w-full max-w-sm rounded-[28px] bg-surface p-7 text-center shadow-card">
        <span className="mx-auto grid h-16 w-16 place-items-center rounded-[22px] bg-night text-white">
          <Smartphone className="h-8 w-8" />
        </span>
        <h1 className="mt-4 text-2xl">{ar ? 'تسجيل الدخول للتطبيق' : 'Sign in to the app'}</h1>
        <p className="mt-2 text-sm text-muted">
          {ar ? 'اختار حساب Google، وبعدها بنرجعك للتطبيق تلقائيًا.' : 'Pick your Google account and we’ll take you straight back to the app.'}
        </p>
        {!ok ? (
          <ErrorNote>{ar ? 'الرابط ناقص. ارجع للتطبيق وجرّب مرة ثانية.' : 'This link is incomplete. Go back to the app and try again.'}</ErrorNote>
        ) : back ? (
          <div className="mt-6">
            <p className="text-olive">{ar ? 'تمام! رجعناك للتطبيق.' : 'Done! Returning you to the app.'}</p>
            <a href={back} className="mt-4 block">
              <Button block size="lg">{ar ? 'افتح التطبيق' : 'Open the app'}</Button>
            </a>
          </div>
        ) : (
          <GoogleButton
            accountType={accountType}
            onCredential={async (credential) => {
              setError(null);
              try {
                const r = await post('/api/auth/google/handoff', { credential, challenge, language: ar ? 'ar' : 'en', ...(accountType && scheme === 'taler' ? { accountType } : {}) });
                const url = `${scheme}://google?code=${encodeURIComponent(r.code)}`;
                setBack(url);
                window.location.href = url;
              } catch (e) {
                setError(err(e));
              }
            }}
          />
        )}
        <ErrorNote>{error}</ErrorNote>
      </div>
    </div>
  );
}
