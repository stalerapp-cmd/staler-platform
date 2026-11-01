import { AnimatePresence, motion } from 'framer-motion';
import { useEffect, useMemo, useRef, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { ArrowDownToLine, ArrowUpFromLine, Banknote, Clock, LocateFixed, MapPin, Navigation, Phone, Search, Ticket, XCircle } from 'lucide-react';
import { del, newIdempotencyKey, post, put } from '../lib/api';
import { useAuth } from '../lib/auth';
import { useI18n } from '../lib/i18n';
import { useData, usePolling } from '../lib/hooks';
import { AMOUNT_RE, fill, money, relative } from '../lib/format';
import { QRImage } from '../components/QR';
import { MapView, type Me } from '../components/MapView';
import { useToast } from '../components/Toast';
import { useConfirm } from '../components/Confirm';
import { useSecureAction } from '../components/SecureAction';
import { AmountInput, AnimatedNumber, Avatar, Badge, Button, EmptyState, ErrorNote, Field, PageHeader, Sheet, Skeleton, SuccessMark, Toggle, cx } from '../components/ui';

interface Stats {
  balance: string;
  cash_in_today: string;
  cash_out_today: string;
  in_escrow: string;
  issued_today: number;
}

// ------------------------------------------------------------------ desk
export default function AgentDesk() {
  const { t, lang, err } = useI18n();
  const toast = useToast();
  const confirm = useConfirm();
  const { reload: reloadUser } = useAuth();
  const stats = useData<Stats>('/api/exchange/stats');
  const list = useData<{ cashouts: any[] }>('/api/exchange/cashouts');
  const [amount, setAmount] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [show, setShow] = useState<any>(null);
  usePolling(
    async () => {
      await list.reload();
      void stats.reload();
    },
    3000,
    !!show,
  );
  const shown = show && list.data?.cashouts.find((c) => c.id === show.id);
  const paid = shown?.status === 'paid';
  useEffect(() => {
    if (paid) void reloadUser();
  }, [paid, reloadUser]);

  const tiles = [
    { label: t.agent.balance, v: stats.data?.balance, icon: Banknote, cls: 'bg-night text-white' },
    { label: t.agent.inToday, v: stats.data?.cash_in_today, icon: ArrowDownToLine, cls: 'bg-olive/12 text-olive' },
    { label: t.agent.outToday, v: stats.data?.cash_out_today, icon: ArrowUpFromLine, cls: 'bg-stitch/10 text-stitch' },
    { label: t.agent.escrow, v: stats.data?.in_escrow, icon: Ticket, cls: 'bg-gold/15 text-[rgb(150_105_10)] dark:text-gold' },
  ];
  const tone = (s: string) => (s === 'paid' ? 'good' : s === 'open' ? 'info' : 'neutral');

  return (
    <div>
      <PageHeader title={t.agent.desk} lead={t.agent.deskLead} />
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        {tiles.map((x, i) => (
          <motion.div
            key={x.label}
            initial={{ opacity: 0, y: 14 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.08 * i, type: 'spring', bounce: 0.3 }}
            className={cx('relative overflow-hidden rounded-3xl p-4', x.cls)}
          >
            <x.icon className="h-5 w-5 opacity-80" />
            <p className="mt-3 text-xs opacity-80">{x.label}</p>
            {x.v === undefined ? (
              <Skeleton className="mt-1 h-7 w-24" />
            ) : (
              <p className="num font-display text-2xl">
                <AnimatedNumber value={Number(x.v)} format={(n) => money(n, lang)} />
              </p>
            )}
          </motion.div>
        ))}
      </div>

      <div className="mt-6 grid gap-5 lg:grid-cols-2">
        <Link to="/app/vouchers" className="sewn card group block overflow-hidden p-6 transition hover:-translate-y-0.5">
          <div className="flex items-start gap-4">
            <span className="grid h-14 w-14 shrink-0 place-items-center rounded-2xl bg-olive text-white transition duration-300 group-hover:-rotate-6">
              <ArrowDownToLine className="h-7 w-7" />
            </span>
            <div>
              <h2 className="text-xl">{t.agent.cashIn}</h2>
              <p className="mt-1 text-sm text-muted">{t.agent.cashInD}</p>
              <span className="mt-4 inline-flex items-center gap-2 rounded-full bg-olive/12 px-3 py-1.5 text-sm font-medium text-olive">
                <Ticket className="h-4 w-4" /> {t.vouchers.create}
              </span>
            </div>
          </div>
        </Link>

        <form
          className="sewn card p-6"
          onSubmit={async (e) => {
            e.preventDefault();
            if (!AMOUNT_RE.test(amount) || Number(amount) <= 0) return;
            setBusy(true);
            setError(null);
            try {
              const r = await post('/api/exchange/cashouts', { amount }, newIdempotencyKey());
              setShow(r.cashout);
              setAmount('');
              void list.reload();
            } catch (e2) {
              setError(err(e2));
            } finally {
              setBusy(false);
            }
          }}
        >
          <div className="flex items-start gap-4">
            <span className="grid h-14 w-14 shrink-0 place-items-center rounded-2xl bg-stitch text-white">
              <ArrowUpFromLine className="h-7 w-7" />
            </span>
            <div className="min-w-0 flex-1">
              <h2 className="text-xl">{t.agent.cashOut}</h2>
              <p className="mt-1 text-sm text-muted">{t.agent.cashOutD}</p>
            </div>
          </div>
          <div className="mt-5 space-y-3">
            <AmountInput label={t.common.amount} value={amount} onChange={setAmount} />
            <ErrorNote>{error}</ErrorNote>
            <Button block size="lg" variant="stitch" loading={busy}>
              {t.agent.newCashOut}
            </Button>
          </div>
        </form>
      </div>

      <section className="card mt-6 p-4 sm:p-5">
        <h2 className="mb-2 px-1 text-lg">{t.agent.cashouts}</h2>
        {!list.data ? (
          <Skeleton className="h-24" />
        ) : !list.data.cashouts.length ? (
          <EmptyState icon={<Banknote className="h-6 w-6" />} title={t.common.empty} />
        ) : (
          <ul className="divide-y divide-line">
            {list.data.cashouts.map((c) => (
              <li key={c.id} className="flex items-center justify-between gap-3 py-3">
                <div className="min-w-0">
                  <p className="num font-display text-lg">{money(c.amount, lang)}</p>
                  <p className="truncate text-xs text-muted">
                    {relative(c.created_at, lang)}
                    {c.paid_by_name ? ` · ${c.paid_by_name}` : ''}
                  </p>
                </div>
                <div className="flex items-center gap-2">
                  <Badge tone={tone(c.status)}>{t.agent.st[c.status] ?? c.status}</Badge>
                  {c.status === 'open' && (
                    <button
                      className="rounded-lg p-2 text-muted hover:bg-stitch/10 hover:text-stitch"
                      aria-label={t.common.cancel}
                      onClick={async () => {
                        if (!(await confirm({ title: t.agent.cancelQ, body: money(c.amount, lang), confirmLabel: t.common.cancel, tone: 'danger' }))) return;
                        try {
                          await del(`/api/exchange/cashouts/${c.id}`);
                          void list.reload();
                        } catch (e) {
                          toast(err(e), 'error');
                        }
                      }}
                    >
                      <XCircle className="h-5 w-5" />
                    </button>
                  )}
                </div>
              </li>
            ))}
          </ul>
        )}
      </section>

      <AgentProfile />

      <Sheet open={!!show} onClose={() => setShow(null)} title={t.agent.cashOut}>
        {show && (
          <div className="text-center">
            <AnimatePresence mode="wait">
              {paid ? (
                <motion.div key="paid" initial={{ opacity: 0, scale: 0.9 }} animate={{ opacity: 1, scale: 1 }}>
                  <SuccessMark />
                  <p className="mt-5 text-xl">{fill(t.agent.paidHand, { amount: money(show.amount, lang) })}</p>
                  {shown?.paid_by_name && <p className="mt-1 text-muted">{shown.paid_by_name}</p>}
                  <Button block className="mt-6" onClick={() => setShow(null)}>
                    {t.common.done}
                  </Button>
                </motion.div>
              ) : (
                <motion.div key="qr" exit={{ opacity: 0, scale: 0.95 }}>
                  <QRImage value={show.uri} size={240} label={t.agent.cashOut} />
                  <p className="num mt-5 font-display text-3xl">{money(show.amount, lang)}</p>
                  {show.match && <MatchCode code={show.match} hint={t.qr.matchAgent} />}
                  <p className="mt-2 flex items-center justify-center gap-2 text-sm text-muted">
                    <span className="h-2 w-2 animate-pulse rounded-full bg-stitch" /> {t.agent.waitingPay}
                  </p>
                </motion.div>
              )}
            </AnimatePresence>
          </div>
        )}
      </Sheet>
    </div>
  );
}

function AgentProfile() {
  const { t, err } = useI18n();
  const toast = useToast();
  const data = useData<{ profile: any }>('/api/exchange/profile');
  const [f, setF] = useState<any>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    if (data.data && !f) {
      const p = data.data.profile;
      setF({ displayName: p.display_name ?? '', city: p.city ?? '', address: p.address ?? '', phone: p.phone ?? '', hours: p.hours ?? '', lat: p.lat, lng: p.lng, cashIn: p.cash_in, cashOut: p.cash_out });
    }
  }, [data.data, f]);
  if (!f) return <Skeleton className="mt-6 h-64 rounded-3xl" />;
  const status: string = data.data?.profile.status ?? 'pending';
  const set = (k: string) => (e: React.ChangeEvent<HTMLInputElement>) => setF({ ...f, [k]: e.target.value });
  return (
    <section className="card mt-6 overflow-hidden">
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-line px-5 py-4">
        <div>
          <h2 className="text-lg">{t.agent.profile}</h2>
          <p className="text-sm text-muted">{data.data?.profile.missing ? t.agent.setupFirst : t.agent.profileLead}</p>
        </div>
        <Badge tone={status === 'active' ? 'good' : status === 'suspended' ? 'bad' : 'warn'}>
          {status === 'active' ? t.agent.listed : status === 'suspended' ? t.agent.suspended : t.agent.pending}
        </Badge>
      </div>
      <form
        className="grid gap-5 p-5 lg:grid-cols-2"
        onSubmit={async (e) => {
          e.preventDefault();
          setBusy(true);
          setError(null);
          try {
            await put('/api/exchange/profile', {
              displayName: f.displayName.trim(),
              city: f.city.trim() || null,
              address: f.address.trim() || null,
              phone: f.phone.trim() || null,
              hours: f.hours.trim() || null,
              lat: f.lat ?? null,
              lng: f.lng ?? null,
              cashIn: f.cashIn,
              cashOut: f.cashOut,
            });
            toast(t.common.saved);
            void data.reload();
          } catch (e2) {
            setError(err(e2));
          } finally {
            setBusy(false);
          }
        }}
      >
        <div className="space-y-4">
          <Field label={t.agent.displayName} value={f.displayName} onChange={set('displayName')} required minLength={2} maxLength={60} />
          <div className="grid grid-cols-2 gap-3">
            <Field list="ps-places" autoComplete="off" label={t.mstore.city} value={f.city} onChange={set('city')} maxLength={60} />
            <Field label={t.auth.phone} value={f.phone} onChange={set('phone')} dir="ltr" type="tel" />
          </div>
          <Field label={t.mstore.address} value={f.address} onChange={set('address')} maxLength={160} />
          <Field label={t.agent.hours} value={f.hours} onChange={set('hours')} placeholder={t.agent.hoursPh} maxLength={120} />
          <div className="space-y-2 rounded-2xl bg-sunk/60 p-3">
            <p className="px-1 text-sm font-medium">{t.agent.services}</p>
            <Toggle checked={f.cashIn} onChange={(v) => setF({ ...f, cashIn: v })} label={t.agent.cashIn} />
            <Toggle checked={f.cashOut} onChange={(v) => setF({ ...f, cashOut: v })} label={t.agent.cashOut} />
          </div>
        </div>
        <div>
          <p className="mb-2 text-sm font-medium text-ink/80">{t.agent.pin}</p>
          <MapView
            className="h-72 rounded-2xl"
            pins={f.lat != null && f.lng != null ? [{ lat: f.lat, lng: f.lng, kind: 'store', label: f.displayName }] : []}
            onPick={(p) => setF({ ...f, lat: p.lat, lng: p.lng })}
          />
          <p className="mt-2 text-xs text-muted">{t.agent.pinHint}</p>
        </div>
        <div className="lg:col-span-2">
          <ErrorNote>{error}</ErrorNote>
          <Button size="lg" loading={busy} className="mt-2">
            {t.agent.saveProfile}
          </Button>
        </div>
      </form>
    </section>
  );
}

