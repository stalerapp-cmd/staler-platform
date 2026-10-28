import { AnimatePresence, motion, useScroll, useTransform } from 'framer-motion';
import { useEffect, useMemo, useRef, useState } from 'react';
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { Bike, ClipboardList, Map as MapIcon, MapPin, Package, Phone, Search, Share2, ShoppingBag, Store as StoreIcon } from 'lucide-react';
import { assetUrl, get } from '../lib/api';
import { useAuth } from '../lib/auth';
import { useI18n } from '../lib/i18n';
import { CartSheet, ProductCard, ProductSheet, useCart, type Product } from '../components/Commerce';
import { ShareSheet } from '../components/Share';
import { MapView } from '../components/MapView';
import { Button, Chips, EmptyState, Skeleton, cx } from '../components/ui';
import { PublicShell } from '../layouts/PublicShell';
import { CATEGORY_ICONS, StoreCover, StoreLogo, accentOf } from './Stores';

interface Branch {
  id: string;
  slug: string;
  store_name: string;
  branch_name: string | null;
  city: string | null;
  address: string | null;
  lat: number | null;
  lng: number | null;
  is_main: boolean;
}
interface Ad {
  id: string;
  kind: 'image' | 'video';
  media_url: string;
  title: string | null;
  body: string | null;
  product_id: string | null;
}

/** One ad "story": image or muted looping video, with an optional product link. */
function AdCard({ ad, onOpen, i }: { ad: Ad; onOpen: () => void; i: number }) {
  const url = assetUrl(ad.media_url)!;
  return (
    <motion.button
      initial={{ opacity: 0, scale: 0.9, y: 20 }}
      animate={{ opacity: 1, scale: 1, y: 0 }}
      transition={{ delay: 0.25 + i * 0.07, type: 'spring', bounce: 0.3 }}
      whileHover={{ y: -4 }}
      whileTap={{ scale: 0.97 }}
      onClick={onOpen}
      className="group relative aspect-[4/5] w-[68%] shrink-0 snap-center overflow-hidden rounded-[1.6rem] bg-night text-start shadow-card sm:w-64"
    >
      {ad.kind === 'video' ? (
        <video src={url} autoPlay muted loop playsInline preload="metadata" className="h-full w-full object-cover" />
      ) : (
        <img src={url} alt="" loading="lazy" className="h-full w-full object-cover transition duration-700 group-hover:scale-105" />
      )}
      <div className="absolute inset-0 bg-gradient-to-t from-black/75 via-black/10 to-transparent" />
      {(ad.title || ad.body) && (
        <div className="absolute inset-x-0 bottom-0 p-4 text-white">
          {ad.title && <p className="font-display text-xl leading-tight">{ad.title}</p>}
          {ad.body && <p className="mt-1 line-clamp-2 text-sm text-white/80">{ad.body}</p>}
        </div>
      )}
    </motion.button>
  );
}

