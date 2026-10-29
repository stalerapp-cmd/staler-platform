import { AnimatePresence, motion, useReducedMotion } from 'framer-motion';
import { useEffect, useState, type ReactNode } from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import { Briefcase, Check, Eye, EyeOff, HandCoins, User as UserIcon, KeyRound } from 'lucide-react';
import { post, ApiError } from '../lib/api';
import { useAuth } from '../lib/auth';
import { useI18n } from '../lib/i18n';
import { Logo, StarMotif, StitchBand } from '../components/Tatreez';
import { Button, CodeInput, ErrorNote, Field, PasswordStrength, cx, Segmented } from '../components/ui';
import { TopControls } from '../layouts/AppShell';
import { useToast } from '../components/Toast';
import { useConfirm } from '../components/Confirm';
import { AuthBack, MailTips, ResendCode } from '../components/AuthExtras';
import { usePublicConfig } from '../lib/config';
import { fill } from '../lib/format';

export function AuthLayout({ children }: { children: ReactNode }) {
  const { t } = useI18n();
  const reduce = useReducedMotion();
  const lines = [t.landing.f1t, t.landing.f2t, t.landing.f3t, t.landing.f4t];
  const [n, setN] = useState(0);
  useEffect(() => {
    if (reduce) return;
    const h = setInterval(() => setN((x) => (x + 1) % lines.length), 3200);
    return () => clearInterval(h);
  }, [reduce, lines.length]);
  return (
    <div className="app-ground grid min-h-dvh lg:grid-cols-[1.05fr_1fr]">
      {/* Desktop: the embroidered side panel */}
      <div className="cloth cloth-night relative hidden overflow-hidden p-12 lg:flex lg:flex-col lg:justify-between">
        <Link to="/" className="relative flex items-center gap-3">
          <Logo className="h-11 w-11" animate />
          <span className="font-display text-2xl">S-Taler</span>
        </Link>
        <div className="absolute -end-28 top-1/2 h-[600px] w-[600px] -translate-y-1/2 opacity-90">
          <div className="spin-slow h-full w-full">
            <StarMotif size={25} cell={22} className="h-full w-full" colors={['#E2506A', '#E9C060']} strokeWidth={2.4} />
          </div>
        </div>
        <div className="floaty absolute start-16 top-40 h-20 w-20 opacity-60">
          <StarMotif size={9} cell={10} className="h-full w-full" colors={['#9DBB5F', '#E9C060']} strokeWidth={2.2} delay={0.6} />
        </div>
        <div className="relative max-w-sm">
          <p className="font-display text-[2.6rem] leading-[1.15]">{t.landing.title}</p>
          <div className="mt-6 h-8 overflow-hidden">
            <AnimatePresence mode="wait">
              <motion.p
                key={n}
                initial={{ y: 24, opacity: 0 }}
                animate={{ y: 0, opacity: 1 }}
                exit={{ y: -24, opacity: 0 }}
                transition={{ duration: 0.35 }}
                className="flex items-center gap-2 text-lg text-white/80"
              >
                <span className="h-2 w-2 rotate-45 bg-gold" /> {lines[n]}
              </motion.p>
            </AnimatePresence>
          </div>
        </div>
        <StitchBand width={80} className="relative h-10 w-full opacity-80" colors={['#E2506A', '#9DBB5F']} />
      </div>

      <div className="flex min-h-dvh flex-col">
        {/* Phones: a cloth header the form card rises over */}
        <div className="cloth cloth-night safe-top relative overflow-hidden px-4 pb-16 pt-2 lg:hidden">
          <div className="pointer-events-none absolute -end-12 -top-10 h-52 w-52 opacity-50">
            <div className="spin-slow h-full w-full">
              <StarMotif size={17} cell={10} className="h-full w-full" colors={['#E2506A', '#E9C060']} strokeWidth={2.2} />
            </div>
          </div>
          <div className="relative flex items-center justify-between">
            <AuthBack onDark />
            <TopControls onDark />
          </div>
          <div className="relative mt-3 flex items-center gap-3 px-2">
            <Logo className="h-12 w-12" animate />
            <div>
              <p className="font-display text-2xl leading-none">S-Taler</p>
              <p className="mt-1 text-sm text-white/70">{t.brand.tagline}</p>
            </div>
          </div>
        </div>
        <div className="safe-top hidden items-center justify-between px-6 py-4 lg:flex">
          <div className="flex items-center gap-3">
            <AuthBack />
            <Link to="/" className="flex items-center gap-2 rounded-full bg-surface py-1 pe-3.5 ps-1 shadow-sm ring-1 ring-line transition hover:ring-ink/30">
              <Logo className="h-7 w-7" />
              <span className="font-display text-base">S-Taler</span>
            </Link>
          </div>
          <div className="rounded-full bg-surface p-1 shadow-sm ring-1 ring-line">
            <TopControls />
          </div>
        </div>
        <div className="relative -mt-10 flex flex-1 items-start justify-center px-3 pb-10 sm:px-5 lg:mt-0 lg:items-center">
          <motion.div
            initial={{ opacity: 0, y: 28 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ type: 'spring', bounce: 0.25, duration: 0.7 }}
            className="sewn relative w-full max-w-md rounded-[30px] border border-line/70 bg-surface p-6 shadow-card sm:p-8"
          >
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
            <div className="flex justify-end">
              <Link
                to={email.trim() ? `/forgot?email=${encodeURIComponent(email.trim())}` : '/forgot'}
                className="group inline-flex items-center gap-2 rounded-full bg-sunk px-3 py-1.5 text-sm text-ink/80 ring-1 ring-line transition hover:bg-stitch/10 hover:text-stitch hover:ring-stitch/30"
              >
                <motion.span whileHover={{ rotate: [0, -20, 15, 0] }} className="grid h-6 w-6 place-items-center rounded-full bg-surface text-stitch shadow-sm">
                  <KeyRound className="h-3.5 w-3.5" />
                </motion.span>
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
  const confirm = useConfirm();
  const cfg = usePublicConfig();
  const [method, setMethod] = useState<'email' | 'sms'>('email');
  const prefill = (useLocation() as { state?: { email?: string } }).state?.email ?? '';
  const [f, setF] = useState({ fullName: '', email: prefill, password: '', phoneNumber: '', accountType: 'user' as 'user' | 'merchant' | 'exchange' });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [fieldErr, setFieldErr] = useState<Record<string, string>>({});
  const set = (k: keyof typeof f) => (e: React.ChangeEvent<HTMLInputElement>) => setF({ ...f, [k]: e.target.value });

  const [pw2, setPw2] = useState('');
  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (f.password !== pw2) return setFieldErr({ password2: t.auth.mismatch });
    if (method === 'sms' && !f.phoneNumber.trim()) return setError(t.auth.smsNeedsPhone);
          if (!(await confirm({ title: t.auth.reviewTitle, body: fill(t.auth.reviewBody, { email: method === 'sms' ? f.phoneNumber.trim() : f.email.trim() }), confirmLabel: t.auth.reviewOk }))) return;
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
        method,
      });
      nav('/verify', { state: { email: f.email.trim(), sms: method === 'sms' ? f.phoneNumber.trim() : undefined } });
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
    { v: 'user' as const, icon: UserIcon, title: t.auth.personal, d: t.auth.personalD, c: 'bg-night text-white' },
    { v: 'merchant' as const, icon: Briefcase, title: t.auth.business, d: t.auth.businessD, c: 'bg-stitch text-white' },
    { v: 'exchange' as const, icon: HandCoins, title: t.auth.exchange, d: t.auth.exchangeD, c: 'bg-gold text-night' },
  ];
  return (
    <AuthLayout>
      <h1 className="text-3xl">{t.auth.registerTitle}</h1>
      <p className="mt-2 text-muted">{t.auth.registerLead}</p>
      <form onSubmit={submit} className="mt-7 space-y-4">
        <fieldset>
          <legend className="mb-2 text-sm font-medium text-ink/80">{t.auth.accountType}</legend>
          <div className="grid grid-cols-3 gap-2.5">
            {types.map((o) => {
              const on = f.accountType === o.v;
              return (
                <motion.button
                  type="button"
                  key={o.v}
                  whileTap={{ scale: 0.95 }}
                  aria-pressed={on}
                  onClick={() => setF({ ...f, accountType: o.v })}
                  className={cx(
                    'relative flex flex-col items-center rounded-2xl border px-2 py-3.5 text-center transition',
                    on ? 'border-transparent bg-sunk ring-2 ring-stitch' : 'border-line hover:border-ink/30',
                  )}
                >
                  {on && (
                    <motion.span layoutId="acct-check" className="absolute -end-1.5 -top-1.5 grid h-6 w-6 place-items-center rounded-full bg-stitch text-white shadow">
                      <Check className="h-3.5 w-3.5" strokeWidth={3} />
                    </motion.span>
                  )}
                  <motion.span
                    animate={on ? { rotate: [0, -10, 8, 0], scale: [1, 1.15, 1] } : { rotate: 0, scale: 1 }}
                    transition={{ duration: 0.5 }}
                    className={cx('mb-2 grid h-11 w-11 place-items-center rounded-2xl', on ? o.c : 'bg-sunk text-muted')}
                  >
                    <o.icon className="h-5 w-5" />
                  </motion.span>
                  <span className="block text-sm font-semibold leading-tight">{o.title}</span>
                  <span className="mt-1 block text-[11px] leading-snug text-muted">{o.d}</span>
                </motion.button>
              );
            })}
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
        {cfg?.sms && (
          <div>
            <p className="mb-2 text-sm font-medium text-ink/80">{t.auth.sendVia}</p>
            <Segmented value={method} onChange={setMethod} options={[{ value: 'email', label: t.auth.viaEmail }, { value: 'sms', label: t.auth.viaSms }]} />
          </div>
        )}
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
  const loc = useLocation() as { state?: { email?: string; sms?: string } };
  const [email, setEmail] = useState(loc.state?.email ?? '');
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [wrong, setWrong] = useState(false);

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
      setWrong(true);
      setCode('');
    } finally {
      setBusy(false);
    }
  };
  return (
    <AuthLayout>
      <h1 className="text-3xl">{t.auth.verifyTitle}</h1>
      <p className="mt-2 text-muted">
        {loc.state?.sms ? t.auth.verifyLeadSms : t.auth.verifyLead} <span className="num font-medium text-ink" dir="ltr">{loc.state?.sms ?? email}</span>
      </p>
      <form onSubmit={submit} className="mt-8 space-y-5">
        {!loc.state?.email && <Field label={t.auth.email} type="email" value={email} onChange={(e) => setEmail(e.target.value)} dir="ltr" required />}
        <CodeInput value={code} onChange={setCode} />
        <ErrorNote>{error}</ErrorNote>
        {wrong && email.trim() && (
          <Link
            to={`/forgot?email=${encodeURIComponent(email.trim())}&step=code`}
            className="flex items-center gap-3 rounded-2xl border border-dashed border-line bg-sunk/60 p-3.5 text-sm transition hover:border-ink/30"
          >
            <KeyRound className="h-5 w-5 shrink-0 text-muted" />
            <span>{t.auth.haveAccountHint}</span>
          </Link>
        )}
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
  // Links in the e-mails open this page with the address filled in, straight on the code step.
  const qs = new URLSearchParams(useLocation().search);
  const [step, setStep] = useState<'email' | 'reset'>(qs.get('step') === 'code' && qs.get('email') ? 'reset' : 'email');
  const [email, setEmail] = useState(qs.get('email') ?? '');
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
        const fr = await post('/api/auth/forgot-password', { email: email.trim() });
        if (fr?.pending) return nav('/verify', { state: { email: email.trim() } });
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
