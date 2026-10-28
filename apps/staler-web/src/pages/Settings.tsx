import { useRef, useState, type ReactNode } from 'react';
import { useNavigate } from 'react-router-dom';
import { Camera, Laptop, LogOut, ShieldAlert, ShieldCheck, Smartphone, Trash2 } from 'lucide-react';
import { applySession, del, patch, post, upload } from '../lib/api';
import { useAuth } from '../lib/auth';
import { RoleBadge } from '../components/RoleBadge';
import { BioToggle } from '../components/AppLock';
import { useI18n } from '../lib/i18n';
import { useTheme } from '../lib/theme';
import { useData } from '../lib/hooks';
import { relative } from '../lib/format';
import { useToast } from '../components/Toast';
import { Avatar, Badge, Button, CodeInput, CopyButton, ErrorNote, Field, PageHeader, PasswordStrength, Segmented, Sheet } from '../components/ui';
import { useConfirm } from '../components/Confirm';

function Section({ title, children, aside }: { title: string; children: ReactNode; aside?: ReactNode }) {
  return (
    <section className="card p-5 sm:p-6">
      <div className="mb-4 flex items-center justify-between gap-3">
        <h2 className="text-lg">{title}</h2>
        {aside}
      </div>
      {children}
    </section>
  );
}

