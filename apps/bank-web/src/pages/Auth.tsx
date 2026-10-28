import { motion } from 'framer-motion';
import { useState, type ReactNode } from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import { Eye, EyeOff, Fingerprint, KeySquare, Scale } from 'lucide-react';
import { ApiError, post } from '../lib/api';
import { useAuth } from '../lib/auth';
import { useI18n } from '../lib/i18n';
import { Emblem, Guilloche } from '../components/Guilloche';
import { Button, CodeInput, ErrorNote, Field, PasswordStrength, Segmented } from '../components/ui';
import { TopControls } from '../layouts/Shell';
import { useToast } from '../components/Toast';
import { useConfirm } from '../components/Confirm';
import { AuthBack, MailTips, ResendCode } from '../components/AuthExtras';
import { GoogleButton } from '../components/GoogleButton';
import { usePublicConfig } from '../lib/config';
import { fill } from '../lib/format';

export function AuthLayout({ children }: { children: ReactNode }) {
  const { t } = useI18n();
  const trust = [
    { icon: Scale, text: t.auth.trust1 },
    { icon: Fingerprint, text: t.auth.trust2 },
    { icon: KeySquare, text: t.auth.trust3 },
  ];
  return (
    <div className="grid min-h-dvh bg-bg lg:grid-cols-[1fr_1.05fr]">
      <div className="flex flex-col">
        <div className="safe-top flex items-center justify-between px-5 py-4">
          <div className="flex items-center gap-1">
            <AuthBack />
            <Link to="/" className="flex items-center gap-2.5">
              <Emblem className="h-9 w-9" />
              <span className="font-display text-2xl">TalerBank</span>
            </Link>
          </div>
          <TopControls />
        </div>
        <div className="flex flex-1 items-center justify-center px-5 pb-12">
          <motion.div initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.5 }} className="w-full max-w-md">
            {children}
          </motion.div>
        </div>
      </div>
      <aside className="engraved relative hidden overflow-hidden border-s border-line bg-night lg:flex lg:flex-col lg:justify-end lg:p-14">
        <Guilloche className="absolute -end-40 -top-40 h-[760px] w-[760px] opacity-90" />
        <Guilloche className="absolute -bottom-56 -start-48 h-[520px] w-[520px] opacity-40" spin={false} />
        <div className="relative">
          <p className="max-w-md font-display text-5xl leading-[1.15] text-[#ECE6D8]">{t.brand.tagline}</p>
          <ul className="mt-10 space-y-4">
            {trust.map((x, i) => (
              <motion.li key={x.text} initial={{ opacity: 0, x: 12 }} animate={{ opacity: 1, x: 0 }} transition={{ delay: 0.6 + i * 0.15 }} className="flex items-center gap-3 text-[#C8D3CC]">
                <x.icon className="h-5 w-5 text-gold" strokeWidth={1.6} />
                {x.text}
              </motion.li>
            ))}
          </ul>
        </div>
      </aside>
    </div>
  );
}

function Secret({ label, value, onChange, autoComplete, error }: { label: string; value: string; onChange: (v: string) => void; autoComplete: string; error?: string | null }) {
  const [show, setShow] = useState(false);
  return (
    <Field
      label={label}
      type={show ? 'text' : 'password'}
      value={value}
      onChange={(e) => onChange(e.target.value)}
      autoComplete={autoComplete}
      required
      error={error ?? undefined}
      dir="ltr"
      trailing={
        <button type="button" onClick={() => setShow((s) => !s)} className="rounded-lg p-2 text-muted hover:text-ink" aria-label={show ? 'Hide password' : 'Show password'}>
          {show ? <EyeOff className="h-5 w-5" /> : <Eye className="h-5 w-5" />}
        </button>
      }
    />
  );
}

