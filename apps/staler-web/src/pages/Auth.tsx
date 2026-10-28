import { motion } from 'framer-motion';
import { useState, type ReactNode } from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import { Briefcase, Eye, EyeOff, User as UserIcon } from 'lucide-react';
import { post, ApiError } from '../lib/api';
import { useAuth } from '../lib/auth';
import { useI18n } from '../lib/i18n';
import { Logo, StarMotif, StitchBand } from '../components/Tatreez';
import { Button, CodeInput, ErrorNote, Field, PasswordStrength, cx } from '../components/ui';
import { TopControls } from '../layouts/AppShell';
import { useToast } from '../components/Toast';

export function AuthLayout({ children }: { children: ReactNode }) {
  const { t } = useI18n();
  return (
    <div className="grid min-h-dvh lg:grid-cols-[1.05fr_1fr]">
      <div className="relative hidden overflow-hidden bg-night p-12 text-white lg:flex lg:flex-col lg:justify-between">
        <Link to="/" className="flex items-center gap-3">
          <Logo className="h-10 w-10" />
          <span className="font-display text-2xl">S-Taler</span>
        </Link>
        <div className="absolute -end-24 top-1/2 h-[560px] w-[560px] -translate-y-1/2 opacity-90">
          <StarMotif size={25} cell={22} className="h-full w-full" colors={['#E2506A', '#E9C060']} strokeWidth={2.4} />
        </div>
        <div className="relative max-w-sm">
          <p className="font-display text-4xl leading-tight">{t.landing.title}</p>
          <p className="mt-4 text-white/70">{t.brand.tagline}</p>
        </div>
        <StitchBand width={80} className="relative h-10 w-full opacity-80" colors={['#E2506A', '#9DBB5F']} />
      </div>
      <div className="flex flex-col">
        <div className="safe-top flex items-center justify-between px-5 py-4">
          <Link to="/" className="flex items-center gap-2 lg:invisible">
            <Logo className="h-8 w-8" />
            <span className="font-display text-lg">S-Taler</span>
          </Link>
          <TopControls />
        </div>
        <div className="flex flex-1 items-center justify-center px-5 pb-12">
          <motion.div initial={{ opacity: 0, y: 14 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.45 }} className="w-full max-w-md">
            {children}
          </motion.div>
        </div>
      </div>
    </div>
  );
}

function PasswordField({ label, value, onChange, autoComplete, error }: { label: string; value: string; onChange: (v: string) => void; autoComplete: string; error?: string | null }) {
  const [show, setShow] = useState(false);
  return (
    <Field
      label={label}
      type={show ? 'text' : 'password'}
      value={value}
      onChange={(e) => onChange(e.target.value)}
      autoComplete={autoComplete}
      required
      error={error}
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
  const { t, err } = useI18n();
  const { login, completeMfa, signedOutForIdle } = useAuth();
  const nav = useNavigate();
  const loc = useLocation() as { state?: { from?: string } };
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [mfa, setMfa] = useState<string | null>(null);
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const go = () => nav(loc.state?.from ?? '/app', { replace: true });

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      if (mfa) {
        await completeMfa(mfa, code.trim());
        go();
      } else {
        const r = await login(email.trim(), password);
        if (r.mfaToken) setMfa(r.mfaToken);
        else go();
      }
    } catch (e2) {
      if (e2 instanceof ApiError && e2.code === 'PENDING_VERIFICATION') {
        nav('/verify', { state: { email: email.trim() } });
        return;
      }
      if (e2 instanceof ApiError && e2.code === 'MFA_EXPIRED') setMfa(null);
      setError(err(e2));
    } finally {
      setBusy(false);
    }
  };

  return (
    <AuthLayout>
      <h1 className="text-3xl">{mfa ? t.auth.mfaTitle : t.auth.welcome}</h1>
      <p className="mt-2 text-muted">{mfa ? t.auth.mfaLead : t.auth.loginLead}</p>
      {signedOutForIdle && !mfa && <p className="mt-4 rounded-xl bg-gold/15 px-4 py-3 text-sm">{t.auth.idle}</p>}
      <form onSubmit={submit} className="mt-8 space-y-4">
        {mfa ? (
          <Field label={t.auth.mfaCode} value={code} onChange={(e) => setCode(e.target.value)} autoComplete="one-time-code" autoFocus dir="ltr" placeholder="123456" />
        ) : (
          <>
            <Field label={t.auth.email} type="email" value={email} onChange={(e) => setEmail(e.target.value)} autoComplete="email" required dir="ltr" autoFocus />
            <PasswordField label={t.auth.password} value={password} onChange={setPassword} autoComplete="current-password" />
            <div className="text-end">
              <Link to="/forgot" className="text-sm text-sky hover:underline">
                {t.auth.forgot}
              </Link>
            </div>
          </>
        )}
        <ErrorNote>{error}</ErrorNote>
        <Button block size="lg" loading={busy}>
          {mfa ? t.common.confirm : t.auth.login}
        </Button>
      </form>
      {!mfa && (
        <p className="mt-8 text-center text-muted">
          {t.auth.noAccount}{' '}
          <Link to="/register" className="font-medium text-ink underline decoration-stitch decoration-2 underline-offset-4">
            {t.auth.createOne}
          </Link>
        </p>
      )}
    </AuthLayout>
  );
}

