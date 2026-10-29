import { AnimatePresence, motion } from 'framer-motion';
import { useEffect, useMemo, useRef, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import {
  AlertTriangle,
  ArrowDownUp,
  BookOpen,
  CheckCircle2,
  ChevronDown,
  CircleDollarSign,
  ClipboardCheck,
  Download,
  KeyRound,
  MapPin,
  Navigation,
  Package,
  PackageCheck,
  Search,
  ShieldCheck,
  ShoppingBag,
  Store as StoreIcon,
  Truck,
  XCircle,
  UtensilsCrossed,
  Shirt,
  Cpu,
  Sparkles,
  Sofa,
  Scissors,
  Wrench,
  Shapes,
  LayoutGrid,
  TrendingDown,
  TrendingUp,
  Flame,
  ArrowLeft,
} from 'lucide-react';
import { ApiError, downloadFile, get, post } from '../lib/api';
import { useAuth } from '../lib/auth';
import { useI18n } from '../lib/i18n';
import { useData } from '../lib/hooks';
import { date, fill, money, relative } from '../lib/format';
import { useSecureAction } from '../components/SecureAction';
import { useToast } from '../components/Toast';
import { useConfirm } from '../components/Confirm';
import { Badge, Button, Chips, EmptyState, ErrorNote, PageHeader, Sheet, Skeleton, TextArea, cx } from '../components/ui';
import { CartButton, CartSheet, ProductCard, ProductImage, ProductSheet, type Product } from '../components/Commerce';
import { MapView, type Pin } from '../components/MapView';
import { QRImage } from '../components/QR';
import { SecureReader } from '../components/Reader';
import { PublicShell } from '../layouts/PublicShell';
import { StoreLogo, accentOf, type StoreSummary } from './Stores';
import { StarMotif } from '../components/Tatreez';

export { CartProvider, useCart } from '../components/Commerce';
export type { Product } from '../components/Commerce';

// ------------------------------------------------------------------- market
const CATS: { k: string; icon: typeof Package; c: string }[] = [
  { k: 'food', icon: UtensilsCrossed, c: '#E27A4E' },
  { k: 'fashion', icon: Shirt, c: '#C8344A' },
  { k: 'electronics', icon: Cpu, c: '#4070D6' },
  { k: 'books', icon: BookOpen, c: '#5E7A2E' },
  { k: 'beauty', icon: Sparkles, c: '#B04A9E' },
  { k: 'home', icon: Sofa, c: '#8A5A0E' },
  { k: 'crafts', icon: Scissors, c: '#0F7A6C' },
  { k: 'digital', icon: Download, c: '#232C66' },
  { k: 'services', icon: Wrench, c: '#596079' },
  { k: 'other', icon: Shapes, c: '#C08A23' },
];

function Market() {
  const { t, err } = useI18n();
  const [params, setParams] = useSearchParams();
  const [q, setQ] = useState('');
  const [type, setType] = useState('all');
  const [sort, setSort] = useState('new');
  const [cat, setCat] = useState<string>('all');
  const [items, setItems] = useState<Product[] | null>(null);
  const [stores, setStores] = useState<StoreSummary[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [open, setOpen] = useState<Product | null>(null);
  const [cartOpen, setCartOpen] = useState(false);
  const seq = useRef(0);

  useEffect(() => {
    get<{ stores: StoreSummary[] }>('/api/store/stores')
      .then((d) => setStores(d.stores.slice(0, 14)))
      .catch(() => {});
  }, []);
  useEffect(() => {
    const n = ++seq.current;
    setItems(null);
    const h = setTimeout(async () => {
      try {
        const p = new URLSearchParams({ limit: '60', sort });
        if (q.trim()) p.set('q', q.trim());
        if (type !== 'all') p.set('type', type);
        if (cat !== 'all') p.set('storeCategory', cat);
        const d = await get<{ products: Product[] }>(`/api/store/products?${p}`);
        if (n === seq.current) setItems(d.products);
      } catch (e) {
        if (n === seq.current) setError(err(e));
      }
    }, 250);
    return () => clearTimeout(h);
  }, [q, type, sort, cat, err]);
  useEffect(() => {
    if (params.get('cart')) setCartOpen(true);
  }, [params]);

  const sorts = [
    { v: 'new', label: t.market.newest, icon: Sparkles },
    { v: 'price_asc', label: t.market.cheap, icon: TrendingDown },
    { v: 'price_desc', label: t.market.pricey, icon: TrendingUp },
    { v: 'name', label: t.market.az, icon: ArrowDownUp },
  ];
  const types = [
    { v: 'all', label: t.market.everything },
    { v: 'deals', label: t.market.deals },
    { v: 'physical', label: t.store.physical },
    { v: 'digital', label: t.store.digital },
    { v: 'deposit', label: t.mstore.deposit },
  ];
  const filtered = q.trim() || type !== 'all' || cat !== 'all';

  return (
    <div>
      <PageHeader title={t.store.title} lead={t.store.lead} actions={<CartButton onClick={() => setCartOpen(true)} className="bg-white text-night shadow-lift" />} />

      {/* Categories: big round tiles that bounce when picked */}
      <section className="mb-5">
        <h2 className="mb-3 text-lg">{t.market.cats}</h2>
        <div className="-mx-4 flex gap-3 overflow-x-auto px-4 pb-2 pt-1.5 sm:mx-0 sm:px-1">
          {[{ k: 'all', icon: LayoutGrid, c: '#141B3D' }, ...CATS].map((x, i) => {
            const on = cat === x.k;
            return (
              <motion.button
                key={x.k}
                type="button"
                initial={{ opacity: 0, y: 16 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: i * 0.035, type: 'spring', bounce: 0.4 }}
                whileTap={{ scale: 0.9 }}
                onClick={() => setCat(x.k)}
                className="group flex w-[74px] shrink-0 flex-col items-center gap-1.5 text-center"
                aria-pressed={on}
              >
                <motion.span
                  animate={on ? { rotate: [0, -8, 6, 0], scale: 1.06 } : { rotate: 0, scale: 1 }}
                  transition={{ duration: 0.45 }}
                  className="relative grid h-[62px] w-[62px] place-items-center rounded-[22px] text-white shadow-lift transition group-hover:-translate-y-1"
                  style={{ background: on ? x.c : `${x.c}1f`, color: on ? '#fff' : x.c }}
                >
                  {on && <motion.span layoutId="cat-ring" className="absolute -inset-1 rounded-[25px] border-2 border-dashed" style={{ borderColor: x.c }} />}
                  <x.icon className="h-6 w-6" strokeWidth={1.9} />
                </motion.span>
                <span className={cx('w-full truncate text-xs', on ? 'font-semibold text-ink' : 'text-muted')}>{x.k === 'all' ? t.market.everything : t.shop.cat[x.k]}</span>
              </motion.button>
            );
          })}
        </div>
      </section>

      {stores.length > 0 && cat === 'all' && !q.trim() && (
        <section className="mb-6">
          <h2 className="mb-3 flex items-center gap-2 text-lg">
            <StoreIcon className="h-5 w-5 text-stitch" /> {t.market.byStore}
          </h2>
          <div className="-mx-4 flex snap-x gap-3 overflow-x-auto px-4 pb-3 pt-1 sm:mx-0 sm:px-1">
            {stores.map((s, i) => (
              <motion.div
                key={s.id}
                initial={{ opacity: 0, y: 16, rotate: i % 2 ? 2 : -2 }}
                animate={{ opacity: 1, y: 0, rotate: 0 }}
                transition={{ delay: i * 0.05, type: 'spring', bounce: 0.4 }}
                whileHover={{ y: -4, rotate: i % 2 ? 1.5 : -1.5 }}
                whileTap={{ scale: 0.95 }}
                className="shrink-0 snap-start"
              >
                <Link to={`/s/${s.slug}`} className="block w-[128px] overflow-hidden rounded-[22px] bg-surface text-center shadow-lift ring-1 ring-line/70">
                  <div className="relative h-12 overflow-hidden" style={{ background: accentOf(s) }}>
                    <StarMotif size={9} cell={10} className="absolute -end-3 -top-4 h-16 w-16 opacity-40" colors={['#FFFFFF', '#E9C060']} animate={false} />
                  </div>
                  <div className="relative -mt-8 flex justify-center">
                    <span className="rounded-[18px] bg-surface p-1 shadow-sm">
                      <StoreLogo s={s} size={56} />
                    </span>
                  </div>
                  <p className="mt-1.5 line-clamp-1 px-2 text-sm font-semibold">{s.store_name}</p>
                  <p className="mb-3 mt-1 inline-flex items-center gap-1 rounded-full bg-sunk px-2 py-0.5 text-[11px] text-muted">
                    <Package className="h-3 w-3" /> <span className="num">{s.products}</span>
                  </p>
                </Link>
              </motion.div>
            ))}
            <motion.div initial={{ opacity: 0, scale: 0.8 }} animate={{ opacity: 1, scale: 1 }} transition={{ delay: stores.length * 0.05 }} whileHover={{ y: -4 }} whileTap={{ scale: 0.95 }} className="shrink-0 snap-start">
              <Link
                to="/app/stores"
                className="group flex h-full min-h-[150px] w-[128px] flex-col items-center justify-center gap-2.5 rounded-[22px] border-2 border-dashed border-stitch/40 bg-stitch/5 text-center text-stitch transition hover:bg-stitch/10"
              >
                <span className="relative grid h-14 w-14 place-items-center rounded-full bg-stitch text-white shadow-md shadow-stitch/30">
                  <span className="absolute -inset-1.5 rounded-full border-2 border-dashed border-stitch/50 motion-safe:animate-[spin_12s_linear_infinite]" />
                  <ArrowLeft className="h-6 w-6 transition group-hover:-translate-x-0.5 ltr:rotate-180" />
                </span>
                <span className="text-sm font-semibold">{t.shop.allStores}</span>
              </Link>
            </motion.div>
          </div>
        </section>
      )}

      {/* Search, sort and type: one tidy bar */}
      <div className="sticky top-16 z-20 -mx-4 mb-5 space-y-3 bg-bg/85 px-4 py-3 backdrop-blur-md sm:mx-0 sm:rounded-2xl sm:px-3">
        <label className="relative block">
          <span className="sr-only">{t.common.search}</span>
          <Search className="pointer-events-none absolute start-4 top-1/2 h-5 w-5 -translate-y-1/2 text-muted" />
          <input value={q} onChange={(e) => setQ(e.target.value)} placeholder={t.store.search} className="field h-12 rounded-2xl ps-12" type="search" />
        </label>
        <div className="-mx-4 flex gap-2 overflow-x-auto px-4 sm:mx-0 sm:flex-wrap sm:px-0">
          {types.map((x) => (
            <button
              key={x.v}
              onClick={() => setType(x.v)}
              className={cx('relative shrink-0 rounded-full px-3.5 py-1.5 text-sm transition', type === x.v ? 'text-white' : 'bg-surface text-muted ring-1 ring-line hover:text-ink')}
            >
              {type === x.v && <motion.span layoutId="type-pill" className="absolute inset-0 rounded-full bg-stitch" transition={{ type: 'spring', bounce: 0.25, duration: 0.4 }} />}
              <span className="relative flex items-center gap-1.5">
                {x.v === 'deals' && <Flame className="h-3.5 w-3.5" />}
                {x.label}
              </span>
            </button>
          ))}
          <span className="mx-1 hidden w-px self-stretch bg-line sm:block" />
          {sorts.map((x) => (
            <button
              key={x.v}
              onClick={() => setSort(x.v)}
              className={cx('flex shrink-0 items-center gap-1.5 rounded-full px-3 py-1.5 text-sm transition', sort === x.v ? 'bg-night text-white dark:bg-white/15' : 'text-muted hover:bg-sunk hover:text-ink')}
            >
              <x.icon className="h-3.5 w-3.5" />
              {x.label}
            </button>
          ))}
        </div>
      </div>

      <div className="mb-3 flex items-center justify-between text-sm text-muted">
        <span>{items ? fill(t.market.results, { n: items.length }) : ' '}</span>
        {filtered && (
          <button
            className="text-stitch hover:underline"
            onClick={() => {
              setQ('');
              setType('all');
              setCat('all');
            }}
          >
            {t.market.clear}
          </button>
        )}
      </div>
      <ErrorNote>{error}</ErrorNote>
      {!items ? (
        <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-4">
          {Array.from({ length: 8 }).map((_, i) => (
            <Skeleton key={i} className="aspect-[4/6] rounded-[1.4rem]" />
          ))}
        </div>
      ) : items.length ? (
        <motion.div layout className="grid grid-cols-2 gap-3 sm:grid-cols-3 sm:gap-4 lg:grid-cols-4">
          {items.map((p, i) => (
            <ProductCard key={p.id} p={p} index={i} onOpen={() => setOpen(p)} />
          ))}
        </motion.div>
      ) : (
        <EmptyState icon={<Package className="h-6 w-6" />} title={t.store.noProducts} />
      )}
      <ProductSheet product={open} onClose={() => setOpen(null)} onAdded={() => setCartOpen(true)} />
      <CartSheet
        open={cartOpen}
        onClose={() => {
          setCartOpen(false);
          if (params.get('cart')) setParams({}, { replace: true });
        }}
      />
    </div>
  );
}

export default function Store({ publicMode = false }: { publicMode?: boolean }) {
  if (!publicMode) return <Market />;
  return (
    <PublicShell>
      <Market />
    </PublicShell>
  );
}

// ------------------------------------------------------------------- orders
const STEPS = ['placed', 'accepted', 'shipped', 'delivered', 'completed'] as const;
const EV_ICON: Record<string, typeof Package> = {
  placed: ShoppingBag,
  accepted: ClipboardCheck,
  shipped: Truck,
  ready_for_pickup: PackageCheck,
  location: MapPin,
  note: Package,
  out_for_delivery: Navigation,
  balance_paid: CircleDollarSign,
  delivered: PackageCheck,
  confirmed: CheckCircle2,
  released: ShieldCheck,
  cancelled: XCircle,
  disputed: AlertTriangle,
  resolved: ShieldCheck,
};

function stepOf(o: any) {
  if (o.status === 'completed') return 4;
  if (o.status === 'delivered' || o.delivered_at) return 3;
  if (o.status === 'shipped') return 2;
  if (o.accepted_at) return 1;
  return 0;
}

function Progress({ o }: { o: any }) {
  const { t } = useI18n();
  const at = stepOf(o);
  const labels = [t.ord.ev.placed, t.ord.ev.accepted, o.fulfillment === 'pickup' ? t.ord.ev.ready_for_pickup : t.ord.ev.shipped, t.ord.ev.delivered, t.ord.ev.released];
  return (
    <ol className="relative mt-5 grid grid-cols-5 gap-1" aria-label={t.ord.timeline}>
      <span className="absolute inset-x-[10%] top-3.5 h-1 rounded-full bg-sunk" />
      <motion.span
        className="absolute start-[10%] top-3.5 h-1 rounded-full bg-olive"
        initial={{ width: 0 }}
        animate={{ width: `${(at / (STEPS.length - 1)) * 80}%` }}
        transition={{ duration: 0.9, ease: [0.16, 1, 0.3, 1] }}
      />
      {labels.map((l, i) => (
        <li key={l} className="relative flex flex-col items-center gap-1.5 text-center">
          <motion.span
            initial={{ scale: 0.5 }}
            animate={{ scale: i === at ? [1, 1.18, 1] : 1 }}
            transition={i === at ? { repeat: Infinity, duration: 2 } : {}}
            className={cx('grid h-8 w-8 place-items-center rounded-full border-2 text-xs', i <= at ? 'border-olive bg-olive text-white' : 'border-line bg-surface text-muted')}
          >
            {i < at ? <CheckCircle2 className="h-4 w-4" /> : i + 1}
          </motion.span>
          <span className={cx('text-[11px] leading-tight', i <= at ? 'text-ink' : 'text-muted')}>{l}</span>
        </li>
      ))}
    </ol>
  );
}

function OrderCard({ o, i, onChanged }: { o: any; i: number; onChanged: () => void }) {
  const { t, lang, err } = useI18n();
  const toast = useToast();
  const confirm = useConfirm();
  const secure = useSecureAction();
  const { reload } = useAuth();
  const [open, setOpen] = useState(i === 0 && o.escrow_status === 'held');
  const [busy, setBusy] = useState<string | null>(null);
  const [dispute, setDispute] = useState(false);
  const [reason, setReason] = useState('');
  const [reader, setReader] = useState<{ url: string; title: string } | null>(null);
  const held = o.escrow_status === 'held';
  const physical = o.fulfillment !== 'digital';
  const due = Number(o.balance_due) > 0;
  const tone = o.status === 'completed' ? 'good' : o.status === 'cancelled' ? 'bad' : o.dispute_status === 'open' ? 'bad' : o.status === 'shipped' ? 'info' : 'warn';

  const pins = useMemo<Pin[]>(() => {
    const out: Pin[] = [];
    if (o.store_lat != null && o.store_lng != null) out.push({ lat: o.store_lat, lng: o.store_lng, label: o.store_name, kind: 'store' });
    if (o.delivery_lat != null && o.delivery_lng != null) out.push({ lat: o.delivery_lat, lng: o.delivery_lng, label: t.ord.youPin, kind: 'home' });
    const track = (o.events as any[]).filter((e) => e.lat != null && e.lng != null);
    track.forEach((e, k) => out.push({ lat: e.lat, lng: e.lng, label: `${t.ord.ev[e.kind] ?? e.kind} · ${relative(e.at, lang)}`, kind: k === track.length - 1 ? 'now' : 'track' }));
    return out;
  }, [o, t, lang]);

  const act = async (kind: 'confirm' | 'cancel' | 'pay-balance') => {
    const q =
      kind === 'confirm'
        ? { title: t.ord.confirmQ, body: fill(t.ord.confirmB, { amount: money(o.amount_paid ?? o.total_amount, lang) }), confirmLabel: t.ord.confirmOk }
        : kind === 'cancel'
          ? { title: t.ord.cancelQ, body: o.accepted_at && !o.deposit_refundable && due ? t.ord.cancelBKeep : t.ord.cancelB, confirmLabel: t.ord.cancelOk, tone: 'danger' as const }
          : { title: t.ord.payQ, body: fill(t.ord.payB, { amount: money(o.balance_due, lang) }), confirmLabel: fill(t.ord.payOk, { amount: money(o.balance_due, lang) }) };
    if (!(await confirm(q))) return;
    setBusy(kind);
    try {
      if (kind === 'pay-balance') await secure.run((totp) => post(`/api/store/orders/${o.id}/pay-balance`, totp ? { totp } : {}));
      else await post(`/api/store/orders/${o.id}/${kind}`);
      toast(t.common.done);
      onChanged();
      void reload();
    } catch (e) {
      if (!(e instanceof ApiError && e.code === 'CANCELLED')) toast(err(e), 'error');
    } finally {
      setBusy(null);
    }
  };

  const openFile = async (it: any, purpose: 'download' | 'view') => {
    setBusy(it.id + purpose);
    try {
      const r = await post<{ url: string; purpose: string }>(`/api/store/orders/${o.id}/items/${it.id}/ticket`, { purpose });
      if (r.purpose === 'view') setReader({ url: r.url, title: it.name });
      else {
        await downloadFile(r.url, it.name);
        onChanged();
      }
    } catch (e) {
      toast(err(e), 'error');
    } finally {
      setBusy(null);
    }
  };

  return (
    <motion.article layout initial={{ opacity: 0, y: 14 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: Math.min(i, 8) * 0.04 }} className="card overflow-hidden">
      {secure.element}
      <button onClick={() => setOpen((v) => !v)} className="flex w-full items-start gap-3 p-5 text-start" aria-expanded={open}>
        <StoreLogo s={{ store_name: o.store_name ?? '—', logo_url: o.store_logo }} size={48} />
        <div className="min-w-0 flex-1">
          <p className="truncate font-display text-lg">
            {o.store_name}
            {o.branch_name ? <span className="text-muted"> · {o.branch_name}</span> : null}
          </p>
          <p className="num text-sm text-muted">
            #{String(o.id).slice(0, 8)} · {date(o.created_at, lang)}
          </p>
        </div>
        <div className="flex flex-col items-end gap-1">
          <Badge tone={tone}>{o.dispute_status === 'open' ? t.ord.disputed : t.ord.st[o.status] ?? o.status}</Badge>
          <p className="num font-display text-xl">{money(o.total_amount, lang)}</p>
        </div>
        <ChevronDown className={cx('mt-1 h-5 w-5 shrink-0 text-muted transition', open && 'rotate-180')} />
      </button>

      <AnimatePresence initial={false}>
        {open && (
          <motion.div initial={{ height: 0, opacity: 0 }} animate={{ height: 'auto', opacity: 1 }} exit={{ height: 0, opacity: 0 }} className="overflow-hidden">
            <div className="space-y-5 border-t border-line px-5 pb-5">
              {physical && o.status !== 'cancelled' && <Progress o={o} />}

              <ul className="space-y-2">
                {o.items.map((it: any) => (
                  <li key={it.id} className="flex items-center gap-3 rounded-2xl bg-sunk/70 p-2.5 text-sm">
                    <div className="h-12 w-12 shrink-0 overflow-hidden rounded-xl">
                      <ProductImage p={{ name: it.name, image_url: it.image_url }} />
                    </div>
                    <div className="min-w-0 flex-1">
                      <p className="truncate font-medium">
                        {it.quantity} × {it.name}
                      </p>
                      <p className="num text-xs text-muted">
                        {money(it.price, lang)}
                        {it.licence_code ? ` · ${it.licence_code}` : ''}
                      </p>
                    </div>
                    {it.is_digital && o.status !== 'cancelled' && (
                      <div className="flex shrink-0 flex-col items-end gap-1">
                        <div className="flex gap-1.5">
                          <Button size="sm" variant="secondary" loading={busy === it.id + 'view'} icon={<BookOpen className="h-4 w-4" />} onClick={() => openFile(it, 'view')}>
                            {t.ord.open}
                          </Button>
                          {it.digital_mode !== 'view' && (
                            <Button
                              size="sm"
                              loading={busy === it.id + 'download'}
                              disabled={it.downloads >= it.download_limit}
                              icon={<Download className="h-4 w-4" />}
                              onClick={() => openFile(it, 'download')}
                              aria-label={t.orders.download}
                            />
                          )}
                        </div>
                        {it.digital_mode !== 'view' && <span className="text-[11px] text-muted">{fill(t.ord.downloadsLeft, { n: Math.max(0, it.download_limit - it.downloads) })}</span>}
                      </div>
                    )}
                  </li>
                ))}
              </ul>

              {physical && (
                <div className="grid gap-3 text-sm sm:grid-cols-3">
                  <div className="rounded-2xl border border-line p-3">
                    <p className="text-muted">{t.ord.paidSoFar}</p>
                    <p className="num font-display text-lg">{money(o.amount_paid ?? o.total_amount, lang)}</p>
                  </div>
                  <div className={cx('rounded-2xl border p-3', due ? 'border-gold/50 bg-gold/10' : 'border-line')}>
                    <p className="text-muted">{t.ord.balanceDue}</p>
                    <p className="num font-display text-lg">{money(o.balance_due ?? 0, lang)}</p>
                  </div>
                  <div className="rounded-2xl border border-line p-3">
                    <p className="text-muted">{o.fulfillment === 'pickup' ? t.ord.pickupAt : t.ord.deliverTo}</p>
                    <p className="line-clamp-2">{o.fulfillment === 'pickup' ? o.store_address ?? o.store_name : o.delivery_address}</p>
                  </div>
                </div>
              )}

              {physical && held && o.handover_code && (
                <motion.div
                  initial={{ scale: 0.97, opacity: 0 }}
                  animate={{ scale: 1, opacity: 1 }}
                  className="relative overflow-hidden rounded-3xl bg-night p-5 text-white"
                >
                  <div className="flex flex-wrap items-center gap-5">
                    <div className="rounded-2xl bg-white p-2">
                      <QRImage value={`staler-handover:${o.id}:${o.handover_code}`} size={112} label={t.ord.handover} />
                    </div>
                    <div className="min-w-0 flex-1">
                      <p className="flex items-center gap-2 text-sm text-white/70">
                        <KeyRound className="h-4 w-4" /> {t.ord.handover}
                      </p>
                      <p className="num mt-1 font-display text-4xl tracking-[0.3em]" dir="ltr">
                        {o.handover_code}
                      </p>
                      <p className="mt-2 text-xs text-white/70">{t.ord.handoverLead}</p>
                    </div>
                  </div>
                </motion.div>
              )}

              {physical && pins.length > 0 && <MapView pins={pins} trail className="h-56" />}

              {(o.events as any[]).length > 0 && (
                <div>
                  <h3 className="mb-2 text-sm font-medium text-muted">{t.ord.timeline}</h3>
                  <ol className="relative space-y-3 border-s-2 border-dashed border-line ps-5">
                    {[...(o.events as any[])].reverse().map((e, k) => {
                      const Icon = EV_ICON[e.kind] ?? Package;
                      return (
                        <motion.li key={k} initial={{ opacity: 0, x: 10 }} animate={{ opacity: 1, x: 0 }} transition={{ delay: k * 0.05 }} className="relative">
                          <span className={cx('absolute -start-[1.95rem] top-0 grid h-7 w-7 place-items-center rounded-full border-2 border-surface', k === 0 ? 'bg-stitch text-white' : 'bg-sunk text-muted')}>
                            <Icon className="h-3.5 w-3.5" />
                          </span>
                          <p className="text-sm font-medium">{t.ord.ev[e.kind] ?? e.kind}</p>
                          {e.note && !['placed', 'balance_paid', 'released'].includes(e.kind) && <p className="text-sm text-muted">{e.note}</p>}
                          <p className="text-xs text-muted">{relative(e.at, lang)}</p>
                        </motion.li>
                      );
                    })}
                  </ol>
                </div>
              )}

              {held && (
                <div className="flex flex-wrap gap-2">
                  {due && (
                    <Button loading={busy === 'pay-balance'} icon={<CircleDollarSign className="h-4 w-4" />} onClick={() => act('pay-balance')}>
                      {fill(t.ord.payBalance, { amount: money(o.balance_due, lang) })}
                    </Button>
                  )}
                  {!due && o.dispute_status !== 'open' && (
                    <Button variant="stitch" loading={busy === 'confirm'} icon={<CheckCircle2 className="h-4 w-4" />} onClick={() => act('confirm')}>
                      {t.orders.confirm}
                    </Button>
                  )}
                  {o.status === 'processing' && o.dispute_status !== 'open' && (
                    <Button variant="danger" loading={busy === 'cancel'} icon={<XCircle className="h-4 w-4" />} onClick={() => act('cancel')}>
                      {t.orders.cancel}
                    </Button>
                  )}
                  {o.dispute_status !== 'open' && (
                    <Button variant="ghost" icon={<AlertTriangle className="h-4 w-4" />} onClick={() => setDispute(true)}>
                      {t.ord.dispute}
                    </Button>
                  )}
                </div>
              )}
              {held && (
                <p className="flex items-center gap-2 text-xs text-muted">
                  <ShieldCheck className="h-4 w-4 text-olive" /> {t.ord.protect}
                </p>
              )}
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      <Sheet open={dispute} onClose={() => setDispute(false)} title={t.ord.dispute}>
        <form
          className="space-y-4"
          onSubmit={async (e) => {
            e.preventDefault();
            setBusy('dispute');
            try {
              await post(`/api/store/orders/${o.id}/dispute`, { reason: reason.trim() });
              setDispute(false);
              setReason('');
              toast(t.common.done);
              onChanged();
            } catch (e2) {
              toast(err(e2), 'error');
            } finally {
              setBusy(null);
            }
          }}
        >
          <p className="text-muted">{t.ord.disputeLead}</p>
          <TextArea label={t.ord.disputeReason} value={reason} onChange={(e) => setReason(e.target.value)} required minLength={5} maxLength={500} rows={4} />
          <Button block variant="danger-solid" loading={busy === 'dispute'}>
            {t.ord.disputeSend}
          </Button>
        </form>
      </Sheet>
      <SecureReader url={reader?.url ?? null} title={reader?.title ?? ''} onClose={() => setReader(null)} />
    </motion.article>
  );
}

export function Orders() {
  const { t } = useI18n();
  const { data, loading, reload } = useData<{ orders: any[] }>('/api/store/orders');
  const [tab, setTab] = useState<'open' | 'all'>('open');
  const list = (data?.orders ?? []).filter((o) => tab === 'all' || o.escrow_status === 'held');
  return (
    <div className="mx-auto max-w-3xl">
      <PageHeader
        title={t.orders.title}
        actions={
          <Link to="/stores">
            <Button variant="secondary" icon={<StoreIcon className="h-4 w-4" />}>
              {t.shop.storesTitle}
            </Button>
          </Link>
        }
      />
      <div className="mb-4">
        <Chips label={t.tx.filter} value={tab} onChange={setTab} options={[{ value: 'open', label: t.ord.st.processing }, { value: 'all', label: t.common.all }]} />
      </div>
      {loading && !data ? (
        <Skeleton className="h-40 rounded-2xl" />
      ) : !list.length ? (
        <EmptyState
          icon={<Package className="h-6 w-6" />}
          title={t.orders.none}
          action={
            <Link to="/stores">
              <Button variant="secondary">{t.shop.storesTitle}</Button>
            </Link>
          }
        />
      ) : (
        <div className="space-y-4">
          {list.map((o, i) => (
            <OrderCard key={o.id} o={o} i={i} onChanged={() => void reload()} />
          ))}
        </div>
      )}
      <p className="mt-6 flex items-center justify-center gap-1.5 text-center text-xs text-muted">
        <ShieldCheck className="h-4 w-4" /> {t.ord.protect}
      </p>
    </div>
  );
}
