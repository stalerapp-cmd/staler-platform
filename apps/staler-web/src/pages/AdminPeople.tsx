import { useEffect, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { BellRing, Crown, KeyRound, LogOut, Megaphone, Search, ShieldCheck, ShieldOff, Snowflake, Trash2, UserCog, UserPlus, Users } from 'lucide-react';
import { ApiError, del, get, patch, post } from '../lib/api';
import { useI18n } from '../lib/i18n';
import { useData } from '../lib/hooks';
import { usePerm } from '../lib/perm';
import { date, fill, money, relative } from '../lib/format';
import { useToast } from '../components/Toast';
import { useConfirm } from '../components/Confirm';
import { useSecureAction } from '../components/SecureAction';
import { TxRow } from '../components/Wallet';
import { Avatar, Badge, Button, Chips, EmptyState, ErrorNote, Field, PageHeader, PasswordStrength, Select, Sheet, Skeleton, TextArea, cx } from '../components/ui';

/** Ticked permission list, grouped as the server defines them. */
export function PermissionPicker({ all, value, onChange }: { all: string[]; value: string[]; onChange: (v: string[]) => void }) {
  const { t } = useI18n();
  return (
    <div>
      <div className="mb-2 flex items-center justify-between">
        <p className="text-sm font-medium text-ink/80">{t.people.permissions}</p>
        <div className="flex gap-1 text-sm">
          <button type="button" className="rounded-lg px-2 py-1 text-sky hover:bg-sunk" onClick={() => onChange(all)}>
            {t.people.selectAll}
          </button>
          <button type="button" className="rounded-lg px-2 py-1 text-muted hover:bg-sunk" onClick={() => onChange([])}>
            {t.people.clear}
          </button>
        </div>
      </div>
      <ul className="grid gap-2 sm:grid-cols-2">
        {all.map((p) => {
          const on = value.includes(p);
          return (
            <li key={p}>
              <label className={cx('flex cursor-pointer items-start gap-3 rounded-xl border p-3 text-sm transition', on ? 'border-sky/50 bg-sky/10' : 'border-line hover:bg-sunk')}>
                <input type="checkbox" className="mt-0.5 h-4 w-4 accent-[rgb(var(--sky))]" checked={on} onChange={() => onChange(on ? value.filter((x) => x !== p) : [...value, p])} />
                <span>{t.people.perm[p] ?? p}</span>
              </label>
            </li>
          );
        })}
      </ul>
    </div>
  );
}

/** Announcement card (overview page) — notify permission. */
export function BroadcastCard() {
  const { t, err } = useI18n();
  const toast = useToast();
  const confirm = useConfirm();
  const [title, setTitle] = useState('');
  const [body, setBody] = useState('');
  const [role, setRole] = useState('all');
  const [busy, setBusy] = useState(false);
  return (
    <section className="card p-5">
      <h2 className="flex items-center gap-2 text-lg">
        <Megaphone className="h-5 w-5 text-stitch" /> {t.people.broadcast}
      </h2>
      <p className="mb-4 text-sm text-muted">{t.people.broadcastLead}</p>
      <form
        className="space-y-3"
        onSubmit={async (e) => {
          e.preventDefault();
          if (!(await confirm({ title: t.people.q.broadcastT, body: t.people.q.broadcastB, confirmLabel: t.people.q.broadcastOk }))) return;
          setBusy(true);
          try {
            const r = await post('/api/admin/broadcast', { title: title.trim(), body: body.trim(), ...(role !== 'all' ? { role } : {}) });
            toast(fill(t.people.sent, { n: r.sent }));
            setTitle('');
            setBody('');
          } catch (e2) {
            toast(err(e2), 'error');
          } finally {
            setBusy(false);
          }
        }}
      >
        <Field label={t.people.title} value={title} onChange={(e) => setTitle(e.target.value)} required minLength={2} maxLength={80} />
        <TextArea label={t.people.message} value={body} onChange={(e) => setBody(e.target.value)} required minLength={2} maxLength={500} rows={3} />
        <Select
          block
          label={t.people.audience}
          value={role}
          onChange={setRole}
          options={[{ value: 'all', label: t.people.everyone }, ...(['user', 'merchant', 'exchange', 'admin'] as const).map((k) => ({ value: k, label: t.admin.roles[k] }))]}
        />
        <Button block loading={busy} icon={<BellRing className="h-4 w-4" />}>
          {t.people.send}
        </Button>
      </form>
    </section>
  );
}

export function AdminUsers() {
  const { t, lang, err } = useI18n();
  const toast = useToast();
  const { can } = usePerm();
  const [q, setQ] = useState('');
  const [role, setRole] = useState('all');
  const [data, setData] = useState<{ users: any[]; total: number } | null>(null);
  const [create, setCreate] = useState(false);
  const [f, setF] = useState({ fullName: '', email: '', password: '', role: 'user' });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const load = async () => {
    const p = new URLSearchParams({ limit: '60' });
    if (q.trim()) p.set('q', q.trim());
    if (role !== 'all') p.set('role', role);
    try {
      setData(await get(`/api/admin/users?${p}`));
    } catch (e) {
      toast(err(e), 'error');
    }
  };
  useEffect(() => {
    const h = setTimeout(load, 250);
    return () => clearTimeout(h);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [q, role]);
  return (
    <div>
      <PageHeader
        title={t.admin.users}
        lead={data ? `${data.total}` : undefined}
        actions={
          can('users.edit') && (
            <Button icon={<UserPlus className="h-4 w-4" />} onClick={() => setCreate(true)}>
              {t.admin.createUser}
            </Button>
          )
        }
      />
      <div className="mb-4 space-y-3">
        <label className="relative block">
          <span className="sr-only">{t.common.search}</span>
          <Search className="pointer-events-none absolute start-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted" />
          <input value={q} onChange={(e) => setQ(e.target.value)} placeholder={t.common.search} className="field h-12 ps-10" type="search" />
        </label>
        <Chips
          label={t.admin.role}
          value={role}
          onChange={setRole}
          options={[{ value: 'all', label: t.common.all }, ...Object.entries(t.admin.roles).map(([k, v]) => ({ value: k, label: v }))]}
        />
      </div>
      <div className="card divide-y divide-line/70 overflow-hidden">
        {!data ? (
          <Skeleton className="m-4 h-24" />
        ) : !data.users.length ? (
          <EmptyState icon={<Users className="h-6 w-6" />} title={t.common.empty} />
        ) : (
          data.users.map((u) => (
            <Link key={u.id} to={`/app/admin/users/${u.id}`} className="flex items-center gap-3 px-4 py-3 transition hover:bg-sunk">
              <Avatar name={u.full_name} src={u.profile_image} size={40} />
              <span className="min-w-0 flex-1">
                <span className="flex items-center gap-1.5 truncate font-medium">
                  {u.full_name}
                  {u.admin_level === 'super_admin' && <Crown className="h-4 w-4 shrink-0 text-gold" aria-label={t.people.superAdmin} />}
                </span>
                <span className="block truncate text-xs text-muted" dir="ltr">
                  {u.email}
                </span>
              </span>
              <span className="hidden text-end sm:block">
                <span className="num block text-sm font-medium">{money(u.balance ?? 0, lang)}</span>
                <span className="block text-xs text-muted">{u.last_login_at ? relative(u.last_login_at, lang) : '—'}</span>
              </span>
              <span className="flex flex-col items-end gap-1">
                <Badge>{t.admin.roles[u.role] ?? u.role}</Badge>
                {u.status !== 'active' && <Badge tone="bad">{t.admin.suspended}</Badge>}
              </span>
            </Link>
          ))
        )}
      </div>
      <Sheet open={create} onClose={() => setCreate(false)} title={t.admin.createUser}>
        <form
          className="space-y-4"
          onSubmit={async (e) => {
            e.preventDefault();
            setBusy(true);
            setError(null);
            try {
              await post('/api/admin/users', { fullName: f.fullName.trim(), email: f.email.trim(), password: f.password, role: f.role });
              setCreate(false);
              setF({ fullName: '', email: '', password: '', role: 'user' });
              void load();
              toast(t.common.saved);
            } catch (e2) {
              setError(err(e2));
            } finally {
              setBusy(false);
            }
          }}
        >
          <Field label={t.auth.fullName} value={f.fullName} onChange={(e) => setF({ ...f, fullName: e.target.value })} required />
          <Field label={t.auth.email} type="email" value={f.email} onChange={(e) => setF({ ...f, email: e.target.value })} dir="ltr" required />
          <div>
            <Field label={t.auth.password} type="password" value={f.password} onChange={(e) => setF({ ...f, password: e.target.value })} dir="ltr" required autoComplete="new-password" />
            <PasswordStrength value={f.password} />
          </div>
          <Select block label={t.admin.role} value={f.role} onChange={(v) => setF({ ...f, role: v })} options={(['user', 'merchant', 'exchange'] as const).map((k) => ({ value: k, label: t.admin.roles[k] }))} />
          <ErrorNote>{error}</ErrorNote>
          <Button block loading={busy}>
            {t.admin.createUser}
          </Button>
        </form>
      </Sheet>
    </div>
  );
}

function ActionButton({ icon, children, onClick, tone }: { icon: React.ReactNode; children: React.ReactNode; onClick: () => void; tone?: 'danger' }) {
  return (
    <button
      onClick={onClick}
      className={cx(
        'flex items-center gap-3 rounded-xl border px-4 py-3 text-start text-sm font-medium transition active:scale-[0.99]',
        tone === 'danger' ? 'border-stitch/30 text-stitch hover:bg-stitch/10' : 'border-line hover:bg-sunk',
      )}
    >
      <span className="shrink-0">{icon}</span>
      {children}
    </button>
  );
}

export function AdminUserDetail() {
  const { id } = useParams();
  const nav = useNavigate();
  const { t, lang, err } = useI18n();
  const toast = useToast();
  const confirm = useConfirm();
  const secure = useSecureAction();
  const { can } = usePerm();
  const { data, reload, error } = useData<any>(`/api/admin/users/${id}`, [id]);
  const [f, setF] = useState<any>(null);
  const [pwOpen, setPwOpen] = useState(false);
  const [pw, setPw] = useState('');
  const [pw2, setPw2] = useState('');
  const [msgOpen, setMsgOpen] = useState(false);
  const [msg, setMsg] = useState({ title: '', body: '' });
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    if (data?.user) setF({ fullName: data.user.full_name, email: data.user.email, phoneNumber: data.user.phone_number ?? '', language: data.user.language ?? 'ar', role: data.user.role });
  }, [data]);
  if (error) return <ErrorNote>{err(error)}</ErrorNote>;
  if (!data || !f) return <Skeleton className="h-64 rounded-2xl" />;
  const u = data.user;
  const vars = { name: u.full_name, email: u.email };
  const protectedAcc = u.admin_level === 'super_admin' || (u.role === 'admin' && !can('admins.manage'));
  const run = async (q: { t: string; b: string; ok: string; danger?: boolean }, fn: () => Promise<unknown>, after?: () => void) => {
    if (!(await confirm({ title: fill(q.t, vars), body: fill(q.b, vars), confirmLabel: q.ok, tone: q.danger ? 'danger' : 'primary' }))) return;
    try {
      await fn();
      toast(t.common.done);
      if (after) after();
      else void reload();
    } catch (e) {
      if (!(e instanceof ApiError && e.code === 'CANCELLED')) toast(err(e), 'error');
    }
  };
  const Q = t.people.q;
  return (
    <div className="grid grid-cols-[minmax(0,1fr)] gap-6 lg:grid-cols-[minmax(0,1.1fr)_minmax(0,1fr)]">
      {secure.element}
      <div className="space-y-6">
        <section className="card p-6">
          <div className="flex items-center gap-4">
            <Avatar name={u.full_name} src={u.profile_image} size={64} />
            <div className="min-w-0">
              <h1 className="flex items-center gap-2 truncate text-2xl">
                {u.full_name} {u.admin_level === 'super_admin' && <Crown className="h-5 w-5 text-gold" />}
              </h1>
              <p className="truncate text-muted" dir="ltr">
                {u.email}
              </p>
            </div>
          </div>
          <div className="mt-4 flex flex-wrap gap-2">
            <Badge>{t.admin.roles[u.role]}</Badge>
            <Badge tone={u.status === 'active' ? 'good' : 'bad'}>{u.status === 'active' ? t.admin.active : t.admin.suspended}</Badge>
            {u.totp_enabled && <Badge tone="good">2FA</Badge>}
            <Badge>{date(u.created_at, lang, false)}</Badge>
          </div>
          {data.wallet && (
            <div className="mt-5 rounded-2xl bg-sunk p-4">
              <p className="num text-sm text-muted">{data.wallet.wallet_id}</p>
              <p className="num font-display text-3xl">{money(data.wallet.balance, lang)}</p>
              {data.wallet.is_frozen && <Badge tone="bad">{t.admin.freeze}</Badge>}
            </div>
          )}
          {data.bankLink && <p className="num mt-3 text-sm text-muted">TalerBank · {data.bankLink.bank_iban}</p>}
          {protectedAcc && <p className="mt-4 rounded-xl bg-gold/15 px-4 py-3 text-sm">{t.people.protected}</p>}
        </section>

        {!protectedAcc && (can('users.edit') || can('users.role')) && (
          <section className="card p-6">
            <h2 className="mb-4 flex items-center gap-2 text-lg">
              <UserCog className="h-5 w-5 text-muted" /> {t.people.edit}
            </h2>
            <form
              className="grid gap-4 sm:grid-cols-2"
              onSubmit={async (e) => {
                e.preventDefault();
                const body: any = {};
                if (can('users.edit')) {
                  if (f.fullName.trim() !== u.full_name) body.fullName = f.fullName.trim();
                  if (f.email.trim().toLowerCase() !== u.email) body.email = f.email.trim();
                  if ((f.phoneNumber.trim() || null) !== (u.phone_number ?? null)) body.phoneNumber = f.phoneNumber.trim() || null;
                  if (f.language !== (u.language ?? 'ar')) body.language = f.language;
                }
                if (can('users.role') && f.role !== u.role && u.role !== 'admin') body.role = f.role;
                if (!Object.keys(body).length) return;
                await run({ t: Q.saveT, b: Q.saveB, ok: Q.saveOk }, () => patch(`/api/admin/users/${u.id}`, body));
              }}
            >
              <Field label={t.auth.fullName} value={f.fullName} onChange={(e) => setF({ ...f, fullName: e.target.value })} disabled={!can('users.edit')} />
              <Field label={t.auth.email} type="email" dir="ltr" value={f.email} onChange={(e) => setF({ ...f, email: e.target.value })} disabled={!can('users.edit')} />
              <Field label={t.people.phone} type="tel" dir="ltr" value={f.phoneNumber} onChange={(e) => setF({ ...f, phoneNumber: e.target.value })} disabled={!can('users.edit')} />
              <Select block label={t.people.language} value={f.language} onChange={(v) => setF({ ...f, language: v })} options={[{ value: 'ar', label: 'العربية' }, { value: 'en', label: 'English' }]} />
              {u.role !== 'admin' && can('users.role') && (
                <Select block className="sm:col-span-2" label={t.admin.role} value={f.role} onChange={(v) => setF({ ...f, role: v })} options={(['user', 'merchant', 'exchange'] as const).map((k) => ({ value: k, label: t.admin.roles[k] }))} />
              )}
              <div className="sm:col-span-2">
                <Button>{t.people.save}</Button>
              </div>
            </form>
          </section>
        )}
      </div>

      <div className="space-y-6">
        {!protectedAcc && (
          <section className="card p-6">
            <h2 className="mb-4 flex items-center gap-2 text-lg">
              <ShieldCheck className="h-5 w-5 text-muted" /> {t.people.actions}
            </h2>
            <div className="grid gap-2 sm:grid-cols-2">
              {can('users.status') && (
                <ActionButton
                  icon={<ShieldOff className="h-5 w-5" />}
                  tone={u.status === 'active' ? 'danger' : undefined}
                  onClick={() =>
                    u.status === 'active'
                      ? run({ t: Q.suspendT, b: Q.suspendB, ok: Q.suspendOk, danger: true }, () => patch(`/api/admin/users/${u.id}`, { status: 'suspended' }))
                      : run({ t: Q.activateT, b: Q.activateB, ok: Q.activateOk }, () => patch(`/api/admin/users/${u.id}`, { status: 'active' }))
                  }
                >
                  {u.status === 'active' ? t.admin.suspend : t.admin.activate}
                </ActionButton>
              )}
              {can('wallets.freeze') && data.wallet && (
                <ActionButton
                  icon={<Snowflake className="h-5 w-5" />}
                  onClick={() =>
                    run({ t: data.wallet.is_frozen ? t.admin.unfreeze : t.admin.freeze, b: t.common.areYouSure, ok: data.wallet.is_frozen ? t.admin.unfreeze : t.admin.freeze, danger: !data.wallet.is_frozen }, () =>
                      post(`/api/admin/wallets/${data.wallet.wallet_id}/freeze`, { frozen: !data.wallet.is_frozen }),
                    )
                  }
                >
                  {data.wallet.is_frozen ? t.admin.unfreeze : t.admin.freeze}
                </ActionButton>
              )}
              {can('users.security') && (
                <ActionButton icon={<LogOut className="h-5 w-5 flip-rtl" />} onClick={() => run({ t: Q.revokeT, b: Q.revokeB, ok: Q.revokeOk }, () => post(`/api/admin/users/${u.id}/revoke-sessions`))}>
                  {t.admin.revokeSessions}
                </ActionButton>
              )}
              {can('users.security') && u.totp_enabled && (
                <ActionButton
                  icon={<ShieldOff className="h-5 w-5" />}
                  onClick={() => run({ t: Q.twofaT, b: Q.twofaB, ok: Q.twofaOk, danger: true }, () => secure.run((totp) => post(`/api/admin/users/${u.id}/reset-2fa`, totp ? { totp } : {})))}
                >
                  {t.admin.reset2fa}
                </ActionButton>
              )}
              {can('users.password') && (
                <ActionButton icon={<KeyRound className="h-5 w-5" />} onClick={() => run({ t: Q.resetT, b: Q.resetB, ok: Q.resetOk }, () => post(`/api/admin/users/${u.id}/send-reset`))}>
                  {t.admin.sendReset}
                </ActionButton>
              )}
              {can('users.password') && (
                <ActionButton icon={<KeyRound className="h-5 w-5" />} onClick={() => (setPw(''), setPw2(''), setPwOpen(true))}>
                  {t.people.setPassword}
                </ActionButton>
              )}
              {can('notify') && (
                <ActionButton icon={<BellRing className="h-5 w-5" />} onClick={() => setMsgOpen(true)}>
                  {t.people.notify}
                </ActionButton>
              )}
              {can('users.delete') && (
                <ActionButton
                  icon={<Trash2 className="h-5 w-5" />}
                  tone="danger"
                  onClick={() => run({ t: Q.deleteT, b: Q.deleteB, ok: Q.deleteOk, danger: true }, () => del(`/api/admin/users/${u.id}`), () => nav('/app/admin/users'))}
                >
                  {t.admin.deleteUser}
                </ActionButton>
              )}
            </div>
          </section>
        )}
        <section className="card p-3">
          <h2 className="px-3 pt-2 text-lg">{t.home.recent}</h2>
          {data.transactions.length ? (
            <ul>
              {data.transactions.map((tx: any, i: number) => (
                <TxRow key={tx.id} index={i} tx={{ ...tx, counterparty_name: null, from_account: null, to_account: null, balance_after: null, reference: null }} />
              ))}
            </ul>
          ) : (
            <p className="px-3 py-6 text-center text-sm text-muted">{t.common.empty}</p>
          )}
        </section>
      </div>

      <Sheet open={pwOpen} onClose={() => setPwOpen(false)} title={t.people.setPassword}>
        <form
          className="space-y-4"
          onSubmit={async (e) => {
            e.preventDefault();
            if (pw !== pw2) return;
            setBusy(true);
            try {
              await post(`/api/admin/users/${u.id}/password`, { password: pw });
              toast(t.common.done);
              setPwOpen(false);
            } catch (e2) {
              toast(err(e2), 'error');
            } finally {
              setBusy(false);
            }
          }}
        >
          <p className="text-sm text-muted">{t.people.setPasswordLead}</p>
          <div>
            <Field label={t.auth.newPassword} type="password" dir="ltr" value={pw} onChange={(e) => setPw(e.target.value)} required autoComplete="new-password" />
            <PasswordStrength value={pw} />
          </div>
          <Field label={t.auth.confirmPassword} type="password" dir="ltr" value={pw2} onChange={(e) => setPw2(e.target.value)} required autoComplete="new-password" error={pw2 && !pw.startsWith(pw2) ? t.auth.mismatch : undefined} />
          <Button block variant="danger-solid" loading={busy} disabled={!pw || pw !== pw2}>
            {t.people.setPasswordOk}
          </Button>
        </form>
      </Sheet>
      <Sheet open={msgOpen} onClose={() => setMsgOpen(false)} title={t.people.notify}>
        <form
          className="space-y-4"
          onSubmit={async (e) => {
            e.preventDefault();
            setBusy(true);
            try {
              await post(`/api/admin/users/${u.id}/notify`, { title: msg.title.trim(), body: msg.body.trim() });
              toast(t.common.done);
              setMsg({ title: '', body: '' });
              setMsgOpen(false);
            } catch (e2) {
              toast(err(e2), 'error');
            } finally {
              setBusy(false);
            }
          }}
        >
          <p className="text-sm text-muted">{t.people.notifyLead}</p>
          <Field label={t.people.title} value={msg.title} onChange={(e) => setMsg({ ...msg, title: e.target.value })} required minLength={2} maxLength={80} />
          <TextArea label={t.people.message} value={msg.body} onChange={(e) => setMsg({ ...msg, body: e.target.value })} required minLength={2} maxLength={500} rows={4} />
          <Button block loading={busy} icon={<BellRing className="h-4 w-4" />}>
            {t.people.send}
          </Button>
        </form>
      </Sheet>
    </div>
  );
}

