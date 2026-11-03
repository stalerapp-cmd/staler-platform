import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { useSearchParams } from 'react-router-dom';
import { Analytics, MyReviews, Sections, Wholesale } from './MerchantCRM2';
import { ReportSheet } from '../components/Feedback';
import { motion } from 'framer-motion';
import {
  BarChart3,
  Flag,
  Layers,
  Star,
  Truck,
  BadgePercent,
  BellOff,
  BellRing,
  Crown,
  Gift,
  Heart,
  Megaphone,
  Newspaper,
  Plus,
  Repeat,
  Search,
  Send,
  Sparkles,
  Trash2,
  TrendingUp,
  Users,
  X,
  type LucideIcon,
} from 'lucide-react';
import { del, get, patch, post, put } from '../lib/api';
import { useI18n } from '../lib/i18n';
import { useData } from '../lib/hooks';
import { fill, money, relative } from '../lib/format';
import { useToast } from '../components/Toast';
import { useConfirm } from '../components/Confirm';
import { Avatar, Badge, Button, EmptyState, ErrorNote, Field, PageHeader, Skeleton, TextArea, Toggle, cx } from '../components/ui';

const W = {
  ar: {
    title: 'زباينك',
    lead: 'مين بشتري منك، مين زباينك المميزين، العروض والهدايا، والإشعارات اللي بتوصل لزباينك.',
    tabs: { glance: 'نظرة عامة', analytics: 'تحليلات', people: 'الزباين', sections: 'الأقسام', perks: 'الولاء والعروض', wholesale: 'الجملة', reviews: 'التقييمات', news: 'إشعارات لزباينك' } as Record<string, string>,
    customers: 'زباين', repeat: 'رجعوا اشتروا', loyal: 'زباين مميزين', rev30: 'مبيعات آخر 30 يوم', disc30: 'خصومات آخر 30 يوم', followers: 'مفعّلين إشعاراتك', muted: 'سكّروا إشعاراتك',
    topSpend: 'الأكثر صرفًا', topFreq: 'الأكثر طلبات', ordersN: '{n} طلب', none: 'لسا ما في زباين — أول ما حدا يشتري منك بيبين هون.',
    findPh: 'دوّر على زبون بالاسم', sort: { spent: 'الأكثر صرفًا', orders: 'الأكثر طلبات', recent: 'آخر من اشترى' } as Record<string, string>,
    spent: 'صرف', last: 'آخر طلب', since: 'زبون من', loyalTag: 'زبون مميز', mutedTag: 'مسكّر إشعاراتك', notifyPicked: 'ابعت إشعار لـ {n}',
    loyalty: 'الزبون المميز', loyaltyD: 'بعد عدد معيّن من الطلبات، الزبون بيصير «مميز». فيك تعطيه خصم تلقائي على كل طلب بعدها.',
    loyalOn: 'فعّل الزبون المميز', after: 'بيصير مميز بعد كم طلب؟', discount: 'خصم الزبون المميز (%)', discountHint: '0 يعني بس لقب بدون خصم.', save: 'احفظ',
    offers: 'عروض المناسبات', offersD: 'خصم على كل المتجر لفترة محددة — عيد، رمضان، افتتاح، الجمعة البيضاء…', newOffer: 'عرض جديد',
    oName: 'اسم العرض', oNamePh: 'مثلًا: عيد الفطر', oPct: 'الخصم (%)', oFor: 'لمين', oAll: 'لكل الزباين', oLoyal: 'للزباين المميزين بس', oMin: 'أقل قيمة للطلب (اختياري)', oDays: 'المدة',
    days: { 1: 'يوم', 3: '3 أيام', 7: 'أسبوع', 30: 'شهر' } as Record<number, string>, oAdd: 'أضف العرض', running: 'شغّال', ended: 'خلص', paused: 'موقف', until: 'لحد {d}',
    gifts: 'هدايا مع الطرود', giftsD: 'هدية بتنحط مع الطلب لما يتحقق شرط — وبتوصلك تذكرة مع الطلب الجديد إنك تحطها.', newGift: 'هدية جديدة',
    gName: 'شو الهدية؟', gNamePh: 'مثلًا: كيكة صغيرة، ميدالية، عينة عطر', gRule: 'إمتى؟', rules: { every: 'مع كل طلب', first: 'أول طلب للزبون', loyal: 'للزبون المميز', min_total: 'إذا الطلب فوق مبلغ' } as Record<string, string>,
    gAmount: 'المبلغ', gAdd: 'أضف الهدية', ruleLine: { every: 'مع كل طلب', first: 'مع أول طلب', loyal: 'للزبون المميز', min_total: 'للطلبات فوق {a}' } as Record<string, string>,
    delQ: 'تحذفه؟', saved: 'انحفظ',
    newsTitle: 'ابعت لزباينك', newsLead: 'بيوصل للي اشتروا منك أو فعّلوا إشعارات متجرك — إلا اللي سكّروها.', who: 'لمين؟',
    aAll: 'كل زباينك', aLoyal: 'الزباين المميزين', aPeople: 'زباين بعينهم', tone: 'نوعها', tones: { news: 'خبر', offer: 'عرض', gift: 'هدية' } as Record<string, string>,
    tTitle: 'العنوان', tBody: 'الرسالة', reach: 'رح يوصل لـ {n} زبون', reachNone: 'ما في حدا بهالاختيار', send: 'ابعت', sent: 'انبعت لـ {n}', limit: 'لحد 5 إشعارات باليوم.',
    history: 'اللي بعتّه قبل', histNone: 'لسا ما بعتت إشي.', reached: 'وصل لـ {n}', preview: 'هيك بيبين عندهم', confirmB: 'رح يوصل لـ {n} زبون.',
    needLoyal: 'فعّل «الزبون المميز» أول.', pickCustomers: 'اختار زباين من تبويب «الزباين».',
  },
  en: {
    title: 'Your customers',
    lead: 'Who buys from you, your best customers, offers and gifts, and notifications to your customers.',
    tabs: { glance: 'Overview', analytics: 'Analytics', people: 'Customers', sections: 'Sections', perks: 'Loyalty & offers', wholesale: 'Wholesale', reviews: 'Reviews', news: 'Notify customers' } as Record<string, string>,
    customers: 'Customers', repeat: 'Came back', loyal: 'Loyal customers', rev30: 'Sales, last 30 days', disc30: 'Discounts, last 30 days', followers: 'Following you', muted: 'Muted you',
    topSpend: 'Top spenders', topFreq: 'Most orders', ordersN: '{n} orders', none: 'No customers yet — they show here after their first order.',
    findPh: 'Find a customer by name', sort: { spent: 'Most spent', orders: 'Most orders', recent: 'Most recent' } as Record<string, string>,
    spent: 'Spent', last: 'Last order', since: 'Customer since', loyalTag: 'Loyal', mutedTag: 'Muted you', notifyPicked: 'Notify {n}',
    loyalty: 'Loyal customers', loyaltyD: 'After a number of orders a customer becomes “loyal”. You can give them an automatic discount on every order after that.',
    loyalOn: 'Turn on loyal customers', after: 'Loyal after how many orders?', discount: 'Loyal discount (%)', discountHint: '0 means just the title, no discount.', save: 'Save',
    offers: 'Occasion offers', offersD: 'A discount on the whole store for a while — Eid, Ramadan, an opening, Black Friday…', newOffer: 'New offer',
    oName: 'Offer name', oNamePh: 'e.g. Eid al-Fitr', oPct: 'Discount (%)', oFor: 'For', oAll: 'All customers', oLoyal: 'Loyal customers only', oMin: 'Minimum order (optional)', oDays: 'How long',
    days: { 1: '1 day', 3: '3 days', 7: 'A week', 30: 'A month' } as Record<number, string>, oAdd: 'Add offer', running: 'Running', ended: 'Ended', paused: 'Paused', until: 'until {d}',
    gifts: 'Gifts in the parcel', giftsD: 'A gift goes with the order when a rule matches — the new-order notice reminds you to pack it.', newGift: 'New gift',
    gName: 'What’s the gift?', gNamePh: 'e.g. a small cake, a key ring, a perfume sample', gRule: 'When?', rules: { every: 'Every order', first: 'A customer’s first order', loyal: 'Loyal customers', min_total: 'Orders above an amount' } as Record<string, string>,
    gAmount: 'Amount', gAdd: 'Add gift', ruleLine: { every: 'with every order', first: 'with the first order', loyal: 'for loyal customers', min_total: 'for orders above {a}' } as Record<string, string>,
    delQ: 'Delete it?', saved: 'Saved',
    newsTitle: 'Message your customers', newsLead: 'Reaches people who bought from you or turned on your store’s notifications — except those who muted it.', who: 'Who?',
    aAll: 'All your customers', aLoyal: 'Loyal customers', aPeople: 'Chosen customers', tone: 'Kind', tones: { news: 'News', offer: 'Offer', gift: 'Gift' } as Record<string, string>,
    tTitle: 'Title', tBody: 'Message', reach: 'It will reach {n} customers', reachNone: 'Nobody matches this choice', send: 'Send', sent: 'Sent to {n}', limit: 'Up to 5 a day.',
    history: 'Sent before', histNone: 'Nothing sent yet.', reached: 'reached {n}', preview: 'How it will look to them', confirmB: 'It will reach {n} customers.',
    needLoyal: 'Turn on loyal customers first.', pickCustomers: 'Pick customers in the “Customers” tab.',
  },
};

