import { motion } from 'framer-motion';
import { useRef, useState, type ReactNode } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { AgentProfileEditor } from '../components/AgentProfileEditor';
import { StoreLogo } from './Stores';
import { AtSign, BellRing, Camera, HandCoins, Check, KeyRound, Languages, LockKeyhole, LogOut, MonitorSmartphone, Palette, ShieldAlert, ShieldCheck, SlidersHorizontal, Trash2, UserRound, type LucideIcon } from 'lucide-react';
import { applySession, assetUrl, del, patch, post, put, upload } from '../lib/api';
import { useAuth } from '../lib/auth';
import { RoleBadge } from '../components/RoleBadge';
import { BioToggle } from '../components/AppLock';
import { useI18n } from '../lib/i18n';
import { useTheme } from '../lib/theme';
import { useData } from '../lib/hooks';
import { useToast } from '../components/Toast';
import { Avatar, Badge, Button, CodeInput, CopyButton, ErrorNote, Field, PasswordStrength, Sheet, Toggle, cx } from '../components/ui';
import { StarMotif } from '../components/Tatreez';
import { ImageCropper } from '../components/ImageCropper';
import { fill } from '../lib/format';
import { useConfirm } from '../components/Confirm';
import { DeviceList } from '../components/Devices';
import { TownField } from '../components/TownField';

function Section({ title, children, aside, icon: Icon, tone = 'bg-night text-white' }: { title: string; children: ReactNode; aside?: ReactNode; icon?: LucideIcon; tone?: string }) {
  return (
    <motion.section initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} className="card p-5 sm:p-6">
      <div className="mb-4 flex items-center justify-between gap-3">
        <h2 className="flex items-center gap-3 text-lg">
          {Icon && (
            <span className={`grid h-9 w-9 place-items-center rounded-xl ${tone}`}>
              <Icon className="h-[18px] w-[18px]" />
            </span>
          )}
          {title}
        </h2>
        {aside}
      </div>
      {children}
    </motion.section>
  );
}

type Tab = 'profile' | 'agent' | 'security' | 'devices' | 'account';
const TAB_ICONS: Record<Tab, LucideIcon> = { profile: UserRound, agent: HandCoins, security: ShieldCheck, devices: MonitorSmartphone, account: KeyRound };