export function Login() {
  const { t, err, lang } = useI18n();
  const { login, completeMfa, signedOutForIdle, google } = useAuth();
  const nav = useNavigate();
  const loc = useLocation() as { state?: { from?: string } };
  const [id, setId] = useState('');
  const [pw, setPw] = useState('');
  const [mfa, setMfa] = useState<string | null>(null);
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const go = () => nav(loc.state?.from ?? '/app', { replace: true });
  const onGoogle = async (credential: string) => {
    setBusy(true);
    setError(null);
    try {
      const r = await google(credential, { language: lang });
      if (r.mfaToken) setMfa(r.mfaToken);
      else go();
    } catch (e2) {
      setError(err(e2));
    } finally {
      setBusy(false);
    }
  };
  return (
    <AuthLayout>
      <h1 className="text-4xl">{mfa ? t.auth.mfaTitle : t.auth.welcome}</h1>
      <p className="mt-2 text-muted">{mfa ? t.auth.mfaLead : t.auth.lead}</p>
      {signedOutForIdle && !mfa && <p className="mt-4 rounded-xl bg-gold/15 px-4 py-3 text-sm">{t.auth.idle}</p>}
      <form
        className="mt-8 space-y-4"
        onSubmit={async (e) => {
          e.preventDefault();
          setBusy(true);
          setError(null);
          try {
            if (mfa) {
              await completeMfa(mfa, code.trim());
              go();
            } else {
              const r = await login(id.trim(), pw);
              if (r.mfaToken) setMfa(r.mfaToken);
              else go();
            }
          } catch (e2) {
            if (e2 instanceof ApiError && e2.code === 'MFA_EXPIRED') setMfa(null);
            setError(err(e2));
          } finally {
            setBusy(false);
          }
        }}
      >
        {mfa ? (
          <Field label={t.auth.mfaCode} value={code} onChange={(e) => setCode(e.target.value)} autoComplete="one-time-code" autoFocus dir="ltr" placeholder="123456" />
        ) : (
          <>
            <Field label={t.auth.login} value={id} onChange={(e) => setId(e.target.value)} autoComplete="username" required dir="ltr" autoFocus />
            <Secret label={t.auth.password} value={pw} onChange={setPw} autoComplete="current-password" />
            <div className="text-end">
              <Link to="/forgot" className="text-sm text-gold hover:underline">
                {t.auth.forgot}
              </Link>
            </div>
          </>
        )}
        <ErrorNote>{error}</ErrorNote>
        <Button block size="lg" loading={busy}>
          {mfa ? t.common.confirm : t.auth.signIn}
        </Button>
      </form>
      {!mfa && <GoogleButton onCredential={onGoogle} />}
      {!mfa && (
        <p className="mt-8 text-center text-muted">
          {t.auth.noAccount}{' '}
          <Link to="/register" className="font-medium text-ink underline decoration-gold decoration-2 underline-offset-4">
            {t.auth.open}
          </Link>
        </p>
      )}
    </AuthLayout>
  );
}

export function Register() {
  const { t, err, lang } = useI18n();
  const nav = useNavigate();
  const confirm = useConfirm();
  const cfg = usePublicConfig();
  const { google } = useAuth();
  const [method, setMethod] = useState<'email' | 'sms'>('email');
  const prefill = (useLocation() as { state?: { email?: string } }).state?.email ?? '';
  const [f, setF] = useState({ fullName: '', email: prefill, username: '', password: '', phone: '' });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [fe, setFe] = useState<Record<string, string>>({});
  const set = (k: keyof typeof f) => (e: React.ChangeEvent<HTMLInputElement>) => setF({ ...f, [k]: e.target.value });
  const [pw2, setPw2] = useState('');
  return (
    <AuthLayout>
      <h1 className="text-4xl">{t.auth.registerTitle}</h1>
      <p className="mt-2 text-muted">{t.auth.registerLead}</p>
      <form
        className="mt-8 space-y-4"
        onSubmit={async (e) => {
          e.preventDefault();
          if (f.password !== pw2) return setFe({ password2: t.auth.mismatch });
          if (method === 'sms' && !f.phone.trim()) return setError(t.auth.smsNeedsPhone);
          if (!(await confirm({ title: t.auth.reviewTitle, body: fill(t.auth.reviewBody, { email: method === 'sms' ? f.phone.trim() : f.email.trim() }), confirmLabel: t.auth.reviewOk }))) return;
          setBusy(true);
          setError(null);
          setFe({});
          try {
            await post('/api/auth/register', {
              fullName: f.fullName.trim(),
              email: f.email.trim(),
              username: f.username.trim().toLowerCase(),
              password: f.password,
              language: lang,
              ...(f.phone.trim() ? { phone: f.phone.trim() } : {}),
              method,
            });
            nav('/verify', { state: { email: f.email.trim(), sms: method === 'sms' ? f.phone.trim() : undefined } });
          } catch (e2) {
            if (e2 instanceof ApiError && Array.isArray(e2.details)) setFe(Object.fromEntries((e2.details as any[]).map((d) => [d.path, d.message])));
            setError(err(e2));
          } finally {
            setBusy(false);
          }
        }}
      >
        <Field label={t.auth.fullName} value={f.fullName} onChange={set('fullName')} autoComplete="name" required error={fe.fullName} />
        <Field label={t.auth.email} type="email" value={f.email} onChange={set('email')} autoComplete="email" dir="ltr" required error={fe.email} />
        <Field label={t.auth.username} value={f.username} onChange={set('username')} autoComplete="username" dir="ltr" required hint={t.auth.usernameHint} error={fe.username} />
        <Field label={`${t.auth.phone} (${t.common.optional})`} type="tel" value={f.phone} onChange={set('phone')} autoComplete="tel" dir="ltr" error={fe.phone} />
        <div>
          <Secret label={t.auth.password} value={f.password} onChange={(v) => setF({ ...f, password: v })} autoComplete="new-password" />
          <PasswordStrength value={f.password} />
        </div>
        <Secret
          label={t.auth.confirmPassword}
          value={pw2}
          onChange={setPw2}
          autoComplete="new-password"
          error={fe.password2 ?? (pw2 && !f.password.startsWith(pw2) ? t.auth.mismatch : null)}
        />
        {cfg?.sms && (
          <div>
            <p className="mb-2 text-sm font-medium text-ink/80">{t.auth.sendVia}</p>
            <Segmented value={method} onChange={setMethod} options={[{ value: 'email', label: t.auth.viaEmail }, { value: 'sms', label: t.auth.viaSms }]} />
          </div>
        )}
        <ErrorNote>{error}</ErrorNote>
        <Button block size="lg" loading={busy}>
          {t.auth.create}
        </Button>
      </form>
      <GoogleButton
        text="signup_with"
        onCredential={async (cred) => {
          setBusy(true);
          try {
            const r = await google(cred, { language: lang });
            nav(r.mfaToken ? '/login' : '/app', { replace: true });
          } catch (e2) {
            setError(err(e2));
          } finally {
            setBusy(false);
          }
        }}
      />
      <p className="mt-6 text-center text-muted">
        {t.auth.have}{' '}
        <Link to="/login" className="font-medium text-ink underline decoration-gold decoration-2 underline-offset-4">
          {t.auth.signIn}
        </Link>
      </p>
    </AuthLayout>
  );
}