type Tab = 'glance' | 'analytics' | 'people' | 'sections' | 'perks' | 'wholesale' | 'reviews' | 'news';
const TAB_ICON: Record<Tab, LucideIcon> = { glance: TrendingUp, analytics: BarChart3, people: Users, sections: Layers, perks: BadgePercent, wholesale: Truck, reviews: Star, news: Megaphone };

function Card({ title, icon: Icon, tone, children, aside }: { title: string; icon: LucideIcon; tone: string; children: ReactNode; aside?: ReactNode }) {
  return (
    <motion.section initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} className="card p-5 sm:p-6">
      <div className="mb-4 flex items-center justify-between gap-3">
        <h2 className="flex items-center gap-3 text-lg">
          <span className={cx('grid h-9 w-9 place-items-center rounded-xl', tone)}>
            <Icon className="h-[18px] w-[18px]" />
          </span>
          {title}
        </h2>
        {aside}
      </div>
      {children}
    </motion.section>
  );
}

/** A merchant's customers: who they are, loyalty, offers, gifts, and messages to them. */
export function MerchantCRM() {
  const { lang } = useI18n();
  const w = W[lang === 'ar' ? 'ar' : 'en'];
  const [sp, setSp] = useSearchParams();
  const tab = ((sp.get('tab') as Tab) || 'glance') as Tab;
  const setTab = (k: Tab) => setSp(k === 'glance' ? {} : { tab: k }, { replace: true });
  const [picked, setPicked] = useState<any[]>([]);
  return (
    <div>
      <PageHeader title={w.title} lead={w.lead} />
      <div role="tablist" className="-mx-4 mb-5 flex gap-1.5 overflow-x-auto bg-surface p-1.5 px-4 shadow-card [scrollbar-width:none] sm:mx-0 sm:flex-wrap sm:rounded-3xl sm:px-1.5">
        {(Object.keys(w.tabs) as Tab[]).map((k) => {
          const Icon = TAB_ICON[k];
          const on = tab === k;
          return (
            <button
              key={k}
              role="tab"
              aria-selected={on}
              onClick={() => setTab(k)}
              className={cx('relative flex shrink-0 items-center gap-2 rounded-2xl px-3.5 py-2 text-sm transition sm:flex-1 sm:justify-center', on ? 'text-white' : 'text-muted hover:text-ink')}
            >
              {on && <motion.span layoutId="crm-tab" className="absolute inset-0 rounded-2xl bg-night shadow-lift dark:bg-white/15" transition={{ type: 'spring', bounce: 0.2, duration: 0.45 }} />}
              <Icon className="relative h-[18px] w-[18px]" />
              <span className="relative text-center leading-tight">{w.tabs[k]}</span>
            </button>
          );
        })}
      </div>
      {tab === 'glance' && <Glance />}
      {tab === 'people' && (
        <People
          onNotify={(list) => {
            setPicked(list);
            setTab('news');
          }}
        />
      )}
      {tab === 'analytics' && <Analytics />}
      {tab === 'sections' && <Sections />}
      {tab === 'perks' && <Perks />}
      {tab === 'wholesale' && <Wholesale />}
      {tab === 'reviews' && <MyReviews />}
      {tab === 'news' && <News picked={picked} setPicked={setPicked} />}
    </div>
  );
}

