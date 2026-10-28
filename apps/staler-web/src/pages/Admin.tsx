import { motion } from 'framer-motion';
import { useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { CheckCircle2, RefreshCw, Scale, Search, UserPlus } from 'lucide-react';
import { del, get, patch, post, put } from '../lib/api';
import { useAuth } from '../lib/auth';
import { useI18n } from '../lib/i18n';
import { useData } from '../lib/hooks';
import { date, money, relative } from '../lib/format';
import { useToast } from '../components/Toast';
import { AreaChart } from '../components/Chart';
import { Avatar, Badge, Button, ErrorNote, Field, PageHeader, PasswordStrength, Segmented, Sheet, Skeleton, Toggle, cx } from '../components/ui';
import { TxRow } from '../components/Wallet';

function Tile({ label, value, tone = 'text-ink', i = 0 }: { label: string; value: string; tone?: string; i?: number }) {
  return (
    <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: i * 0.05 }} className="card p-4">
      <p className="text-sm text-muted">{label}</p>
      <p className={cx('num mt-1 font-display text-2xl', tone)}>{value}</p>
    </motion.div>
  );
}

export function AdminOverview() {
  const { t, lang, err } = useI18n();
  const toast = useToast();
  const ov = useData<any>('/api/admin/overview');
  const rec = useData<any>('/api/admin/reconciliation');
  const d = ov.data;
  const r = rec.data;
  const inSystem = r ? Number(r.walletsTotal) + Number(r.vouchersInEscrow) + Number(r.escrowHeld) + Number(r.pendingDeposits) : 0;
  return (
    <div>
      <PageHeader title={t.admin.overview} />
      {!d ? (
        <Skeleton className="h-32 rounded-2xl" />
      ) : (
        <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
          <Tile i={0} label={t.admin.users} value={String(d.users.total)} />
          <Tile i={1} label={t.admin.wallets} value={money(d.money.wallets_total, lang)} tone="text-olive" />
          <Tile i={2} label={t.admin.tx24} value={String(d.activity.tx_24h)} />
          <Tile i={3} label={t.admin.newUsers} value={String(d.users.new_7d)} tone="text-sky" />
        </div>
      )}
      <div className="mt-6 grid gap-6 lg:grid-cols-[1.4fr_1fr]">
        <section className="card p-5">
          <h2 className="mb-4 text-lg">{t.admin.vol}</h2>
          {d ? (
            <AreaChart labels={d.series.map((s: any) => s.day)} series={[{ name: t.admin.vol, color: 'rgb(var(--stitch))', values: d.series.map((s: any) => Number(s.volume)) }]} format={(n) => money(n, lang)} />
          ) : (
            <Skeleton className="h-48" />
          )}
          {d && (
            <div className="mt-4 flex flex-wrap gap-2 text-sm">
              {(['user', 'merchant', 'exchange', 'admin'] as const).map((k) => (
                <Badge key={k}>
                  {t.admin.roles[k]} <span className="num">{d.users[k === 'user' ? 'users' : k === 'merchant' ? 'merchants' : k === 'exchange' ? 'exchanges' : 'admins']}</span>
                </Badge>
              ))}
              <Badge tone="good">
                {t.admin.with2fa} <span className="num">{d.users.with_2fa}</span>
              </Badge>
              <Badge tone="bad">
                {t.admin.suspended} <span className="num">{d.users.suspended}</span>
              </Badge>
            </div>
          )}
        </section>
        <section className="card p-5">
          <div className="mb-4 flex items-center justify-between">
            <h2 className="flex items-center gap-2 text-lg">
              <Scale className="h-5 w-5 text-gold" /> {t.admin.reconcile}
            </h2>
            <Button
              size="sm"
              variant="secondary"
              icon={<RefreshCw className="h-4 w-4" />}
              onClick={async () => {
                try {
                  await post('/api/admin/bank-operations/reconcile');
                  void rec.reload();
                  void ov.reload();
                  toast(t.common.done);
                } catch (e) {
                  toast(err(e), 'error');
                }
              }}
            >
              {t.admin.reconcileRun}
            </Button>
          </div>
          {!r ? (
            <Skeleton className="h-40" />
          ) : (
            <dl className="space-y-2 text-sm">
              {[
                [t.admin.walletsTotal, r.walletsTotal],
                [t.admin.vouchers, r.vouchersInEscrow],
                [t.admin.escrow, r.escrowHeld],
                [t.admin.pendingDeposits, r.pendingDeposits],
              ].map(([k, v]) => (
                <div key={k} className="flex justify-between">
                  <dt className="text-muted">{k}</dt>
                  <dd className="num">{money(v, lang)}</dd>
                </div>
              ))}
              <div className="flex justify-between border-t border-dashed border-line pt-2 font-medium">
                <dt>{t.common.total}</dt>
                <dd className="num">{money(inSystem, lang)}</dd>
              </div>
              <div className="flex justify-between rounded-xl bg-sunk p-3">
                <dt>{t.admin.exchangeAcc}</dt>
                <dd className="num font-display text-lg">{r.exchangeAccount ? money(r.exchangeAccount.balance, lang) : '—'}</dd>
              </div>
              {r.bankError && <ErrorNote>{r.bankError}</ErrorNote>}
            </dl>
          )}
          {d && (
            <p className="mt-4 text-sm text-muted">
              {t.admin.bankOps}: <span className="num">{d.bankOperations.pending}</span> {t.admin.pendingOps}, <span className="num">{d.bankOperations.failed}</span> {t.admin.failedOps}
            </p>
          )}
        </section>
      </div>
    </div>
  );
}

