import { useEffect, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { Check, ExternalLink, Eye, EyeOff, HandCoins, MapPin, Package, Pause, Phone, Play, Search, Store as StoreIcon, Trash2, UserRound } from 'lucide-react';
import { ProductImage } from '../components/Commerce';
import { StoreLogo } from './Stores';
import { del, patch, post, put } from '../lib/api';
import { useI18n } from '../lib/i18n';
import { useData } from '../lib/hooks';
import { date, fill, money } from '../lib/format';
import { useToast } from '../components/Toast';
import { useConfirm } from '../components/Confirm';
import { Avatar, Badge, Button, Chips, EmptyState, ErrorNote, Field, PageHeader, Select, Skeleton, TextArea, cx } from '../components/ui';

const tone = (s: string) => (s === 'active' ? 'good' : s === 'pending' ? 'warn' : 'bad') as 'good' | 'warn' | 'bad';

// ------------------------------------------------------------ cash agents
/** Every cash agent: pending requests first, approve or pause with one tap. */
export function AdminAgents() {
  const { t, lang, err } = useI18n();
  const toast = useToast();
  const confirm = useConfirm();
  const { data, reload, error } = useData<{ agents: any[] }>('/api/admin/agents');
  const [tab, setTab] = useState<'pending' | 'active' | 'all'>('pending');
  const C = t.ctl;
  if (error) return <ErrorNote>{err(error)}</ErrorNote>;
  const all = data?.agents ?? [];
  const pending = all.filter((a) => a.status === 'pending' || a.status === 'none');
  const list = tab === 'pending' ? pending : tab === 'active' ? all.filter((a) => a.status === 'active') : all;
  const setStatus = async (a: any, status: 'active' | 'suspended') => {
    if (status === 'suspended' && !(await confirm({ title: fill(C.pauseQ, { name: a.display_name ?? a.full_name }), body: C.pauseB, confirmLabel: C.pause, tone: 'danger' }))) return;
    try {
      await post(`/api/admin/agents/${a.id}/status`, { status });
      toast(status === 'active' ? C.approved : t.common.done);
      void reload();
    } catch (e) {
      toast(err(e), 'error');
    }
  };
  return (
    <div>
      <PageHeader title={C.agents} lead={C.agentsLead} />
      <Chips
        label={C.agents}
        value={tab}
        onChange={(v) => setTab(v as any)}
        options={[
          { value: 'pending', label: `${C.waiting}${pending.length ? ` (${pending.length})` : ''}` },
          { value: 'active', label: C.listed },
          { value: 'all', label: C.all },
        ]}
      />
      {!data ? (
        <Skeleton className="mt-4 h-40 rounded-2xl" />
      ) : !list.length ? (
        <EmptyState icon={<HandCoins className="h-6 w-6" />} title={tab === 'pending' ? C.noneWaiting : t.common.empty} />
      ) : (
        <ul className="mt-4 grid gap-3 lg:grid-cols-2">
          {list.map((a) => (
            <li key={a.id} className="card p-4">
              <div className="flex items-start gap-3">
                <Avatar name={a.display_name ?? a.full_name} src={a.profile_image} size={44} />
                <div className="min-w-0 flex-1">
                  <p className="truncate font-medium">{a.display_name ?? a.full_name}</p>
                  <p className="truncate text-xs text-muted" dir="ltr">
                    {a.email}
                  </p>
                </div>
                <Badge tone={tone(a.status)}>{a.status === 'none' ? C.noProfile : t.adm2.st[a.status as 'active'] ?? a.status}</Badge>
              </div>
              <dl className="mt-3 grid gap-1.5 text-sm">
                {(a.city || a.address) && (
                  <div className="flex items-start gap-2">
                    <MapPin className="mt-0.5 h-4 w-4 shrink-0 text-muted" />
                    <span className="min-w-0 break-words">{[a.city, a.address].filter(Boolean).join('، ')}</span>
                  </div>
                )}
                {a.phone && (
                  <div className="flex items-center gap-2">
                    <Phone className="h-4 w-4 shrink-0 text-muted" />
                    <span dir="ltr" className="num">
                      {a.phone}
                    </span>
                  </div>
                )}
                <div className="flex flex-wrap gap-2 pt-1 text-xs">
                  {a.cash_in && <span className="rounded-full bg-olive/12 px-2 py-0.5 text-olive">{t.ctl.cashIn}</span>}
                  {a.cash_out && <span className="rounded-full bg-gold/15 px-2 py-0.5">{t.ctl.cashOut}</span>}
                  {a.lat != null && (
                    <a className="rounded-full bg-sky/10 px-2 py-0.5 text-sky" href={`https://www.openstreetmap.org/?mlat=${a.lat}&mlon=${a.lng}#map=17/${a.lat}/${a.lng}`} target="_blank" rel="noreferrer">
                      {C.onMap}
                    </a>
                  )}
                  <span className="text-muted">
                    {C.balance}: <span className="num">{money(a.balance ?? 0, lang)}</span>
                  </span>
                </div>
              </dl>
              <div className="mt-4 flex flex-wrap gap-2">
                {a.status !== 'active' && a.status !== 'none' && (
                  <Button size="sm" icon={<Check className="h-4 w-4" />} onClick={() => setStatus(a, 'active')}>
                    {C.approve}
                  </Button>
                )}
                {a.status === 'active' && (
                  <Button size="sm" variant="danger" icon={<Pause className="h-4 w-4" />} onClick={() => setStatus(a, 'suspended')}>
                    {C.pause}
                  </Button>
                )}
                <Link to={`/app/admin/users/${a.id}`}>
                  <Button size="sm" variant="secondary" icon={<UserRound className="h-4 w-4" />}>
                    {C.account}
                  </Button>
                </Link>
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

// ---------------------------------------------------------------- stores
/** The store list: search, filter and open any store or branch. */
export function AdminStoreList() {
  const { t, lang, err } = useI18n();
  const { data, error } = useData<{ stores: any[] }>('/api/admin/stores');
  const [q, setQ] = useState('');
  const [st, setSt] = useState('all');
  const C = t.ctl;
  if (error) return <ErrorNote>{err(error)}</ErrorNote>;
  const rows = (data?.stores ?? []).filter(
    (s) => (st === 'all' || s.status === st) && (!q || `${s.store_name} ${s.branch_name ?? ''} ${s.owner ?? ''} ${s.owner_email ?? ''} ${s.city ?? ''}`.toLowerCase().includes(q.toLowerCase())),
  );
  return (
    <div>
      <PageHeader title={t.nav.stores} lead={C.storesLead} />
      <div className="mb-4 flex flex-col gap-3 sm:flex-row sm:items-center">
        <label className="relative flex-1">
          <Search className="pointer-events-none absolute start-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted" />
          <input className="input ps-9" placeholder={C.searchStores} value={q} onChange={(e) => setQ(e.target.value)} />
        </label>
        <Chips
          label={C.status}
          value={st}
          onChange={setSt}
          options={[
            { value: 'all', label: C.all },
            { value: 'active', label: t.admin.active },
            { value: 'suspended', label: t.admin.suspended },
            { value: 'closed', label: C.closed },
          ]}
        />
      </div>
      {!data ? (
        <Skeleton className="h-40 rounded-2xl" />
      ) : !rows.length ? (
        <EmptyState icon={<StoreIcon className="h-6 w-6" />} title={t.common.empty} />
      ) : (
        <ul className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
          {rows.map((s) => (
            <li key={s.id}>
              <Link to={`/app/admin/stores/${s.id}`} className={cx('card flex items-center gap-3 p-4 transition hover:border-sky/40', s.status === 'closed' && 'opacity-60')}>
                <StoreLogo s={s} size={52} />
                <div className="min-w-0 flex-1">
                  <p className="truncate font-medium">
                    {s.store_name}
                    {s.branch_name ? ` · ${s.branch_name}` : ''}
                  </p>
                  <p className="truncate text-xs text-muted">
                    {s.owner ?? '—'}
                    {s.city ? ` · ${s.city}` : ''}
                  </p>
                  <p className="mt-1 text-xs">
                    <span className="num">{s.products}</span> {t.adm2.products} · <span className="num">{money(s.revenue, lang)}</span>
                  </p>
                </div>
                <Badge tone={tone(s.status)}>{s.status === 'closed' ? C.closed : s.status === 'active' ? t.admin.active : t.admin.suspended}</Badge>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

/** One store, fully under the admin's hand: details, branches, products, orders, ads. */
export function AdminStoreDetail() {
  const { id } = useParams();
  const nav = useNavigate();
  const { t, lang, err } = useI18n();
  const toast = useToast();
  const confirm = useConfirm();
  const { data, reload, error } = useData<any>(`/api/admin/stores/${id}`, [id]);
  const [f, setF] = useState<any>(null);
  const [busy, setBusy] = useState(false);
  const C = t.ctl;
  useEffect(() => {
    const s = data?.store;
    if (s)
      setF({
        storeName: s.store_name ?? '',
        branchName: s.branch_name ?? '',
        description: s.description ?? '',
        city: s.city ?? '',
        address: s.address ?? '',
        phone: s.phone ?? '',
        showPhone: !!s.show_phone,
        offersPickup: s.offers_pickup !== false,
        offersDelivery: !!s.offers_delivery,
        status: s.status ?? 'active',
      });
  }, [data]);
  if (error) return <ErrorNote>{err(error)}</ErrorNote>;
  if (!data || !f) return <Skeleton className="h-64 rounded-2xl" />;
  const s = data.store;
  const act = async (fn: () => Promise<unknown>, ok = t.common.done) => {
    try {
      await fn();
      toast(ok);
      void reload();
    } catch (e) {
      toast(err(e), 'error');
    }
  };
  const setProduct = async (p: any, body: any) => {
    if (body.status === 'deleted' && !(await confirm({ title: fill(t.adm2.removeQ, { name: p.name }), confirmLabel: t.adm2.remove, tone: 'danger' }))) return;
    await act(() => patch(`/api/admin/products/${p.id}`, body));
  };
  return (
    <div>
      <PageHeader title={s.store_name + (s.branch_name ? ` · ${s.branch_name}` : '')} lead={`${s.owner ?? '—'} · ${s.owner_email ?? ''}`} />
      <div className="mb-4 grid grid-cols-3 gap-2 sm:gap-3">
        {[
          [C.revenue, money(data.stats.revenue, lang)],
          [C.inEscrow, money(data.stats.in_escrow, lang)],
          [C.orders, String(data.stats.orders)],
        ].map(([k, v]) => (
          <div key={k} className="card min-w-0 p-3 sm:p-4">
            <p className="truncate text-xs text-muted">{k}</p>
            <p className="num mt-1 truncate font-display text-base sm:text-xl">{v}</p>
          </div>
        ))}
      </div>

      <div className="grid gap-4 lg:grid-cols-[1.2fr_1fr]">
        <section className="card p-5">
          <h2 className="mb-4 text-lg">{C.details}</h2>
          <form
            className="grid gap-3 sm:grid-cols-2"
            onSubmit={async (e) => {
              e.preventDefault();
              setBusy(true);
              await act(
                () =>
                  put(`/api/admin/stores/${s.id}`, {
                    ...f,
                    branchName: f.branchName.trim() || null,
                    description: f.description.trim() || null,
                    city: f.city.trim() || null,
                    address: f.address.trim() || null,
                    phone: f.phone.trim() || null,
                  }),
                t.common.saved,
              );
              setBusy(false);
            }}
          >
            <Field label={C.name} value={f.storeName} onChange={(e) => setF({ ...f, storeName: e.target.value })} required minLength={2} />
            <Field label={C.branch} value={f.branchName} onChange={(e) => setF({ ...f, branchName: e.target.value })} />
            <Field label={t.mstore.city} value={f.city} onChange={(e) => setF({ ...f, city: e.target.value })} />
            <Field label={t.auth.phone} dir="ltr" value={f.phone} onChange={(e) => setF({ ...f, phone: e.target.value })} />
            <div className="sm:col-span-2">
              <Field label={t.mstore.address} value={f.address} onChange={(e) => setF({ ...f, address: e.target.value })} />
            </div>
            <div className="sm:col-span-2">
              <TextArea label={C.description} value={f.description} onChange={(e) => setF({ ...f, description: e.target.value })} rows={3} />
            </div>
            <Select
              block
              label={C.status}
              value={f.status}
              onChange={(v: string) => setF({ ...f, status: v })}
              options={[
                { value: 'active', label: t.admin.active },
                { value: 'suspended', label: t.admin.suspended },
                { value: 'closed', label: C.closed },
              ]}
            />
            <div className="flex flex-col justify-end gap-2 text-sm">
              {(
                [
                  ['offersPickup', C.pickup],
                  ['offersDelivery', C.delivery],
                  ['showPhone', C.showPhone],
                ] as const
              ).map(([k, l]) => (
                <label key={k} className="flex items-center gap-2">
                  <input type="checkbox" className="h-4 w-4 accent-[rgb(var(--sky))]" checked={f[k]} onChange={(e) => setF({ ...f, [k]: e.target.checked })} />
                  {l}
                </label>
              ))}
            </div>
            <div className="flex flex-wrap gap-2 sm:col-span-2">
              <Button loading={busy}>{t.common.save}</Button>
              {s.slug && (
                <a href={`/s/${s.slug}`} target="_blank" rel="noreferrer">
                  <Button type="button" variant="secondary" icon={<ExternalLink className="h-4 w-4" />}>
                    {t.adm2.open}
                  </Button>
                </a>
              )}
              {s.owner_id && (
                <Link to={`/app/admin/users/${s.owner_id}`}>
                  <Button type="button" variant="ghost" icon={<UserRound className="h-4 w-4" />}>
                    {C.owner}
                  </Button>
                </Link>
              )}
            </div>
          </form>
        </section>

        <div className="space-y-4">
          <section className="card overflow-hidden">
            <h2 className="border-b border-line px-5 py-4 text-lg">{C.branches}</h2>
            <ul className="divide-y divide-line">
              {data.branches.map((b: any) => (
                <li key={b.id}>
                  <Link to={`/app/admin/stores/${b.id}`} className={cx('flex items-center gap-3 px-5 py-3 hover:bg-sunk/60', b.id === s.id && 'bg-sky/5')}>
                    <StoreIcon className={cx('h-4 w-4 shrink-0', b.parent_id ? 'text-muted' : 'text-stitch')} />
                    <span className="min-w-0 flex-1 truncate text-sm">
                      {b.branch_name || b.store_name}
                      {b.city ? <span className="text-muted"> · {b.city}</span> : null}
                    </span>
                    <span className="num text-xs text-muted">{b.products}</span>
                    <Badge tone={tone(b.status)}>{b.status === 'closed' ? C.closed : b.status === 'active' ? t.admin.active : t.admin.suspended}</Badge>
                  </Link>
                </li>
              ))}
            </ul>
          </section>

          {(data.ads.length > 0 || data.pickupPoints.length > 0) && (
            <section className="card p-5">
              {data.ads.length > 0 && (
                <>
                  <h2 className="mb-3 text-lg">{t.nav.ads}</h2>
                  <ul className="mb-4 grid grid-cols-3 gap-2">
                    {data.ads.map((a: any) => (
                      <li key={a.id} className="group relative aspect-video overflow-hidden rounded-xl bg-sunk">
                        {a.kind === 'video' ? <video src={a.media_url} className="h-full w-full object-cover" muted /> : <img src={a.media_url} alt="" className="h-full w-full object-cover" />}
                        <button
                          className="absolute end-1 top-1 grid h-7 w-7 place-items-center rounded-full bg-black/60 text-white"
                          aria-label={t.adm2.remove}
                          onClick={async () => {
                            if (!(await confirm({ title: C.removeAd, confirmLabel: t.adm2.remove, tone: 'danger' }))) return;
                            await act(() => del(`/api/admin/ads/${a.id}`));
                          }}
                        >
                          <Trash2 className="h-3.5 w-3.5" />
                        </button>
                      </li>
                    ))}
                  </ul>
                </>
              )}
              {data.pickupPoints.length > 0 && (
                <>
                  <h2 className="mb-2 text-lg">{t.nav.pickup}</h2>
                  <ul className="space-y-1 text-sm">
                    {data.pickupPoints.map((p: any) => (
                      <li key={p.id} className="flex items-center gap-2">
                        <MapPin className="h-4 w-4 text-muted" />
                        <span className="flex-1 truncate">
                          {p.name}
                          {p.city ? ` · ${p.city}` : ''}
                        </span>
                        {!p.active && <Badge tone="neutral">{t.pick.off}</Badge>}
                      </li>
                    ))}
                  </ul>
                </>
              )}
            </section>
          )}
        </div>
      </div>

      <section className="card mt-4 overflow-hidden">
        <h2 className="flex items-center gap-2 border-b border-line px-5 py-4 text-lg">
          <Package className="h-5 w-5 text-stitch" /> {t.adm2.products} <span className="num text-sm text-muted">({data.products.length})</span>
        </h2>
        {!data.products.length ? (
          <p className="p-6 text-center text-sm text-muted">{t.adm2.noProducts}</p>
        ) : (
          <ul className="divide-y divide-line">
            {data.products.map((p: any) => (
              <li key={p.id} className={cx('flex items-center gap-3 px-4 py-2.5', p.status !== 'active' && 'opacity-60')}>
                <div className="h-11 w-11 shrink-0 overflow-hidden rounded-lg">
                  <ProductImage p={p} />
                </div>
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-medium">{p.name}</p>
                  <p className="num text-xs text-muted">
                    {money(p.price, lang)} · {p.is_digital ? '∞' : p.stock}
                  </p>
                </div>
                <button
                  onClick={() => setProduct(p, { status: p.status === 'active' ? 'hidden' : 'active' })}
                  className="rounded-lg p-2 text-muted hover:bg-sunk hover:text-ink"
                  title={p.status === 'active' ? t.adm2.hide : t.adm2.show}
                  aria-label={p.status === 'active' ? t.adm2.hide : t.adm2.show}
                >
                  {p.status === 'active' ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                </button>
                <button onClick={() => setProduct(p, { status: 'deleted' })} className="rounded-lg p-2 text-muted hover:bg-stitch/10 hover:text-stitch" aria-label={t.adm2.remove}>
                  <Trash2 className="h-4 w-4" />
                </button>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="card mt-4 overflow-hidden">
        <h2 className="border-b border-line px-5 py-4 text-lg">{C.lastOrders}</h2>
        {!data.orders.length ? (
          <p className="p-6 text-center text-sm text-muted">{t.common.empty}</p>
        ) : (
          <ul className="divide-y divide-line text-sm">
            {data.orders.map((o: any) => (
              <li key={o.id} className="flex items-center gap-3 px-5 py-2.5">
                <span className="min-w-0 flex-1 truncate">{o.buyer ?? '—'}</span>
                <span className="hidden text-xs text-muted sm:inline">{date(o.created_at, lang)}</span>
                <span className="num">{money(o.total_amount, lang)}</span>
                <Badge tone={o.escrow_status === 'released' ? 'good' : o.escrow_status === 'held' ? 'info' : 'neutral'}>{t.orders.st[o.status] ?? o.status}</Badge>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="mt-4 rounded-3xl border border-stitch/30 bg-stitch/5 p-5">
        <h2 className="text-lg text-stitch">{C.danger}</h2>
        <p className="mt-1 text-sm text-muted">{C.deleteLead}</p>
        <div className="mt-4 flex flex-wrap gap-2">
          <Button
            variant="secondary"
            icon={s.status === 'active' ? <Pause className="h-4 w-4" /> : <Play className="h-4 w-4" />}
            onClick={async () => {
              if (!(await confirm({ title: s.store_name, body: t.common.areYouSure, confirmLabel: s.status === 'active' ? t.adm2.suspendStore : t.adm2.activateStore, tone: s.status === 'active' ? 'danger' : 'primary' }))) return;
              await act(() => patch(`/api/admin/stores/${s.id}`, { status: s.status === 'active' ? 'suspended' : 'active' }));
            }}
          >
            {s.status === 'active' ? t.adm2.suspendStore : t.adm2.activateStore}
          </Button>
          <Button
            variant="danger"
            icon={<Trash2 className="h-4 w-4" />}
            onClick={async () => {
              if (!(await confirm({ title: fill(C.deleteQ, { name: s.store_name }), body: C.deleteB, confirmLabel: C.deleteStore, tone: 'danger' }))) return;
              try {
                await del(`/api/admin/stores/${s.id}`);
                toast(C.deleted);
                nav('/app/admin/stores');
              } catch (e) {
                toast(err(e), 'error');
              }
            }}
          >
            {C.deleteStore}
          </Button>
        </div>
      </section>
    </div>
  );
}