export function Register() {
  const { t, err, lang } = useI18n();
  const nav = useNavigate();
  const [f, setF] = useState({ fullName: '', email: '', password: '', phoneNumber: '', accountType: 'user' as 'user' | 'merchant' });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [fieldErr, setFieldErr] = useState<Record<string, string>>({});
  const set = (k: keyof typeof f) => (e: React.ChangeEvent<HTMLInputElement>) => setF({ ...f, [k]: e.target.value });

  const [pw2, setPw2] = useState('');
  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (f.password !== pw2) return setFieldErr({ password2: t.auth.mismatch });
    setBusy(true);
    setError(null);
    setFieldErr({});
    try {
      await post('/api/auth/register', {
        fullName: f.fullName.trim(),
        email: f.email.trim(),
        password: f.password,
        accountType: f.accountType,
        language: lang,
        ...(f.phoneNumber.trim() ? { phoneNumber: f.phoneNumber.trim() } : {}),
      });
      nav('/verify', { state: { email: f.email.trim() } });
    } catch (e2) {
      if (e2 instanceof ApiError && Array.isArray(e2.details)) {
        setFieldErr(Object.fromEntries((e2.details as any[]).map((d) => [d.path, d.message])));
      }
      setError(err(e2));
    } finally {
      setBusy(false);
    }
  };

  const types = [
    { v: 'user' as const, icon: UserIcon, title: t.auth.personal, d: t.auth.personalD },
    { v: 'merchant' as const, icon: Briefcase, title: t.auth.business, d: t.auth.businessD },
  ];
  return (
    <AuthLayout>
      <h1 className="text-3xl">{t.auth.registerTitle}</h1>
      <p className="mt-2 text-muted">{t.auth.registerLead}</p>
      <form onSubmit={submit} className="mt-8 space-y-4">
        <fieldset>
          <legend className="mb-2 text-sm font-medium text-ink/80">{t.auth.accountType}</legend>
          <div className="grid grid-cols-2 gap-3">
            {types.map((o) => (
              <button
                type="button"
                key={o.v}
                aria-pressed={f.accountType === o.v}
                onClick={() => setF({ ...f, accountType: o.v })}
                className={cx('rounded-2xl border p-4 text-start transition', f.accountType === o.v ? 'border-stitch bg-stitch/5 ring-2 ring-stitch/20' : 'border-line hover:border-ink/30')}
              >
                <o.icon className={cx('mb-2 h-5 w-5', f.accountType === o.v ? 'text-stitch' : 'text-muted')} />
                <span className="block font-medium">{o.title}</span>
                <span className="block text-xs text-muted">{o.d}</span>
              </button>
            ))}
          </div>
        </fieldset>
        <Field label={t.auth.fullName} value={f.fullName} onChange={set('fullName')} autoComplete="name" required error={fieldErr.fullName} />
        <Field label={t.auth.email} type="email" value={f.email} onChange={set('email')} autoComplete="email" required dir="ltr" error={fieldErr.email} />
        <Field label={`${t.auth.phone} (${t.common.optional})`} type="tel" value={f.phoneNumber} onChange={set('phoneNumber')} autoComplete="tel" dir="ltr" error={fieldErr.phoneNumber} />
        <div>
          <PasswordField label={t.auth.password} value={f.password} onChange={(v) => setF({ ...f, password: v })} autoComplete="new-password" error={fieldErr.password} />
          <PasswordStrength value={f.password} />
        </div>
        <PasswordField
          label={t.auth.confirmPassword}
          value={pw2}
          onChange={setPw2}
          autoComplete="new-password"
          error={fieldErr.password2 ?? (pw2 && !f.password.startsWith(pw2) ? t.auth.mismatch : null)}
        />
        <ErrorNote>{error}</ErrorNote>
        <Button block size="lg" loading={busy}>
          {t.auth.register}
        </Button>
        <p className="text-center text-xs text-muted">{t.auth.terms}</p>
      </form>
      <p className="mt-6 text-center text-muted">
        {t.auth.haveAccount}{' '}
        <Link to="/login" className="font-medium text-ink underline decoration-stitch decoration-2 underline-offset-4">
          {t.auth.login}
        </Link>
      </p>
    </AuthLayout>
  );
}

