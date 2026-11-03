import { useState } from 'react';
import { motion } from 'framer-motion';
import {
  Apple,
  Baby,
  BadgePercent,
  Book,
  Briefcase,
  Cake,
  Check,
  Coffee,
  Cookie,
  Croissant,
  Dumbbell,
  Flag,
  Flower2,
  Gem,
  Gift,
  Glasses,
  Hammer,
  Headphones,
  Home,
  LayoutGrid,
  Laptop,
  Leaf,
  Package,
  Palette,
  PawPrint,
  Pill,
  Shirt,
  ShoppingBasket,
  Smartphone,
  Sparkles,
  Star,
  Truck,
  Utensils,
  Watch,
  type LucideIcon,
} from 'lucide-react';
import { assetUrl, post } from '../lib/api';
import { useI18n } from '../lib/i18n';
import { money } from '../lib/format';
import { useToast } from './Toast';
import { ReportSheet, ReviewSheet } from './Feedback';
import { Button, cx } from './ui';

/** Icons a store can give its sections. */
export const SECTION_ICONS: Record<string, LucideIcon> = {
  grid: LayoutGrid,
  basket: ShoppingBasket,
  croissant: Croissant,
  cake: Cake,
  cookie: Cookie,
  coffee: Coffee,
  apple: Apple,
  utensils: Utensils,
  shirt: Shirt,
  gem: Gem,
  watch: Watch,
  glasses: Glasses,
  sparkles: Sparkles,
  flower: Flower2,
  baby: Baby,
  book: Book,
  palette: Palette,
  phone: Smartphone,
  laptop: Laptop,
  headphones: Headphones,
  home: Home,
  hammer: Hammer,
  pill: Pill,
  dumbbell: Dumbbell,
  paw: PawPrint,
  leaf: Leaf,
  gift: Gift,
  briefcase: Briefcase,
  package: Package,
  star: Star,
};
export const sectionIcon = (k?: string | null) => SECTION_ICONS[k ?? ''] ?? LayoutGrid;

/** Ready-made section ideas by store category (the owner can pick or write their own). */
export const SECTION_IDEAS: Record<string, { ar: string; en: string; icon: string }[]> = {
  food: [
    { ar: 'مخبوزات', en: 'Bakery', icon: 'croissant' },
    { ar: 'حلويات', en: 'Sweets', icon: 'cake' },
    { ar: 'مشروبات', en: 'Drinks', icon: 'coffee' },
    { ar: 'خضار وفواكه', en: 'Fruit & veg', icon: 'apple' },
    { ar: 'وجبات', en: 'Meals', icon: 'utensils' },
    { ar: 'بلدي', en: 'Home-made', icon: 'leaf' },
  ],
  fashion: [
    { ar: 'رجالي', en: 'Men', icon: 'shirt' },
    { ar: 'نسائي', en: 'Women', icon: 'sparkles' },
    { ar: 'أطفال', en: 'Kids', icon: 'baby' },
    { ar: 'إكسسوارات', en: 'Accessories', icon: 'watch' },
    { ar: 'مطرّز', en: 'Embroidered', icon: 'palette' },
    { ar: 'جديدنا', en: 'New in', icon: 'star' },
  ],
  electronics: [
    { ar: 'جوالات', en: 'Phones', icon: 'phone' },
    { ar: 'لابتوبات', en: 'Laptops', icon: 'laptop' },
    { ar: 'سماعات', en: 'Audio', icon: 'headphones' },
    { ar: 'إكسسوارات', en: 'Accessories', icon: 'package' },
  ],
  books: [
    { ar: 'روايات', en: 'Novels', icon: 'book' },
    { ar: 'أطفال', en: 'Children', icon: 'baby' },
    { ar: 'قرطاسية', en: 'Stationery', icon: 'palette' },
    { ar: 'كتب رقمية', en: 'E-books', icon: 'laptop' },
  ],
  other: [
    { ar: 'الأكثر طلبًا', en: 'Best sellers', icon: 'star' },
    { ar: 'جديدنا', en: 'New in', icon: 'sparkles' },
    { ar: 'هدايا', en: 'Gifts', icon: 'gift' },
    { ar: 'للبيت', en: 'For the home', icon: 'home' },
  ],
};

export type Section = { id: string; name: string; icon: string | null; image_url: string | null; cover?: string | null; count: number };

/**
 * The store's own sections as picture tiles, plus "Offers" (discounted items) and
 * "Wholesale" (for approved trade buyers). Several can be picked at once.
 */