export function AdminUsers() {
  const { t, lang, err } = useI18n();
  const { user } = useAuth();
  const toast = useToast();
  const [q, setQ] = useState('');
  const [role, setRole] = useState('');
  const [data, setData] = useState<{ users: any[]; total: number } | null>(null);
  const [create, setCreate] = useState(false);
  const [f, setF] = useState({ fullName: '', email: '', password: '', role: 'user', adminLevel: 'admin' });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const load = async () => {
    const p = new URLSearchParams({ limit: '50' });
    if (q.trim()) p.set('q', q.trim());
    if (role) p.set('role', role);
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
  const isSuper = user?.admin_level === 'super_admin';
  return (
    <div>
      <PageHeader title={t.admin.users} actions={<Button icon={<UserPlus className="h-4 w-4" />} onClick={() => setCreate(true)}>{t.admin.createUser}</Button>} />
      <div className="mb-4 flex flex-wrap gap-3">
        <label className="relative min-w-[220px] flex-1">
          <Search className="pointer-events-none absolute start-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted" />
          <input value={q} onChange={(e) => setQ(e.target.value)} placeholder={t.common.search} className="field ps-9" />
        </label>
        <select value={role} onChange={(e) => setRole(e.target.value)} className="field w-auto" aria-label={t.admin.role}>
          <option value="">{t.common.all}</option>
          {Object.entries(t.admin.roles).map(([k, v]) => (
            <option key={k} value={k}>
              {v}
            </option>
          ))}
        </select>
      </div>
      <div className="card overflow-x-auto">
        <table className="w-full min-w-[640px] text-sm">
          <thead className="text-start text-muted">
            <tr className="border-b border-line">
              <th className="p-3 text-start font-medium">{t.auth.fullName}</th>
              <th className="p-3 text-start font-medium">{t.admin.role}</th>
              <th className="p-3 text-start font-medium">{t.common.status}</th>
              <th className="p-3 text-end font-medium">{t.home.balance}</th>
            </tr>
          </thead>
          <tbody>
            {!data
              ? null
              : data.users.map((u) => (
                  <tr key={u.id} className="border-b border-line/60 last:border-0 hover:bg-sunk/60">
                    <td className="p-3">
                      <Link to={`/app/admin/users/${u.id}`} className="flex items-center gap-3">
                        <Avatar name={u.full_name} src={u.profile_image} size={34} />
                        <span className="min-w-0">
                          <span className="block truncate font-medium">{u.full_name}</span>
                          <span className="block truncate text-xs text-muted">{u.email}</span>
                        </span>
                      </Link>
                    </td>
                    <td className="p-3">
                      {t.admin.roles[u.role] ?? u.role}
                      {u.admin_level === 'super_admin' && ' ★'}
                    </td>
                    <td className="p-3">
                      <Badge tone={u.status === 'active' ? 'good' : 'bad'}>{u.status === 'active' ? t.admin.active : t.admin.suspended}</Badge>
                    </td>
                    <td className="num p-3 text-end">{money(u.balance ?? 0, lang)}</td>
                  </tr>
                ))}
          </tbody>
        </table>
        {!data && <Skeleton className="m-4 h-24" />}
      </div>
      <Sheet open={create} onClose={() => setCreate(false)} title={t.admin.createUser}>
        <form
          className="space-y-4"
          onSubmit={async (e) => {
            e.preventDefault();
            setBusy(true);
            setError(null);
            try {
              await post('/api/admin/users', { fullName: f.fullName.trim(), email: f.email.trim(), password: f.password, role: f.role, ...(f.role === 'admin' ? { adminLevel: f.adminLevel } : {}) });
              setCreate(false);
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
          <select value={f.role} onChange={(e) => setF({ ...f, role: e.target.value })} className="field" aria-label={t.admin.role}>
            {Object.entries(t.admin.roles)
              .filter(([k]) => k !== 'admin' || isSuper)
              .map(([k, v]) => (
                <option key={k} value={k}>
                  {v}
                </option>
              ))}
          </select>
          {f.role === 'admin' && (
            <select value={f.adminLevel} onChange={(e) => setF({ ...f, adminLevel: e.target.value })} className="field" aria-label={t.admin.adminLevel}>
              <option value="admin">admin</option>
              <option value="super_admin">super_admin</option>
            </select>
          )}
          <ErrorNote>{error}</ErrorNote>
          <Button block loading={busy}>
            {t.admin.createUser}
          </Button>
        </form>
      </Sheet>
    </div>
  );
}

export function AdminUserDetail() {
  const { id } = useParams();
  const { t, lang, err } = useI18n();
  const { user: me } = useAuth();
  const toast = useToast();
  const { data, reload } = useData<any>(`/api/admin/users/${id}`, [id]);
  const run = async (fn: () => Promise<unknown>) => {
    try {
      await fn();
      toast(t.common.done);
      void reload();
    } catch (e) {
      toast(err(e), 'error');
    }
  };
  if (!data) return <Skeleton className="h-64 rounded-2xl" />;
  const u = data.user;
  const self = String(u.id) === String(me?.id);
  return (
    <div className="grid gap-6 lg:grid-cols-[1fr_1.2fr]">
      <section className="card h-fit p-6">
        <div className="flex items-center gap-4">
          <Avatar name={u.full_name} src={u.profile_image} size={64} />
          <div className="min-w-0">
            <h1 className="truncate text-2xl">{u.full_name}</h1>
            <p className="truncate text-muted">{u.email}</p>
          </div>
        </div>
        <div className="mt-4 flex flex-wrap gap-2">
          <Badge>{t.admin.roles[u.role]}</Badge>
          <Badge tone={u.status === 'active' ? 'good' : 'bad'}>{u.status === 'active' ? t.admin.active : t.admin.suspended}</Badge>
          {u.totp_enabled && <Badge tone="good">2FA</Badge>}
        </div>
        {data.wallet && (
          <div className="mt-6 rounded-2xl bg-sunk p-4">
            <p className="num text-sm text-muted">{data.wallet.wallet_id}</p>
            <p className="num font-display text-3xl">{money(data.wallet.balance, lang)}</p>
            {data.wallet.is_frozen && <Badge tone="bad">frozen</Badge>}
          </div>
        )}
        {data.bankLink && (
          <p className="num mt-3 text-sm text-muted">
            TalerBank · {data.bankLink.bank_iban}
          </p>
        )}
        {!self && (
          <div className="mt-6 grid gap-2">
            <select
              value={u.role}
              onChange={(e) => run(() => patch(`/api/admin/users/${u.id}`, { role: e.target.value }))}
              className="field"
              aria-label={t.admin.role}
            >
              {Object.entries(t.admin.roles).map(([k, v]) => (
                <option key={k} value={k}>
                  {v}
                </option>
              ))}
            </select>
            <Button variant={u.status === 'active' ? 'danger' : 'primary'} onClick={() => run(() => patch(`/api/admin/users/${u.id}`, { status: u.status === 'active' ? 'suspended' : 'active' }))}>
              {u.status === 'active' ? t.admin.suspend : t.admin.activate}
            </Button>
            {data.wallet && (
              <Button variant="secondary" onClick={() => run(() => post(`/api/admin/wallets/${data.wallet.wallet_id}/freeze`, { frozen: !data.wallet.is_frozen }))}>
                {data.wallet.is_frozen ? t.admin.unfreeze : t.admin.freeze}
              </Button>
            )}
            <Button variant="secondary" onClick={() => run(() => post(`/api/admin/users/${u.id}/revoke-sessions`))}>
              {t.admin.revokeSessions}
            </Button>
            <Button variant="secondary" onClick={() => run(() => post(`/api/admin/users/${u.id}/send-reset`))}>
              {t.admin.sendReset}
            </Button>
            {u.totp_enabled && (
              <Button variant="secondary" onClick={() => run(() => post(`/api/admin/users/${u.id}/reset-2fa`, {}))}>
                {t.admin.reset2fa}
              </Button>
            )}
            <Button variant="danger" onClick={() => run(() => del(`/api/admin/users/${u.id}`))}>
              {t.admin.deleteUser}
            </Button>
          </div>
        )}
      </section>
      <section className="card h-fit p-3">
        <h2 className="px-3 pt-2 text-lg">{t.home.recent}</h2>
        <ul>
          {data.transactions.map((tx: any, i: number) => (
            <TxRow key={tx.id} index={i} tx={{ ...tx, counterparty_name: null, from_account: null, to_account: null, balance_after: null, reference: null }} />
          ))}
        </ul>
        <p className="px-3 pb-2 text-xs text-muted">{date(u.created_at, lang)}</p>
      </section>
    </div>
  );
}

export function AdminStores() {
  const { t, lang, err } = useI18n();
  const toast = useToast();
  const { data, reload } = useData<{ stores: any[] }>('/api/admin/stores');
  return (
    <div>
      <PageHeader title={t.nav.stores} />
      <div className="grid gap-3 sm:grid-cols-2">
        {data?.stores.map((s) => (
          <div key={s.id} className="card p-5">
            <div className="flex items-start justify-between gap-3">
              <div>
                <p className="font-display text-lg">{s.store_name}</p>
                <p className="text-sm text-muted">
                  {t.admin.owner}: {s.owner ?? '—'}
                </p>
              </div>
              <Badge tone={s.status === 'active' ? 'good' : 'bad'}>{s.status === 'active' ? t.admin.active : t.admin.suspended}</Badge>
            </div>
            <p className="mt-3 text-sm">
              {t.admin.products}: <span className="num">{s.products}</span> · {t.merchant.revenue}: <span className="num">{money(s.revenue, lang)}</span>
            </p>
            <Button
              size="sm"
              className="mt-4"
              variant={s.status === 'active' ? 'danger' : 'secondary'}
              onClick={async () => {
                try {
                  await patch(`/api/admin/stores/${s.id}`, { status: s.status === 'active' ? 'suspended' : 'active' });
                  void reload();
                } catch (e) {
                  toast(err(e), 'error');
                }
              }}
            >
              {s.status === 'active' ? t.admin.suspend : t.admin.activate}
            </Button>
          </div>
        ))}
      </div>
    </div>
  );
}

export function AdminPending() {
  const { t, lang } = useI18n();
  const { data, reload } = useData<{ pendingUsers: any[] }>('/api/admin/pending-users');
  return (
    <div>
      <PageHeader title={t.nav.pending} actions={<Button variant="secondary" onClick={() => del('/api/admin/pending-users').then(reload)}>{t.admin.clearExpired}</Button>} />
      <div className="card divide-y divide-line">
        {data?.pendingUsers.length ? (
          data.pendingUsers.map((p) => (
            <div key={p.id} className="flex flex-wrap items-center gap-3 p-4">
              <div className="min-w-0 flex-1">
                <p className="font-medium">{p.full_name}</p>
                <p className="text-sm text-muted">{p.email}</p>
              </div>
              <span className="text-sm text-muted">
                {t.admin.attempts}: <span className="num">{p.attempts}</span> · {t.admin.expires} {p.expires_at ? relative(p.expires_at, lang) : '—'}
              </span>
              <Button size="sm" variant="danger" onClick={() => del(`/api/admin/pending-users/${p.id}`).then(reload)}>
                {t.common.delete}
              </Button>
            </div>
          ))
        ) : (
          <p className="p-8 text-center text-muted">{t.common.empty}</p>
        )}
      </div>
    </div>
  );
}

export function AdminBankOps() {
  const { t, lang } = useI18n();
  const { data } = useData<{ operations: any[] }>('/api/admin/bank-operations');
  return (
    <div>
      <PageHeader title={t.nav.bankOps} />
      <div className="card overflow-x-auto">
        <table className="w-full min-w-[640px] text-sm">
          <tbody>
            {data?.operations.map((o) => (
              <tr key={o.id} className="border-b border-line/60 last:border-0">
                <td className="p-3">{t.bank.kinds[o.kind] ?? o.kind}</td>
                <td className="p-3 text-muted">{o.email}</td>
                <td className="num p-3">{money(o.amount, lang)}</td>
                <td className="p-3">
                  <Badge tone={o.status === 'completed' ? 'good' : o.status === 'pending' ? 'warn' : 'bad'}>{t.bank.opStatus[o.status] ?? o.status}</Badge>
                </td>
                <td className="p-3 text-muted">{o.error ?? ''}</td>
                <td className="p-3 text-muted">{relative(o.created_at, lang)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

export function AdminAudit() {
  const { t, lang } = useI18n();
  const [filter, setFilter] = useState('');
  const { data } = useData<{ events: any[] }>(`/api/admin/audit?limit=100${filter ? `&action=${encodeURIComponent(filter)}` : ''}`, [filter]);
  return (
    <div>
      <PageHeader title={t.nav.audit} />
      <div className="mb-4">
        <Segmented
          value={filter}
          onChange={setFilter}
          options={[
            { value: '', label: t.common.all },
            { value: 'auth.', label: 'auth' },
            { value: 'bank.', label: 'bank' },
            { value: 'admin.', label: 'admin' },
            { value: 'wallet.', label: 'wallet' },
          ]}
        />
      </div>
      <div className="card divide-y divide-line">
        {data?.events.map((e) => (
          <div key={e.id} className="flex flex-wrap items-center gap-3 px-4 py-3 text-sm">
            <CheckCircle2 className="h-4 w-4 text-olive" />
            <code className="num">{e.action}</code>
            <span className="text-muted">{e.email ?? '—'}</span>
            <span className="num ms-auto text-muted">{e.ip_address}</span>
            <span className="text-muted">{relative(e.created_at, lang)}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

export function AdminSettings() {
  const { t, err } = useI18n();
  const toast = useToast();
  const { data } = useData<{ settings: any }>('/api/admin/settings');
  const [s, setS] = useState<any>(null);
  useEffect(() => {
    if (data) setS(data.settings);
  }, [data]);
  if (!s) return <Skeleton className="h-64 rounded-2xl" />;
  return (
    <div className="mx-auto max-w-2xl">
      <PageHeader title={t.nav.system} />
      <form
        className="card space-y-4 p-6"
        onSubmit={async (e) => {
          e.preventDefault();
          try {
            await put('/api/admin/settings', {
              siteName: s.site_name,
              maintenanceMode: s.maintenance_mode,
              allowRegistrations: s.allow_registrations,
              announcement: s.announcement || null,
            });
            toast(t.common.saved);
          } catch (e2) {
            toast(err(e2), 'error');
          }
        }}
      >
        <Field label={t.admin.siteName} value={s.site_name ?? ''} onChange={(e) => setS({ ...s, site_name: e.target.value })} />
        <Toggle checked={!!s.maintenance_mode} onChange={(v) => setS({ ...s, maintenance_mode: v })} label={t.admin.maintenance} description={t.admin.maintenanceD} />
        <Toggle checked={!!s.allow_registrations} onChange={(v) => setS({ ...s, allow_registrations: v })} label={t.admin.registrations} />
        <Field label={t.admin.announcement} value={s.announcement ?? ''} onChange={(e) => setS({ ...s, announcement: e.target.value })} maxLength={280} />
        <Button>{t.common.save}</Button>
      </form>
    </div>
  );
}
