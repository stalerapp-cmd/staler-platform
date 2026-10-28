import { useEffect, useState, type ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { Search, Users } from 'lucide-react';
import { get, put } from '../lib/api';
import { useI18n } from '../lib/i18n';
import { useData } from '../lib/hooks';
import { date, money, relative } from '../lib/format';
import { fmtIban } from '../components/Bank';
import { useConfirm } from '../components/Confirm';
import { usePerm } from '../lib/perm';
import { BroadcastCard } from './AdminPeople';
import { AreaChart } from '../components/Chart';
import { useToast } from '../components/Toast';
import { Avatar, Badge, Button, EmptyState, ErrorNote, Field, PageHeader, Segmented, Select, Sheet, Skeleton, Toggle, cx } from '../components/ui';

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
  const { can } = usePerm();
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
      {can('notify') && (
        <div className="mt-6">
          <BroadcastCard />
        </div>
      )}
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
        <Select
          block
          label={t.tx.typeLabel}
          value={type || 'all'}
          onChange={(v) => setType(v === 'all' ? '' : v)}
          options={[{ value: 'all', label: t.common.all }, ...Object.entries(t.tx.types).map(([k, v]) => ({ value: k, label: v }))]}
        />
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
  const confirm = useConfirm();
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
          if (!(await confirm({ title: t.ask.saveTitle, body: t.ask.saveBody, confirmLabel: t.common.save }))) return;
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