export default function Settings() {
  const { t, lang, setLang, err } = useI18n();
  const { theme, setTheme } = useTheme();
  const { user, reload, logout } = useAuth();
  const toast = useToast();
  const nav = useNavigate();
  const fileRef = useRef<HTMLInputElement>(null);
  const confirm = useConfirm();
  const sessions = useData<{ sessions: any[] }>('/api/auth/me/sessions');
  const isAgent = user?.role === 'exchange';
  const tabs: Tab[] = isAgent ? ['profile', 'agent', 'security', 'devices', 'account'] : ['profile', 'security', 'devices', 'account'];
  const [params, setParams] = useSearchParams();
  const asked = params.get('tab') as Tab | null;
  const [tab, setTabState] = useState<Tab>(asked && tabs.includes(asked) ? asked : 'profile');
  const setTab = (k: Tab) => {
    setTabState(k);
    setParams(k === 'profile' ? {} : { tab: k }, { replace: true });
  };
  const [cropFile, setCropFile] = useState<File | null>(null);
  // Editing the current photo: reopen the original it was cut from (or the photo itself) — no new upload.
  const [editing, setEditing] = useState(false);
  const editPhoto = async () => {
    const src = assetUrl((user as any)?.profile_image_original ?? user?.profile_image);
    if (!src) return;
    try {
      const b = await (await fetch(src)).blob();
      setEditing(true);
      setCropFile(new File([b], 'photo', { type: b.type || 'image/png' }));
    } catch {
      toast(lang === 'ar' ? 'ما قدرنا نفتح الصورة' : 'Couldn’t open the photo', 'error');
    }
  };
  /** The full picture, made smaller if huge, kept so the photo can be edited later. */
  const shrink = (f: File) =>
    new Promise<Blob>((resolve) => {
      const i = new Image();
      const u = URL.createObjectURL(f);
      i.onload = () => {
        const k = Math.min(1, 1600 / Math.max(i.naturalWidth, i.naturalHeight));
        const c = document.createElement('canvas');
        c.width = Math.round(i.naturalWidth * k);
        c.height = Math.round(i.naturalHeight * k);
        c.getContext('2d')!.drawImage(i, 0, 0, c.width, c.height);
        URL.revokeObjectURL(u);
        c.toBlob((b) => resolve(b ?? f), 'image/jpeg', 0.88);
      };
      i.onerror = () => resolve(f);
      i.src = u;
    });

  const [name, setName] = useState(user?.full_name ?? '');
  const [phone, setPhone] = useState(user?.phone_number ?? '');
  const [homeCity, setHomeCity] = useState<string>(user?.home_city ?? '');
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<Record<string, string | null>>({});

  const [emailStep, setEmailStep] = useState<'idle' | 'form' | 'code'>('idle');
  const [newEmail, setNewEmail] = useState('');
  const [emailPw, setEmailPw] = useState('');
  const [emailCode, setEmailCode] = useState('');
  const [emailOld, setEmailOld] = useState('');
  const [pwStep, setPwStep] = useState<'form' | 'code'>('form');
  const [pwCode, setPwCode] = useState('');

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
    <div className="mx-auto max-w-5xl">
      {/* Profile cloth: photo, name, account type and how protected the account is */}
      <motion.div
        initial={{ opacity: 0, y: 12 }}
        animate={{ opacity: 1, y: 0 }}
        className="cloth cloth-plum mb-6 overflow-hidden rounded-[30px] p-5 shadow-card sm:p-7"
      >
        <div className="pointer-events-none absolute -end-12 top-1/2 h-56 w-56 -translate-y-1/2 opacity-25">
          <div className="spin-slow h-full w-full">
            <StarMotif size={17} cell={10} className="h-full w-full" colors={['#FFFFFF', '#FFE3A1']} strokeWidth={2.2} />
          </div>
        </div>
        <div className="relative flex flex-col items-center gap-5 text-center sm:flex-row sm:flex-wrap sm:text-start">
          {/* Photo: the avatar with its own two clear actions right under it */}
          <div className="flex flex-col items-center gap-2.5">
            <button
              onClick={() => fileRef.current?.click()}
              className="group relative rounded-full ring-4 ring-white/30 transition hover:ring-white/60"
              aria-label={user?.profile_image ? t.settings.changePhoto2 : t.settings.addPhoto}
            >
              <Avatar name={user?.full_name} src={user?.profile_image} size={92} />
              <span className="absolute inset-0 grid place-items-center rounded-full bg-night/45 text-white opacity-0 transition group-hover:opacity-100">
                {busy === 'avatar' ? <span className="h-6 w-6 animate-spin rounded-full border-2 border-white border-t-transparent" /> : <Camera className="h-7 w-7" />}
              </span>
            </button>
            <input
              ref={fileRef}
              type="file"
              accept="image/jpeg,image/png,image/webp"
              hidden
              onChange={(e) => {
                const f = e.target.files?.[0];
                if (f) {
                  setEditing(false);
                  setCropFile(f);
                }
                e.target.value = '';
              }}
            />
            <ImageCropper
              file={cropFile}
              shape="circle"
              onCancel={() => setCropFile(null)}
              onConfirm={(blob) =>
                act('avatar', async () => {
                  const fd = new FormData();
                  fd.append('image', blob, 'photo.png');
                  if (editing) fd.append('keepOriginal', '1');
                  else if (cropFile) fd.append('original', await shrink(cropFile), 'original.jpg');
                  await upload('/api/auth/me/avatar', fd);
                  await reload();
                  setCropFile(null);
                  toast(t.crop.saved);
                })
              }
            />
            <div className="flex overflow-hidden rounded-full bg-white/15 text-xs font-medium text-white ring-1 ring-white/25 backdrop-blur">
              <button onClick={() => fileRef.current?.click()} className="flex items-center gap-1.5 px-3 py-1.5 transition hover:bg-white/20">
                <Camera className="h-3.5 w-3.5" /> {user?.profile_image ? t.settings.changePhoto2 : t.settings.addPhoto}
              </button>
              {user?.profile_image && (
                <button onClick={editPhoto} className="flex items-center gap-1.5 border-s border-white/25 px-3 py-1.5 transition hover:bg-white/20">
                  <SlidersHorizontal className="h-3.5 w-3.5" /> {lang === 'ar' ? 'عدّلها' : 'Adjust'}
                </button>
              )}
              {user?.profile_image && (
                <button
                  onClick={async () => {
                    if (!(await confirm({ title: t.ask.photoTitle, body: t.ask.photoBody, confirmLabel: t.ask.photoOk, tone: 'danger' }))) return;
                    await act('avatar', async () => (await del('/api/auth/me/avatar'), await reload()));
                  }}
                  className="flex items-center gap-1.5 border-s border-white/25 px-3 py-1.5 transition hover:bg-stitch/80"
                  aria-label={t.settings.removePhoto2}
                >
                  <Trash2 className="h-3.5 w-3.5" /> {t.settings.removePhoto2}
                </button>
              )}
            </div>
          </div>
          <div className="w-full min-w-0 sm:w-auto sm:flex-1">
            <p className="break-words font-display text-2xl text-white">{user?.full_name}</p>
            <p className="truncate text-sm text-white/75" dir="ltr">
              {user?.email}
            </p>
            <div className="mt-2 flex flex-wrap items-center justify-center gap-2 sm:justify-start">
              <RoleBadge onDark />
              {user?.wallet_id && (
                <span className="num inline-flex min-w-0 max-w-full items-center gap-1 rounded-full bg-white/15 py-1 pe-1 ps-2.5 text-xs text-white/90">
                  <span dir="ltr" className="truncate">
                    {user.wallet_id}
                  </span>
                  <CopyButton text={user.wallet_id} />
                </span>
              )}
            </div>
          </div>
          <div className="w-full rounded-2xl bg-white/12 p-3.5 backdrop-blur-sm sm:w-64">
            {(() => {
              const shields: [boolean, string][] = [[!!user?.totp_enabled, t.settings.shield2fa], [!!user?.phone_number, t.settings.shieldPhone], [true, t.settings.shieldMail]];
              const on = shields.filter((x) => x[0]).length;
              return (
                <>
                  <p className="flex items-center justify-between text-sm font-medium text-white">
                    {t.settings.protection}
                    <span className="text-xs text-white/75">{fill(t.settings.protectionLead, { n: on })}</span>
                  </p>
                  <div className="mt-2 flex gap-1.5">
                    {shields.map((x, i) => (
                      <motion.span key={i} initial={{ scaleX: 0 }} animate={{ scaleX: 1 }} transition={{ delay: 0.3 + i * 0.15 }} className={cx('h-2 flex-1 origin-left rounded-full', x[0] ? 'bg-[#9DE07B]' : 'bg-white/25')} />
                    ))}
                  </div>
                  <ul className="mt-2.5 space-y-1 text-xs text-white/85">
                    {shields.map((x, i) => (
                      <li key={i} className="flex items-center gap-1.5">
                        {x[0] ? <Check className="h-3.5 w-3.5 text-[#9DE07B]" /> : <ShieldAlert className="h-3.5 w-3.5 text-[#FFD27A]" />}
                        {x[1]}
                      </li>
                    ))}
                  </ul>
                </>
              );
            })()}
          </div>
        </div>
        <ErrorNote>{error.avatar}</ErrorNote>
      </motion.div>

      <div className="lg:grid lg:grid-cols-[220px_1fr] lg:gap-6">
        {/* Tabs: a scrolling pill row on phones, a sticky list on desktop */}
        <div role="tablist" className={cx('mb-5 grid gap-1.5', tabs.length === 5 ? 'grid-cols-5' : 'grid-cols-4', 'rounded-3xl bg-surface p-1.5 shadow-card lg:sticky lg:top-24 lg:mb-0 lg:flex lg:h-fit lg:flex-col lg:gap-2 lg:bg-transparent lg:p-0 lg:shadow-none')}>
          {tabs.map((k) => {
            const Icon = TAB_ICONS[k];
            const on = tab === k;
            return (
              <button
                key={k}
                role="tab"
                aria-selected={on}
                onClick={() => setTab(k)}
                className={cx('relative flex min-w-0 flex-col items-center gap-1 rounded-2xl px-1 py-2 text-[12px] transition lg:flex-row lg:gap-2.5 lg:px-4 lg:py-2.5 lg:text-[15px]', on ? 'text-white' : 'text-muted hover:text-ink')}
              >
                {on && <motion.span layoutId="settings-tab" className="absolute inset-0 rounded-2xl bg-night shadow-lift dark:bg-white/15" transition={{ type: 'spring', bounce: 0.2, duration: 0.45 }} />}
                <Icon className="relative h-[18px] w-[18px]" />
                <span className="relative max-w-full text-center leading-tight lg:text-start">{t.settings.tabs[k]}</span>
              </button>
            );
          })}
        </div>

        <div className="min-w-0 space-y-5">
      {tab === 'agent' && isAgent && <AgentProfileEditor />}
      {tab === 'profile' && (
        <>
      <Section title={t.settings.profile} icon={UserRound}>
        <form
          className="grid gap-4 sm:grid-cols-2"
          onSubmit={(e) => {
            e.preventDefault();
            void act('profile', async () => {
              await patch('/api/auth/me', { fullName: name.trim(), phoneNumber: phone.trim() || null, homeCity: homeCity.trim() || null, language: lang });
              await reload();
              toast(t.common.saved);
            });
          }}
        >
          <Field label={t.settings.fullName} value={name} onChange={(e) => setName(e.target.value)} required />
          <Field label={t.settings.phone} value={phone} onChange={(e) => setPhone(e.target.value)} dir="ltr" type="tel" />
          <div className="sm:col-span-2">
            <TownField label={lang === 'ar' ? 'منطقتك' : 'Where you live'} value={homeCity} onChange={setHomeCity} />
            <p className="mt-1.5 text-xs text-muted">
              {lang === 'ar' ? 'اختياري — حتى توصلك أخبار وعروض منطقتك، وتحديثات وكلاء الصرف القريبين منك.' : 'Optional — so you get news and offers for your area, and updates from cash agents near you.'}
            </p>
          </div>
          <div className="sm:col-span-2">
            <ErrorNote>{error.profile}</ErrorNote>
            <Button loading={busy === 'profile'}>{t.common.save}</Button>
          </div>
        </form>
      </Section>
      <Section title={t.settings.prefs} icon={Palette} tone="bg-gold text-night">
        <p className="mb-2 flex items-center gap-2 text-sm font-medium text-ink/80">
          <Languages className="h-4 w-4" /> {t.settings.language}
        </p>
        <div className="grid grid-cols-2 gap-3">
          {([['ar', 'العربية', 'ع'], ['en', 'English', 'A']] as const).map(([v, label, glyph]) => (
            <button key={v} onClick={() => setLang(v)} className={cx('flex items-center gap-3 rounded-2xl border p-3 text-start transition', lang === v ? 'border-stitch ring-2 ring-stitch/20' : 'border-line hover:border-ink/30')}>
              <span className={cx('grid h-10 w-10 place-items-center rounded-xl font-display text-lg', lang === v ? 'bg-stitch text-white' : 'bg-sunk')}>{glyph}</span>
              {label}
            </button>
          ))}
        </div>
        <p className="mb-2 mt-5 text-sm font-medium text-ink/80">{t.settings.appearance}</p>
        <ThemePicker theme={theme} onChange={setTheme} />
      </Section>
      <StoreNotifications />
        </>
      )}

      {tab === 'account' && (
        <>
      <Workplaces />
      <Section title={t.settings.email} icon={AtSign} tone="bg-olive text-white" aside={emailStep === 'idle' && <Button size="sm" variant="secondary" onClick={() => setEmailStep('form')}>{t.settings.changeEmail}</Button>}>
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
          <div className="mt-4 space-y-5">
            <div className="rounded-2xl bg-sunk/60 p-4">
              <p className="mb-3 flex items-center gap-2 text-sm font-medium">
                <ShieldCheck className="h-4 w-4 text-olive" /> {fill(t.settings.codeOld, { email: user?.email ?? '' })}
              </p>
              <CodeInput value={emailOld} onChange={setEmailOld} />
            </div>
            <div className="rounded-2xl bg-sunk/60 p-4">
              <p className="mb-3 flex items-center gap-2 text-sm font-medium">
                <AtSign className="h-4 w-4 text-sky" /> {fill(t.settings.codeNew, { email: newEmail })}
              </p>
              <CodeInput value={emailCode} onChange={setEmailCode} autoFocus={false} />
            </div>
            <ErrorNote>{error.email}</ErrorNote>
            <div className="flex flex-wrap gap-2">
              <Button
                loading={busy === 'email'}
                disabled={emailCode.length !== 6 || emailOld.length !== 6}
                onClick={() =>
                  act('email', async () => {
                    await post('/api/auth/me/email/confirm', { code: emailCode, oldCode: emailOld });
                    await reload();
                    setEmailStep('idle');
                    setEmailCode('');
                    setEmailOld('');
                    toast(t.settings.emailChanged);
                  })
                }
              >
                {t.common.confirm}
              </Button>
              <Button variant="ghost" onClick={() => (setEmailStep('idle'), setEmailCode(''), setEmailOld(''))}>
                {t.common.cancel}
              </Button>
            </div>
          </div>
        )}
      </Section>

        </>
      )}

      {tab === 'security' && (
        <>
      <Section title={t.settings.password} icon={LockKeyhole}>
        {pwStep === 'form' ? (
          <form
            className="grid gap-4 sm:grid-cols-2"
            onSubmit={(e) => {
              e.preventDefault();
              if (next !== next2) return setError((x) => ({ ...x, password: t.auth.mismatch }));
              void act('password', async () => {
                await post('/api/auth/me/password/request', { currentPassword: cur, newPassword: next });
                setPwStep('code');
                setPwCode('');
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
        ) : (
          <div className="space-y-4">
            <p className="rounded-2xl bg-sunk/60 p-4 text-sm">{fill(t.settings.pwCodeSent, { email: user?.email ?? '' })}</p>
            <CodeInput value={pwCode} onChange={setPwCode} />
            <ErrorNote>{error.password}</ErrorNote>
            <div className="flex flex-wrap gap-2">
              <Button
                loading={busy === 'password'}
                disabled={pwCode.length !== 6}
                onClick={() =>
                  act('password', async () => {
                    const s = await post('/api/auth/me/password', { code: pwCode });
                    await applySession(s);
                    setCur('');
                    setNext('');
                    setNext2('');
                    setPwStep('form');
                    toast(t.settings.pwChanged);
                    void sessions.reload();
                  })
                }
              >
                {t.settings.changePassword}
              </Button>
              <Button variant="ghost" onClick={() => setPwStep('form')}>
                {t.common.cancel}
              </Button>
            </div>
          </div>
        )}
      </Section>

      <BioToggle />

      <Section
        title={t.settings.twofa}
        icon={ShieldCheck}
        tone="bg-stitch text-white"
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

        </>
      )}

      {tab === 'devices' && (
      <Section
        title={t.settings.sessions}
        icon={MonitorSmartphone}
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
        <DeviceList
          sessions={sessions.data?.sessions}
          thisDevice={t.settings.thisDevice}
          lastUsed={t.settings.lastUsed}
          revoke={t.settings.revoke}
          onRevoke={async (s) => {
            if (!(await confirm({ title: t.ask.deviceTitle, body: t.ask.deviceBody, confirmLabel: t.ask.deviceOk, tone: 'danger' }))) return;
            await del(`/api/auth/me/sessions/${s.id}`);
            void sessions.reload();
          }}
        />
      </Section>
      )}

      {tab === 'account' && (
      <section className="rounded-2xl border border-dashed border-stitch/40 bg-stitch/[0.03] p-5 sm:p-6">
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
      )}
        </div>
      </div>

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

/** Light / dark as two little skies: a sun that spins its rays, a moon with twinkling stars. */
function ThemePicker({ theme, onChange }: { theme: string; onChange: (v: 'light' | 'dark') => void }) {
  const { t } = useI18n();
  return (
    <div role="radiogroup" aria-label={t.settings.appearance} className="grid grid-cols-1 gap-3 min-[420px]:grid-cols-2">
      {(['light', 'dark'] as const).map((v) => {
        const on = theme === v;
        const light = v === 'light';
        return (
          <motion.button
            key={v}
            role="radio"
            aria-checked={on}
            whileTap={{ scale: 0.97 }}
            onClick={() => onChange(v)}
            className={cx(
              'group relative isolate flex h-32 overflow-hidden rounded-[24px] text-start transition duration-300',
              light ? 'bg-[linear-gradient(135deg,#FFFFFF_0%,#F6F3EC_100%)] text-[#141B3D]' : 'bg-[radial-gradient(120%_120%_at_0%_0%,#2A3570_0%,#0D1230_70%)] text-white',
              on ? 'shadow-[0_22px_44px_-26px_rgb(20_27_61/0.75)] ring-2 ring-gold' : 'ring-1 ring-line hover:-translate-y-0.5',
            )}
          >
            {/* Medallion: an eight-pointed star that stitches itself in when chosen */}
            <span className="pointer-events-none absolute -end-6 top-1/2 grid h-40 w-40 -translate-y-1/2 place-items-center">
              <span className={cx('absolute inset-0 rounded-full border border-dashed', light ? 'border-[#C8344A]/25' : 'border-[#E9C060]/30')} />
              <span className={cx('absolute inset-5 rounded-full', light ? 'bg-[#C8344A]/[0.04]' : 'bg-[#E9C060]/[0.06]')} />
              <motion.span className="relative" animate={on ? { scale: [0.92, 1] } : { scale: 0.92 }} transition={{ duration: 0.6, ease: 'easeOut' }}>
                <StarMotif key={on ? 'on' : 'off'} size={13} cell={7} strokeWidth={1.6} className={cx('h-[91px] w-[91px] transition-opacity duration-500', on ? 'opacity-100' : 'opacity-40 group-hover:opacity-70')} colors={light ? ['#C8344A', '#D9A73A'] : ['#E9C060', '#E2506A']} />
              </motion.span>
            </span>
            <span className="relative z-10 flex flex-1 flex-col justify-between p-4">
              <span>
                <span className="block font-display text-2xl leading-none">{light ? t.settings.themeLight : t.settings.themeDark}</span>
                <span className={cx('mt-1.5 block max-w-[60%] text-xs', light ? 'text-[#5B6383]' : 'text-white/60')}>{light ? t.settings.themeLightD : t.settings.themeDarkD}</span>
              </span>
              <span className={cx('grid h-6 w-6 place-items-center rounded-full transition', on ? 'bg-gold text-night' : light ? 'ring-1 ring-[#141B3D]/25' : 'ring-1 ring-white/30')}>
                {on && <Check className="h-3.5 w-3.5" strokeWidth={3} />}
              </span>
            </span>
          </motion.button>
        );
      })}
    </div>
  );
}

/** Stores I bought from or follow: turn each one's news and offers on or off. */
function StoreNotifications() {
  const { lang } = useI18n();
  const ar = lang === 'ar';
  const { data, setData } = useData<{ stores: any[] }>('/api/store/me/following');
  if (!data?.stores.length) return null;
  const toggle = async (st: any) => {
    const next = !st.notify;
    setData({ stores: data.stores.map((x) => (x.id === st.id ? { ...x, notify: next } : x)) });
    try {
      await put(`/api/store/me/follow/${st.id}`, { notify: next });
    } catch {
      setData({ stores: data.stores });
    }
  };
  return (
    <Section title={ar ? 'إشعارات المتاجر' : 'Store notifications'} icon={BellRing} tone="bg-stitch/10 text-stitch">
      <p className="mb-3 text-sm text-muted">{ar ? 'المتاجر اللي اشتريت منها أو تابعتها. سكّر أي متجر ما بدك توصلك أخباره وعروضه.' : 'Stores you bought from or follow. Turn off any store whose news and offers you don’t want.'}</p>
      <ul className="divide-y divide-line">
        {data.stores.map((st) => (
          <li key={st.id} className="flex items-center gap-3 py-3">
            <StoreLogo s={st} size={40} />
            <span className="min-w-0 flex-1">
              <span className="block truncate font-medium">{st.store_name}</span>
              <span className="block text-xs text-muted">
                {st.orders > 0 ? (ar ? `${st.orders} طلب` : `${st.orders} orders`) : ar ? 'متابَع' : 'Following'}
              </span>
            </span>
            <Toggle checked={st.notify} onChange={() => void toggle(st)} label="" />
          </li>
        ))}
      </ul>
    </Section>
  );
}

/** Places that added me (a shop's staff, a family…): accept to show it on my profile, or hide it. */
function Workplaces() {
  const { lang, err } = useI18n();
  const ar = lang === 'ar';
  const toast = useToast();
  const data = useData<{ workplaces: any[] }>('/api/people/workplaces');
  const list = data.data?.workplaces ?? [];
  if (!list.length) return null;
  const set = async (id: string, body: any) => {
    try {
      await post(`/api/people/workplaces/${id}`, body);
      void data.reload();
    } catch (e) {
      toast(err(e), 'error');
    }
  };
  return (
    <section id="workplaces" className="card p-5 sm:p-6">
      <h2 className="mb-1 text-lg">{ar ? 'وين بتشتغل / تابع لمين' : 'Where you work'}</h2>
      <p className="mb-4 text-sm text-muted">{ar ? 'ناس ضافوك لفئة عندهم. إذا وافقت بيبين بملفك، وبتقدر تخفيه وقت ما بدك.' : 'People added you to a group. If you accept it shows on your profile; you can hide it any time.'}</p>
      <ul className="space-y-2.5">
        {list.map((w) => (
          <li key={w.id} className="flex flex-wrap items-center gap-3 rounded-2xl p-3 ring-1 ring-line">
            <Avatar name={w.store_name ?? w.owner_name} src={w.owner_image} size={40} />
            <div className="min-w-0 flex-1">
              <p className="truncate font-semibold">{w.workplace ?? w.store_name ?? w.owner_name}</p>
              <p className="truncate text-xs text-muted">{[w.owner_name, w.role_title, w.since ? String(w.since).slice(0, 10) : null].filter(Boolean).join(' · ')}</p>
            </div>
            {w.link_status === 'invited' ? (
              <div className="flex gap-1.5">
                <Button size="sm" onClick={() => set(w.id, { accept: true })}>
                  {ar ? 'وافق' : 'Accept'}
                </Button>
                <Button size="sm" variant="secondary" onClick={() => set(w.id, { accept: false })}>
                  {ar ? 'لا' : 'Decline'}
                </Button>
              </div>
            ) : w.link_status === 'accepted' ? (
              <Toggle checked={w.show_on_profile} onChange={(v) => set(w.id, { show: v })} label={ar ? 'يبين بملفي' : 'On my profile'} />
            ) : (
              <button onClick={() => set(w.id, { accept: true })} className="text-xs text-sky">
                {ar ? 'رفضت — غيّر رأيك' : 'Declined — change'}
              </button>
            )}
          </li>
        ))}
      </ul>
    </section>
  );
}
