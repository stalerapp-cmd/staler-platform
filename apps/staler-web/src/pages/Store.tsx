import { AnimatePresence, motion } from 'framer-motion';
import { createContext, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { ArrowDownUp, Download, FileDown, Minus, Package, Plus, Search, ShoppingCart, Trash2, Truck } from 'lucide-react';
import { ApiError, assetUrl, downloadFile, get, newIdempotencyKey, post } from '../lib/api';
import { useAuth } from '../lib/auth';
import { useI18n } from '../lib/i18n';
import { useData } from '../lib/hooks';
import { date, money } from '../lib/format';
import { useSecureAction } from '../components/SecureAction';
import { useToast } from '../components/Toast';
import { Badge, Button, Chips, EmptyState, ErrorNote, PageHeader, Select, Sheet, Skeleton, SuccessMark, cx } from '../components/ui';
import { StarMotif } from '../components/Tatreez';
import { useConfirm } from '../components/Confirm';
import { fill } from '../lib/format';

export interface Product {
  id: string;
  name: string;
  description: string | null;
  price: string;
  image_url: string | null;
  stock: number;
  is_digital: boolean;
  store_name: string;
  merchant_id: string;
  category?: string | null;
  store_description?: string | null;
}

// --------------------------------------------------------------------- cart
interface Line {
  product: Product;
  qty: number;
}
const CartCtx = createContext<{
  lines: Line[];
  add: (p: Product) => void;
  setQty: (id: string, q: number) => void;
  clear: () => void;
  count: number;
} | null>(null);

export function CartProvider({ children }: { children: ReactNode }) {
  const [lines, setLines] = useState<Line[]>(() => {
    try {
      return JSON.parse(sessionStorage.getItem('st.cart') ?? '[]');
    } catch {
      return [];
    }
  });
  useEffect(() => {
    try {
      sessionStorage.setItem('st.cart', JSON.stringify(lines));
    } catch {
      /* ignore */
    }
  }, [lines]);
  const value = useMemo(
    () => ({
      lines,
      count: lines.reduce((s, l) => s + l.qty, 0),
      add: (p: Product) =>
        setLines((ls) => {
          const ex = ls.find((l) => l.product.id === p.id);
          if (ex) return ls.map((l) => (l.product.id === p.id ? { ...l, qty: p.is_digital ? 1 : Math.min(l.qty + 1, 99, p.stock) } : l));
          return [...ls, { product: p, qty: 1 }];
        }),
      setQty: (id: string, q: number) => setLines((ls) => (q <= 0 ? ls.filter((l) => l.product.id !== id) : ls.map((l) => (l.product.id === id ? { ...l, qty: Math.min(q, 99) } : l)))),
      clear: () => setLines([]),
    }),
    [lines],
  );
  return <CartCtx.Provider value={value}>{children}</CartCtx.Provider>;
}
export const useCart = () => useContext(CartCtx)!;

// ------------------------------------------------------------- product art
function ProductImage({ p, className }: { p: Product; className?: string }) {
  const url = assetUrl(p.image_url);
  const [failed, setFailed] = useState(false);
  if (url && !failed) {
    return <img src={url} alt={p.name} loading="lazy" onError={() => setFailed(true)} className={cx('h-full w-full object-cover', className)} />;
  }
  // No photo: a stitched cover, colour chosen from the product name so it stays stable.
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

function ProductCard({ p, onOpen, index }: { p: Product; onOpen: () => void; index: number }) {
  const { t, lang } = useI18n();
  const soldOut = !p.is_digital && p.stock <= 0;
  return (
    <motion.button
      initial={{ opacity: 0, y: 14 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ delay: Math.min(index, 12) * 0.04 }}
      onClick={onOpen}
      className="group relative flex flex-col overflow-hidden rounded-2xl border border-line bg-surface text-start transition hover:-translate-y-1 hover:shadow-card"
    >
      <div className="relative aspect-[4/5] overflow-hidden">
        <ProductImage p={p} className="transition duration-500 group-hover:scale-105" />
        <div className="absolute start-2 top-2">
          {p.is_digital ? <Badge tone="info">{t.store.digital}</Badge> : soldOut ? <Badge tone="bad">{t.store.soldOut}</Badge> : null}
        </div>
      </div>
      <div className="flex flex-1 flex-col p-3.5">
        <p className="line-clamp-2 font-medium leading-snug">{p.name}</p>
        <p className="mt-0.5 truncate text-xs text-muted">{p.store_name}</p>
        <p className="num mt-auto pt-3 font-display text-lg">{money(p.price, lang)}</p>
      </div>
      <span className="pointer-events-none absolute inset-0 rounded-2xl border-2 border-dashed border-stitch/0 transition group-hover:border-stitch/40" />
    </motion.button>
  );
}

// ------------------------------------------------------------------- store
export default function Store({ publicMode = false }: { publicMode?: boolean }) {
  const { t, err } = useI18n();
  const { count } = useCart();
  const [q, setQ] = useState('');
  const [type, setType] = useState<'' | 'digital' | 'physical'>('');
  const [sort, setSort] = useState('new');
  const [items, setItems] = useState<Product[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [open, setOpen] = useState<Product | null>(null);
  const [cartOpen, setCartOpen] = useState(false);
  const seq = useRef(0);

  useEffect(() => {
    const n = ++seq.current;
    const h = setTimeout(async () => {
      try {
        const p = new URLSearchParams({ limit: '60', sort });
        if (q.trim()) p.set('q', q.trim());
        if (type) p.set('type', type);
        const d = await get<{ products: Product[] }>(`/api/store/products?${p}`);
        if (n === seq.current) setItems(d.products);
      } catch (e) {
        if (n === seq.current) setError(err(e));
      }
    }, 250);
    return () => clearTimeout(h);
  }, [q, type, sort, err]);

  return (
    <div className={publicMode ? 'mx-auto max-w-6xl px-5 py-8' : ''}>
      <PageHeader
        title={t.store.title}
        lead={t.store.lead}
        actions={
          <Button variant="secondary" onClick={() => setCartOpen(true)} icon={<ShoppingCart className="h-5 w-5" />}>
            {t.store.cart}
            {count > 0 && <span className="num ms-1 rounded-full bg-stitch px-2 text-xs text-white">{count}</span>}
          </Button>
        }
      />
      <div className="mb-6 space-y-3">
        <div className="flex flex-wrap items-center gap-3">
          <label className="relative min-w-[220px] flex-1">
            <span className="sr-only">{t.common.search}</span>
            <Search className="pointer-events-none absolute start-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted" />
            <input value={q} onChange={(e) => setQ(e.target.value)} placeholder={t.store.search} className="field h-12 ps-10" type="search" />
          </label>
          <Select
            label={t.store.sortBy}
            value={sort as any}
            onChange={(v) => setSort(v)}
            icon={<ArrowDownUp className="h-4 w-4" />}
            options={Object.entries(t.store.sort).map(([k, v]) => ({ value: k, label: v }))}
            className="min-w-[200px]"
          />
        </div>
        <Chips
          label={t.tx.filter}
          value={(type || 'all') as any}
          onChange={(v: string) => setType((v === 'all' ? '' : v) as any)}
          options={[
            { value: 'all', label: t.common.all },
            { value: 'digital', label: t.store.digital },
            { value: 'physical', label: t.store.physical },
          ]}
        />
      </div>
      <ErrorNote>{error}</ErrorNote>
      {!items ? (
        <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-4">
          {Array.from({ length: 8 }).map((_, i) => (
            <Skeleton key={i} className="aspect-[4/6] rounded-2xl" />
          ))}
        </div>
      ) : items.length ? (
        <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-4">
          {items.map((p, i) => (
            <ProductCard key={p.id} p={p} index={i} onOpen={() => setOpen(p)} />
          ))}
        </div>
      ) : (
        <EmptyState icon={<Package className="h-6 w-6" />} title={t.store.noProducts} />
      )}
      <ProductSheet product={open} onClose={() => setOpen(null)} onAdded={() => setCartOpen(true)} />
      <CartSheet open={cartOpen} onClose={() => setCartOpen(false)} publicMode={publicMode} />
    </div>
  );
}

function ProductSheet({ product, onClose, onAdded }: { product: Product | null; onClose: () => void; onAdded: () => void }) {
  const { t, lang } = useI18n();
  const { add } = useCart();
  if (!product) return <Sheet open={false} onClose={onClose} title="">{null}</Sheet>;
  const soldOut = !product.is_digital && product.stock <= 0;
  return (
    <Sheet open={!!product} onClose={onClose} title={product.name} wide>
      <div className="grid gap-6 sm:grid-cols-2">
        <div className="aspect-square overflow-hidden rounded-2xl">
          <ProductImage p={product} />
        </div>
        <div className="flex flex-col">
          <p className="text-sm text-muted">
            {t.store.by} {product.store_name}
          </p>
          <p className="num mt-2 font-display text-4xl">{money(product.price, lang)}</p>
          <div className="mt-3 flex flex-wrap gap-2">
            {product.is_digital ? (
              <Badge tone="info">
                <FileDown className="h-3.5 w-3.5" /> {t.store.digital}
              </Badge>
            ) : (
              <Badge tone={soldOut ? 'bad' : 'good'}>
                <Truck className="h-3.5 w-3.5" /> {soldOut ? t.store.soldOut : `${product.stock} ${t.store.inStock}`}
              </Badge>
            )}
          </div>
          {product.description && <p className="mt-4 whitespace-pre-line text-muted">{product.description}</p>}
          {!product.is_digital && <p className="mt-4 rounded-xl bg-olive/10 p-3 text-sm text-olive">{t.store.escrow}</p>}
          <Button
            className="mt-auto"
            block
            size="lg"
            variant="stitch"
            disabled={soldOut}
            icon={<ShoppingCart className="h-5 w-5" />}
            onClick={() => {
              add(product);
              onClose();
              onAdded();
            }}
          >
            {t.store.add}
          </Button>
        </div>
      </div>
    </Sheet>
  );
}

function CartSheet({ open, onClose, publicMode }: { open: boolean; onClose: () => void; publicMode: boolean }) {
  const { t, lang, err } = useI18n();
  const { user, reload } = useAuth();
  const nav = useNavigate();
  const { lines, setQty, clear } = useCart();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<any>(null);
  const key = useRef(newIdempotencyKey());
  const secure = useSecureAction();
  const total = lines.reduce((s, l) => s + Math.round(Number(l.product.price) * 100) * l.qty, 0) / 100;
  const confirm = useConfirm();

  const checkout = async () => {
    if (!user) return nav('/login', { state: { from: '/app/store' } });
    const count = lines.reduce((n, l) => n + l.qty, 0);
    const ok = await confirm({
      title: t.ask.buyTitle,
      body: fill(t.ask.buyBody, { total: money(total, lang), count }),
      confirmLabel: fill(t.ask.buyOk, { total: money(total, lang) }),
    });
    if (!ok) return;
    setBusy(true);
    setError(null);
    try {
      const r = await secure.run((totp) =>
        post('/api/store/checkout', { items: lines.map((l) => ({ productId: l.product.id, quantity: l.qty })), ...(totp ? { totp } : {}) }, key.current),
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

  return (
    <Sheet
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
          <p className="mt-3 text-sm text-muted">{t.store.paidLead}</p>
          <Link to="/app/orders" onClick={onClose}>
            <Button block className="mt-6">
              {t.nav.orders}
            </Button>
          </Link>
        </div>
      ) : !lines.length ? (
        <p className="py-10 text-center text-muted">{t.store.emptyCart}</p>
      ) : (
        <div>
          <ul className="divide-y divide-line">
            <AnimatePresence initial={false}>
              {lines.map((l) => (
                <motion.li key={l.product.id} layout exit={{ opacity: 0, height: 0 }} className="flex items-center gap-3 py-3">
                  <div className="h-14 w-14 shrink-0 overflow-hidden rounded-xl">
                    <ProductImage p={l.product} />
                  </div>
                  <div className="min-w-0 flex-1">
                    <p className="truncate font-medium">{l.product.name}</p>
                    <p className="num text-sm text-muted">{money(l.product.price, lang)}</p>
                  </div>
                  {l.product.is_digital ? (
                    <button onClick={() => setQty(l.product.id, 0)} className="rounded-lg p-2 text-muted hover:text-stitch" aria-label={t.store.remove}>
                      <Trash2 className="h-4 w-4" />
                    </button>
                  ) : (
                    <div className="flex items-center gap-1 rounded-xl border border-line">
                      <button onClick={() => setQty(l.product.id, l.qty - 1)} className="p-2 text-muted hover:text-ink" aria-label="−">
                        <Minus className="h-4 w-4" />
                      </button>
                      <span className="num w-6 text-center">{l.qty}</span>
                      <button onClick={() => setQty(l.product.id, Math.min(l.qty + 1, l.product.stock))} className="p-2 text-muted hover:text-ink" aria-label="+">
                        <Plus className="h-4 w-4" />
                      </button>
                    </div>
                  )}
                </motion.li>
              ))}
            </AnimatePresence>
          </ul>
          <div className="mt-4 flex items-center justify-between border-t border-dashed border-line pt-4">
            <span className="text-muted">{t.common.total}</span>
            <span className="num font-display text-2xl">{money(total, lang)}</span>
          </div>
          <ErrorNote>{error}</ErrorNote>
          <Button block size="lg" variant="stitch" className="mt-5" loading={busy} onClick={checkout}>
            {user ? t.store.checkout : t.store.loginToBuy}
          </Button>
          {publicMode && !user && <p className="mt-2 text-center text-xs text-muted">{t.store.loginToBuy}</p>}
        </div>
      )}
    </Sheet>
  );
}

// ------------------------------------------------------------------- orders
export function Orders() {
  const { t, lang, err } = useI18n();
  const toast = useToast();
  const { reload } = useAuth();
  const { data, loading, reload: refresh } = useData<{ orders: any[] }>('/api/store/orders');
  const [confirm, setConfirm] = useState<{ id: string; kind: 'confirm' | 'cancel' } | null>(null);
  const [busy, setBusy] = useState(false);
  const tone = (s: string) => (s === 'completed' ? 'good' : s === 'cancelled' ? 'bad' : s === 'shipped' ? 'info' : 'warn');

  return (
    <div className="mx-auto max-w-3xl">
      <PageHeader title={t.orders.title} />
      {loading && !data ? (
        <Skeleton className="h-40 rounded-2xl" />
      ) : !data?.orders.length ? (
        <EmptyState
          icon={<Package className="h-6 w-6" />}
          title={t.orders.none}
          action={
            <Link to="/app/store">
              <Button variant="secondary">{t.nav.store}</Button>
            </Link>
          }
        />
      ) : (
        <div className="space-y-4">
          {data.orders.map((o, i) => (
            <motion.article key={o.id} initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: i * 0.04 }} className="card p-5">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div>
                  <p className="font-display text-lg">{o.store_name}</p>
                  <p className="num text-sm text-muted">
                    #{String(o.id).slice(0, 8)} · {date(o.created_at, lang)}
                  </p>
                </div>
                <div className="text-end">
                  <Badge tone={tone(o.status)}>{t.orders.st[o.status] ?? o.status}</Badge>
                  <p className="num mt-1 font-display text-xl">{money(o.total_amount, lang)}</p>
                </div>
              </div>
              <ul className="mt-4 space-y-2">
                {o.items.map((it: any) => (
                  <li key={it.id} className="flex items-center justify-between gap-3 rounded-xl bg-sunk px-3 py-2 text-sm">
                    <span className="min-w-0 truncate">
                      {it.quantity} × {it.name}
                    </span>
                    {it.is_digital && o.status !== 'cancelled' && (
                      <Button
                        size="sm"
                        variant="secondary"
                        icon={<Download className="h-4 w-4" />}
                        onClick={() => downloadFile(`/api/store/orders/${o.id}/items/${it.id}/download`, it.name).catch((e) => toast(err(e), 'error'))}
                      >
                        {t.orders.download}
                      </Button>
                    )}
                  </li>
                ))}
              </ul>
              {o.escrow_status === 'held' && (
                <div className="mt-4 flex flex-wrap gap-2">
                  <Button size="sm" onClick={() => setConfirm({ id: o.id, kind: 'confirm' })}>
                    {t.orders.confirm}
                  </Button>
                  {o.status === 'processing' && (
                    <Button size="sm" variant="danger" onClick={() => setConfirm({ id: o.id, kind: 'cancel' })}>
                      {t.orders.cancel}
                    </Button>
                  )}
                </div>
              )}
            </motion.article>
          ))}
        </div>
      )}
      <Sheet open={!!confirm} onClose={() => setConfirm(null)} title={confirm?.kind === 'cancel' ? t.orders.cancel : t.orders.confirm}>
        <p className="text-muted">{confirm?.kind === 'cancel' ? t.orders.cancelQ : t.orders.confirmQ}</p>
        <div className="mt-6 grid grid-cols-2 gap-3">
          <Button variant="secondary" onClick={() => setConfirm(null)}>
            {t.common.no}
          </Button>
          <Button
            variant={confirm?.kind === 'cancel' ? 'danger' : 'primary'}
            loading={busy}
            onClick={async () => {
              if (!confirm) return;
              setBusy(true);
              try {
                await post(`/api/store/orders/${confirm.id}/${confirm.kind}`);
                toast(t.common.done);
                void refresh();
                void reload();
              } catch (e) {
                toast(err(e), 'error');
              } finally {
                setBusy(false);
                setConfirm(null);
              }
            }}
          >
            {t.common.yes}
          </Button>
        </div>
      </Sheet>
    </div>
  );
}
