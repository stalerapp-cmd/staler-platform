import { AnimatePresence, motion, useScroll, useTransform } from 'framer-motion';
import { ScrollRow } from '../components/ScrollRow';
import { CountChip } from './Store';
import { cityWithGov } from './Stores';
import { fill } from '../lib/format';
import { useEffect, useMemo, useRef, useState } from 'react';
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { Bike, ClipboardList, Facebook, GitBranch, Instagram, Map as MapIcon, MapPin, MessageCircle, Music2, Package, Phone, Quote, Search, Share2, ShoppingBag, Store as StoreIcon, Truck } from 'lucide-react';
import { assetUrl, get, PUBLIC_ORIGIN } from '../lib/api';
import { useAuth } from '../lib/auth';
import { useI18n } from '../lib/i18n';
import { CartSheet, ProductCard, ProductSheet, useCart, type Product } from '../components/Commerce';
import { ShareSheet } from '../components/Share';
import { MapView } from '../components/MapView';
import { Button, EmptyState, Skeleton, cx } from '../components/ui';
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
      className="group relative aspect-[4/5] w-[62%] shrink-0 snap-center overflow-hidden rounded-[1.6rem] bg-night text-start shadow-card sm:w-52 lg:w-48"
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

/** Round frosted buttons on the storefront. */
const GLASS = 'grid h-11 w-11 place-items-center rounded-full bg-white/15 text-white ring-1 ring-white/30 backdrop-blur-md transition hover:-translate-y-0.5 hover:bg-white/25 active:scale-95';