export function SectionsShowcase({
  sections,
  deals,
  wholesale,
  picked,
  onToggle,
  accent,
}: {
  sections: Section[];
  deals: number;
  wholesale: number | null;
  picked: string[];
  onToggle: (key: string) => void;
  accent: string;
}) {
  const { lang } = useI18n();
  const ar = lang === 'ar';
  const tiles = [
    ...(deals > 0 ? [{ key: 'deals', name: ar ? 'عروض وخصومات' : 'On offer', count: deals, icon: BadgePercent, special: 'deals' as const, img: null }] : []),
    ...(wholesale ? [{ key: 'wholesale', name: ar ? 'أسعار الجملة' : 'Wholesale', count: wholesale, icon: Truck, special: 'wholesale' as const, img: null }] : []),
    ...sections.filter((s) => s.count > 0).map((s) => ({ key: s.id, name: s.name, count: s.count, icon: sectionIcon(s.icon), special: null, img: s.image_url ?? s.cover ?? null })),
  ];
  if (!tiles.length) return null;
  return (
    <section className="mt-9">
      <div className="mb-3 flex items-end justify-between gap-3 px-1">
        <h2 className="text-2xl">{ar ? 'تسوّق حسب القسم' : 'Shop by section'}</h2>
        <p className="text-xs text-muted">{ar ? 'اختار قسم أو أكثر' : 'Pick one or more'}</p>
      </div>
      <div className="-mx-4 flex snap-x gap-3 overflow-x-auto px-4 pb-2 [scrollbar-width:none] sm:mx-0 sm:grid sm:grid-cols-3 sm:overflow-visible sm:px-0 lg:grid-cols-4">
        {tiles.map((x, i) => {
          const on = picked.includes(x.key);
          return (
            <motion.button
              key={x.key}
              type="button"
              aria-pressed={on}
              onClick={() => onToggle(x.key)}
              initial={{ opacity: 0, y: 14 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: Math.min(i, 8) * 0.04 }}
              whileTap={{ scale: 0.97 }}
              className={cx(
                'group relative h-36 w-40 shrink-0 snap-start overflow-hidden rounded-[1.4rem] text-start text-white shadow-card transition sm:h-40 sm:w-auto',
                on ? 'ring-[3px] ring-offset-2 ring-offset-bg' : 'hover:-translate-y-0.5 hover:shadow-lift',
              )}
              style={{ ['--tw-ring-color' as string]: accent, background: x.special === 'deals' ? 'linear-gradient(135deg,#B3203C,#5A1424)' : x.special === 'wholesale' ? 'linear-gradient(135deg,#1F4D3A,#0F2A20)' : accent }}
            >
              {x.img && <img src={assetUrl(x.img)!} alt="" loading="lazy" className="absolute inset-0 h-full w-full object-cover transition duration-700 group-hover:scale-110" />}
              <span className="absolute inset-0 bg-gradient-to-t from-black/75 via-black/25 to-transparent" />
              {!x.img && (
                <span className="pointer-events-none absolute -end-6 -top-6 grid h-28 w-28 place-items-center rounded-full border border-dashed border-white/25">
                  <x.icon className="h-12 w-12 text-white/25" />
                </span>
              )}
              <span className="absolute start-3 top-3 grid h-9 w-9 place-items-center rounded-xl bg-white/20 backdrop-blur">
                <x.icon className="h-[18px] w-[18px]" />
              </span>
              {on && (
                <motion.span initial={{ scale: 0 }} animate={{ scale: 1 }} className="absolute end-3 top-3 grid h-7 w-7 place-items-center rounded-full bg-white text-night">
                  <Check className="h-4 w-4" />
                </motion.span>
              )}
              <span className="absolute inset-x-3 bottom-3">
                <span className="block truncate text-lg font-semibold leading-tight">{x.name}</span>
                <span className="text-xs text-white/75">{ar ? `${x.count} منتج` : `${x.count} products`}</span>
              </span>
            </motion.button>
          );
        })}
      </div>
    </section>
  );
}