/** Super admin only: who administers the platform, and with which permissions. */
export function AdminAdmins() {
  const { t, lang, err } = useI18n();
  const toast = useToast();
  const confirm = useConfirm();
  const secure = useSecureAction();
  const admins = useData<{ admins: any[] }>('/api/admin/admins');
  const perms = useData<{ permissions: string[] }>('/api/admin/permissions');
  const all = perms.data?.permissions ?? [];
  const [adding, setAdding] = useState(false);
  const [f, setF] = useState({ email: '', fullName: '', password: '', permissions: [] as string[] });
  const [editing, setEditing] = useState<any>(null);
  const [editPerms, setEditPerms] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const Q = t.people.q;
  return (
    <div>
      {secure.element}
      <PageHeader title={t.people.admins} lead={t.people.superNote} actions={<Button icon={<UserPlus className="h-4 w-4" />} onClick={() => setAdding(true)}>{t.people.addAdmin}</Button>} />
      <div className="space-y-3">
        {!admins.data ? (
          <Skeleton className="h-28 rounded-2xl" />
        ) : (
          admins.data.admins.map((a) => {
            const sup = a.admin_level === 'super_admin';
            return (
              <section key={a.id} className={cx('card p-5', sup && 'border-gold/40')}>
                <div className="flex flex-wrap items-center gap-4">
                  <Avatar name={a.full_name} size={44} />
                  <div className="min-w-0 flex-1">
                    <p className="flex items-center gap-2 font-medium">
                      {a.full_name} {sup && <Badge tone="warn"><Crown className="h-3.5 w-3.5" /> {t.people.superAdmin}</Badge>}
                    </p>
                    <p className="truncate text-sm text-muted" dir="ltr">
                      {a.email}
                    </p>
                    <p className="text-xs text-muted">{a.last_login_at ? relative(a.last_login_at, lang) : '—'}</p>
                  </div>
                  {!sup && (
                    <div className="flex flex-wrap gap-2">
                      <Button size="sm" variant="secondary" onClick={() => (setEditing(a), setEditPerms(a.admin_permissions ?? []))}>
                        {t.people.editPerms}
                      </Button>
                      <Button
                        size="sm"
                        variant="danger"
                        onClick={async () => {
                          if (!(await confirm({ title: fill(Q.removeAdminT, { name: a.full_name }), body: Q.removeAdminB, confirmLabel: Q.removeAdminOk, tone: 'danger' }))) return;
                          try {
                            await del(`/api/admin/admins/${a.id}`);
                            void admins.reload();
                          } catch (e) {
                            toast(err(e), 'error');
                          }
                        }}
                      >
                        {t.people.removeAdmin}
                      </Button>
                    </div>
                  )}
                </div>
                <div className="mt-3 flex flex-wrap gap-1.5">
                  {sup ? (
                    <Badge tone="good">{t.people.superNote}</Badge>
                  ) : (a.admin_permissions ?? []).length ? (
                    (a.admin_permissions as string[]).map((p) => <Badge key={p} tone="info">{t.people.perm[p] ?? p}</Badge>)
                  ) : (
                    <Badge>{t.people.noPerms}</Badge>
                  )}
                </div>
              </section>
            );
          })
        )}
      </div>

      <Sheet open={adding} onClose={() => setAdding(false)} title={t.people.addAdmin} wide>
        <form
          className="space-y-4"
          onSubmit={async (e) => {
            e.preventDefault();
            if (!(await confirm({ title: fill(Q.grantT, { email: f.email.trim() }), body: Q.grantB, confirmLabel: Q.grantOk }))) return;
            setBusy(true);
            setError(null);
            try {
              await secure.run((totp) =>
                post('/api/admin/admins', {
                  email: f.email.trim(),
                  permissions: f.permissions,
                  ...(f.fullName.trim() ? { fullName: f.fullName.trim() } : {}),
                  ...(f.password ? { password: f.password } : {}),
                  ...(totp ? { totp } : {}),
                }),
              );
              setAdding(false);
              setF({ email: '', fullName: '', password: '', permissions: [] });
              void admins.reload();
              toast(t.common.done);
            } catch (e2) {
              if (!(e2 instanceof ApiError && e2.code === 'CANCELLED')) setError(err(e2));
            } finally {
              setBusy(false);
            }
          }}
        >
          <p className="text-sm text-muted">{t.people.addAdminLead}</p>
          <Field label={t.auth.email} type="email" dir="ltr" value={f.email} onChange={(e) => setF({ ...f, email: e.target.value })} required />
          <p className="text-xs text-muted">{t.people.newAccountHint}</p>
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label={`${t.auth.fullName} (${t.common.optional})`} value={f.fullName} onChange={(e) => setF({ ...f, fullName: e.target.value })} />
            <Field label={`${t.auth.password} (${t.common.optional})`} type="password" dir="ltr" value={f.password} onChange={(e) => setF({ ...f, password: e.target.value })} autoComplete="new-password" />
          </div>
          <PermissionPicker all={all} value={f.permissions} onChange={(v) => setF({ ...f, permissions: v })} />
          <ErrorNote>{error}</ErrorNote>
          <Button block size="lg" loading={busy}>
            {t.people.addAdmin}
          </Button>
        </form>
      </Sheet>

      <Sheet open={!!editing} onClose={() => setEditing(null)} title={t.people.editPerms} wide>
        {editing && (
          <div className="space-y-5">
            <p className="font-medium">{editing.full_name}</p>
            <PermissionPicker all={all} value={editPerms} onChange={setEditPerms} />
            <Button
              block
              loading={busy}
              onClick={async () => {
                if (!(await confirm({ title: fill(Q.permsT, { name: editing.full_name }), body: Q.permsB, confirmLabel: Q.permsOk }))) return;
                setBusy(true);
                try {
                  await patch(`/api/admin/admins/${editing.id}`, { permissions: editPerms });
                  setEditing(null);
                  void admins.reload();
                  toast(t.common.saved);
                } catch (e) {
                  toast(err(e), 'error');
                } finally {
                  setBusy(false);
                }
              }}
            >
              {t.common.save}
            </Button>
          </div>
        )}
      </Sheet>
    </div>
  );
}
