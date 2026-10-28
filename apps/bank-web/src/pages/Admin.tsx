import { useEffect, useState, type ReactNode } from 'react';
import { Link, useParams } from 'react-router-dom';
import { Banknote, ChevronLeft, Search, Users } from 'lucide-react';
import { ApiError, get, patch, post, put } from '../lib/api';
import { useI18n } from '../lib/i18n';
import { useData } from '../lib/hooks';
import { useAuth } from '../lib/auth';
import { AMOUNT_RE, date, money, relative } from '../lib/format';
import { fmtIban } from '../components/Bank';
import { AreaChart } from '../components/Chart';
import { useSecureAction } from '../components/SecureAction';
import { useToast } from '../components/Toast';
import { AmountInput, Avatar, Badge, Button, EmptyState, ErrorNote, Field, PageHeader, Segmented, Sheet, Skeleton, Toggle, cx } from '../components/ui';

function Stat({ label, value, tone }: { label: string; value: ReactNode; tone?: 'gold' | 'olive' | 'stitch' }) {
  return (
    <div className="card p-5">
      <p className="text-sm text-muted">{label}</p>
      <p className={cx('num mt-2 font-display text-3xl', tone === 'gold' && 'text-gold', tone === 'olive' && 'text-olive', tone === 'stitch' && 'text-stitch')}>{value}</p>
    </div>
  );
}

function Loading() {
  return (
    <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
      {Array.from({ length: 4 }).map((_, i) => (
        <Skeleton key={i} className="h-28 rounded-2xl" />
      ))}
    </div>
  );
}

