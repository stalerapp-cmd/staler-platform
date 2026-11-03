import { AnimatePresence, motion } from 'framer-motion';
import { useEffect, useMemo, useRef, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { ArrowDownToLine, ArrowUpFromLine, Banknote, ChevronDown, Clock, LocateFixed, MapPin, Navigation, Phone, Search, Signpost, Ticket, XCircle } from 'lucide-react';
import { AgentUpdates, POST_LOOK } from '../components/AgentUpdates';
import { MediaViewer, PlaceStrip, ShotsChip, type PlaceShot } from '../components/PlaceMedia';
import { del, newIdempotencyKey, post } from '../lib/api';
import { useAuth } from '../lib/auth';
import { useI18n } from '../lib/i18n';
import { useData, usePolling } from '../lib/hooks';
import { AMOUNT_RE, fill, money, relative } from '../lib/format';
import { QRImage } from '../components/QR';
import { MapView, type Me } from '../components/MapView';
import { PlacePicker, placeLabel } from '../components/PlacePicker';
import { expandPlaces, placeKey } from '../lib/places';
import { useToast } from '../components/Toast';
import { useConfirm } from '../components/Confirm';
import { useSecureAction } from '../components/SecureAction';
import { AmountInput, AnimatedNumber, Avatar, Badge, Button, EmptyState, ErrorNote, PageHeader, Sheet, Skeleton, SuccessMark, cx } from '../components/ui';

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

      <AgentProfileCard />
      <AgentUpdates />

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

/** A short summary on the desk; the profile itself is edited in Settings → Agent profile. */
function AgentProfileCard() {
  const { t, lang } = useI18n();
  const data = useData<{ profile: any }>('/api/exchange/profile');
  const p = data.data?.profile;
  const status: string = p?.status ?? 'pending';
  return (
    <Link
      to="/app/settings?tab=agent"
      className="group mt-6 flex items-center gap-4 rounded-3xl bg-surface p-4 shadow-card ring-1 ring-line/60 transition hover:-translate-y-0.5 hover:ring-ink/20"
    >
      <span className="grid h-12 w-12 shrink-0 place-items-center rounded-2xl bg-gold/15 text-[rgb(150_105_10)] dark:text-gold">
        <MapPin className="h-6 w-6" />
      </span>
      <span className="min-w-0 flex-1">
        <span className="block font-semibold">{t.agent.profile}</span>
        <span className="block truncate text-sm text-muted">{p?.missing ? t.agent.setupFirst : [p?.display_name, p?.city].filter(Boolean).join(' · ') || t.agent.profileLead}</span>
      </span>
      <Badge tone={status === 'active' ? 'good' : status === 'suspended' ? 'bad' : 'warn'}>
        {status === 'active' ? t.agent.listed : status === 'suspended' ? t.agent.suspended : t.agent.pending}
      </Badge>
      <span className="hidden text-sm font-medium text-sky sm:inline">{lang === 'ar' ? 'تعديل' : 'Edit'}</span>
    </Link>
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
  const { user } = useAuth();
  const you = lang === 'ar' ? '(أنت)' : '(you)';
  const mine = (a: any) => !!user && a.id === user.id;
  const toast = useToast();
  const data = useData<{ agents: any[] }>('/api/exchange/agents');
  const [q, setQ] = useState('');
  const [places, setPlaces] = useState<string[]>([]);
  const [pickPlace, setPickPlace] = useState(false);
  const wanted = useMemo(() => new Set(expandPlaces(places).map(placeKey)), [places]);
  const [service, setService] = useState<'all' | 'in' | 'out'>('all');
  const [sel, setSel] = useState<string | null>(null);
  const [me, setMe] = useState<Me | null>(null);
  const [origin, setOrigin] = useState<{ lat: number; lng: number; label: string } | null>(null);
  const [locating, setLocating] = useState(false);
  const [fitKey, setFitKey] = useState(0);
  const [viewer, setViewer] = useState<{ media: PlaceShot[]; i: number; title: string } | null>(null);
  const [focus, setFocus] = useState<{ key: string; lat: number; lng: number; zoom?: number } | null>(null);
  const [sp, setSp] = useSearchParams();
  const listRef = useRef<HTMLUListElement>(null);
  const A = t.agentMap;
  const ar = lang === 'ar';

  const all = data.data?.agents ?? [];
  // Distances are measured from a place searched on the map, or else from the person.
  const from = origin ?? me;
  const agents = useMemo(() => {
    const needle = q.trim().toLowerCase();
    const list = all
      .filter((a) => !needle || `${a.display_name} ${a.city ?? ''} ${a.address ?? ''} ${a.phone ?? ''}`.toLowerCase().includes(needle))
      .filter((a) => !wanted.size || wanted.has(placeKey(a.city ?? '')))
      .filter((a) => service === 'all' || (service === 'in' ? a.cash_in : a.cash_out))
      .map((a) => ({ ...a, dist: from && a.lat != null ? metres(from, { lat: Number(a.lat), lng: Number(a.lng) }) : null }));
    return from ? list.sort((x, y) => (x.dist ?? Infinity) - (y.dist ?? Infinity)) : list;
  }, [all, q, wanted, service, from]);
  const pins = useMemo(
    () => agents.filter((a) => a.lat != null && a.lng != null).map((a) => ({ id: a.id, lat: Number(a.lat), lng: Number(a.lng), kind: 'agent' as const, label: mine(a) ? `${a.display_name} ${you}` : a.display_name })),
    [agents],
  );
  // Re-frame the map whenever the set of agents shown changes.
  useEffect(() => {
    setFitKey((k) => k + 1);
  }, [pins.length, places, service]);
  // ?agent=<id> (from a mention or an update): open that agent and fly to them.
  const wantedAgent = sp.get('agent');
  useEffect(() => {
    if (!wantedAgent || !all.length) return;
    const a = all.find((x) => x.id === wantedAgent);
    if (a) {
      setSel(a.id);
      if (a.lat != null) setFocus({ key: `agent:${a.id}`, lat: Number(a.lat), lng: Number(a.lng), zoom: 16 });
      setTimeout(() => listRef.current?.querySelector(`[data-agent="${a.id}"]`)?.scrollIntoView({ behavior: 'smooth', block: 'center' }), 700);
    }
    sp.delete('agent');
    setSp(sp, { replace: true });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [wantedAgent, all.length]);
  const fmtDist = (m: number) => (m < 1000 ? fill(A.m, { n: Math.round(m / 10) * 10 }) : fill(A.km, { n: (m / 1000).toFixed(m < 10000 ? 1 : 0) }));

  const locate = () => {
    if (!navigator.geolocation) return toast(A.noGeo, 'error');
    setLocating(true);
    navigator.geolocation.getCurrentPosition(
      (p) => {
        setLocating(false);
        setMe({ lat: p.coords.latitude, lng: p.coords.longitude, acc: p.coords.accuracy });
        setOrigin(null);
        setSel(null);
        setPlaces([]);
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
              pins={origin ? [...pins, { lat: origin.lat, lng: origin.lng, kind: 'home' as const, label: origin.label }] : pins}
              selectedId={sel}
              onPinClick={(id) => choose(id === sel ? null : id)}
              me={me}
              fitKey={fitKey}
              zoom={9}
              search
              onSearchPick={(p) => {
                setOrigin(p);
                setPlaces([]);
                setSel(null);
              }}
              onSearchClear={() => setOrigin(null)}
              focus={focus}
            />
            {/* Floating controls over the map (under the search box) */}
            <div dir="ltr" className="pointer-events-none absolute inset-x-3 top-[3.9rem] z-[500] flex justify-end">
              <button
                type="button"
                onClick={locate}
                className="pointer-events-auto inline-flex items-center gap-2 rounded-full bg-surface/95 px-3.5 py-2 text-sm font-medium shadow-lift ring-1 ring-line backdrop-blur transition hover:-translate-y-0.5 active:scale-95"
              >
                {locating ? <span className="h-4 w-4 animate-spin rounded-full border-2 border-sky border-t-transparent" /> : <LocateFixed className="h-4 w-4 text-sky" />}
                {locating ? A.locating : me ? A.refresh : A.nearMe}
              </button>
            </div>
          </div>
        </div>

        <div className="min-w-0 lg:order-1">
          <div className="mb-3 flex gap-2">
            <label className="relative block min-w-0 flex-1">
              <Search className="pointer-events-none absolute start-4 top-1/2 h-5 w-5 -translate-y-1/2 text-muted" />
              <input value={q} onChange={(e) => setQ(e.target.value)} placeholder={A.searchPh} className="field ps-12 pe-10" type="search" />
              {q && (
                <button type="button" onClick={() => setQ('')} className="absolute end-3 top-1/2 grid h-7 w-7 -translate-y-1/2 place-items-center rounded-full text-muted hover:bg-sunk" aria-label={t.common.close}>
                  <XCircle className="h-4 w-4" />
                </button>
              )}
            </label>
            <button
              type="button"
              onClick={() => setPickPlace(true)}
              className={cx('relative flex shrink-0 items-center gap-2 rounded-xl px-3.5 text-sm font-medium transition', places.length ? 'bg-stitch text-white shadow-lift' : 'bg-surface text-ink ring-1 ring-line hover:ring-ink/20')}
              aria-label={t.shop.pickPlace}
              title={t.shop.pickPlace}
            >
              <MapPin className="h-5 w-5" />
              <span className="hidden sm:inline">{places.length ? fill(t.shop.inPlaces, { n: places.length }) : t.shop.pickPlace}</span>
              {places.length > 0 && <span className="num grid h-5 min-w-5 place-items-center rounded-full bg-white/25 px-1 text-[11px] sm:hidden">{places.length}</span>}
            </button>
          </div>
          {places.length > 0 && (
            <div className="mb-3 flex flex-wrap gap-1.5">
              {places.map((k) => (
                <span key={k} className="inline-flex items-center gap-1 rounded-full bg-night py-1 pe-1 ps-3 text-xs font-medium text-white dark:bg-white/15">
                  {placeLabel(k, lang)}
                  <button type="button" onClick={() => setPlaces(places.filter((x) => x !== k))} className="grid h-5 w-5 place-items-center rounded-full bg-white/15 hover:bg-white/30" aria-label="✕">
                    <XCircle className="h-3 w-3" />
                  </button>
                </span>
              ))}
            </div>
          )}
          <PlacePicker open={pickPlace} onClose={() => setPickPlace(false)} value={places} onChange={setPlaces} />
          <MediaViewer media={viewer?.media ?? []} index={viewer ? viewer.i : null} title={viewer?.title} onClose={() => setViewer(null)} />
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
          {data.data && (
            <p className="mb-3 text-sm text-muted">
              {origin
                ? `${fill(A.count, { n: agents.length })} — ${lang === 'ar' ? `الأقرب لـ «${origin.label}» أول` : `nearest to “${origin.label}” first`}`
                : fill(me ? A.countNear : A.count, { n: agents.length })}
            </p>
          )}
          {!data.data ? (
            <div className="space-y-3">
              {[0, 1, 2].map((i) => (
                <Skeleton key={i} className="h-28 rounded-3xl" />
              ))}
            </div>
          ) : !agents.length ? (
            <EmptyState icon={<MapPin className="h-6 w-6" />} title={q || places.length || service !== 'all' ? A.noMatch : t.agent.none} />
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
                        <p className="flex min-w-0 items-center gap-1.5 font-semibold">
                          <span className="truncate">{a.display_name}</span>
                          {mine(a) && <span className="shrink-0 rounded-full bg-stitch/10 px-2 py-0.5 text-[11px] font-semibold text-stitch">{you}</span>}
                        </p>
                        {a.dist != null && <span className="shrink-0 rounded-full bg-sky/10 px-2 py-0.5 text-xs font-medium text-sky">{fmtDist(a.dist)}</span>}
                      </div>
                      <p className="truncate text-sm text-muted">{[a.city, a.address].filter(Boolean).join(' · ') || '—'}</p>
                      {a.hours && (
                        <p className="mt-1 flex items-center gap-1.5 text-xs text-muted">
                          <Clock className="h-3.5 w-3.5" /> {a.hours}
                        </p>
                      )}
                      <div className="mt-2 flex flex-wrap items-center gap-1.5">
                        {a.cash_in && <Badge tone="good">{t.agent.cashIn}</Badge>}
                        {a.cash_out && <Badge tone="info">{t.agent.cashOut}</Badge>}
                        {a.lat == null && <Badge tone="neutral">{A.noPin}</Badge>}
                        {sel !== a.id && <ShotsChip n={a.media?.length ?? 0} />}
                      </div>
                    </div>
                  </div>
                  {a.update && <AgentNote u={a.update} />}
                  <AnimatePresence initial={false}>
                    {sel === a.id && (a.directions || a.media?.length > 0) && (
                      <motion.div initial={{ height: 0, opacity: 0 }} animate={{ height: 'auto', opacity: 1 }} exit={{ height: 0, opacity: 0 }} transition={{ duration: 0.28, ease: [0.16, 1, 0.3, 1] }} className="overflow-hidden">
                        <div className="mt-3 rounded-2xl bg-bg/70 p-3 ring-1 ring-line">
                          {a.directions && (
                            <p className="flex items-start gap-2 text-sm leading-relaxed">
                              <Signpost className="mt-0.5 h-4 w-4 shrink-0 text-stitch" />
                              <span>
                                <span className="block text-xs font-semibold text-muted">{ar ? 'كيف توصل' : 'How to get there'}</span>
                                {a.directions}
                              </span>
                            </p>
                          )}
                          <PlaceStrip media={a.media ?? []} onOpen={(i) => setViewer({ media: a.media, i, title: a.display_name })} className={a.directions ? 'mt-3' : ''} />
                        </div>
                      </motion.div>
                    )}
                  </AnimatePresence>
                  {sel !== a.id && (a.directions || a.media?.length > 0) && (
                    <span className="mt-2 inline-flex items-center gap-1 text-xs font-medium text-sky">
                      <ChevronDown className="h-3.5 w-3.5" /> {ar ? 'شوف المكان وكيف توصل' : 'See the place and how to get there'}
                    </span>
                  )}
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

/** The agent's latest update (a move, new hours, closing, an offer) on their card. */
function AgentNote({ u }: { u: { kind: keyof typeof POST_LOOK; title: string; body: string; at: string } }) {
  const { lang } = useI18n();
  const L = POST_LOOK[u.kind] ?? POST_LOOK.news;
  return (
    <div className={cx('mt-3 flex items-start gap-2.5 rounded-2xl px-3 py-2.5', L.c.replace(/text-\S+/g, ''), 'bg-opacity-100')}>
      <span className={cx('grid h-7 w-7 shrink-0 place-items-center rounded-lg', L.c)}>
        <L.icon className="h-4 w-4" />
      </span>
      <span className="min-w-0 flex-1">
        <span className="block text-sm font-semibold">{u.title}</span>
        <span className="line-clamp-2 block text-xs text-ink/75">{u.body}</span>
        <span className="mt-0.5 block text-[11px] text-muted">{relative(u.at, lang)}</span>
      </span>
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