export default function Settings() {
  const { t, lang, setLang, err } = useI18n();
  const { theme, setTheme } = useTheme();
  const { user, reload, logout } = useAuth();
  const toast = useToast();
  const nav = useNavigate();
  const fileRef = useRef<HTMLInputElement>(null);
  const confirm = useConfirm();
  const sessions = useData<{ sessions: any[] }>('/api/auth/me/sessions');

  const [name, setName] = useState(user?.full_name ?? '');
  const [phone, setPhone] = useState(user?.phone_number ?? '');
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<Record<string, string | null>>({});

  const [emailStep, setEmailStep] = useState<'idle' | 'form' | 'code'>('idle');
  const [newEmail, setNewEmail] = useState('');
  const [emailPw, setEmailPw] = useState('');
  const [emailCode, setEmailCode] = useState('');

  const [cur, setCur] = useState('');
  const [next, setNext] = useState('');
  const [next2, setNext2] = useState('');

  const [totp, setTotp] = useState<{ qr: string; secret: string } | null>(null);
  const [totpCode, setTotpCode] = useState('');
  const [recovery, setRecovery] = useState<string[] | null>(null);
  const [disable, setDisable] = useState(false);
  const [disablePw, setDisablePw] = useState('');
  const [disableCode, setDisableCode] = useState('');

  const [delStep, setDelStep] = useState<'idle' | 'code'>('idle');
  const [delCode, setDelCode] = useState('');
  const [delPw, setDelPw] = useState('');

  const act = async (k: string, fn: () => Promise<void>) => {
    setBusy(k);
    setError((e) => ({ ...e, [k]: null }));
    try {
      await fn();
    } catch (e) {
      setError((s) => ({ ...s, [k]: err(e) }));
    } finally {
      setBusy(null);
    }
  };

  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <PageHeader title={t.settings.title} />

      <Section title={t.settings.profile}>
        <div className="flex flex-wrap items-center gap-5">
          <div className="relative">
            <Avatar name={user?.full_name} src={user?.profile_image} size={84} />
            <button onClick={() => fileRef.current?.click()} className="absolute -bottom-1 -end-1 grid h-9 w-9 place-items-center rounded-full bg-stitch text-white shadow-lift" aria-label={t.settings.changePhoto}>
              <Camera className="h-4 w-4" />
            </button>
            <input
              ref={fileRef}
              type="file"
              accept="image/jpeg,image/png,image/webp"
              hidden
              onChange={(e) =>
                e.target.files?.[0] &&
                act('avatar', async () => {
                  const fd = new FormData();
                  fd.append('image', e.target.files![0]!);
                  await upload('/api/auth/me/avatar', fd);
                  await reload();
                })
              }
            />
          </div>
          <div className="min-w-0">
            <p className="font-display text-xl">{user?.full_name}</p>
            <p className="text-sm text-muted">{user?.email}</p>
            <RoleBadge className="mt-2" />
            {user?.profile_image && (
              <button className="mt-1 text-sm text-stitch" onClick={async () => {
                  if (!(await confirm({ title: t.ask.photoTitle, body: t.ask.photoBody, confirmLabel: t.ask.photoOk, tone: 'danger' }))) return;
                  await act('avatar', async () => (await del('/api/auth/me/avatar'), await reload()));
                }}>
                {t.settings.removePhoto}
              </button>
            )}
          </div>
        </div>
        <ErrorNote>{error.avatar}</ErrorNote>
        <form
          className="mt-6 grid gap-4 sm:grid-cols-2"
          onSubmit={(e) => {
            e.preventDefault();
            void act('profile', async () => {
              await patch('/api/auth/me', { fullName: name.trim(), phoneNumber: phone.trim() || null, language: lang });
              await reload();
              toast(t.common.saved);
            });
          }}
        >
          <Field label={t.settings.fullName} value={name} onChange={(e) => setName(e.target.value)} required />
          <Field label={t.settings.phone} value={phone} onChange={(e) => setPhone(e.target.value)} dir="ltr" type="tel" />
          <div>
            <p className="mb-1.5 text-sm font-medium text-ink/80">{t.settings.language}</p>
            <Segmented value={lang} onChange={setLang} options={[{ value: 'ar', label: 'العربية' }, { value: 'en', label: 'English' }]} />
          </div>
          <div>
            <p className="mb-1.5 text-sm font-medium text-ink/80">{t.settings.appearance}</p>
            <Segmented value={theme} onChange={setTheme} options={[{ value: 'light', label: t.settings.light }, { value: 'dark', label: t.settings.dark }]} />
          </div>
          <div className="sm:col-span-2">
            <ErrorNote>{error.profile}</ErrorNote>
            <Button loading={busy === 'profile'}>{t.common.save}</Button>
          </div>
        </form>
      </Section>

      <Section title={t.settings.email} aside={emailStep === 'idle' && <Button size="sm" variant="secondary" onClick={() => setEmailStep('form')}>{t.settings.changeEmail}</Button>}>
        <p className="num">{user?.email}</p>
        {emailStep === 'form' && (
          <form
            className="mt-4 grid gap-4 sm:grid-cols-2"
            onSubmit={(e) => {
              e.preventDefault();
              void act('email', async () => {
                await post('/api/auth/me/email', { newEmail: newEmail.trim(), password: emailPw });
                setEmailPw('');
                setEmailStep('code');
              });
            }}
          >
            <Field label={t.settings.newEmail} type="email" value={newEmail} onChange={(e) => setNewEmail(e.target.value)} dir="ltr" required />
            <Field label={t.settings.currentPassword} type="password" value={emailPw} onChange={(e) => setEmailPw(e.target.value)} dir="ltr" required autoComplete="current-password" />
            <div className="sm:col-span-2">
              <ErrorNote>{error.email}</ErrorNote>
              <Button loading={busy === 'email'}>{t.common.continue}</Button>
            </div>
          </form>
        )}
        {emailStep === 'code' && (
          <div className="mt-4 space-y-4">
            <p className="text-sm text-muted">{t.settings.emailCode}</p>
            <CodeInput value={emailCode} onChange={setEmailCode} />
            <ErrorNote>{error.email}</ErrorNote>
            <Button
              loading={busy === 'email'}
              disabled={emailCode.length !== 6}
              onClick={() =>
                act('email', async () => {
                  await post('/api/auth/me/email/confirm', { code: emailCode });
                  await reload();
                  setEmailStep('idle');
                  setEmailCode('');
                  toast(t.common.saved);
                })
              }
            >
              {t.common.confirm}
            </Button>
          </div>
        )}
      </Section>

      <Section title={t.settings.password}>
        <form
          className="grid gap-4 sm:grid-cols-2"
          onSubmit={(e) => {
            e.preventDefault();
            if (next !== next2) return setError((x) => ({ ...x, password: t.auth.mismatch }));
            void act('password', async () => {
              const s = await post('/api/auth/me/password', { currentPassword: cur, newPassword: next });
              await applySession(s);
              setCur('');
              setNext('');
              setNext2('');
              toast(t.settings.pwChanged);
              void sessions.reload();
            });
          }}
        >
          <Field label={t.settings.currentPassword} type="password" value={cur} onChange={(e) => setCur(e.target.value)} dir="ltr" required autoComplete="current-password" />
          <div>
            <Field label={t.auth.newPassword} type="password" value={next} onChange={(e) => setNext(e.target.value)} dir="ltr" required autoComplete="new-password" />
            <PasswordStrength value={next} />
          </div>
          <Field
            label={t.auth.confirmPassword}
            type="password"
            value={next2}
            onChange={(e) => setNext2(e.target.value)}
            dir="ltr"
            required
            autoComplete="new-password"
            error={next2 && !next.startsWith(next2) ? t.auth.mismatch : undefined}
          />
          <div className="sm:col-span-2">
            <ErrorNote>{error.password}</ErrorNote>
            <Button loading={busy === 'password'}>{t.settings.changePassword}</Button>
          </div>
        </form>
      </Section>

      <BioToggle />

      <Section
        title={t.settings.twofa}
        aside={user?.totp_enabled ? <Badge tone="good"><ShieldCheck className="h-3.5 w-3.5" />{t.settings.twofaOn}</Badge> : <Badge tone="warn"><ShieldAlert className="h-3.5 w-3.5" />{t.settings.twofaOff}</Badge>}
      >
        <p className="text-muted">{t.settings.twofaLead}</p>
        {!user?.totp_enabled && !totp && (
          <Button className="mt-4" loading={busy === 'totp'} onClick={() => act('totp', async () => setTotp(await post('/api/auth/me/totp/setup')))}>
            {t.settings.enable}
          </Button>
        )}
        {totp && !user?.totp_enabled && (
          <div className="mt-5 grid items-start gap-6 sm:grid-cols-[auto_1fr]">
            <img src={totp.qr} alt="Authenticator QR code" width={180} height={180} className="rounded-2xl bg-white p-2" />
            <div className="space-y-4">
              <p className="text-sm text-muted">{t.settings.scanApp}</p>
              <div className="flex items-center gap-2 text-sm">
                <span className="text-muted">{t.settings.secretKey}</span>
                <code className="num break-all rounded-lg bg-sunk px-2 py-1">{totp.secret}</code>
                <CopyButton text={totp.secret} />
              </div>
              <CodeInput value={totpCode} onChange={setTotpCode} autoFocus={false} />
              <ErrorNote>{error.totp}</ErrorNote>
              <Button
                loading={busy === 'totp'}
                disabled={totpCode.length !== 6}
                onClick={() =>
                  act('totp', async () => {
                    const r = await post('/api/auth/me/totp/enable', { code: totpCode });
                    setRecovery(r.recoveryCodes);
                    setTotp(null);
                    setTotpCode('');
                    await reload();
                  })
                }
              >
                {t.settings.enable}
              </Button>
            </div>
          </div>
        )}
        {user?.totp_enabled && (
          <Button className="mt-4" variant="danger" onClick={() => setDisable(true)}>
            {t.settings.disable}
          </Button>
        )}
      </Section>

      <Section
        title={t.settings.sessions}
        aside={
          <Button
            size="sm"
            variant="secondary"
            icon={<LogOut className="h-4 w-4 flip-rtl" />}
            onClick={async () => {
              if (!(await confirm({ title: t.ask.allOutTitle, body: t.ask.allOutBody, confirmLabel: t.ask.allOutOk, tone: 'danger' }))) return;
              await post('/api/auth/logout-all');
              await logout();
              nav('/login');
            }}
          >
            {t.settings.signOutAll}
          </Button>
        }
      >
        <ul className="divide-y divide-line">
          {sessions.data?.sessions.map((s) => (
            <li key={s.id} className="flex items-center gap-3 py-3">
              {/mobile|android|iphone/i.test(s.user_agent ?? '') ? <Smartphone className="h-5 w-5 text-muted" /> : <Laptop className="h-5 w-5 text-muted" />}
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm">{(s.user_agent ?? '—').slice(0, 70)}</p>
                <p className="text-xs text-muted">
                  <span className="num">{s.ip_address}</span> · {t.settings.lastUsed} {relative(s.last_used_at ?? s.created_at, lang)}
                </p>
              </div>
              {s.current ? (
                <Badge tone="info">{t.settings.thisDevice}</Badge>
              ) : (
                <Button size="sm" variant="ghost" onClick={async () => {
                    if (!(await confirm({ title: t.ask.deviceTitle, body: t.ask.deviceBody, confirmLabel: t.ask.deviceOk, tone: 'danger' }))) return;
                    await del(`/api/auth/me/sessions/${s.id}`);
                    void sessions.reload();
                  }}>
                  {t.settings.revoke}
                </Button>
              )}
            </li>
          ))}
        </ul>
      </Section>

      <section className="rounded-2xl border border-stitch/30 p-5 sm:p-6">
        <h2 className="text-lg text-stitch">{t.settings.danger}</h2>
        <p className="mt-1 text-sm text-muted">{t.settings.dangerLead}</p>
        {delStep === 'idle' ? (
          <Button className="mt-4" variant="danger" icon={<Trash2 className="h-4 w-4" />} loading={busy === 'delete'} onClick={() => act('delete', async () => (await post('/api/auth/me/delete/request'), setDelStep('code')))}>
            {t.settings.deleteSend}
          </Button>
        ) : (
          <div className="mt-4 space-y-4">
            <CodeInput value={delCode} onChange={setDelCode} />
            <Field label={t.settings.currentPassword} type="password" value={delPw} onChange={(e) => setDelPw(e.target.value)} dir="ltr" autoComplete="current-password" />
            <Button
              variant="stitch"
              loading={busy === 'delete'}
              disabled={delCode.length !== 6 || !delPw}
              onClick={() =>
                act('delete', async () => {
                  await post('/api/auth/me/delete/confirm', { code: delCode, password: delPw });
                  await logout();
                  nav('/');
                })
              }
            >
              {t.settings.deleteConfirm}
            </Button>
          </div>
        )}
        <ErrorNote>{error.delete}</ErrorNote>
      </section>

      <Sheet open={!!recovery} onClose={() => setRecovery(null)} title={t.settings.recovery}>
        <p className="text-sm text-muted">{t.settings.recoveryLead}</p>
        <ul className="num mt-4 grid grid-cols-2 gap-2">
          {recovery?.map((c) => (
            <li key={c} className="rounded-lg bg-sunk px-3 py-2 text-center tracking-wider">
              {c}
            </li>
          ))}
        </ul>
        <div className="mt-4 flex justify-between">
          <CopyButton text={recovery?.join('\n') ?? ''} label={t.common.copy} />
          <Button onClick={() => setRecovery(null)}>{t.common.done}</Button>
        </div>
      </Sheet>

      <Sheet open={disable} onClose={() => setDisable(false)} title={t.settings.disable}>
        <form
          className="space-y-4"
          onSubmit={(e) => {
            e.preventDefault();
            void act('disable', async () => {
              await post('/api/auth/me/totp/disable', { password: disablePw, code: disableCode.trim() });
              setDisable(false);
              setDisablePw('');
              setDisableCode('');
              await reload();
            });
          }}
        >
          <Field label={t.settings.currentPassword} type="password" value={disablePw} onChange={(e) => setDisablePw(e.target.value)} dir="ltr" required />
          <Field label={t.auth.mfaCode} value={disableCode} onChange={(e) => setDisableCode(e.target.value)} dir="ltr" required autoComplete="one-time-code" />
          <ErrorNote>{error.disable}</ErrorNote>
          <Button block variant="danger" loading={busy === 'disable'}>
            {t.settings.disable}
          </Button>
        </form>
      </Sheet>
    </div>
  );
}