const PAGE = 30;
function usePaged<T>(path: string, key: string, params: Record<string, string>) {
  const [items, setItems] = useState<T[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<unknown>(null);
  const qs = (offset: number) => {
    const p = new URLSearchParams({ limit: String(PAGE), offset: String(offset) });
    for (const [k, v] of Object.entries(params)) if (v) p.set(k, v);
    return p.toString();
  };
  const load = async (offset: number) => {
    setLoading(true);
    try {
      const d = await get<any>(`${path}?${qs(offset)}`);
      setItems((p) => (offset ? [...p, ...d[key]] : d[key]));
      setTotal(d.total);
      setError(null);
    } catch (e) {
      setError(e);
    } finally {
      setLoading(false);
    }
  };
  const sig = JSON.stringify(params);
  useEffect(() => {
    const h = setTimeout(() => void load(0), 250);
    return () => clearTimeout(h);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sig]);
  return { items, total, loading, error, more: () => load(items.length), reload: () => load(0) };
}

export function AdminOverview() {
  const { t, lang } = useI18n();
  const { data: d } = useData<any>('/api/admin/overview');
  if (!d) return <Loading />;
  return (
    <div>
      <PageHeader title={t.admin.overview} />
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <Stat label={t.admin.deposits} value={money(d.money.customer_deposits, lang)} tone="gold" />
        <Stat label={t.admin.exchange} value={money(d.money.exchange_balance, lang)} />
        <Stat label={t.admin.central} value={money(d.money.central_balance, lang)} />
        <Stat label={t.admin.volume} value={money(d.activity.volume_7d, lang)} tone="olive" />
        <Stat label={t.admin.customers} value={d.users.customers} />
        <Stat label={t.admin.with2fa} value={`${d.users.with_2fa}`} />
        <Stat label={t.admin.tx24} value={d.activity.tx_24h} />
        <Stat label={t.admin.pending} value={d.pendingWithdrawals} tone={d.money.frozen_accounts ? 'stitch' : undefined} />
      </div>
      <div className="mt-6 grid grid-cols-[minmax(0,1fr)] gap-6 lg:grid-cols-[minmax(0,1.6fr)_minmax(0,1fr)]">
        <section className="card p-5">
          <h2 className="mb-3 text-xl">{t.admin.volume14}</h2>
          <AreaChart
            labels={d.series.map((s: any) => s.day.slice(5))}
            series={[{ name: t.admin.series, color: 'rgb(var(--brass))', values: d.series.map((s: any) => Number(s.volume)) }]}
            format={(n) => money(n, lang)}
          />
        </section>
        <section className="card p-5">
          <h2 className="mb-3 text-xl">{t.admin.recent}</h2>
          <ul className="space-y-3 text-sm">
            {d.recent.map((e: any, i: number) => (
              <li key={i} className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <p className="num truncate font-medium">{e.action}</p>
                  <p className="truncate text-xs text-muted">{e.email ?? '—'}</p>
                </div>
                <span className="shrink-0 text-xs text-muted">{relative(e.created_at, lang)}</span>
              </li>
            ))}
          </ul>
        </section>
      </div>
    </div>
  );
}

export function AdminCustomers() {
  const { t, lang, err } = useI18n();
  const [q, setQ] = useState('');
  const [status, setStatus] = useState<'' | 'active' | 'suspended'>('');
  const list = usePaged<any>('/api/admin/users', 'users', { q, status });
  return (
    <div>
      <PageHeader title={t.admin.customers} />
      <div className="card mb-4 flex flex-wrap items-center gap-3 p-4">
        <label className="relative min-w-[220px] flex-1">
          <span className="sr-only">{t.common.search}</span>
          <Search className="pointer-events-none absolute start-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted" />
          <input value={q} onChange={(e) => setQ(e.target.value)} placeholder={t.common.search} className="field ps-9" />
        </label>
        <Segmented
          value={status || 'all'}
          onChange={(v) => setStatus(v === 'all' ? '' : (v as any))}
          options={[
            { value: 'all', label: t.common.all },
            { value: 'active', label: t.admin.active },
            { value: 'suspended', label: t.admin.suspended },
          ]}
        />
      </div>
      {list.error ? <ErrorNote>{err(list.error)}</ErrorNote> : null}
      <div className="card overflow-hidden">
        {!list.items.length && !list.loading ? (
          <EmptyState icon={<Users className="h-6 w-6" />} title={t.common.empty} />
        ) : (
          <ul className="divide-y divide-line">
            {list.items.map((u) => (
              <li key={u.id}>
                <Link to={`/app/admin/customers/${u.id}`} className="flex items-center gap-3 px-4 py-3 transition hover:bg-sunk">
                  <Avatar name={u.full_name} size={40} />
                  <div className="min-w-0 flex-1">
                    <p className="truncate font-medium">{u.full_name}</p>
                    <p className="num truncate text-xs text-muted">
                      @{u.username} · {u.email}
                    </p>
                  </div>
                  <div className="hidden text-end sm:block">
                    <p className="num font-medium">{money(u.total_balance, lang)}</p>
                    <p className="text-xs text-muted">{u.last_login_at ? relative(u.last_login_at, lang) : '—'}</p>
                  </div>
                  <div className="flex flex-col items-end gap-1">
                    {u.role === 'admin' && <Badge tone="info">{t.admin.roles.admin}</Badge>}
                    <Badge tone={u.status === 'active' ? 'good' : 'bad'}>{u.status === 'active' ? t.admin.active : t.admin.suspended}</Badge>
                  </div>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </div>
      {list.items.length < list.total && (
        <div className="mt-4 text-center">
          <Button variant="secondary" loading={list.loading} onClick={list.more}>
            {t.common.more}
          </Button>
        </div>
      )}
    </div>
  );
}

export function AdminCustomer() {
  const { id } = useParams();
  const { t, lang, err } = useI18n();
  const { user: me } = useAuth();
  const toast = useToast();
  const secure = useSecureAction();
  const { data, reload, error } = useData<any>(`/api/admin/users/${id}`, [id]);
  const [teller, setTeller] = useState<any>(null);
  const [dir, setDir] = useState<'in' | 'out'>('in');
  const [amount, setAmount] = useState('');
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const [tErr, setTErr] = useState<string | null>(null);

  const run = async (fn: () => Promise<unknown>) => {
    try {
      await fn();
      toast(t.common.saved);
      void reload();
    } catch (e) {
      if (!(e instanceof ApiError && e.code === 'CANCELLED')) toast(err(e), 'error');
    }
  };
  if (error) return <ErrorNote>{err(error)}</ErrorNote>;
  if (!data) return <Loading />;
  const u = data.user;
  const self = me?.id === u.id;
  return (
    <div>
      {secure.element}
      <Link to="/app/admin/customers" className="mb-4 inline-flex items-center gap-1 text-sm text-muted hover:text-ink">
        <ChevronLeft className="h-4 w-4 flip-rtl" /> {t.admin.customers}
      </Link>
      <div className="card engraved flex flex-wrap items-center gap-4 p-6">
        <Avatar name={u.full_name} size={64} />
        <div className="min-w-0 flex-1">
          <h1 className="font-display text-3xl">{u.full_name}</h1>
          <p className="num text-sm text-muted">
            @{u.username} · {u.email} {u.phone ? `· ${u.phone}` : ''}
          </p>
          <div className="mt-2 flex flex-wrap gap-1.5">
            <Badge tone={u.status === 'active' ? 'good' : 'bad'}>{u.status === 'active' ? t.admin.active : t.admin.suspended}</Badge>
            <Badge tone="info">{t.admin.roles[u.role] ?? u.role}</Badge>
            {u.totp_enabled && <Badge tone="good">2FA</Badge>}
          </div>
        </div>
        {!self && (
          <div className="flex flex-wrap gap-2">
            <Button size="sm" variant={u.status === 'active' ? 'danger' : 'secondary'} onClick={() => run(() => patch(`/api/admin/users/${u.id}`, { status: u.status === 'active' ? 'suspended' : 'active' }))}>
              {u.status === 'active' ? t.admin.suspend : t.admin.activate}
            </Button>
            <Button size="sm" variant="secondary" onClick={() => run(() => post(`/api/admin/users/${u.id}/revoke-sessions`))}>
              {t.admin.revokeSessions}
            </Button>
            {u.totp_enabled && (
              <Button size="sm" variant="secondary" onClick={() => run(() => secure.run((totp) => post(`/api/admin/users/${u.id}/reset-2fa`, totp ? { totp } : {})))}>
                {t.admin.reset2fa}
              </Button>
            )}
            <Button size="sm" variant="ghost" onClick={() => run(() => patch(`/api/admin/users/${u.id}`, { role: u.role === 'admin' ? 'user' : 'admin' }))}>
              {u.role === 'admin' ? t.admin.makeCustomer : t.admin.makeAdmin}
            </Button>
          </div>
        )}
      </div>

      <h2 className="mb-3 mt-8 text-xl">{t.admin.accounts}</h2>
      <div className="grid gap-4 md:grid-cols-2">
        {data.accounts.map((a: any) => (
          <div key={a.id} className="card p-5">
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <p className="num text-sm text-muted">{a.account_number}</p>
                <p className="num truncate text-sm">{fmtIban(a.iban)}</p>
              </div>
              {a.is_locked && <Badge tone="bad">{t.admin.freeze}</Badge>}
            </div>
            <p className="num mt-3 font-display text-3xl">{money(a.balance, lang, a.currency)}</p>
            <div className="mt-4 flex flex-wrap gap-2">
              <Button size="sm" icon={<Banknote className="h-4 w-4" />} onClick={() => (setTeller(a), setTErr(null))}>
                {t.admin.teller}
              </Button>
              <Button size="sm" variant={a.is_locked ? 'secondary' : 'danger'} onClick={() => run(() => post(`/api/admin/accounts/${a.id}/freeze`, { frozen: !a.is_locked }))}>
                {a.is_locked ? t.admin.unfreeze : t.admin.freeze}
              </Button>
            </div>
          </div>
        ))}
      </div>

      <div className="mt-8 grid grid-cols-[minmax(0,1fr)] gap-6 lg:grid-cols-[minmax(0,1.5fr)_minmax(0,1fr)]">
        <section className="card p-4">
          <h2 className="mb-2 px-1 text-xl">{t.nav.transactions}</h2>
          <ul className="divide-y divide-line text-sm">
            {data.transactions.map((x: any) => (
              <li key={x.id} className="flex items-center justify-between gap-3 px-1 py-2.5">
                <div className="min-w-0">
                  <p className="truncate">{x.subject || t.tx.types[x.type] || x.type}</p>
                  <p className="text-xs text-muted">{date(x.created_at, lang)}</p>
                </div>
                <span className={cx('num shrink-0 font-medium', x.direction === 'in' ? 'text-olive' : '')}>
                  {x.direction === 'in' ? '+' : '−'}
                  {money(x.amount, lang)}
                </span>
              </li>
            ))}
          </ul>
        </section>
        <section className="card h-fit p-4">
          <h2 className="mb-2 px-1 text-xl">{t.admin.apps}</h2>
          {data.linkedApps.length ? (
            <ul className="divide-y divide-line text-sm">
              {data.linkedApps.map((a: any) => (
                <li key={a.id} className="px-1 py-2.5">
                  <p className="font-medium">{a.client_name}</p>
                  <p className="text-xs text-muted">{a.last_used_at ? relative(a.last_used_at, lang) : '—'}</p>
                </li>
              ))}
            </ul>
          ) : (
            <p className="px-1 text-sm text-muted">{t.common.empty}</p>
          )}
        </section>
      </div>

      <Sheet open={!!teller} onClose={() => setTeller(null)} title={t.admin.teller}>
        <form
          className="space-y-4"
          onSubmit={async (e) => {
            e.preventDefault();
            if (!AMOUNT_RE.test(amount) || Number(amount) <= 0) return setTErr(t.common.amount);
            setBusy(true);
            setTErr(null);
            try {
              await secure.run((totp) => post('/api/admin/teller', { accountId: teller.id, amount, direction: dir, note: note.trim(), ...(totp ? { totp } : {}) }));
              setTeller(null);
              setAmount('');
              setNote('');
              toast(t.common.saved);
              void reload();
            } catch (e2) {
              if (!(e2 instanceof ApiError && e2.code === 'CANCELLED')) setTErr(err(e2));
            } finally {
              setBusy(false);
            }
          }}
        >
          <Segmented value={dir} onChange={setDir} options={[{ value: 'in', label: t.admin.cashIn }, { value: 'out', label: t.admin.cashOut }]} />
          <AmountInput label={t.common.amount} value={amount} onChange={setAmount} />
          <Field label={t.admin.tellerNote} value={note} onChange={(e) => setNote(e.target.value)} minLength={3} maxLength={140} required />
          <ErrorNote>{tErr}</ErrorNote>
          <Button block size="lg" loading={busy}>
            {t.admin.book}
          </Button>
        </form>
      </Sheet>
    </div>
  );
}

export function AdminLedger() {
  const { t, lang, err } = useI18n();
  const [q, setQ] = useState('');
  const [type, setType] = useState('');
  const list = usePaged<any>('/api/admin/transactions', 'transactions', { q, type });
  return (
    <div>
      <PageHeader title={t.nav.ledger} />
      <div className="card mb-4 grid gap-3 p-4 sm:grid-cols-2">
        <label className="relative">
          <span className="sr-only">{t.common.search}</span>
          <Search className="pointer-events-none absolute start-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted" />
          <input value={q} onChange={(e) => setQ(e.target.value)} placeholder={t.tx.searchPh} className="field ps-9" />
        </label>
        <select value={type} onChange={(e) => setType(e.target.value)} className="field" aria-label="Type">
          <option value="">{t.common.all}</option>
          {Object.entries(t.tx.types).map(([k, v]) => (
            <option key={k} value={k}>
              {v}
            </option>
          ))}
        </select>
      </div>
      {list.error ? <ErrorNote>{err(list.error)}</ErrorNote> : null}
      <div className="card overflow-x-auto">
        <table className="w-full min-w-[720px] text-sm">
          <thead className="text-start text-muted">
            <tr className="border-b border-line">
              <th className="px-4 py-3 text-start font-medium">{t.common.date}</th>
              <th className="px-4 py-3 text-start font-medium">{t.common.from}</th>
              <th className="px-4 py-3 text-start font-medium">{t.common.to}</th>
              <th className="px-4 py-3 text-start font-medium">{t.common.note}</th>
              <th className="px-4 py-3 text-end font-medium">{t.common.amount}</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-line">
            {list.items.map((x) => (
              <tr key={x.id} className="hover:bg-sunk">
                <td className="whitespace-nowrap px-4 py-3 text-muted">{date(x.created_at, lang)}</td>
                <td className="px-4 py-3">{x.from_name ?? '—'}</td>
                <td className="px-4 py-3">{x.to_name ?? '—'}</td>
                <td className="max-w-[220px] truncate px-4 py-3" title={x.subject ?? ''}>
                  <span className="text-muted">{t.tx.types[x.type] ?? x.type}</span> {x.subject ? `· ${x.subject}` : ''}
                </td>
                <td className="num whitespace-nowrap px-4 py-3 text-end font-medium">{money(x.amount, lang, x.currency)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {list.items.length < list.total && (
        <div className="mt-4 text-center">
          <Button variant="secondary" loading={list.loading} onClick={list.more}>
            {t.common.more}
          </Button>
        </div>
      )}
    </div>
  );
}

export function AdminExchange() {
  const { t, lang } = useI18n();
  const { data } = useData<any>('/api/admin/exchange');
  if (!data) return <Loading />;
  return (
    <div>
      <PageHeader title={t.nav.exchange} />
      <div className="card engraved p-6">
        <p className="text-sm text-muted">{t.admin.exchange}</p>
        <p className="num mt-1 font-display text-5xl text-gold">{money(data.account.balance, lang)}</p>
        <p className="num mt-2 break-all text-sm text-muted">{fmtIban(data.account.iban)}</p>
        <p className="num break-all text-xs text-muted">{data.account.payto}</p>
      </div>
      <div className="mt-6 grid gap-6 lg:grid-cols-2">
        <section className="card p-4">
          <h2 className="mb-2 px-1 text-xl">{t.admin.reserves}</h2>
          <ul className="divide-y divide-line text-sm">
            {data.reserves.map((r: any) => (
              <li key={r.reserve_pub} className="flex items-center justify-between gap-3 px-1 py-2.5">
                <div className="min-w-0">
                  <p className="num truncate">{r.reserve_pub.slice(0, 20)}…</p>
                  <p className="text-xs text-muted">
                    {r.full_name ?? '—'} · {relative(r.created_at, lang)}
                  </p>
                </div>
                <div className="text-end">
                  <p className="num font-medium">{money(r.amount, lang)}</p>
                  <Badge tone={r.status === 'withdrawn' || r.status === 'closed' ? 'neutral' : 'info'}>{r.status}</Badge>
                </div>
              </li>
            ))}
          </ul>
        </section>
        <section className="card p-4">
          <h2 className="mb-2 px-1 text-xl">{t.admin.wires}</h2>
          <ul className="divide-y divide-line text-sm">
            {data.wires.map((w: any) => (
              <li key={w.id} className="flex items-center justify-between gap-3 px-1 py-2.5">
                <div className="min-w-0">
                  <p className="truncate">{w.to_name ?? fmtIban(w.to_iban)}</p>
                  <p className="text-xs text-muted">{w.executed_at ? relative(w.executed_at, lang) : '—'}</p>
                </div>
                <div className="text-end">
                  <p className="num font-medium">{money(w.amount, lang)}</p>
                  <Badge tone={w.status === 'completed' ? 'good' : 'info'}>{w.status}</Badge>
                </div>
              </li>
            ))}
          </ul>
        </section>
      </div>
    </div>
  );
}

export function AdminAudit() {
  const { t, lang, err } = useI18n();
  const [action, setAction] = useState('');
  const list = usePaged<any>('/api/admin/audit', 'events', { action });
  const [open, setOpen] = useState<any>(null);
  return (
    <div>
      <PageHeader title={t.nav.audit} />
      <label className="relative mb-4 block">
        <span className="sr-only">{t.common.search}</span>
        <Search className="pointer-events-none absolute start-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted" />
        <input value={action} onChange={(e) => setAction(e.target.value)} placeholder="auth.login, transfer…" className="field ps-9" dir="ltr" />
      </label>
      {list.error ? <ErrorNote>{err(list.error)}</ErrorNote> : null}
      <div className="card overflow-hidden">
        <ul className="divide-y divide-line text-sm">
          {list.items.map((e) => (
            <li key={e.id}>
              <button onClick={() => setOpen(e)} className="flex w-full items-center justify-between gap-3 px-4 py-3 text-start hover:bg-sunk">
                <div className="min-w-0">
                  <p className="num truncate font-medium">{e.action}</p>
                  <p className="num truncate text-xs text-muted">
                    {e.email ?? '—'} · {e.ip_address ?? '—'}
                  </p>
                </div>
                <span className="shrink-0 text-xs text-muted">{date(e.created_at, lang)}</span>
              </button>
            </li>
          ))}
        </ul>
      </div>
      {list.items.length < list.total && (
        <div className="mt-4 text-center">
          <Button variant="secondary" loading={list.loading} onClick={list.more}>
            {t.common.more}
          </Button>
        </div>
      )}
      <Sheet open={!!open} onClose={() => setOpen(null)} title={open?.action ?? ''} wide>
        {open && <pre className="num max-h-[60vh] overflow-auto whitespace-pre-wrap break-all rounded-xl bg-sunk p-4 text-xs">{JSON.stringify(open, null, 2)}</pre>}
      </Sheet>
    </div>
  );
}

export function AdminSettings() {
  const { t, err } = useI18n();
  const toast = useToast();
  const { data, reload } = useData<{ settings: Record<string, any> }>('/api/admin/settings');
  const [s, setS] = useState<Record<string, any> | null>(null);
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    if (data) setS({ allow_registrations: data.settings.allow_registrations !== false, maintenance_mode: data.settings.maintenance_mode === true, bank_name: data.settings.bank_name ?? 'TalerBank' });
  }, [data]);
  if (!s) return <Loading />;
  return (
    <div className="mx-auto max-w-2xl">
      <PageHeader title={t.nav.system} />
      <form
        className="card space-y-5 p-6"
        onSubmit={async (e) => {
          e.preventDefault();
          setBusy(true);
          try {
            await put('/api/admin/settings', { ...s, bank_name: String(s.bank_name).trim() });
            toast(t.common.saved);
            void reload();
          } catch (e2) {
            toast(err(e2), 'error');
          } finally {
            setBusy(false);
          }
        }}
      >
        <Field label={t.admin.bankName} value={s.bank_name} onChange={(e) => setS({ ...s, bank_name: e.target.value })} minLength={2} maxLength={60} required />
        <Toggle checked={s.allow_registrations} onChange={(v) => setS({ ...s, allow_registrations: v })} label={t.admin.registrations} />
        <Toggle checked={s.maintenance_mode} onChange={(v) => setS({ ...s, maintenance_mode: v })} label={t.admin.maintenance} description={t.admin.maintenanceD} />
        <Button loading={busy}>{t.common.save}</Button>
      </form>
    </div>
  );
}