export default function StorePage() {
  const { slug } = useParams();
  const [params, setParams] = useSearchParams();
  const nav = useNavigate();
  const { t, err, lang } = useI18n();
  const { user } = useAuth();
  const { count } = useCart();
  const [data, setData] = useState<{ store: any; branches: Branch[]; ads: Ad[]; pickupPoints?: any[] } | null>(null);
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
  const shareUrl = `${PUBLIC_ORIGIN}/s/${slug}`;
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
          {/* ---------------------------------------------------- storefront */}
          <section ref={heroRef} className="relative -mx-4 overflow-hidden text-white shadow-card sm:mx-0 sm:rounded-[2rem]" style={{ background: accent }}>
            <motion.div className="absolute inset-0" style={{ y: coverY, scale: coverScale }}>
              <StoreCover s={s.main ?? s} className="h-full w-full" />
            </motion.div>
            {/* Legibility: deep at the bottom, a soft veil on the reading side. */}
            <div className="absolute inset-0 bg-gradient-to-t from-black/85 via-black/35 to-black/5" />
            <div className="absolute inset-0 bg-gradient-to-l from-black/40 via-transparent to-transparent rtl:bg-gradient-to-r" />

            <div className="relative flex min-h-[380px] flex-col justify-between gap-6 p-5 pb-12 sm:min-h-[340px] sm:p-8 sm:pb-14">
              {/* top line: what the store offers */}
              <div className="flex flex-wrap items-center gap-2">
                <span className="inline-flex items-center gap-1.5 rounded-full bg-white/15 px-3 py-1.5 text-xs font-semibold ring-1 ring-white/25 backdrop-blur-md">
                  <CatIcon className="h-3.5 w-3.5" /> {t.shop.cat[s.main?.category ?? s.category ?? 'other']}
                </span>
                {s.offers_delivery && (
                  <span className="inline-flex items-center gap-1.5 rounded-full bg-white/15 px-3 py-1.5 text-xs font-semibold ring-1 ring-white/25 backdrop-blur-md">
                    <Bike className="h-3.5 w-3.5" /> {t.shop.delivery}
                  </span>
                )}
                {s.offers_pickup && (
                  <span className="inline-flex items-center gap-1.5 rounded-full bg-white/15 px-3 py-1.5 text-xs font-semibold ring-1 ring-white/25 backdrop-blur-md">
                    <ShoppingBag className="h-3.5 w-3.5" /> {t.shop.pickup}
                  </span>
                )}
              </div>

              {/* bottom: identity on one side, actions on the other */}
              <div className="flex flex-col gap-5 lg:flex-row lg:items-end lg:justify-between">
                <div className="flex min-w-0 items-end gap-4">
                  <motion.div className="shrink-0" initial={{ scale: 0.7, rotate: -10, opacity: 0 }} animate={{ scale: 1, rotate: 0, opacity: 1 }} transition={{ type: 'spring', bounce: 0.4 }}>
                    <span className="block rounded-[30px] bg-white/20 p-1 ring-1 ring-white/40 backdrop-blur">
                      <StoreLogo s={s.main ?? s} size={92} />
                    </span>
                  </motion.div>
                  <div className="min-w-0 pb-1">
                    <motion.h1 initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.1 }} className="font-display text-3xl leading-[1.1] drop-shadow-sm sm:text-5xl">
                      {s.store_name}
                    </motion.h1>
                    <motion.p initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ delay: 0.2 }} className="mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-1 text-sm text-white/85">
                      {s.branch_name && <span className="font-semibold text-white">{s.branch_name}</span>}
                      <span>
                        {t.shop.by} <span className="font-semibold text-white">{s.owner_name}</span>
                      </span>
                      {(s.city || s.main?.city) && (
                        <span className="inline-flex items-center gap-1">
                          <MapPin className="h-3.5 w-3.5" /> {cityWithGov(s.city ?? s.main?.city, lang)}
                        </span>
                      )}
                    </motion.p>
                  </div>
                </div>

                <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.25 }} className="flex flex-wrap items-center gap-2">
                  <button type="button" onClick={() => setShare(true)} className="inline-flex h-11 items-center gap-2 rounded-full bg-white px-5 text-sm font-bold text-night shadow-lg transition hover:-translate-y-0.5 active:scale-95">
                    <Share2 className="h-4 w-4" /> {t.shop.shareStore}
                  </button>
                  {s.phone && (
                    <a href={`tel:${s.phone}`} className={GLASS} title={t.shop.call} aria-label={t.shop.call}>
                      <Phone className="h-[18px] w-[18px]" />
                    </a>
                  )}
                  {waPhone && (
                    <a href={`https://wa.me/${waPhone}`} target="_blank" rel="noopener noreferrer" className={GLASS} title={t.shop.whatsapp} aria-label={t.shop.whatsapp}>
                      <MessageCircle className="h-[18px] w-[18px]" />
                    </a>
                  )}
                  {pins.length > 0 && (
                    <button type="button" onClick={() => setShowMap((v) => !v)} className={cx(GLASS, showMap && 'bg-white text-night')} title={t.ord.map} aria-label={t.ord.map}>
                      <MapIcon className="h-[18px] w-[18px]" />
                    </button>
                  )}
                  {(['instagram', 'tiktok', 'facebook'] as const)
                    .filter((k) => s[k])
                    .map((k) => {
                      const Ico = k === 'instagram' ? Instagram : k === 'facebook' ? Facebook : Music2;
                      return (
                        <a key={k} href={k === 'tiktok' ? `https://www.tiktok.com/@${s[k]}` : `https://www.${k}.com/${s[k]}`} target="_blank" rel="noopener noreferrer" className={GLASS} title={t.social[k]} aria-label={t.social[k]}>
                          <Ico className="h-[18px] w-[18px]" />
                        </a>
                      );
                    })}
                  {user && (
                    <Link to="/app/orders" className={GLASS} title={t.shop.yourOrders} aria-label={t.shop.yourOrders}>
                      <ClipboardList className="h-[18px] w-[18px]" />
                    </Link>
                  )}
                </motion.div>
              </div>
            </div>
          </section>

          {/* ------------------------------------------- the store at a glance */}
          <motion.section
            initial={{ opacity: 0, y: 16 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.3, type: 'spring', bounce: 0.25 }}
            className="relative z-10 mx-1 -mt-7 overflow-hidden rounded-[1.6rem] bg-surface shadow-[0_22px_48px_-30px_rgb(var(--night)/0.6)] ring-1 ring-line/70 sm:mx-8"
          >
            <dl className="grid grid-cols-2 divide-line sm:grid-cols-4 sm:divide-x rtl:sm:divide-x-reverse [&>div]:border-line max-sm:[&>div:nth-child(-n+2)]:border-b max-sm:[&>div:nth-child(odd)]:border-e">
              {[
                { icon: Package, label: t.storeX.products, value: products ? String(products.length) : '…', tone: 'text-stitch' },
                { icon: MapPin, label: t.storeX.place, value: s.city || s.main?.city ? cityWithGov(s.city ?? s.main?.city, lang) : t.storeX.online, tone: 'text-sky' },
                {
                  icon: Truck,
                  label: t.storeX.getIt,
                  value: s.offers_delivery && s.offers_pickup ? t.storeX.both : s.offers_delivery ? t.shop.delivery : s.offers_pickup ? t.shop.pickup : t.storeX.ask,
                  tone: 'text-olive',
                },
                { icon: GitBranch, label: t.storeX.branches, value: data!.branches.length > 1 ? fill(t.storeX.nBranches, { n: data!.branches.length }) : t.storeX.oneBranch, tone: 'text-gold' },
              ].map((c) => (
                <div key={c.label} className="flex min-w-0 items-center gap-3 px-4 py-3.5 sm:px-5">
                  <span className={cx('grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-sunk', c.tone)}>
                    <c.icon className="h-[18px] w-[18px]" />
                  </span>
                  <div className="min-w-0">
                    <dt className="truncate text-xs text-muted">{c.label}</dt>
                    <dd className="num text-[15px] font-semibold leading-snug">{c.value}</dd>
                  </div>
                </div>
              ))}
            </dl>
            {s.description && (
              <p className="flex items-start gap-3 border-t border-line px-5 py-3.5 text-[15px] leading-relaxed text-ink/80">
                <Quote className="mt-0.5 h-4 w-4 shrink-0 text-stitch/70" />
                <span>{s.description}</span>
              </p>
            )}
          </motion.section>

          <AnimatePresence>
            {showMap && (
              <motion.div initial={{ height: 0, opacity: 0 }} animate={{ height: 'auto', opacity: 1 }} exit={{ height: 0, opacity: 0 }} className="mt-4 overflow-hidden sm:mx-8">
                <MapView pins={pins} className="h-72 rounded-[1.6rem]" />
              </motion.div>
            )}
          </AnimatePresence>

          {/* --------------------------------------------------------- ads */}
          {data!.ads.length > 0 && (
            <section className="mt-8">
              <h2 className="mb-3 px-1 text-xl">{t.shop.ads}</h2>
              <ScrollRow nudgeKey={`ads-${slug}`} label={t.shop.ads}>
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
              </ScrollRow>
            </section>
          )}

          {/* ------------------------------------------------ pickup points */}
          {!!data!.pickupPoints?.length && (
            <section className="mt-8">
              <h2 className="mb-3 flex items-center gap-2 text-xl">
                <MapPin className="h-5 w-5 text-stitch" /> {t.pick.title}
              </h2>
              <ScrollRow label={t.pick.title}>
                {data!.pickupPoints.map((x: any, i: number) => (
                  <motion.div
                    key={x.id}
                    initial={{ opacity: 0, y: 12 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ delay: i * 0.05 }}
                    className="w-64 shrink-0 snap-start rounded-3xl bg-surface p-4 shadow-lift ring-1 ring-line/70"
                  >
                    <p className="font-semibold">{x.name}</p>
                    {(x.city || x.address) && <p className="text-sm text-muted">{[x.city, x.address].filter(Boolean).join(' · ')}</p>}
                    {x.description && <p className="mt-2 line-clamp-3 text-sm">{x.description}</p>}
                    {x.hours && <p className="mt-2 text-xs text-muted">{x.hours}</p>}
                  </motion.div>
                ))}
              </ScrollRow>
            </section>
          )}

          {/* ----------------------------------------------------- branches */}
          {data!.branches.length > 1 && (
            <section className="mt-6">
              <ScrollRow label={t.shop.branches} innerClassName="gap-2">
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
              </ScrollRow>
            </section>
          )}

          {/* ----------------------------------------------------- products */}
          <section className="mt-9">
            <div className="mb-3 flex items-center gap-2.5">
              <h2 className="text-2xl">{t.merchant.products}</h2>
              <CountChip n={products?.length ?? null} />
            </div>
            <div className="sticky top-[calc(env(safe-area-inset-top)+4.25rem)] z-20 -mx-4 mb-4 flex flex-col gap-2.5 bg-bg/85 px-4 py-2.5 backdrop-blur-md sm:mx-0 sm:flex-row sm:items-center sm:rounded-2xl sm:px-3">
              <label className="relative block min-w-0 flex-1">
                <span className="sr-only">{t.common.search}</span>
                <Search className="pointer-events-none absolute start-4 top-1/2 h-5 w-5 -translate-y-1/2 text-muted" />
                <input value={q} onChange={(e) => setQ(e.target.value)} placeholder={fill(t.shop.searchIn, { store: s.store_name })} className="field h-12 rounded-2xl ps-12" type="search" />
              </label>
              <ScrollRow label={t.tx.filter} innerClassName="gap-2 pb-0.5" bleed={false} className="sm:max-w-[55%] sm:shrink-0">
                {[
                  { value: 'all', label: t.common.all },
                  { value: 'physical', label: t.store.physical },
                  { value: 'digital', label: t.store.digital },
                  { value: 'deposit', label: t.mstore.deposit },
                ].map((o) => (
                  <button
                    key={o.value}
                    type="button"
                    onClick={() => setType(o.value)}
                    aria-pressed={type === o.value}
                    className={cx('relative shrink-0 rounded-full px-4 py-2 text-sm transition', type === o.value ? 'text-white' : 'bg-surface text-ink/80 ring-1 ring-line hover:text-ink')}
                  >
                    {type === o.value && <motion.span layoutId="sp-type" className="absolute inset-0 rounded-full" style={{ background: accent }} transition={{ type: 'spring', bounce: 0.25, duration: 0.4 }} />}
                    <span className="relative whitespace-nowrap">{o.label}</span>
                  </button>
                ))}
              </ScrollRow>
            </div>
            {!products ? (
              <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-4">
                {Array.from({ length: 8 }).map((_, i) => (
                  <Skeleton key={i} className="aspect-[4/6] rounded-[1.4rem]" />
                ))}
              </div>
            ) : products.length ? (
              <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 sm:gap-4 lg:grid-cols-4">
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