export function Verify() {
  const { t, err } = useI18n();
  const toast = useToast();
  const nav = useNavigate();
  const { finishVerification } = useAuth();
  const loc = useLocation() as { state?: { email?: string; sms?: string } };
  const [email, setEmail] = useState(loc.state?.email ?? '');
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  return (
    <AuthLayout>
      <h1 className="text-4xl">{t.auth.verifyTitle}</h1>
      <p className="mt-2 text-muted">
        {loc.state?.sms ? t.auth.verifyLeadSms : t.auth.verifyLead} <span className="num font-medium text-ink" dir="ltr">{loc.state?.sms ?? email}</span>
      </p>
      <form
        className="mt-8 space-y-5"
        onSubmit={async (e) => {
          e.preventDefault();
          setBusy(true);
          setError(null);
          try {
            await finishVerification(await post('/api/auth/verify-email', { email: email.trim(), code }));
            nav('/app', { replace: true });
          } catch (e2) {
            setError(err(e2));
            setCode('');
          } finally {
            setBusy(false);
          }
        }}
      >
        {!loc.state?.email && <Field label={t.auth.email} type="email" value={email} onChange={(e) => setEmail(e.target.value)} dir="ltr" required />}
        <CodeInput value={code} onChange={setCode} />
        <ErrorNote>{error}</ErrorNote>
        <Button block size="lg" loading={busy} disabled={code.length !== 6}>
          {t.auth.verify}
        </Button>
        <ResendCode
          onResend={async () => {
            await post('/api/auth/resend-code', { email: email.trim() }).catch(() => {});
            toast(t.auth.resent);
          }}
        />
        <MailTips onChangeEmail={() => nav('/register', { state: { email } })} />
      </form>
    </AuthLayout>
  );
}

export function Forgot() {
  const { t, err } = useI18n();
  const nav = useNavigate();
  const toast = useToast();
  const [step, setStep] = useState<'email' | 'reset'>('email');
  const [email, setEmail] = useState('');
  const [code, setCode] = useState('');
  const [pw, setPw] = useState('');
  const [pw2, setPw2] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  return (
    <AuthLayout>
      <h1 className="text-4xl">{t.auth.resetTitle}</h1>
      <p className="mt-2 text-muted">{step === 'email' ? t.auth.resetLead : `${t.auth.verifyLead} ${email}`}</p>
      <form
        className="mt-8 space-y-5"
        onSubmit={async (e) => {
          e.preventDefault();
          setBusy(true);
          setError(null);
          try {
            if (step === 'email') {
              await post('/api/auth/forgot-password', { email: email.trim() });
              setStep('reset');
            } else {
              if (pw !== pw2) throw new Error(t.auth.mismatch);
              await post('/api/auth/reset-password', { email: email.trim(), code, newPassword: pw });
              toast(t.auth.resetDone);
              nav('/login');
            }
          } catch (e2) {
            setError(err(e2));
          } finally {
            setBusy(false);
          }
        }}
      >
        {step === 'email' ? (
          <Field label={t.auth.email} type="email" value={email} onChange={(e) => setEmail(e.target.value)} dir="ltr" required autoFocus />
        ) : (
          <>
            <CodeInput value={code} onChange={setCode} />
            <div>
              <Secret label={t.auth.newPassword} value={pw} onChange={setPw} autoComplete="new-password" />
              <PasswordStrength value={pw} />
            </div>
            <Secret label={t.auth.confirmPassword} value={pw2} onChange={setPw2} autoComplete="new-password" error={pw2 && !pw.startsWith(pw2) ? t.auth.mismatch : null} />
          </>
        )}
        <ErrorNote>{error}</ErrorNote>
        <Button block size="lg" loading={busy} disabled={step === 'reset' && code.length !== 6}>
          {step === 'email' ? t.auth.sendCode : t.auth.setPassword}
        </Button>
      </form>
      <p className="mt-6 text-center">
        <Link to="/login" className="text-sm text-muted hover:text-ink">
          {t.common.back}
        </Link>
      </p>
    </AuthLayout>
  );
}