// ------------------------------------------------------------------ glance
function Glance() {
  const { lang } = useI18n();
  const w = W[lang === 'ar' ? 'ar' : 'en'];
  const { data } = useData<any>('/api/merchant/crm/insights');
  if (!data) return <Skeleton className="h-72 rounded-3xl" />;
  const T = data.totals;
  const repeatPct = T.customers ? Math.round((T.repeat / T.customers) * 100) : 0;
  const tiles: [string, ReactNode, LucideIcon, string][] = [
    [w.customers, T.customers, Users, 'bg-sky/10 text-sky'],
    [w.repeat, `${T.repeat} · ${repeatPct}%`, Repeat, 'bg-olive/12 text-olive'],
    [w.loyal, data.loyalAfter ? T.loyal : '—', Crown, 'bg-gold/15 text-[rgb(150_105_10)] dark:text-gold'],
    [w.rev30, money(data.last30.revenue, lang), TrendingUp, 'bg-night/10 text-night dark:bg-white/10 dark:text-white'],
    [w.disc30, money(data.last30.discounts, lang), BadgePercent, 'bg-stitch/10 text-stitch'],
    [w.followers, `${data.followers.following}${data.followers.muted ? ` · ${data.followers.muted} ${w.muted}` : ''}`, BellRing, 'bg-sky/10 text-sky'],
  ];
  const Top = ({ title, rows, icon: Icon, by }: { title: string; rows: any[]; icon: LucideIcon; by: 'spent' | 'orders' }) => (
    <Card title={title} icon={Icon} tone={by === 'spent' ? 'bg-gold/15 text-[rgb(150_105_10)] dark:text-gold' : 'bg-olive/12 text-olive'}>
      {!rows.length ? (
        <p className="text-sm text-muted">{w.none}</p>
      ) : (
        <ol className="space-y-2.5">
          {rows.map((r, i) => (
            <li key={r.id} className="flex items-center gap-3">
              <span className={cx('grid h-7 w-7 shrink-0 place-items-center rounded-full text-xs font-bold', i === 0 ? 'bg-gold text-night' : i === 1 ? 'bg-[#C9CED8] text-night' : i === 2 ? 'bg-[#D9A57A] text-night' : 'bg-sunk text-muted')}>{i + 1}</span>
              <Avatar name={r.full_name} src={r.profile_image} size={36} />
              <span className="min-w-0 flex-1">
                <span className="block truncate text-sm font-semibold">{r.full_name}</span>
                <span className="block text-xs text-muted">{fill(w.ordersN, { n: r.orders })}</span>
              </span>
              <span className="num shrink-0 text-sm font-semibold">{money(r.spent, lang)}</span>
            </li>
          ))}
        </ol>
      )}
    </Card>
  );
  return (
    <div className="space-y-5">
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
        {tiles.map(([k, v, Icon, tone], i) => (
          <motion.div key={k} initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: i * 0.04 }} className="card p-4">
            <span className={cx('mb-2 grid h-9 w-9 place-items-center rounded-xl', tone)}>
              <Icon className="h-[18px] w-[18px]" />
            </span>
            <p className="text-xs text-muted">{k}</p>
            <p className="num mt-0.5 text-lg font-bold leading-tight">{v}</p>
          </motion.div>
        ))}
      </div>
      <div className="grid gap-5 lg:grid-cols-2">
        <Top title={w.topSpend} rows={data.topSpenders} icon={Crown} by="spent" />
        <Top title={w.topFreq} rows={data.topFrequent} icon={Repeat} by="orders" />
      </div>
    </div>
  );
}