// ------------------------------------------------------------- directory
/** Straight-line distance in metres. */
function metres(a: { lat: number; lng: number }, b: { lat: number; lng: number }) {
  const R = 6371e3;
  const r = (d: number) => (d * Math.PI) / 180;
  const dLat = r(b.lat - a.lat);
  const dLng = r(b.lng - a.lng);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(r(a.lat)) * Math.cos(r(b.lat)) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}

export function AgentsMap() {
  const { t, lang } = useI18n();
  const toast = useToast();
  const data = useData<{ agents: any[] }>('/api/exchange/agents');
  const [q, setQ] = useState('');
  const [city, setCity] = useState('');
  const [service, setService] = useState<'all' | 'in' | 'out'>('all');
  const [sel, setSel] = useState<string | null>(null);
  const [me, setMe] = useState<Me | null>(null);
  const [locating, setLocating] = useState(false);
  const [fitKey, setFitKey] = useState(0);
  const listRef = useRef<HTMLUListElement>(null);
  const A = t.agentMap;

  const all = data.data?.agents ?? [];
  const cities = useMemo(() => [...new Set(all.map((a) => (a.city ?? '').trim()).filter(Boolean))].sort((x, y) => x.localeCompare(y, lang)), [all, lang]);
  const agents = useMemo(() => {
    const needle = q.trim().toLowerCase();
    const list = all
      .filter((a) => !needle || `${a.display_name} ${a.city ?? ''} ${a.address ?? ''} ${a.phone ?? ''}`.toLowerCase().includes(needle))
      .filter((a) => !city || (a.city ?? '').trim() === city)
      .filter((a) => service === 'all' || (service === 'in' ? a.cash_in : a.cash_out))
      .map((a) => ({ ...a, dist: me && a.lat != null ? metres(me, { lat: Number(a.lat), lng: Number(a.lng) }) : null }));
    return me ? list.sort((x, y) => (x.dist ?? Infinity) - (y.dist ?? Infinity)) : list;
  }, [all, q, city, service, me]);
  const pins = useMemo(
    () => agents.filter((a) => a.lat != null && a.lng != null).map((a) => ({ id: a.id, lat: Number(a.lat), lng: Number(a.lng), kind: 'agent' as const, label: a.display_name })),
    [agents],
  );
  // Re-frame the map whenever the set of agents shown changes.
  useEffect(() => {
    setFitKey((k) => k + 1);
  }, [pins.length, city, service]);
  const chosen = agents.find((a) => a.id === sel) ?? null;
  const fmtDist = (m: number) => (m < 1000 ? fill(A.m, { n: Math.round(m / 10) * 10 }) : fill(A.km, { n: (m / 1000).toFixed(m < 10000 ? 1 : 0) }));

  const locate = () => {
    if (!navigator.geolocation) return toast(A.noGeo, 'error');
    setLocating(true);
    navigator.geolocation.getCurrentPosition(
      (p) => {
        setLocating(false);
        setMe({ lat: p.coords.latitude, lng: p.coords.longitude, acc: p.coords.accuracy });
        setSel(null);
        setCity('');
        if (p.coords.accuracy > 500) toast(fill(A.rough, { n: Math.round(p.coords.accuracy) }));
      },
      (e) => {
        setLocating(false);
        toast(e.code === 1 ? A.denied : e.code === 3 ? A.timeout : A.unavailable, 'error');
      },
      { enableHighAccuracy: true, timeout: 15000, maximumAge: 0 },
    );
  };

  const choose = (id: string | null) => {
    setSel(id);
    if (id) listRef.current?.querySelector(`[data-agent="${id}"]`)?.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  };

  const actions = (a: any, compact = false) => (
    <div className={cx('flex flex-wrap gap-2', compact ? 'mt-2.5' : 'mt-3')}>
      {a.lat != null && (
        <a
          href={`https://www.google.com/maps/dir/?api=1&destination=${a.lat},${a.lng}${me ? `&origin=${me.lat},${me.lng}` : ''}`}
          target="_blank"
          rel="noreferrer"
          onClick={(e) => e.stopPropagation()}
          className="inline-flex items-center gap-1.5 rounded-full bg-night px-3 py-1.5 text-sm text-white transition hover:-translate-y-0.5 dark:bg-white/10"
        >
          <Navigation className="h-4 w-4" /> {t.agent.directions}
        </a>
      )}
      {a.phone && (
        <a href={`tel:${a.phone}`} onClick={(e) => e.stopPropagation()} className="inline-flex items-center gap-1.5 rounded-full bg-sunk px-3 py-1.5 text-sm transition hover:-translate-y-0.5">
          <Phone className="h-4 w-4" /> <span dir="ltr">{a.phone}</span>
        </a>
      )}
    </div>
  );

  return (
    <div>
      <PageHeader title={t.agent.find} lead={t.agent.findLead} />
      <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.25fr)]">
        {/* Map first on phones, on the side on wide screens. */}
        <div className="lg:order-2">
          <div className="relative lg:sticky lg:top-24">
            <MapView
              className="h-[340px] rounded-3xl shadow-lift sm:h-[440px] lg:h-[calc(100dvh-9rem)] lg:max-h-[720px]"
              pins={pins}
              selectedId={sel}
              onPinClick={(id) => choose(id === sel ? null : id)}
              me={me}
              fitKey={fitKey}
              zoom={9}
            />
            {/* Floating controls over the map */}
            <div dir="ltr" className="pointer-events-none absolute inset-x-3 top-3 z-[500] flex justify-end">
              <button
                type="button"
                onClick={locate}
                className="pointer-events-auto inline-flex items-center gap-2 rounded-full bg-surface/95 px-3.5 py-2 text-sm font-medium shadow-lift ring-1 ring-line backdrop-blur transition hover:-translate-y-0.5 active:scale-95"
              >
                {locating ? <span className="h-4 w-4 animate-spin rounded-full border-2 border-sky border-t-transparent" /> : <LocateFixed className="h-4 w-4 text-sky" />}
                {locating ? A.locating : me ? A.refresh : A.nearMe}
              </button>
            </div>
            <AnimatePresence>
              {chosen && (
                <motion.div
                  key={chosen.id}
                  initial={{ opacity: 0, y: 16, scale: 0.97 }}
                  animate={{ opacity: 1, y: 0, scale: 1 }}
                  exit={{ opacity: 0, y: 12 }}
                  transition={{ type: 'spring', bounce: 0.3, duration: 0.45 }}
                  className="absolute inset-x-3 bottom-3 z-[500] rounded-2xl bg-surface/95 p-3.5 shadow-card ring-1 ring-line backdrop-blur"
                >
                  <div className="flex items-start gap-3">
                    <Avatar name={chosen.display_name} src={chosen.logo_url} size={44} />
                    <div className="min-w-0 flex-1">
                      <p className="truncate font-semibold">{chosen.display_name}</p>
                      <p className="truncate text-xs text-muted">{[chosen.city, chosen.address].filter(Boolean).join(' · ') || '—'}</p>
                      <p className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted">
                        {chosen.dist != null && (
                          <span className="inline-flex items-center gap-1 font-medium text-sky">
                            <MapPin className="h-3.5 w-3.5" /> {fmtDist(chosen.dist)}
                          </span>
                        )}
                        {chosen.hours && (
                          <span className="inline-flex items-center gap-1">
                            <Clock className="h-3.5 w-3.5" /> {chosen.hours}
                          </span>
                        )}
                      </p>
                    </div>
                    <button type="button" onClick={() => setSel(null)} className="grid h-8 w-8 shrink-0 place-items-center rounded-full text-muted hover:bg-sunk hover:text-ink" aria-label={t.common.close}>
                      <XCircle className="h-5 w-5" />
                    </button>
                  </div>
                  {actions(chosen, true)}
                </motion.div>
              )}
            </AnimatePresence>
          </div>
        </div>

        <div className="min-w-0 lg:order-1">
          <label className="relative mb-3 block">
            <Search className="pointer-events-none absolute start-4 top-1/2 h-5 w-5 -translate-y-1/2 text-muted" />
            <input value={q} onChange={(e) => setQ(e.target.value)} placeholder={A.searchPh} className="field ps-12 pe-10" type="search" />
            {q && (
              <button type="button" onClick={() => setQ('')} className="absolute end-3 top-1/2 grid h-7 w-7 -translate-y-1/2 place-items-center rounded-full text-muted hover:bg-sunk" aria-label={t.common.close}>
                <XCircle className="h-4 w-4" />
              </button>
            )}
          </label>
          <div className="-mx-1 mb-2 flex gap-2 overflow-x-auto px-1 pb-1 [scrollbar-width:none]">
            {(
              [
                ['all', A.allServices],
                ['in', t.agent.cashIn],
                ['out', t.agent.cashOut],
              ] as const
            ).map(([k, l]) => (
              <button key={k} type="button" onClick={() => setService(k)} className={cx('shrink-0 rounded-full px-3.5 py-1.5 text-sm transition', service === k ? 'bg-night text-white dark:bg-white/15' : 'bg-surface text-muted ring-1 ring-line hover:text-ink')}>
                {l}
              </button>
            ))}
          </div>
          {cities.length > 1 && (
            <div className="-mx-1 mb-4 flex gap-2 overflow-x-auto px-1 pb-1 [scrollbar-width:none]">
              <button type="button" onClick={() => setCity('')} className={cx('shrink-0 rounded-full px-3 py-1 text-xs transition', !city ? 'bg-gold/25 font-semibold text-ink' : 'bg-sunk text-muted hover:text-ink')}>
                {A.allCities}
              </button>
              {cities.map((c) => (
                <button key={c} type="button" onClick={() => setCity(c === city ? '' : c)} className={cx('shrink-0 rounded-full px-3 py-1 text-xs transition', city === c ? 'bg-gold/25 font-semibold text-ink' : 'bg-sunk text-muted hover:text-ink')}>
                  {c}
                </button>
              ))}
            </div>
          )}
          {data.data && (
            <p className="mb-3 text-sm text-muted">
              {fill(me ? A.countNear : A.count, { n: agents.length })}
            </p>
          )}
          {!data.data ? (
            <div className="space-y-3">
              {[0, 1, 2].map((i) => (
                <Skeleton key={i} className="h-28 rounded-3xl" />
              ))}
            </div>
          ) : !agents.length ? (
            <EmptyState icon={<MapPin className="h-6 w-6" />} title={q || city || service !== 'all' ? A.noMatch : t.agent.none} />
          ) : (
            <ul ref={listRef} className="space-y-3">
              {agents.map((a, i) => (
                <motion.li
                  key={a.id}
                  data-agent={a.id}
                  layout
                  initial={{ opacity: 0, y: 12 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ delay: Math.min(i, 8) * 0.04 }}
                  className={cx('card cursor-pointer p-4 transition hover:-translate-y-0.5', sel === a.id && 'ring-2 ring-stitch')}
                  onClick={() => choose(sel === a.id ? null : a.id)}
                >
                  <div className="flex items-start gap-3">
                    <Avatar name={a.display_name} src={a.logo_url} size={52} />
                    <div className="min-w-0 flex-1">
                      <div className="flex items-start justify-between gap-2">
                        <p className="truncate font-semibold">{a.display_name}</p>
                        {a.dist != null && <span className="shrink-0 rounded-full bg-sky/10 px-2 py-0.5 text-xs font-medium text-sky">{fmtDist(a.dist)}</span>}
                      </div>
                      <p className="truncate text-sm text-muted">{[a.city, a.address].filter(Boolean).join(' · ') || '—'}</p>
                      {a.hours && (
                        <p className="mt-1 flex items-center gap-1.5 text-xs text-muted">
                          <Clock className="h-3.5 w-3.5" /> {a.hours}
                        </p>
                      )}
                      <div className="mt-2 flex flex-wrap gap-1.5">
                        {a.cash_in && <Badge tone="good">{t.agent.cashIn}</Badge>}
                        {a.cash_out && <Badge tone="info">{t.agent.cashOut}</Badge>}
                        {a.lat == null && <Badge tone="neutral">{A.noPin}</Badge>}
                      </div>
                    </div>
                  </div>
                  {actions(a)}
                </motion.li>
              ))}
            </ul>
          )}
        </div>
      </div>
    </div>
  );
}

