import { AnimatePresence, motion } from 'framer-motion';
import { createContext, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import { BookOpen, CheckCircle2, FileDown, LocateFixed, MapPin, Minus, Plus, Share2, ShieldCheck, ShoppingCart, Store as StoreIcon, Trash2, Truck } from 'lucide-react';
import { ApiError, assetUrl, newIdempotencyKey, post, PUBLIC_ORIGIN } from '../lib/api';
import { useAuth } from '../lib/auth';
import { useI18n } from '../lib/i18n';
import { fill, money } from '../lib/format';
import { useSecureAction } from './SecureAction';
import { useConfirm } from './Confirm';
import { Badge, Button, ErrorNote, Field, Segmented, Sheet, SuccessMark, TextArea, cx } from './ui';
import { StarMotif } from './Tatreez';
import { ShareSheet } from './Share';

export interface Product {
  id: string;
  name: string;
  description: string | null;
  price: string;
  compare_at_price?: string | null;
  image_url: string | null;
  stock: number;
  is_digital: boolean;
  digital_mode?: 'download' | 'view';
  store_name: string;
  store_slug?: string;
  branch_name?: string | null;
  store_logo?: string | null;
  merchant_id: string;
  category?: string | null;
  deposit_percent?: number;
  deposit_refundable?: boolean;
}

const cents = (v: string | number) => Math.round(Number(v) * 100);
/** What the buyer pays today for one line (deposit share for physical deposit items). */
export function payNowCents(p: Product, qty: number) {
  const line = cents(p.price) * qty;
  return !p.is_digital && (p.deposit_percent ?? 0) > 0 ? Math.ceil((line * (p.deposit_percent ?? 0)) / 100) : line;
}

// --------------------------------------------------------------------- cart
interface Line {
  product: Product;
  qty: number;
}
interface Cart {
  lines: Line[];
  add: (p: Product) => void;
  setQty: (id: string, q: number) => void;
  remove: (id: string) => void;
  clear: () => void;
  count: number;
}
const CartCtx = createContext<Cart | null>(null);
const CART_KEY = 'st.cart.v2';

export function CartProvider({ children }: { children: ReactNode }) {
  const [lines, setLines] = useState<Line[]>(() => {
    try {
      return JSON.parse(localStorage.getItem(CART_KEY) ?? '[]');
    } catch {
      return [];
    }
  });
  useEffect(() => {
    try {
      localStorage.setItem(CART_KEY, JSON.stringify(lines));
    } catch {
      /* private mode */
    }
  }, [lines]);
  const value = useMemo<Cart>(
    () => ({
      lines,
      count: lines.reduce((s, l) => s + l.qty, 0),
      add: (p) =>
        setLines((ls) => {
          const ex = ls.find((l) => l.product.id === p.id);
          if (ex) return ls.map((l) => (l.product.id === p.id ? { ...l, product: p, qty: p.is_digital ? 1 : Math.min(l.qty + 1, 99, Math.max(1, p.stock)) } : l));
          return [...ls, { product: p, qty: 1 }];
        }),
      setQty: (id, q) => setLines((ls) => ls.map((l) => (l.product.id === id ? { ...l, qty: Math.max(1, Math.min(q, 99)) } : l))),
      remove: (id) => setLines((ls) => ls.filter((l) => l.product.id !== id)),
      clear: () => setLines([]),
    }),
    [lines],
  );
  return <CartCtx.Provider value={value}>{children}</CartCtx.Provider>;
}
export const useCart = () => useContext(CartCtx)!;

export function CartButton({ onClick, className }: { onClick: () => void; className?: string }) {
  const { count } = useCart();
  const { t } = useI18n();
  return (
    <button onClick={onClick} className={cx('relative rounded-xl p-2.5 text-muted transition hover:bg-sunk hover:text-ink active:scale-95', className)} aria-label={t.store.cart}>
      <ShoppingCart className="h-5 w-5" />
      <AnimatePresence>
        {count > 0 && (
          <motion.span
            key={count}
            initial={{ scale: 0 }}
            animate={{ scale: 1 }}
            exit={{ scale: 0 }}
            className="num absolute end-1 top-1 grid h-4 min-w-4 place-items-center rounded-full bg-stitch px-1 text-[10px] font-bold text-white"
          >
            {count}
          </motion.span>
        )}
      </AnimatePresence>
    </button>
  );
}

// ------------------------------------------------------------- product art
export function ProductImage({ p, className }: { p: Pick<Product, 'name' | 'image_url'>; className?: string }) {
  const url = assetUrl(p.image_url);
  const [failed, setFailed] = useState(false);
  if (url && !failed) return <img src={url} alt={p.name} loading="lazy" onError={() => setFailed(true)} className={cx('h-full w-full object-cover', className)} />;
  // No photo: a stitched cover, colour chosen from the name so it stays stable.
  const hash = Array.from(p.name).reduce((h, c) => (h * 31 + c.charCodeAt(0)) >>> 0, 7);
  const covers = [
    ['#141B3D', '#E2506A', '#E9C060'],
    ['#2F3F18', '#E9C060', '#E2506A'],
    ['#5A1424', '#E9C060', '#9DBB5F'],
    ['#1C3B4A', '#E2506A', '#E9C060'],
  ] as const;
  const [bg, a, b] = covers[hash % covers.length]!;
  return (
    <div className={cx('relative grid h-full w-full place-items-center overflow-hidden', className)} style={{ background: bg }} aria-hidden="true">
      <StarMotif size={13} cell={10} className="absolute h-[85%] w-[85%] opacity-80" colors={[a, b]} animate={false} />
      <span className="relative grid h-14 w-14 place-items-center rounded-2xl bg-black/25 font-display text-2xl text-white backdrop-blur-sm">{Array.from(p.name.replace(/["«»]/g, ''))[0]}</span>
    </div>
  );
}

export function ProductCard({ p, onOpen, index, showStore = true }: { p: Product; onOpen: () => void; index: number; showStore?: boolean }) {
  const { t, lang } = useI18n();
  const soldOut = !p.is_digital && p.stock <= 0;
  const few = !p.is_digital && p.stock > 0 && p.stock <= 5;
  const off = p.compare_at_price && Number(p.compare_at_price) > Number(p.price) ? Math.round((1 - Number(p.price) / Number(p.compare_at_price)) * 100) : 0;
  return (
    <motion.button
      initial={{ opacity: 0, y: 24, scale: 0.97 }}
      animate={{ opacity: 1, y: 0, scale: 1 }}
      transition={{ delay: Math.min(index, 12) * 0.04, type: 'spring', bounce: 0.25 }}
      whileTap={{ scale: 0.97 }}
      onClick={onOpen}
      className={cx(
        'group relative flex flex-col overflow-hidden rounded-[1.4rem] border border-line bg-surface text-start transition duration-300 hover:-translate-y-1 hover:shadow-card',
        soldOut && 'opacity-80',
      )}
    >
      <div className="relative aspect-[4/5] overflow-hidden">
        <ProductImage p={p} className={cx('transition duration-700 group-hover:scale-110', soldOut && 'grayscale')} />
        <div className="absolute inset-x-2 top-2 flex flex-wrap gap-1.5">
          {p.is_digital && (
            <Badge tone="info">
              {p.digital_mode === 'view' ? <BookOpen className="h-3 w-3" /> : <FileDown className="h-3 w-3" />}
              {p.digital_mode === 'view' ? t.shop.viewOnly : t.store.digital}
            </Badge>
          )}
          {!soldOut && (p.deposit_percent ?? 0) > 0 && <Badge tone="warn">{fill(t.shop.deposit, { p: p.deposit_percent ?? 0 })}</Badge>}
          {!soldOut && off > 0 && <Badge tone="bad">{fill(t.shop.save, { p: off })}</Badge>}
        </div>
        {soldOut && (
          <div className="absolute inset-0 grid place-items-center bg-night/45 backdrop-blur-[1px]">
            <span className="-rotate-12 rounded-xl border-2 border-white/90 px-4 py-1.5 font-display text-xl tracking-wide text-white shadow-lg">{t.store.soldOut}</span>
          </div>
        )}
        {few && <span className="absolute bottom-2 start-2 rounded-full bg-night/75 px-2.5 py-1 text-[11px] font-medium text-white backdrop-blur">{fill(t.shop.fewLeft, { n: p.stock })}</span>}
      </div>
      <div className="flex flex-1 flex-col p-3.5">
        <p className="line-clamp-2 font-medium leading-snug">{p.name}</p>
        {showStore && <p className="mt-0.5 truncate text-xs text-muted">{p.branch_name ? `${p.store_name} · ${p.branch_name}` : p.store_name}</p>}
        <div className="mt-auto flex items-baseline gap-2 pt-3">
          <p className="num font-display text-lg">{money(p.price, lang)}</p>
          {off > 0 && <p className="num text-xs text-muted line-through">{money(p.compare_at_price!, lang)}</p>}
        </div>
      </div>
      <span className="pointer-events-none absolute inset-0 rounded-[1.4rem] border-2 border-dashed border-stitch/0 transition group-hover:border-stitch/40" />
    </motion.button>
  );
}

export function ProductSheet({ product, onClose, onAdded, storeUrl }: { product: Product | null; onClose: () => void; onAdded: () => void; storeUrl?: string }) {
  const { t, lang } = useI18n();
  const { add, setQty, lines, count } = useCart();
  const [share, setShare] = useState(false);
  const [qty, setQ] = useState(1);
  const [added, setAdded] = useState(false);
  const p = product;
  useEffect(() => {
    setQ(1);
    setAdded(false);
  }, [p?.id]);
  const soldOut = p ? !p.is_digital && p.stock <= 0 : false;
  const dep = p && !p.is_digital && (p.deposit_percent ?? 0) > 0;
  const shareUrl = p ? `${PUBLIC_ORIGIN}/s/${p.store_slug ?? ''}?p=${p.id}` : '';
  const max = p ? (p.is_digital ? 1 : Math.max(1, Math.min(99, p.stock))) : 1;
  const footer = p && (
    <div className="flex items-center gap-2.5">
      <button
        onClick={() => setShare(true)}
        className="grid h-12 w-12 shrink-0 place-items-center rounded-2xl bg-sunk text-ink transition active:scale-90"
        aria-label={t.shop.share}
      >
        <Share2 className="h-5 w-5" />
      </button>
      {!p.is_digital && !soldOut && !added && (
        <div className="flex h-12 shrink-0 items-center rounded-2xl bg-sunk" aria-label={t.shop.qty}>
          <button onClick={() => setQ(Math.max(1, qty - 1))} disabled={qty <= 1} className="grid h-12 w-10 place-items-center disabled:opacity-30" aria-label="−">
            <Minus className="h-4 w-4" />
          </button>
          <span className="num w-6 text-center font-semibold">{qty}</span>
          <button onClick={() => setQ(Math.min(max, qty + 1))} disabled={qty >= max} className="grid h-12 w-10 place-items-center disabled:opacity-30" aria-label="+">
            <Plus className="h-4 w-4" />
          </button>
        </div>
      )}
      <AnimatePresence mode="wait" initial={false}>
        {added ? (
          <motion.div key="view" className="flex-1" initial={{ y: 14, opacity: 0 }} animate={{ y: 0, opacity: 1 }}>
            <Button
              block
              size="lg"
              variant="primary"
              icon={<CheckCircle2 className="h-5 w-5 text-[#9DE07B]" />}
              onClick={() => {
                onClose();
                onAdded();
              }}
            >
              {fill(t.shop.viewCart, { n: count })}
            </Button>
          </motion.div>
        ) : (
          <motion.div key="add" className="flex-1" exit={{ y: -14, opacity: 0 }}>
            <Button
              block
              size="lg"
              variant="stitch"
              disabled={soldOut}
              icon={<ShoppingCart className="h-5 w-5" />}
              onClick={() => {
                const had = lines.find((l) => l.product.id === p.id)?.qty ?? 0;
                add(p);
                if (!p.is_digital) setQty(p.id, Math.min(max, had + qty));
                setAdded(true);
              }}
            >
              {soldOut ? t.store.soldOut : t.store.add}
            </Button>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
  return (
    <>
      <Sheet open={!!p} onClose={onClose} title={p?.name ?? ''} wide footer={footer}>
        {p && (
          <div className="grid gap-5 sm:grid-cols-2 sm:gap-6">
            <motion.div layoutId={`img-${p.id}`} className="relative aspect-[4/3] overflow-hidden rounded-3xl sm:aspect-square">
              <ProductImage p={p} />
              {soldOut && (
                <div className="absolute inset-0 grid place-items-center bg-night/45">
                  <span className="-rotate-12 rounded-xl border-2 border-white/90 px-4 py-1.5 font-display text-xl text-white">{t.store.soldOut}</span>
                </div>
              )}
            </motion.div>
            <div className="flex min-w-0 flex-col">
              {p.store_slug ? (
                <Link to={storeUrl ?? `/s/${p.store_slug}`} onClick={onClose} className="flex items-center gap-2 text-sm text-muted hover:text-ink">
                  <StoreIcon className="h-4 w-4" /> {p.store_name}
                  {p.branch_name ? ` · ${p.branch_name}` : ''}
                </Link>
              ) : (
                <p className="text-sm text-muted">{p.store_name}</p>
              )}
              <div className="mt-2 flex items-baseline gap-3">
                <p className="num font-display text-4xl">{money(p.price, lang)}</p>
                {p.compare_at_price && Number(p.compare_at_price) > Number(p.price) && <p className="num text-muted line-through">{money(p.compare_at_price, lang)}</p>}
              </div>
              <div className="mt-3 flex flex-wrap gap-2">
                {p.is_digital ? (
                  <Badge tone="info">
                    {p.digital_mode === 'view' ? <BookOpen className="h-3.5 w-3.5" /> : <FileDown className="h-3.5 w-3.5" />}
                    {p.digital_mode === 'view' ? t.shop.viewOnly : t.shop.downloadable}
                  </Badge>
                ) : (
                  <Badge tone={soldOut ? 'bad' : 'good'}>
                    <Truck className="h-3.5 w-3.5" /> {soldOut ? t.store.soldOut : `${p.stock} ${t.store.inStock}`}
                  </Badge>
                )}
              </div>
              {p.description && <p className="mt-4 whitespace-pre-line break-words text-muted">{p.description}</p>}
              {dep && (
                <div className="mt-4 rounded-2xl border border-gold/40 bg-gold/10 p-3.5 text-sm">
                  <p className="font-medium">{fill(t.shop.deposit, { p: p.deposit_percent ?? 0 })}</p>
                  <p className="mt-1 text-ink/80">
                    {fill(t.shop.depositLong, { amount: money(payNowCents(p, 1) / 100, lang), rest: money((cents(p.price) - payNowCents(p, 1)) / 100, lang) })}
                  </p>
                  {p.deposit_refundable === false && <p className="mt-1 text-xs text-muted">{t.shop.depositNonRefundable}</p>}
                </div>
              )}
              <p className="mt-4 flex items-start gap-2 rounded-2xl bg-olive/10 p-3 text-sm text-olive">
                <ShieldCheck className="mt-0.5 h-4 w-4 shrink-0" />
                {p.is_digital ? t.shop.digitalProtected : t.ord.protect}
              </p>
            </div>
          </div>
        )}
      </Sheet>
      {p && <ShareSheet open={share} onClose={() => setShare(false)} url={shareUrl} title={p.name} />}
    </>
  );
}

// ---------------------------------------------------------------- checkout
export function CartSheet({ open, onClose, ordersHref = '/app/orders' }: { open: boolean; onClose: () => void; ordersHref?: string }) {
  const { t, lang, err } = useI18n();
  const { user, reload } = useAuth();
  const nav = useNavigate();
  const loc = useLocation();
  const { lines, setQty, remove, clear } = useCart();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<any>(null);
  const [how, setHow] = useState<'delivery' | 'pickup'>('delivery');
  const [address, setAddress] = useState('');
  const [phone, setPhone] = useState('');
  const [note, setNote] = useState('');
  const [geo, setGeo] = useState<{ lat: number; lng: number } | null>(null);
  const [locating, setLocating] = useState(false);
  const key = useRef(newIdempotencyKey());
  const secure = useSecureAction();
  const confirm = useConfirm();
  const physical = lines.some((l) => !l.product.is_digital);
  const full = lines.reduce((s, l) => s + cents(l.product.price) * l.qty, 0);
  const now = lines.reduce((s, l) => s + payNowCents(l.product, l.qty), 0);

  const locate = () => {
    if (!navigator.geolocation) return;
    setLocating(true);
    navigator.geolocation.getCurrentPosition(
      (p) => {
        setGeo({ lat: +p.coords.latitude.toFixed(5), lng: +p.coords.longitude.toFixed(5) });
        setLocating(false);
      },
      () => setLocating(false),
      { enableHighAccuracy: true, timeout: 10_000 },
    );
  };

  const checkout = async () => {
    if (!user) return nav('/login', { state: { from: loc.pathname + loc.search } });
    if (physical && how === 'delivery' && address.trim().length < 5) return setError(t.shop.addressPh);
    const count = lines.reduce((n, l) => n + l.qty, 0);
    const ok = await confirm({
      title: t.ask.buyTitle,
      body: fill(t.ask.buyBody, { total: money(now / 100, lang), count }),
      confirmLabel: fill(t.ask.buyOk, { total: money(now / 100, lang) }),
    });
    if (!ok) return;
    setBusy(true);
    setError(null);
    try {
      const r = await secure.run((totp) =>
        post(
          '/api/store/checkout',
          {
            items: lines.map((l) => ({ productId: l.product.id, quantity: l.qty })),
            ...(physical ? { fulfillment: how } : {}),
            ...(physical && how === 'delivery' ? { address: address.trim() } : {}),
            ...(physical && phone.trim() ? { phone: phone.trim() } : {}),
            ...(physical && geo ? geo : {}),
            ...(note.trim() ? { note: note.trim() } : {}),
            ...(totp ? { totp } : {}),
          },
          key.current,
        ),
      );
      setDone(r);
      clear();
      key.current = newIdempotencyKey();
      void reload();
    } catch (e) {
      if (!(e instanceof ApiError && e.code === 'CANCELLED')) setError(err(e));
      key.current = newIdempotencyKey();
    } finally {
      setBusy(false);
    }
  };

  const askRemove = async (l: Line) => {
    if (await confirm({ title: t.shop.removeQ, body: fill(t.shop.removeB, { name: l.product.name }), confirmLabel: t.shop.removeOk, tone: 'danger' })) remove(l.product.id);
  };

  const footer =
    !done && lines.length ? (
      <div>
        <div className="flex items-end justify-between gap-3">
          <div>
            {now !== full && (
              <p className="text-xs text-muted">
                {t.shop.totalLater} <span className="num">{money((full - now) / 100, lang)}</span>
              </p>
            )}
            <p className="text-sm text-muted">{now !== full ? t.shop.payNow : t.common.total}</p>
          </div>
          <motion.p key={now} initial={{ scale: 1.15 }} animate={{ scale: 1 }} className="num font-display text-2xl">
            {money(now / 100, lang)}
          </motion.p>
        </div>
        <ErrorNote>{error}</ErrorNote>
        <Button block size="lg" variant="stitch" className="mt-3" loading={busy} onClick={checkout} icon={<ShieldCheck className="h-5 w-5" />}>
          {user ? t.store.checkout : t.store.loginToBuy}
        </Button>
      </div>
    ) : undefined;

  return (
    <Sheet
      footer={footer}
      open={open}
      onClose={() => {
        setDone(null);
        onClose();
      }}
      title={t.store.cart}
    >
      {secure.element}
      {done ? (
        <div className="py-4 text-center">
          <SuccessMark />
          <h3 className="mt-5 text-xl">{t.store.paid}</h3>
          <p className="num mt-1 font-display text-2xl">{money(done.total, lang)}</p>
          <p className="mt-3 text-sm text-muted">{t.ord.protect}</p>
          <Link to={user ? ordersHref : '/login'} onClick={onClose}>
            <Button block className="mt-6">
              {t.nav.orders}
            </Button>
          </Link>
        </div>
      ) : !lines.length ? (
        <div className="py-10 text-center">
          <motion.div initial={{ rotate: -8, scale: 0.8 }} animate={{ rotate: 0, scale: 1 }} transition={{ type: 'spring' }} className="mx-auto grid h-20 w-20 place-items-center rounded-full bg-sunk">
            <ShoppingCart className="h-9 w-9 text-muted" />
          </motion.div>
          <p className="mt-4 text-muted">{t.store.emptyCart}</p>
        </div>
      ) : (
        <div>
          <ul className="divide-y divide-line">
            <AnimatePresence initial={false}>
              {lines.map((l) => (
                <motion.li key={l.product.id} layout exit={{ opacity: 0, x: 40, height: 0 }} className="flex items-center gap-3 py-3">
                  <div className="h-14 w-14 shrink-0 overflow-hidden rounded-xl">
                    <ProductImage p={l.product} />
                  </div>
                  <div className="min-w-0 flex-1">
                    <p className="truncate font-medium">{l.product.name}</p>
                    <p className="num text-sm text-muted">
                      {money(l.product.price, lang)}
                      {(l.product.deposit_percent ?? 0) > 0 && !l.product.is_digital && <span className="ms-1 text-gold">· {fill(t.shop.deposit, { p: l.product.deposit_percent ?? 0 })}</span>}
                    </p>
                  </div>
                  {!l.product.is_digital && (
                    <div className="flex items-center gap-1 rounded-xl border border-line">
                      <button onClick={() => setQty(l.product.id, l.qty - 1)} disabled={l.qty <= 1} className="p-2 text-muted hover:text-ink disabled:opacity-30" aria-label="−">
                        <Minus className="h-4 w-4" />
                      </button>
                      <span className="num w-6 text-center">{l.qty}</span>
                      <button onClick={() => setQty(l.product.id, Math.min(l.qty + 1, Math.max(1, l.product.stock)))} className="p-2 text-muted hover:text-ink" aria-label="+">
                        <Plus className="h-4 w-4" />
                      </button>
                    </div>
                  )}
                  <button onClick={() => askRemove(l)} className="rounded-xl p-2.5 text-muted transition hover:bg-stitch/10 hover:text-stitch" aria-label={t.store.remove}>
                    <Trash2 className="h-4 w-4" />
                  </button>
                </motion.li>
              ))}
            </AnimatePresence>
          </ul>
          <button
            onClick={async () => {
              if (await confirm({ title: t.shop.clearQ, body: t.shop.clearB, confirmLabel: t.shop.clearOk, tone: 'danger' })) clear();
            }}
            className="mt-1 text-xs text-muted underline-offset-4 hover:text-stitch hover:underline"
          >
            {t.shop.clearCart}
          </button>

          {physical && (
            <div className="mt-5 space-y-3 rounded-2xl border border-line p-4">
              <p className="text-sm font-medium">{t.shop.howGet}</p>
              <Segmented value={how} onChange={setHow} options={[{ value: 'delivery', label: t.shop.delivery }, { value: 'pickup', label: t.shop.pickup }]} />
              {how === 'delivery' && (
                <>
                  <TextArea label={t.shop.address} placeholder={t.shop.addressPh} value={address} onChange={(e) => setAddress(e.target.value)} rows={2} maxLength={300} />
                  <div className="flex flex-wrap items-center gap-2">
                    <Button type="button" size="sm" variant="secondary" loading={locating} icon={geo ? <MapPin className="h-4 w-4" /> : <LocateFixed className="h-4 w-4" />} onClick={locate}>
                      {geo ? t.shop.located : t.shop.useLocation}
                    </Button>
                    {geo && <span className="num text-xs text-muted" dir="ltr">{`${geo.lat}, ${geo.lng}`}</span>}
                  </div>
                </>
              )}
              <Field label={t.shop.phone} type="tel" dir="ltr" value={phone} onChange={(e) => setPhone(e.target.value)} autoComplete="tel" />
              <Field label={t.shop.note} value={note} onChange={(e) => setNote(e.target.value)} maxLength={300} />
            </div>
          )}
          <p className="mt-4 flex items-center justify-center gap-1.5 text-center text-xs text-muted">
            <ShieldCheck className="h-3.5 w-3.5" /> {t.ord.protect}
          </p>
        </div>
      )}
    </Sheet>
  );
}