/** "Buying for a shop?" — ask to deal wholesale, or see that you're approved and the terms. */
export function WholesaleCard({ merchantId, ws, onChange }: { merchantId: string; ws: { terms: string | null; status: string | null; businessName: string | null }; onChange: () => void }) {
  const { lang, err } = useI18n();
  const toast = useToast();
  const ar = lang === 'ar';
  const [open, setOpen] = useState(false);
  const [name, setName] = useState(ws.businessName ?? '');
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const apply = async () => {
    setBusy(true);
    try {
      await post(`/api/store/me/wholesale/${merchantId}`, { businessName: name.trim(), note: note.trim() || undefined });
      toast(ar ? 'انبعت طلبك للمتجر' : 'Request sent to the store');
      setOpen(false);
      onChange();
    } catch (e) {
      toast(err(e), 'error');
    } finally {
      setBusy(false);
    }
  };
  const approved = ws.status === 'approved';
  return (
    <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} className={cx('overflow-hidden rounded-2xl p-4 ring-1', approved ? 'bg-[#1F4D3A] text-white ring-transparent' : 'bg-surface ring-line')}>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="flex items-center gap-2 text-sm font-semibold">
            <Truck className="h-5 w-5" />
            {approved ? (ar ? `انت تاجر جملة هون${ws.businessName ? ` — ${ws.businessName}` : ''}` : `You buy wholesale here${ws.businessName ? ` — ${ws.businessName}` : ''}`) : ar ? 'بتشتري لمحلّك؟ تعامل معنا جملة' : 'Buying for a shop? Deal with us wholesale'}
          </p>
          {ws.terms && <p className={cx('mt-1 whitespace-pre-line text-xs leading-relaxed', approved ? 'text-white/75' : 'text-muted')}>{ws.terms}</p>}
          {approved && <p className="mt-1 text-xs text-white/75">{ar ? 'أسعار الجملة بتبين على المنتجات، وبتنحسب لحالها لما توصل للكمية.' : 'Wholesale prices show on the products and apply once you reach the quantity.'}</p>}
        </div>
        {!approved && (
          <Button size="sm" variant={ws.status === 'pending' ? 'secondary' : 'primary'} disabled={ws.status === 'pending'} onClick={() => setOpen(!open)}>
            {ws.status === 'pending' ? (ar ? 'طلبك بستنى' : 'Request pending') : ws.status === 'rejected' ? (ar ? 'قدّم مرة ثانية' : 'Apply again') : ar ? 'قدّم كتاجر جملة' : 'Apply'}
          </Button>
        )}
      </div>
      {open && (
        <div className="mt-3 grid gap-2 sm:grid-cols-[1fr_1.4fr_auto]">
          <input value={name} onChange={(e) => setName(e.target.value)} maxLength={80} placeholder={ar ? 'اسم محلك أو شركتك' : 'Your shop or company'} className="field h-11 text-sm" />
          <input value={note} onChange={(e) => setNote(e.target.value)} maxLength={400} placeholder={ar ? 'ملاحظة (اختياري): شو بتحتاج وكم' : 'Note (optional): what and how much'} className="field h-11 text-sm" />
          <Button size="sm" disabled={name.trim().length < 2} loading={busy} onClick={apply}>
            {ar ? 'ابعت' : 'Send'}
          </Button>
        </div>
      )}
    </motion.div>
  );
}

/** Wholesale price under a product card, for approved trade buyers. */
export function WholesaleChip({ price, min }: { price: string; min: number }) {
  const { lang } = useI18n();
  return (
    <span className="mt-1.5 flex items-center justify-center gap-1 rounded-full bg-[#1F4D3A]/10 px-2.5 py-1 text-[11px] font-semibold text-[#1F4D3A] dark:bg-[#1F4D3A]/40 dark:text-[#9fd8bd]">
      <Truck className="h-3.5 w-3.5" /> {lang === 'ar' ? `جملة ${money(price, lang)}${min > 1 ? ` من ${min} قطعة` : ''}` : `Wholesale ${money(price, lang)}${min > 1 ? ` from ${min}` : ''}`}
    </span>
  );
}

/** A quiet bar at the end of a store page: rate it, or report it. */
export function StoreFeedbackBar({ storeId, storeName }: { storeId: string; storeName: string }) {
  const { lang } = useI18n();
  const ar = lang === 'ar';
  const [rate, setRate] = useState(false);
  const [report, setReport] = useState(false);
  return (
    <div className="mt-10 flex flex-wrap items-center justify-between gap-3 rounded-3xl bg-surface p-4 ring-1 ring-line/70 sm:px-5">
      <div className="min-w-0">
        <p className="font-semibold">{ar ? 'كيف كانت تجربتك مع المتجر؟' : 'How was this store?'}</p>
        <p className="text-xs text-muted">{ar ? 'تقييم واحد إلك — بتقدر تعدّله إذا تغيّر رأيك.' : 'One review per person — you can change it later.'}</p>
      </div>
      <div className="flex gap-2">
        <Button size="sm" icon={<Star className="h-4 w-4" />} onClick={() => setRate(true)}>
          {ar ? 'قيّم المتجر' : 'Rate it'}
        </Button>
        <button type="button" onClick={() => setReport(true)} className="inline-flex items-center gap-1.5 rounded-full px-3 py-2 text-sm text-muted transition hover:bg-stitch/10 hover:text-stitch">
          <Flag className="h-4 w-4" /> {ar ? 'بلّغ' : 'Report'}
        </button>
      </div>
      <ReviewSheet open={rate} onClose={() => setRate(false)} storeId={storeId} storeName={storeName} />
      <ReportSheet open={report} onClose={() => setReport(false)} target={{ storeId, name: storeName }} />
    </div>
  );
}