// ------------------------------------------------------- customer pays
/** Three digits shown on both phones: if they match, both people are looking at the same request. */
function MatchCode({ code, hint }: { code: string; hint: string }) {
  return (
    <div className="mx-auto mt-4 flex max-w-xs items-center gap-3 rounded-2xl border border-dashed border-sky/40 bg-sky/5 px-4 py-2.5 text-start">
      <span dir="ltr" className="num font-display text-2xl tracking-[0.3em] text-sky">
        {code}
      </span>
      <span className="text-xs leading-snug text-muted">{hint}</span>
    </div>
  );
}

export function CashOutPay() {
  const { t, lang, err } = useI18n();
  const secure = useSecureAction();
  const { reload } = useAuth();
  const [params] = useSearchParams();
  const code = params.get('c') ?? '';
  const [preview, setPreview] = useState<any>(null);
  const [loadErr, setLoadErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState<any>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    post('/api/exchange/cashouts/preview', { code })
      .then(setPreview)
      .catch((e) => setLoadErr(err(e)));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [code]);
  if (done)
    return (
      <div className="card mx-auto max-w-md p-8 text-center">
        <SuccessMark />
        <h2 className="mt-6 text-2xl">{t.agent.paid}</h2>
        <p className="num mt-2 font-display text-3xl">{money(done.amount, lang)}</p>
        <Link to="/app" className="mt-8 block">
          <Button block>{t.common.done}</Button>
        </Link>
      </div>
    );
  return (
    <div className="mx-auto max-w-md">
      {secure.element}
      <PageHeader title={t.agent.payTitle} />
      {loadErr ? (
        <ErrorNote>{loadErr}</ErrorNote>
      ) : !preview ? (
        <Skeleton className="h-48 rounded-3xl" />
      ) : (
        <div className="sewn card p-6">
          <p className="text-sm text-muted">{t.agent.payFrom}</p>
          <p className="font-medium">{preview.agent}</p>
          <p className="num mt-6 font-display text-5xl">{money(preview.amount, lang)}</p>
          {preview.match && <MatchCode code={preview.match} hint={t.qr.matchCustomer} />}
          <p className="mt-3 text-sm text-muted">{t.agent.payLead}</p>
          <ErrorNote>{error}</ErrorNote>
          <Button
            block
            size="lg"
            variant="stitch"
            className="mt-6"
            loading={busy}
            disabled={preview.status !== 'open'}
            onClick={async () => {
              setBusy(true);
              setError(null);
              try {
                const key = newIdempotencyKey();
                setDone(await secure.run((totp) => post('/api/exchange/cashouts/pay', { code, ...(totp ? { totp } : {}) }, key)));
                void reload();
              } catch (e) {
                setError(err(e));
              } finally {
                setBusy(false);
              }
            }}
          >
            {preview.status === 'open' ? t.agent.pay : t.agent.st[preview.status]}
          </Button>
        </div>
      )}
    </div>
  );
}