// ------------------------------------------------------------------ people
function People({ onNotify }: { onNotify: (list: any[]) => void }) {
  const [report, setReport] = useState<any>(null);
  const { lang } = useI18n();
  const w = W[lang === 'ar' ? 'ar' : 'en'];
  const [q, setQ] = useState('');
  const [qq, setQq] = useState('');
  const [sort, setSort] = useState<'spent' | 'orders' | 'recent'>('spent');
  const [sel, setSel] = useState<Record<string, any>>({});
  useEffect(() => {
    const h = setTimeout(() => setQq(q.trim()), 200);
    return () => clearTimeout(h);
  }, [q]);
  const { data, loading } = useData<{ customers: any[]; loyalAfter: number | null }>(`/api/merchant/crm/customers?sort=${sort}${qq ? `&q=${encodeURIComponent(qq)}` : ''}`, [sort, qq]);
  const needle = q.trim().toLowerCase();
  const rows = (data?.customers ?? []).filter((c) => !needle || needle === qq.toLowerCase() || c.full_name?.toLowerCase().includes(needle));
  const pickedList = Object.values(sel);
  return (
    <>
      {report && <ReportSheet open onClose={() => setReport(null)} target={{ userId: report.id, name: report.full_name }} />}
    <div className="space-y-4">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
        <label className="relative block flex-1">
          <Search className="pointer-events-none absolute start-4 top-1/2 h-5 w-5 -translate-y-1/2 text-muted" />
          <input value={q} onChange={(e) => setQ(e.target.value)} placeholder={w.findPh} type="search" className="field h-12 rounded-2xl pe-10 ps-12" />
          {q && (
            <button type="button" onClick={() => setQ('')} className="absolute end-3 top-1/2 grid h-7 w-7 -translate-y-1/2 place-items-center rounded-full text-muted hover:bg-sunk">
              <X className="h-4 w-4" />
            </button>
          )}
        </label>
        <div className="flex gap-1.5 rounded-2xl bg-sunk p-1">
          {(['spent', 'orders', 'recent'] as const).map((k) => (
            <button key={k} type="button" onClick={() => setSort(k)} className={cx('rounded-xl px-3 py-2 text-xs transition sm:text-sm', sort === k ? 'bg-surface font-semibold shadow-sm' : 'text-muted hover:text-ink')}>
              {w.sort[k]}
            </button>
          ))}
        </div>
      </div>
      {pickedList.length > 0 && (
        <motion.div initial={{ opacity: 0, y: -6 }} animate={{ opacity: 1, y: 0 }} className="flex items-center justify-between gap-3 rounded-2xl bg-night p-3 text-white dark:bg-white/10">
          <span className="text-sm">{fill(w.notifyPicked, { n: pickedList.length })}</span>
          <div className="flex gap-2">
            <button type="button" onClick={() => setSel({})} className="rounded-full px-3 py-1.5 text-xs text-white/70 hover:text-white">
              <X className="h-4 w-4" />
            </button>
            <Button size="sm" icon={<Send className="h-4 w-4 flip-rtl" />} onClick={() => onNotify(pickedList)}>
              {w.send}
            </Button>
          </div>
        </motion.div>
      )}
      {!data && loading ? (
        <Skeleton className="h-64 rounded-3xl" />
      ) : !rows.length ? (
        <EmptyState icon={<Users className="h-6 w-6" />} title={w.none} />
      ) : (
        <ul className="card divide-y divide-line overflow-hidden">
          {rows.map((c) => {
            const on = !!sel[c.id];
            return (
              <li key={c.id}>
                <button
                  type="button"
                  onClick={() => setSel((s) => (on ? Object.fromEntries(Object.entries(s).filter(([k]) => k !== c.id)) : { ...s, [c.id]: c }))}
                  className={cx('flex w-full items-center gap-3 px-4 py-3 text-start transition', on ? 'bg-sky/[0.06]' : 'hover:bg-sunk/50')}
                >
                  <span className={cx('grid h-5 w-5 shrink-0 place-items-center rounded-md border text-[11px]', on ? 'border-sky bg-sky text-white' : 'border-line')}>{on ? '✓' : ''}</span>
                  <Avatar name={c.full_name} src={c.profile_image} size={42} />
                  <span className="min-w-0 flex-1">
                    <span className="flex flex-wrap items-center gap-1.5">
                      <span className="truncate font-semibold">{c.full_name}</span>
                      {c.loyal && (
                        <span className="inline-flex items-center gap-1 rounded-full bg-gold/15 px-2 py-0.5 text-[11px] font-semibold text-[rgb(150_105_10)] dark:text-gold">
                          <Crown className="h-3 w-3" /> {w.loyalTag}
                        </span>
                      )}
                      {!c.notify && (
                        <span className="inline-flex items-center gap-1 rounded-full bg-sunk px-2 py-0.5 text-[11px] text-muted" title={w.mutedTag}>
                          <BellOff className="h-3 w-3" />
                        </span>
                      )}
                    </span>
                    <span className="mt-0.5 block text-xs text-muted">
                      {fill(w.ordersN, { n: c.orders })} · {w.last} {relative(c.last_at, lang)}
                    </span>
                  </span>
                  <span className="shrink-0 text-end">
                    <span className="num block text-sm font-bold">{money(c.spent, lang)}</span>
                    <span className="block text-[11px] text-muted">{w.spent}</span>
                  </span>
                  <span
                    role="button"
                    tabIndex={0}
                    onClick={(e) => {
                      e.stopPropagation();
                      setReport(c);
                    }}
                    className="grid h-8 w-8 shrink-0 place-items-center rounded-full text-muted transition hover:bg-stitch/10 hover:text-stitch"
                    title={lang === 'ar' ? 'بلّغ عن هالزبون' : 'Report this customer'}
                  >
                    <Flag className="h-4 w-4" />
                  </span>
                </button>
              </li>
            );
          })}
        </ul>
      )}
    </div>
    </>
  );
}