export default function StorePage() {
  const { slug } = useParams();
  const [params, setParams] = useSearchParams();
  const nav = useNavigate();
  const { t, err } = useI18n();
  const { user } = useAuth();
  const { count } = useCart();
  const [data, setData] = useState<{ store: any; branches: Branch[]; ads: Ad[] } | null>(null);
  const [missing, setMissing] = useState(false);
  const [products, setProducts] = useState<Product[] | null>(null);
  const [q, setQ] = useState('');
  const [type, setType] = useState('all');
  const [open, setOpen] = useState<Product | null>(null);
  const [cart, setCart] = useState(false);
  const [share, setShare] = useState(false);
  const [showMap, setShowMap] = useState(false);
  const heroRef = useRef<HTMLDivElement>(null);
  const { scrollYProgress } = useScroll({ target: heroRef, offset: ['start start', 'end start'] });
  const coverY = useTransform(scrollYProgress, [0, 1], [0, 90]);
  const coverScale = useTransform(scrollYProgress, [0, 1], [1, 1.12]);

  useEffect(() => {
    setData(null);
    setMissing(false);
    get(`/api/store/s/${slug}`)
      .then(setData)
      .catch(() => setMissing(true));
  }, [slug]);

  useEffect(() => {
    if (!slug) return;
    let alive = true;
    const h = setTimeout(async () => {
      try {
        const p = new URLSearchParams({ store: slug, limit: '100' });
        if (q.trim()) p.set('q', q.trim());
        if (type !== 'all') p.set('type', type);
        const d = await get<{ products: Product[] }>(`/api/store/products?${p}`);
        if (alive) setProducts(d.products);
      } catch (e) {
        if (alive) setProducts([]);
        console.warn(err(e));
      }
    }, 200);
    return () => {
      alive = false;
      clearTimeout(h);
    };
  }, [slug, q, type, err]);

  // ?p=<id> opens a shared product directly.
  useEffect(() => {
    const pid = params.get('p');
    if (!pid || !products) return;
    const hit = products.find((p) => p.id === pid);
    if (hit) setOpen(hit);
    else get<{ product: Product }>(`/api/store/products/${pid}`).then((r) => setOpen(r.product)).catch(() => {});
  }, [params, products]);

  const s = data?.store;
  const pins = useMemo(
    () => (data?.branches ?? []).filter((b) => b.lat != null && b.lng != null).map((b) => ({ lat: b.lat!, lng: b.lng!, label: b.branch_name ?? b.store_name, kind: 'store' as const })),
    [data],
  );
  const accent = s ? accentOf(s.main ?? s) : '#141B3D';
  const CatIcon = CATEGORY_ICONS[s?.main?.category ?? s?.category ?? 'other'] ?? StoreIcon;
  const shareUrl = `${location.origin}/s/${slug}`;
  const waPhone = s?.phone ? s.phone.replace(/[^\d]/g, '').replace(/^0/, '970') : null;

  if (missing)
    return (
      <PublicShell>
        <EmptyState
          icon={<StoreIcon className="h-6 w-6" />}
          title={t.shop.storeNotFound}
          action={
            <Link to="/stores">
              <Button variant="secondary">{t.shop.allStores}</Button>
            </Link>
          }
        />
      </PublicShell>
    );

  return (
    <PublicShell
      onCart={() => setCart(true)}
      brand={
        s ? (
          <Link to={`/s/${s.main?.slug ?? slug}`} className="flex min-w-0 items-center gap-2">
            <StoreLogo s={s.main ?? s} size={34} />
            <span className="truncate font-display text-lg">{s.store_name}</span>
          </Link>
        ) : undefined
      }
      className="pt-0 sm:pt-5"
    >
      {!s ? (
        <div className="space-y-4 pt-5">
          <Skeleton className="h-56 rounded-[2rem]" />
          <Skeleton className="h-24 rounded-2xl" />
        </div>
      ) : (
        <>
          {/* ---------------------------------------------------------- hero */}
          <section ref={heroRef} className="relative -mx-4 overflow-hidden sm:mx-0 sm:rounded-[2rem]" style={{ background: accent }}>
            <motion.div style={{ y: coverY, scale: coverScale }}>
              <StoreCover s={s.main ?? s} className="h-56 sm:h-72" />
            </motion.div>
          </section>
          <div className="relative px-1 sm:px-6">
            <motion.div className="-mt-12 inline-block" initial={{ scale: 0.6, rotate: -12, opacity: 0 }} animate={{ scale: 1, rotate: 0, opacity: 1 }} transition={{ type: 'spring', bounce: 0.45 }}>
              <StoreLogo s={s.main ?? s} size={96} />
            </motion.div>
            <motion.h1 initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} className="mt-3 font-display text-3xl leading-tight sm:text-4xl">
              {s.store_name}
              {s.branch_name && <span className="text-muted"> · {s.branch_name}</span>}
            </motion.h1>
            <p className="mt-1 text-sm text-muted">
              {t.shop.owner}: <span className="font-medium text-ink">{s.owner_name}</span>
            </p>
            {s.description && <p className="mt-4 max-w-2xl text-ink/80">{s.description}</p>}
            <div className="mt-4 flex flex-wrap gap-2 text-sm">
              <span className="flex items-center gap-1.5 rounded-full bg-sunk px-3 py-1.5">
                <CatIcon className="h-4 w-4" /> {t.shop.cat[s.main?.category ?? s.category ?? 'other']}
              </span>
              {(s.city || s.main?.city) && (
                <span className="flex items-center gap-1.5 rounded-full bg-sunk px-3 py-1.5">
                  <MapPin className="h-4 w-4" /> {s.city ?? s.main?.city}
                </span>
              )}
              {s.offers_delivery && (
                <span className="flex items-center gap-1.5 rounded-full bg-olive/15 px-3 py-1.5 text-olive">
                  <Bike className="h-4 w-4" /> {t.shop.delivery}
                </span>
              )}
              {s.offers_pickup && (
                <span className="flex items-center gap-1.5 rounded-full bg-sky/15 px-3 py-1.5 text-sky">
                  <ShoppingBag className="h-4 w-4" /> {t.shop.pickup}
                </span>
              )}
            </div>
            <div className="mt-4 flex flex-wrap gap-2">
              <Button variant="stitch" icon={<Share2 className="h-4 w-4" />} onClick={() => setShare(true)}>
                {t.shop.shareStore}
              </Button>
              {s.phone && (
                <a href={`tel:${s.phone}`}>
                  <Button variant="secondary" icon={<Phone className="h-4 w-4" />}>
                    {t.shop.call}
                  </Button>
                </a>
              )}
              {waPhone && (
                <a href={`https://wa.me/${waPhone}`} target="_blank" rel="noopener noreferrer">
                  <Button variant="secondary">{t.shop.whatsapp}</Button>
                </a>
              )}
              {pins.length > 0 && (
                <Button variant="ghost" icon={<MapIcon className="h-4 w-4" />} onClick={() => setShowMap((v) => !v)}>
                  {t.ord.map}
                </Button>
              )}
              {user && (
                <Link to="/app/orders">
                  <Button variant="ghost" icon={<ClipboardList className="h-4 w-4" />}>
                    {t.shop.yourOrders}
                  </Button>
                </Link>
              )}
            </div>
            <AnimatePresence>
              {showMap && (
                <motion.div initial={{ height: 0, opacity: 0 }} animate={{ height: 'auto', opacity: 1 }} exit={{ height: 0, opacity: 0 }} className="mt-4 overflow-hidden">
                  <MapView pins={pins} className="h-64" />
                </motion.div>
              )}
            </AnimatePresence>
          </div>

          {/* --------------------------------------------------------- ads */}
          {data!.ads.length > 0 && (
            <section className="mt-8">
              <h2 className="mb-3 px-1 text-xl">{t.shop.ads}</h2>
              <div className="-mx-4 flex snap-x snap-mandatory gap-3 overflow-x-auto px-4 pb-3 sm:mx-0 sm:px-0">
                {data!.ads.map((ad, i) => (
                  <AdCard
                    key={ad.id}
                    ad={ad}
                    i={i}
                    onOpen={() => {
                      if (ad.product_id) setParams({ p: ad.product_id }, { replace: true });
                    }}
                  />
                ))}
              </div>
            </section>
          )}

          {/* ----------------------------------------------------- branches */}
          {data!.branches.length > 1 && (
            <section className="mt-6">
              <div className="-mx-4 flex gap-2 overflow-x-auto px-4 pb-1 sm:mx-0 sm:flex-wrap sm:px-0">
                {data!.branches.map((b) => {
                  const on = b.slug === slug;
                  return (
                    <button
                      key={b.id}
                      onClick={() => nav(`/s/${b.slug}`, { replace: true })}
                      className={cx('relative flex shrink-0 items-center gap-2 rounded-full border px-4 py-2 text-sm transition', on ? 'border-transparent text-white' : 'border-line bg-surface text-muted hover:text-ink')}
                    >
                      {on && <motion.span layoutId="branch-pill" className="absolute inset-0 rounded-full" style={{ background: accent }} />}
                      <MapPin className="relative h-4 w-4" />
                      <span className="relative">{b.is_main ? t.shop.mainBranch : b.branch_name ?? b.city}</span>
                    </button>
                  );
                })}
              </div>
            </section>
          )}

          {/* ----------------------------------------------------- products */}
          <section className="mt-6">
            <div className="mb-4 flex flex-wrap items-center gap-3">
              <label className="relative min-w-[200px] flex-1">
                <span className="sr-only">{t.common.search}</span>
                <Search className="pointer-events-none absolute start-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted" />
                <input value={q} onChange={(e) => setQ(e.target.value)} placeholder={t.store.search} className="field h-12 ps-10" type="search" />
              </label>
              <Chips
                label={t.tx.filter}
                value={type as any}
                onChange={(v: string) => setType(v)}
                options={[
                  { value: 'all', label: t.common.all },
                  { value: 'physical', label: t.store.physical },
                  { value: 'digital', label: t.store.digital },
                  { value: 'deposit', label: t.mstore.deposit },
                ]}
              />
            </div>
            {!products ? (
              <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-4">
                {Array.from({ length: 8 }).map((_, i) => (
                  <Skeleton key={i} className="aspect-[4/6] rounded-[1.4rem]" />
                ))}
              </div>
            ) : products.length ? (
              <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-4">
                {products.map((p, i) => (
                  <ProductCard key={p.id} p={p} index={i} showStore={false} onOpen={() => setParams({ p: p.id }, { replace: true })} />
                ))}
              </div>
            ) : (
              <EmptyState icon={<Package className="h-6 w-6" />} title={t.store.noProducts} />
            )}
          </section>
        </>
      )}

      {/* floating cart */}
      <AnimatePresence>
        {count > 0 && !cart && (
          <motion.button
            initial={{ y: 80, opacity: 0 }}
            animate={{ y: 0, opacity: 1 }}
            exit={{ y: 80, opacity: 0 }}
            onClick={() => setCart(true)}
            className="fixed bottom-[calc(env(safe-area-inset-bottom)+16px)] end-4 z-30 flex items-center gap-2 rounded-full bg-stitch px-5 py-3.5 font-semibold text-white shadow-lg shadow-stitch/40"
          >
            <ShoppingBag className="h-5 w-5" /> {t.store.cart} · <span className="num">{count}</span>
          </motion.button>
        )}
      </AnimatePresence>

      <ProductSheet
        product={open}
        onClose={() => {
          setOpen(null);
          if (params.get('p')) setParams({}, { replace: true });
        }}
        onAdded={() => setCart(true)}
        storeUrl={`/s/${slug}`}
      />
      <CartSheet open={cart} onClose={() => setCart(false)} ordersHref="/app/orders" />
      {s && <ShareSheet open={share} onClose={() => setShare(false)} url={shareUrl} title={s.store_name} />}
    </PublicShell>
  );
}
