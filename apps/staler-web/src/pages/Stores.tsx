import { motion } from 'framer-motion';
import { PlacePicker, placeLabel } from '../components/PlacePicker';
import { governorateOf, placeKey } from '../lib/places';
import { fill } from '../lib/format';
import { ScrollRow } from '../components/ScrollRow';
import { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { BookOpen, FileDown, GitBranch, LayoutGrid, MapPin, Megaphone, Package, RotateCcw, Scissors, Search, Shirt, Smartphone, Sofa, Sparkles, Store as StoreIcon, UtensilsCrossed, Wrench, X } from 'lucide-react';
import { assetUrl, get } from '../lib/api';
import { useI18n } from '../lib/i18n';
import { useAuth } from '../lib/auth';
import { CartSheet } from '../components/Commerce';
import { StarMotif } from '../components/Tatreez';
import { EmptyState, ErrorNote, Skeleton, cx } from '../components/ui';
import { PublicShell } from '../layouts/PublicShell';

export const CATEGORY_ICONS: Record<string, typeof StoreIcon> = {
  food: UtensilsCrossed,
  fashion: Shirt,
  electronics: Smartphone,
  books: BookOpen,
  beauty: Sparkles,
  home: Sofa,
  crafts: Scissors,
  digital: FileDown,
  services: Wrench,
  other: LayoutGrid,
};
export const CATEGORIES = Object.keys(CATEGORY_ICONS);

export interface StoreSummary {
  id: string;
  slug: string;
  store_name: string;
  description: string | null;
  logo_url: string | null;
  cover_url: string | null;
  category: string | null;
  city: string | null;
  accent: string | null;
  owner_name: string;
  products: number;
  branches: number;
  ads: number;
}

const PALETTE = ['#141B3D', '#5A1424', '#2F3F18', '#1C3B4A', '#4A2C10'];
export const accentOf = (s: { accent?: string | null; store_name: string }) =>
  s.accent ?? PALETTE[Array.from(s.store_name).reduce((h, c) => (h * 31 + c.charCodeAt(0)) >>> 0, 3) % PALETTE.length]!;

/** Cover photo, or a stitched pattern in the store's colour. */
export function StoreCover({ s, className }: { s: { cover_url?: string | null; accent?: string | null; store_name: string }; className?: string }) {
  const url = assetUrl(s.cover_url ?? null);
  const bg = accentOf(s);
  return (
    <div className={cx('relative overflow-hidden', className)} style={{ background: bg }}>
      {url ? (
        <img src={url} alt="" loading="lazy" className="h-full w-full object-cover" />
      ) : (
        <StarMotif size={17} cell={12} className="absolute -end-6 -top-10 h-56 w-56 opacity-70" colors={['#E2506A', '#E9C060']} animate={false} />
      )}
      <div className="absolute inset-0 bg-gradient-to-t from-black/50 via-black/5 to-transparent" />
    </div>
  );
}

export function StoreLogo({ s, size = 56 }: { s: { logo_url?: string | null; store_name: string; accent?: string | null }; size?: number }) {
  const url = assetUrl(s.logo_url ?? null);
  return (
    <span className="grid shrink-0 place-items-center overflow-hidden rounded-2xl border-4 border-surface bg-surface font-display text-xl text-white shadow-card" style={{ width: size, height: size, background: url ? undefined : accentOf(s) }}>
      {url ? <img src={url} alt="" className="h-full w-full object-cover" /> : Array.from(s.store_name)[0]}
    </span>
  );
}

/** "حوارة · نابلس": the town, plus its governorate when that adds something. */
export function cityWithGov(city: string, lang: string) {
  const g = governorateOf(city);
  if (!g) return city;
  const gov = lang === 'ar' ? g.ar : g.en;
  return placeKey(gov).startsWith(placeKey(city)) || placeKey(city) === placeKey(g.towns[0] ?? '') ? city : `${city} · ${gov}`;
}

function StoreCard({ s, i }: { s: StoreSummary; i: number }) {
  const { t, lang } = useI18n();
  const Icon = CATEGORY_ICONS[s.category ?? 'other'] ?? LayoutGrid;
  return (
    <motion.div
      initial={{ opacity: 0, y: 26 }}
      whileInView={{ opacity: 1, y: 0 }}
      viewport={{ once: true, margin: '-40px' }}
      transition={{ type: 'spring', bounce: 0.3, delay: (i % 6) * 0.05 }}
    >
      <Link
        to={`/s/${s.slug}`}
        className="group block h-full rounded-[1.75rem] bg-surface p-1.5 shadow-[0_1px_0_rgb(var(--line)),0_18px_40px_-28px_rgb(var(--night)/0.6)] ring-1 ring-line/60 transition duration-300 hover:-translate-y-1.5 hover:shadow-[0_28px_50px_-28px_rgb(var(--night)/0.65)]"
      >
        <div className="relative overflow-hidden rounded-[1.35rem]">
          <StoreCover s={s} className="h-40 transition duration-700 ease-out group-hover:scale-[1.05]" />
          {s.ads > 0 && (
            <span className="absolute end-3 top-3 flex items-center gap-1 rounded-full bg-stitch px-2.5 py-1 text-[11px] font-semibold text-white shadow">
              <span className="relative flex h-2 w-2">
                <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-white/80" />
                <span className="relative inline-flex h-2 w-2 rounded-full bg-white" />
              </span>
              {t.shop.ads}
            </span>
          )}
          <span className="absolute start-3 top-3 flex items-center gap-1.5 rounded-full bg-black/35 px-2.5 py-1 text-[11px] font-medium text-white backdrop-blur">
            <Icon className="h-3.5 w-3.5" /> {t.shop.cat[s.category ?? 'other'] ?? s.category}
          </span>
          {s.city && (
            <span className="absolute bottom-3 end-3 flex max-w-[60%] items-center gap-1 rounded-full bg-white/90 px-2.5 py-1 text-[11px] font-semibold text-night shadow-sm backdrop-blur">
              <MapPin className="h-3.5 w-3.5 shrink-0 text-stitch" />
              <span className="truncate">{cityWithGov(s.city, lang)}</span>
            </span>
          )}
        </div>
        <div className="relative px-3 pb-3">
          <div className="-mt-9 flex items-end gap-3">
            <motion.span whileHover={{ rotate: -6, scale: 1.05 }}>
              <StoreLogo s={s} size={64} />
            </motion.span>
          </div>
          <h3 className="mt-2 truncate font-display text-xl">{s.store_name}</h3>
          <p className="truncate text-sm text-muted">
            {t.shop.by} {s.owner_name}
          </p>
          {s.description && <p className="mt-2 line-clamp-2 text-sm text-ink/75">{s.description}</p>}
          <div className="mt-3 flex flex-wrap gap-2 text-xs text-muted">
            <span className="flex items-center gap-1 rounded-full bg-sunk px-2.5 py-1">
              <Package className="h-3.5 w-3.5" /> <span className="num">{s.products}</span> {t.shop.products}
            </span>
            {s.branches > 0 && (
              <span className="flex items-center gap-1 rounded-full bg-sunk px-2.5 py-1">
                <GitBranch className="h-3.5 w-3.5" /> <span className="num">{s.branches + 1}</span> {t.shop.branches}
              </span>
            )}
          </div>
        </div>
      </Link>
    </motion.div>
  );
}

/** Directory of stores. Used publicly (/stores) and inside the app (/app/stores). */
export function StoresDirectory() {
  const { t, err } = useI18n();
  const { lang } = useI18n();
  const [q, setQ] = useState('');
  const [cats, setCats] = useState<string[]>([]);
  const [places, setPlaces] = useState<string[]>([]);
  const [pickPlace, setPickPlace] = useState(false);
  const [stores, setStores] = useState<StoreSummary[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const seq = useRef(0);
  useEffect(() => {
    const n = ++seq.current;
    const h = setTimeout(async () => {
      try {
        const p = new URLSearchParams();
        if (q.trim()) p.set('q', q.trim());
        if (cats.length) p.set('category', cats.join(','));
        if (places.length) p.set('places', places.join(','));
        const d = await get<{ stores: StoreSummary[] }>(`/api/store/stores?${p}`);
        if (n === seq.current) setStores(d.stores);
      } catch (e) {
        if (n === seq.current) setError(err(e));
      }
    }, 220);
    return () => clearTimeout(h);
  }, [q, cats, places, err]);

  return (
    <div>
      <section className="relative mb-6 overflow-hidden rounded-[2rem] bg-night px-5 py-9 text-white shadow-card sm:px-10 sm:py-14">
        <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(90%_70%_at_0%_100%,rgba(94,122,46,0.35),transparent_60%)]" />
        <motion.div
          className="pointer-events-none absolute -end-16 -top-16 h-72 w-72 opacity-60"
          animate={{ rotate: 360 }}
          transition={{ duration: 120, repeat: Infinity, ease: 'linear' }}
        >
          <StarMotif size={21} cell={14} className="h-full w-full" colors={['#E2506A', '#E9C060']} animate={false} />
        </motion.div>
        <motion.h1 initial={{ opacity: 0, y: 16 }} animate={{ opacity: 1, y: 0 }} className="relative font-display text-4xl sm:text-5xl">
          {t.shop.storesTitle}
        </motion.h1>
        <motion.p initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ delay: 0.15 }} className="relative mt-3 max-w-xl text-white/75">
          {t.shop.storesLead}
        </motion.p>
        <label className="relative mt-6 block max-w-xl">
          <span className="sr-only">{t.common.search}</span>
          <Search className="pointer-events-none absolute start-4 top-1/2 h-5 w-5 -translate-y-1/2 text-muted" />
          <input value={q} onChange={(e) => setQ(e.target.value)} placeholder={t.shop.searchStores} type="search" className="h-14 w-full rounded-2xl border-0 bg-white pe-4 ps-12 text-base text-ink shadow-lg outline-none ring-2 ring-transparent transition placeholder:text-muted/80 focus:ring-gold/70" />
        </label>
      </section>

      <ScrollRow nudgeKey="stores-cats" label={t.mstore.category} className="mb-6" innerClassName="gap-2">
        {['', ...CATEGORIES].map((c) => {
          const Icon = c ? CATEGORY_ICONS[c]! : StoreIcon;
          const on = c ? cats.includes(c) : !cats.length;
          return (
            <button
              key={c || 'all'}
              role="checkbox"
              aria-checked={on}
              onClick={() => (c ? setCats(on ? cats.filter((x) => x !== c) : [...cats, c]) : setCats([]))}
              className={cx('relative flex shrink-0 snap-start items-center gap-2 rounded-full px-4 py-2.5 text-sm transition', on ? 'text-white shadow-lift' : 'bg-surface text-ink/80 ring-1 ring-line/70 hover:-translate-y-0.5 hover:text-ink')}
            >
              {on && <motion.span initial={{ scale: 0.6, opacity: 0 }} animate={{ scale: 1, opacity: 1 }} className="absolute inset-0 rounded-full bg-night" transition={{ type: 'spring', bounce: 0.35, duration: 0.4 }} />}
              <Icon className="relative h-4 w-4" />
              <span className="relative whitespace-nowrap">{c ? t.shop.cat[c] : t.shop.allStores}</span>
            </button>
          );
        })}
      </ScrollRow>

      <div className="-mt-3 mb-6 flex flex-wrap items-center gap-2">
        <button
          type="button"
          onClick={() => setPickPlace(true)}
          className={cx('flex items-center gap-2 rounded-full px-4 py-2 text-sm font-medium transition', places.length ? 'bg-stitch text-white shadow-lift' : 'bg-surface text-ink ring-1 ring-line hover:ring-ink/20')}
        >
          <MapPin className="h-4 w-4" />
          {places.length ? fill(t.shop.inPlaces, { n: places.length }) : t.shop.pickPlace}
        </button>
        {places.map((k) => (
          <span key={k} className="inline-flex items-center gap-1 rounded-full bg-night py-1 pe-1 ps-3 text-xs font-medium text-white dark:bg-white/15">
            {placeLabel(k, lang)}
            <button type="button" onClick={() => setPlaces(places.filter((x) => x !== k))} className="grid h-5 w-5 place-items-center rounded-full bg-white/15 hover:bg-white/30" aria-label="✕">
              <X className="h-3 w-3" />
            </button>
          </span>
        ))}
        {(places.length > 0 || cats.length > 0) && (
          <button type="button" onClick={() => (setPlaces([]), setCats([]))} className="inline-flex items-center gap-1 rounded-full px-2.5 py-1 text-xs font-medium text-stitch transition hover:bg-stitch/10">
            <RotateCcw className="h-3.5 w-3.5" /> {t.market.clear}
          </button>
        )}
      </div>
      <PlacePicker open={pickPlace} onClose={() => setPickPlace(false)} value={places} onChange={setPlaces} />

      <ErrorNote>{error}</ErrorNote>
      {!stores ? (
        <div className="grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
          {Array.from({ length: 6 }).map((_, i) => (
            <Skeleton key={i} className="h-72 rounded-[1.6rem]" />
          ))}
        </div>
      ) : stores.length ? (
        <div className="grid gap-4 sm:grid-cols-2 sm:gap-5 lg:grid-cols-3">
          {stores.map((s, i) => (
            <StoreCard key={s.id} s={s} i={i} />
          ))}
        </div>
      ) : (
        <EmptyState icon={<Megaphone className="h-6 w-6" />} title={t.shop.noStores} />
      )}
    </div>
  );
}

export default function StoresPage() {
  const [cart, setCart] = useState(false);
  const { user } = useAuth();
  return (
    <PublicShell onCart={() => setCart(true)}>
      <StoresDirectory />
      <CartSheet open={cart} onClose={() => setCart(false)} ordersHref={user ? '/app/orders' : '/login'} />
    </PublicShell>
  );
}