// ------------------------------------------------------------------- perks
function Perks() {
  const { lang, err } = useI18n();
  const w = W[lang === 'ar' ? 'ar' : 'en'];
  const toast = useToast();
  const confirm = useConfirm();
  const { data, reload } = useData<any>('/api/merchant/crm/perks');
  const [loyalOn, setLoyalOn] = useState(false);
  const [after, setAfter] = useState(5);
  const [disc, setDisc] = useState(10);
  const [offer, setOffer] = useState<{ name: string; percent: string; audience: 'all' | 'loyal'; min: string; days: number } | null>(null);
  const [gift, setGift] = useState<{ gift: string; rule: 'every' | 'first' | 'loyal' | 'min_total'; amount: string } | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    if (!data) return;
    setLoyalOn(!!data.loyalAfter);
    if (data.loyalAfter) setAfter(data.loyalAfter);
    setDisc(data.loyalDiscount ?? 0);
  }, [data]);
  if (!data) return <Skeleton className="h-72 rounded-3xl" />;
  const run = async (key: string, fn: () => Promise<unknown>, after2?: () => void) => {
    setBusy(key);
    setError(null);
    try {
      await fn();
      toast(w.saved);
      after2?.();
      void reload();
    } catch (e) {
      setError(err(e));
    } finally {
      setBusy(null);
    }
  };
  const now = Date.now();
  const fmtDay = (d: string) => new Date(d).toLocaleDateString(lang === 'ar' ? 'ar-PS' : 'en-GB', { day: 'numeric', month: 'short' });
  return (
    <div className="space-y-5">
      <ErrorNote>{error}</ErrorNote>
      {/* Loyalty */}
      <Card title={w.loyalty} icon={Crown} tone="bg-gold/15 text-[rgb(150_105_10)] dark:text-gold">
        <p className="mb-4 text-sm text-muted">{w.loyaltyD}</p>
        <div className="rounded-2xl bg-sunk/60 p-3.5">
          <Toggle checked={loyalOn} onChange={setLoyalOn} label={w.loyalOn} />
        </div>
        {loyalOn && (
          <div className="mt-4 grid gap-4 sm:grid-cols-2">
            <div>
              <p className="mb-2 text-sm font-medium text-ink/80">{w.after}</p>
              <div className="flex flex-wrap gap-2">
                {[3, 5, 10, 20].map((n) => (
                  <button key={n} type="button" onClick={() => setAfter(n)} className={cx('num h-11 min-w-[3rem] rounded-xl px-3 text-sm font-semibold transition', after === n ? 'bg-night text-white dark:bg-white/15' : 'bg-sunk text-ink/80 hover:text-ink')}>
                    {n}
                  </button>
                ))}
                <input type="number" min={2} max={1000} value={after} onChange={(e) => setAfter(Math.max(2, Number(e.target.value) || 2))} className="field num h-11 w-24 text-center" />
              </div>
            </div>
            <div>
              <p className="mb-2 text-sm font-medium text-ink/80">{w.discount}</p>
              <div className="flex items-center gap-3">
                <input type="range" min={0} max={50} step={1} value={disc} onChange={(e) => setDisc(Number(e.target.value))} className="flex-1 accent-[rgb(var(--stitch))]" />
                <span className="num w-14 rounded-xl bg-stitch/10 py-2 text-center font-bold text-stitch">{disc}%</span>
              </div>
              <p className="mt-1 text-xs text-muted">{w.discountHint}</p>
            </div>
          </div>
        )}
        <Button className="mt-4" loading={busy === 'loyal'} onClick={() => run('loyal', () => put('/api/merchant/crm/loyalty', { loyalAfter: loyalOn ? after : null, loyalDiscount: loyalOn ? disc : 0 }))}>
          {w.save}
        </Button>
      </Card>

      {/* Offers */}
      <Card
        title={w.offers}
        icon={BadgePercent}
        tone="bg-stitch/10 text-stitch"
        aside={
          !offer && (
            <Button size="sm" variant="secondary" icon={<Plus className="h-4 w-4" />} onClick={() => setOffer({ name: '', percent: '15', audience: 'all', min: '', days: 7 })}>
              {w.newOffer}
            </Button>
          )
        }
      >
        <p className="mb-4 text-sm text-muted">{w.offersD}</p>
        {offer && (
          <motion.form
            initial={{ opacity: 0, y: -6 }}
            animate={{ opacity: 1, y: 0 }}
            className="mb-4 space-y-4 rounded-2xl bg-stitch/[0.05] p-4 ring-1 ring-stitch/20"
            onSubmit={(e) => {
              e.preventDefault();
              void run(
                'offer',
                () =>
                  post('/api/merchant/crm/promos', {
                    name: offer.name.trim(),
                    percent: Number(offer.percent),
                    audience: offer.audience,
                    ...(offer.min.trim() ? { minTotal: offer.min.trim() } : {}),
                    endsAt: new Date(Date.now() + offer.days * 86400000).toISOString(),
                  }),
                () => setOffer(null),
              );
            }}
          >
            <div className="grid gap-3 sm:grid-cols-[1fr_8rem]">
              <Field label={w.oName} placeholder={w.oNamePh} value={offer.name} onChange={(e) => setOffer({ ...offer, name: e.target.value })} required minLength={2} maxLength={60} />
              <Field label={w.oPct} type="number" min={1} max={90} value={offer.percent} onChange={(e) => setOffer({ ...offer, percent: e.target.value })} required />
            </div>
            <div className="grid gap-3 sm:grid-cols-2">
              <div>
                <p className="mb-2 text-sm font-medium text-ink/80">{w.oFor}</p>
                <div className="flex gap-2">
                  {(['all', 'loyal'] as const).map((a) => (
                    <button key={a} type="button" onClick={() => setOffer({ ...offer, audience: a })} className={cx('flex-1 rounded-xl px-3 py-2.5 text-sm transition', offer.audience === a ? 'bg-night text-white dark:bg-white/15' : 'bg-sunk text-ink/80')}>
                      {a === 'all' ? w.oAll : w.oLoyal}
                    </button>
                  ))}
                </div>
              </div>
              <div>
                <p className="mb-2 text-sm font-medium text-ink/80">{w.oDays}</p>
                <div className="flex gap-2">
                  {[1, 3, 7, 30].map((d) => (
                    <button key={d} type="button" onClick={() => setOffer({ ...offer, days: d })} className={cx('flex-1 rounded-xl px-2 py-2.5 text-xs transition sm:text-sm', offer.days === d ? 'bg-night text-white dark:bg-white/15' : 'bg-sunk text-ink/80')}>
                      {w.days[d]}
                    </button>
                  ))}
                </div>
              </div>
            </div>
            <Field label={w.oMin} inputMode="decimal" dir="ltr" value={offer.min} onChange={(e) => setOffer({ ...offer, min: e.target.value })} />
            <div className="flex gap-2">
              <Button loading={busy === 'offer'}>{w.oAdd}</Button>
              <Button type="button" variant="ghost" onClick={() => setOffer(null)}>
                <X className="h-4 w-4" />
              </Button>
            </div>
          </motion.form>
        )}
        {!data.promos.length ? null : (
          <ul className="space-y-2">
            {data.promos.map((p: any) => {
              const live = p.active && new Date(p.ends_at).getTime() > now;
              const over = new Date(p.ends_at).getTime() <= now;
              return (
                <li key={p.id} className={cx('flex flex-wrap items-center gap-3 rounded-2xl p-3 ring-1', live ? 'bg-stitch/[0.05] ring-stitch/25' : 'ring-line opacity-70')}>
                  <span className="num grid h-12 w-12 shrink-0 place-items-center rounded-xl bg-stitch text-sm font-bold text-white">{Number(p.percent)}%</span>
                  <span className="min-w-0 flex-1">
                    <span className="block font-semibold">{p.name}</span>
                    <span className="block text-xs text-muted">
                      {p.audience === 'loyal' ? w.oLoyal : w.oAll} · {fill(w.until, { d: fmtDay(p.ends_at) })}
                      {Number(p.min_total) > 0 ? ` · ≥ ${money(p.min_total, lang)}` : ''}
                    </span>
                  </span>
                  <Badge tone={live ? 'good' : over ? 'neutral' : 'warn'}>{live ? w.running : over ? w.ended : w.paused}</Badge>
                  {!over && <Toggle checked={p.active} onChange={(v) => void run(`p${p.id}`, () => patch(`/api/merchant/crm/promos/${p.id}`, { active: v }))} label="" />}
                  <button
                    type="button"
                    onClick={async () => (await confirm({ title: w.delQ, body: p.name, tone: 'danger' })) && void run(`d${p.id}`, () => del(`/api/merchant/crm/promos/${p.id}`))}
                    className="grid h-9 w-9 place-items-center rounded-full text-muted hover:bg-stitch/10 hover:text-stitch"
                  >
                    <Trash2 className="h-4 w-4" />
                  </button>
                </li>
              );
            })}
          </ul>
        )}
      </Card>

      {/* Gifts */}
      <Card
        title={w.gifts}
        icon={Gift}
        tone="bg-olive/12 text-olive"
        aside={
          !gift && (
            <Button size="sm" variant="secondary" icon={<Plus className="h-4 w-4" />} onClick={() => setGift({ gift: '', rule: 'every', amount: '' })}>
              {w.newGift}
            </Button>
          )
        }
      >
        <p className="mb-4 text-sm text-muted">{w.giftsD}</p>
        {gift && (
          <motion.form
            initial={{ opacity: 0, y: -6 }}
            animate={{ opacity: 1, y: 0 }}
            className="mb-4 space-y-4 rounded-2xl bg-olive/[0.06] p-4 ring-1 ring-olive/20"
            onSubmit={(e) => {
              e.preventDefault();
              void run(
                'gift',
                () => post('/api/merchant/crm/gifts', { gift: gift.gift.trim(), rule: gift.rule, ...(gift.rule === 'min_total' ? { threshold: gift.amount.trim() } : {}) }),
                () => setGift(null),
              );
            }}
          >
            <Field label={w.gName} placeholder={w.gNamePh} value={gift.gift} onChange={(e) => setGift({ ...gift, gift: e.target.value })} required minLength={2} maxLength={80} />
            <div>
              <p className="mb-2 text-sm font-medium text-ink/80">{w.gRule}</p>
              <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
                {(['every', 'first', 'loyal', 'min_total'] as const).map((r) => (
                  <button key={r} type="button" onClick={() => setGift({ ...gift, rule: r })} className={cx('rounded-xl px-3 py-2.5 text-sm transition', gift.rule === r ? 'bg-night text-white dark:bg-white/15' : 'bg-sunk text-ink/80')}>
                    {w.rules[r]}
                  </button>
                ))}
              </div>
            </div>
            {gift.rule === 'min_total' && <Field label={w.gAmount} inputMode="decimal" dir="ltr" value={gift.amount} onChange={(e) => setGift({ ...gift, amount: e.target.value })} required />}
            <div className="flex gap-2">
              <Button loading={busy === 'gift'}>{w.gAdd}</Button>
              <Button type="button" variant="ghost" onClick={() => setGift(null)}>
                <X className="h-4 w-4" />
              </Button>
            </div>
          </motion.form>
        )}
        {data.gifts.length > 0 && (
          <ul className="space-y-2">
            {data.gifts.map((g: any) => (
              <li key={g.id} className={cx('flex items-center gap-3 rounded-2xl p-3 ring-1', g.active ? 'bg-olive/[0.05] ring-olive/25' : 'ring-line opacity-70')}>
                <span className="grid h-11 w-11 shrink-0 place-items-center rounded-xl bg-olive/15 text-olive">
                  <Gift className="h-5 w-5" />
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block font-semibold">{g.gift}</span>
                  <span className="block text-xs text-muted">{fill(w.ruleLine[g.rule] ?? g.rule, { a: g.threshold ? money(g.threshold, lang) : '' })}</span>
                </span>
                <Toggle checked={g.active} onChange={(v) => void run(`g${g.id}`, () => patch(`/api/merchant/crm/gifts/${g.id}`, { active: v }))} label="" />
                <button
                  type="button"
                  onClick={async () => (await confirm({ title: w.delQ, body: g.gift, tone: 'danger' })) && void run(`x${g.id}`, () => del(`/api/merchant/crm/gifts/${g.id}`))}
                  className="grid h-9 w-9 place-items-center rounded-full text-muted hover:bg-stitch/10 hover:text-stitch"
                >
                  <Trash2 className="h-4 w-4" />
                </button>
              </li>
            ))}
          </ul>
        )}
      </Card>
    </div>
  );
}