export function Verify() {
  const { t, err } = useI18n();
  const nav = useNavigate();
  const toast = useToast();
  const { finishVerification } = useAuth();
  const loc = useLocation() as { state?: { email?: string } };
  const [email, setEmail] = useState(loc.state?.email ?? '');
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async (e?: React.FormEvent) => {
    e?.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const data = await post('/api/auth/verify-email', { email: email.trim(), code });
      await finishVerification(data);
      nav('/app', { replace: true });
    } catch (e2) {
      setError(err(e2));
      setCode('');
    } finally {
      setBusy(false);
    }
  };
  return (
    <AuthLayout>
      <h1 className="text-3xl">{t.auth.verifyTitle}</h1>
      <p className="mt-2 text-muted">
        {t.auth.verifyLead} <span className="num font-medium text-ink">{email}</span>
      </p>
      <form onSubmit={submit} className="mt-8 space-y-5">
        {!loc.state?.email && <Field label={t.auth.email} type="email" value={email} onChange={(e) => setEmail(e.target.value)} dir="ltr" required />}
        <CodeInput value={code} onChange={setCode} />
        <ErrorNote>{error}</ErrorNote>
        <Button block size="lg" loading={busy} disabled={code.length !== 6}>
          {t.auth.verify}
        </Button>
        <Button
          type="button"
          variant="ghost"
          block
          onClick={async () => {
            try {
              await post('/api/auth/resend-code', { email: email.trim() });
              toast(t.auth.resent);
            } catch (e2) {
              setError(err(e2));
            }
          }}
        >
          {t.auth.resend}
        </Button>
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
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pw2, setPw2] = useState('');
  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (step === 'reset' && pw !== pw2) return setError(t.auth.mismatch);
    setBusy(true);
    setError(null);
    try {
      if (step === 'email') {
        await post('/api/auth/forgot-password', { email: email.trim() });
        setStep('reset');
      } else {
        await post('/api/auth/reset-password', { email: email.trim(), code, newPassword: pw });
        toast(t.auth.resetDone);
        nav('/login');
      }
    } catch (e2) {
      setError(err(e2));
    } finally {
      setBusy(false);
    }
  };
  return (
    <AuthLayout>
      <h1 className="text-3xl">{t.auth.resetTitle}</h1>
      <p className="mt-2 text-muted">{step === 'email' ? t.auth.resetLead : `${t.auth.verifyLead} ${email}`}</p>
      <form onSubmit={submit} className="mt-8 space-y-5">
        {step === 'email' ? (
          <Field label={t.auth.email} type="email" value={email} onChange={(e) => setEmail(e.target.value)} dir="ltr" required autoFocus />
        ) : (
          <>
            <CodeInput value={code} onChange={setCode} />
            <div>
              <PasswordField label={t.auth.newPassword} value={pw} onChange={setPw} autoComplete="new-password" />
              <PasswordStrength value={pw} />
            </div>
            <PasswordField label={t.auth.confirmPassword} value={pw2} onChange={setPw2} autoComplete="new-password" error={pw2 && !pw.startsWith(pw2) ? t.auth.mismatch : null} />
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