// -------------------------------------------------------------------- news
function News({ picked, setPicked }: { picked: any[]; setPicked: (v: any[]) => void }) {
  const { lang, err } = useI18n();
  const w = W[lang === 'ar' ? 'ar' : 'en'];
  const toast = useToast();
  const confirm = useConfirm();
  const hist = useData<{ items: any[] }>('/api/merchant/crm/announcements');
  const [audience, setAudience] = useState<'all' | 'loyal' | 'people' | 'wholesale'>(picked.length ? 'people' : 'all');
  const [tone, setTone] = useState<'news' | 'offer' | 'gift'>('news');
  const [title, setTitle] = useState('');
  const [body, setBody] = useState('');
  const [count, setCount] = useState<number | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const target = useMemo(() => ({ audience, ...(audience === 'people' ? { userIds: picked.map((p) => p.id) } : {}) }), [audience, picked]);
  useEffect(() => {
    if (audience === 'people' && !picked.length) {
      setCount(0);
      return;
    }
    let alive = true;
    const h = setTimeout(async () => {
      try {
        const r = await post<{ count: number }>('/api/merchant/crm/announce', { title: 'xx', body: 'xx', ...target, dryRun: true });
        if (alive) {
          setCount(r.count);
          setError(null);
        }
      } catch (e) {
        if (alive) {
          setCount(0);
          if (audience === 'loyal') setError(w.needLoyal);
        }
      }
    }, 250);
    return () => {
      alive = false;
      clearTimeout(h);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [target]);
  const TONE: Record<string, { icon: LucideIcon; c: string }> = {
    news: { icon: Newspaper, c: 'bg-sky/10 text-sky' },
    offer: { icon: BadgePercent, c: 'bg-stitch/10 text-stitch' },
    gift: { icon: Gift, c: 'bg-olive/12 text-olive' },
  };
  const T = TONE[tone]!;
  const send = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!(await confirm({ title: w.send, body: fill(w.confirmB, { n: count ?? 0 }) }))) return;
    setBusy(true);
    setError(null);
    try {
      const r = await post<{ sent: number }>('/api/merchant/crm/announce', { title: title.trim(), body: body.trim(), tone, ...target });
      toast(fill(w.sent, { n: r.sent }));
      setTitle('');
      setBody('');
      void hist.reload();
    } catch (e2) {
      setError(err(e2));
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="grid gap-5 lg:grid-cols-[minmax(0,1.3fr)_minmax(0,1fr)]">
      <form onSubmit={send} className="min-w-0">
        <Card title={w.newsTitle} icon={Megaphone} tone="bg-stitch/10 text-stitch">
          <p className="mb-4 text-sm text-muted">{w.newsLead}</p>
          <p className="mb-2 text-sm font-medium text-ink/80">{w.who}</p>
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
            {([
              ['all', w.aAll, Users],
              ['loyal', w.aLoyal, Crown],
              ['people', w.aPeople, Heart],
              ['wholesale', lang === 'ar' ? 'تجار الجملة' : 'Wholesale buyers', Truck],
            ] as const).map(([k, label, Icon]) => (
              <button key={k} type="button" onClick={() => setAudience(k)} className={cx('flex flex-col items-center gap-1.5 rounded-2xl px-2 py-3 text-center text-xs transition sm:text-sm', audience === k ? 'bg-night text-white shadow-lift dark:bg-white/15' : 'bg-sunk text-ink/80 hover:text-ink')}>
                <Icon className="h-5 w-5" />
                {label}
              </button>
            ))}
          </div>
          {audience === 'people' && (
            <div className="mt-3">
              {picked.length ? (
                <div className="flex flex-wrap gap-2">
                  {picked.map((p) => (
                    <span key={p.id} className="inline-flex items-center gap-2 rounded-full bg-sky/10 py-1 pe-1 ps-1 text-sm">
                      <Avatar name={p.full_name} src={p.profile_image} size={24} />
                      <span className="max-w-[9rem] truncate">{p.full_name}</span>
                      <button type="button" onClick={() => setPicked(picked.filter((x) => x.id !== p.id))} className="grid h-6 w-6 place-items-center rounded-full text-muted hover:bg-black/5">
                        <X className="h-3.5 w-3.5" />
                      </button>
                    </span>
                  ))}
                </div>
              ) : (
                <p className="rounded-xl bg-sunk px-3 py-2 text-sm text-muted">{w.pickCustomers}</p>
              )}
            </div>
          )}
          <p className={cx('mt-3 flex items-center gap-2 rounded-xl px-3 py-2 text-sm', count ? 'bg-olive/10 text-olive' : 'bg-sunk text-muted')}>
            <Users className="h-4 w-4" /> {count == null ? '…' : count ? fill(w.reach, { n: count }) : w.reachNone}
          </p>
          <div className="mt-5 space-y-4">
            <div>
              <p className="mb-2 text-sm font-medium text-ink/80">{w.tone}</p>
              <div className="flex flex-wrap gap-2">
                {(['news', 'offer', 'gift'] as const).map((k) => {
                  const D = TONE[k]!;
                  return (
                    <button key={k} type="button" onClick={() => setTone(k)} className={cx('inline-flex items-center gap-2 rounded-full px-3.5 py-2 text-sm transition', tone === k ? cx(D.c, 'font-semibold ring-1 ring-current') : 'bg-sunk text-ink/75')}>
                      <D.icon className="h-4 w-4" /> {w.tones[k]}
                    </button>
                  );
                })}
              </div>
            </div>
            <Field label={w.tTitle} value={title} onChange={(e) => setTitle(e.target.value)} required minLength={2} maxLength={80} />
            <TextArea label={w.tBody} value={body} onChange={(e) => setBody(e.target.value)} required minLength={2} maxLength={500} rows={4} />
            <ErrorNote>{error}</ErrorNote>
            <Button size="lg" block loading={busy} disabled={!count || title.trim().length < 2 || body.trim().length < 2} icon={<Send className="h-4 w-4 flip-rtl" />}>
              {w.send}
              {count ? <span className="num ms-1.5 rounded-full bg-white/20 px-2 py-0.5 text-xs">{count}</span> : null}
            </Button>
            <p className="text-center text-xs text-muted">{w.limit}</p>
          </div>
        </Card>
      </form>
      <div className="min-w-0 space-y-5">
        <section className="card p-5">
          <p className="mb-3 text-sm font-medium text-muted">{w.preview}</p>
          <div className="flex items-start gap-3 rounded-2xl bg-bg/70 p-3.5 ring-1 ring-line">
            <span className={cx('grid h-10 w-10 shrink-0 place-items-center rounded-xl', T.c)}>
              <T.icon className="h-5 w-5" />
            </span>
            <span className="min-w-0 flex-1">
              <span className="block font-semibold">{title.trim() || w.tTitle}</span>
              <span className="mt-0.5 block whitespace-pre-line text-sm text-muted">{body.trim() || w.tBody}</span>
            </span>
            <Sparkles className="h-4 w-4 shrink-0 text-gold" />
          </div>
        </section>
        <section className="card overflow-hidden">
          <h2 className="border-b border-line px-5 py-4 text-lg">{w.history}</h2>
          {!hist.data?.items.length ? (
            <p className="p-6 text-center text-sm text-muted">{w.histNone}</p>
          ) : (
            <ul className="max-h-[28rem] divide-y divide-line overflow-y-auto">
              {hist.data.items.map((h) => {
                const D = TONE[h.tone] ?? TONE.news!;
                return (
                  <li key={h.id} className="flex items-start gap-3 px-5 py-3.5">
                    <span className={cx('mt-0.5 grid h-8 w-8 shrink-0 place-items-center rounded-lg', D.c)}>
                      <D.icon className="h-4 w-4" />
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-sm font-semibold">{h.title}</span>
                      <span className="line-clamp-2 block text-xs text-muted">{h.body}</span>
                      <span className="mt-1 block text-[11px] text-muted">
                        {fill(w.reached, { n: h.sent_count })} · {relative(h.created_at, lang)}
                      </span>
                    </span>
                  </li>
                );
              })}
            </ul>
          )}
        </section>
      </div>
    </div>
  );
}

/** For the store page: this store's offer, my loyalty, and whether I get its news. */
export async function storePerks(merchantId: string) {
  return get<any>(`/api/store/me/perks/${merchantId}`);
}
