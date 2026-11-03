import { useState } from 'react';
import { Link } from 'react-router-dom';
import { motion } from 'framer-motion';
import { Check, Eye, EyeOff, Flag, Hand, History, ShieldAlert, Star, Store, UserRound, X } from 'lucide-react';
import { get, patch, post } from '../lib/api';
import { useI18n } from '../lib/i18n';
import { useData } from '../lib/hooks';
import { relative } from '../lib/format';
import { useToast } from '../components/Toast';
import { useConfirm } from '../components/Confirm';
import { REASONS } from '../components/Feedback';
import { Avatar, Badge, Button, EmptyState, PageHeader, Sheet, Skeleton, cx } from '../components/ui';

const W = {
  ar: {
    title: 'البلاغات والتقييمات',
    lead: 'بلاغات الناس على المتاجر وعلى بعض، وتقييمات المتاجر بالأسماء الحقيقية — وإنت بتقرر شو بيبين للناس ولصاحب المتجر.',
    tabs: { reports: 'البلاغات', reviews: 'تقييمات المتاجر' },
    filters: { open: 'مفتوحة', mine: 'معي', closed: 'منتهية', all: 'الكل' } as Record<string, string>,
    st: { open: 'جديد', handling: 'قيد المتابعة', resolved: 'انحل', dismissed: 'انرفض' } as Record<string, string>,
    from: 'من {name}',
    about: 'عن',
    prior: '{n} بلاغ عليه',
    take: 'استلمه',
    resolve: 'انحل',
    dismiss: 'ارفضه',
    resolution: 'شو صار؟ (بيوصل للي بلّغ)',
    done: 'انسكّر البلاغ',
    handler: 'مع {name}',
    none: 'ما في بلاغات هون',
    sort: { worst: 'الأضعف', best: 'الأفضل', most: 'الأكثر تقييمًا', reports: 'الأكثر بلاغات' } as Record<string, string>,
    reviews: '{n} تقييم',
    low: '{n} سيئ',
    reportsN: '{n} بلاغ',
    disputes: '{n} نزاع',
    orders: '{n} طلب',
    pub: 'شو بيشوف الناس بصفحة المتجر؟',
    pubOpts: { off: 'ولا إشي', stars: 'النجوم والعدد', full: 'النجوم وتعليقات' } as Record<string, string>,
    own: 'شو بيشوف صاحب المتجر؟',
    ownOpts: { none: 'ولا إشي', anonymous: 'التقييمات بلا أسماء', full: 'زي ما هي' } as Record<string, string>,
    shows: 'صاحب المتجر مفعّل العرض',
    hides: 'صاحب المتجر مش عارضها',
    forAll: 'طبّق على كل المتاجر',
    allQ: 'تطبّق هالاختيار على كل المتاجر؟',
    allB: 'رح يتغيّر لكل المتاجر مرة وحدة.',
    saved: 'انحفظ',
    anon: 'بدّه اسمه مخفي',
    edited: 'عدّل تقييمه {n} مرة',
    before: 'قبل التعديل',
    hide: 'خبّي',
    show: 'رجّعه',
    hidden: 'مخفي',
    bought: 'اشترى {n} مرة',
    storeReports: 'البلاغات على المتجر',
    noReviews: 'لسا ما في تقييمات',
    open: 'افتح المتجر',
  },
  en: {
    title: 'Reports & reviews',
    lead: 'Reports about stores and people, and store reviews with real names — you decide what the public and the store owner see.',
    tabs: { reports: 'Reports', reviews: 'Store reviews' },
    filters: { open: 'Open', mine: 'Mine', closed: 'Closed', all: 'All' } as Record<string, string>,
    st: { open: 'New', handling: 'Handling', resolved: 'Resolved', dismissed: 'Dismissed' } as Record<string, string>,
    from: 'From {name}',
    about: 'About',
    prior: '{n} reports on them',
    take: 'Take it',
    resolve: 'Resolved',
    dismiss: 'Dismiss',
    resolution: 'What happened? (the reporter sees it)',
    done: 'Report closed',
    handler: 'With {name}',
    none: 'No reports here',
    sort: { worst: 'Weakest', best: 'Best', most: 'Most reviewed', reports: 'Most reported' } as Record<string, string>,
    reviews: '{n} reviews',
    low: '{n} poor',
    reportsN: '{n} reports',
    disputes: '{n} disputes',
    orders: '{n} orders',
    pub: 'What the public sees on the store page',
    pubOpts: { off: 'Nothing', stars: 'Stars and count', full: 'Stars and comments' } as Record<string, string>,
    own: 'What the store owner sees',
    ownOpts: { none: 'Nothing', anonymous: 'Reviews without names', full: 'As they are' } as Record<string, string>,
    shows: 'The owner shows them',
    hides: 'The owner isn’t showing them',
    forAll: 'Apply to every store',
    allQ: 'Apply this to every store?',
    allB: 'It changes for all stores at once.',
    saved: 'Saved',
    anon: 'Asked to hide their name',
    edited: 'Changed their review {n} times',
    before: 'Before the change',
    hide: 'Hide',
    show: 'Show again',
    hidden: 'Hidden',
    bought: 'Bought {n} times',
    storeReports: 'Reports about the store',
    noReviews: 'No reviews yet',
    open: 'Open store',
  },
};

export function Stars({ v, size = 'h-4 w-4' }: { v: number; size?: string }) {
  return (
    <span className="inline-flex" aria-label={`${v}/5`}>
      {[1, 2, 3, 4, 5].map((n) => (
        <Star key={n} className={cx(size, n <= Math.round(v) ? 'fill-gold text-gold' : 'text-line')} />
      ))}
    </span>
  );
}

export function AdminReports() {
  const { lang } = useI18n();
  const w = W[lang === 'ar' ? 'ar' : 'en'];
  const [tab, setTab] = useState<'reports' | 'reviews'>('reports');
  return (
    <div>
      <PageHeader title={w.title} lead={w.lead} />
      <div className="mb-5 inline-flex rounded-2xl bg-surface p-1 ring-1 ring-line" role="tablist">
        {(['reports', 'reviews'] as const).map((k) => (
          <button key={k} role="tab" aria-selected={tab === k} onClick={() => setTab(k)} className={cx('relative flex items-center gap-2 rounded-xl px-4 py-2 text-sm font-medium transition', tab === k ? 'text-white' : 'text-muted hover:text-ink')}>
            {tab === k && <motion.span layoutId="rep-tab" className="absolute inset-0 rounded-xl bg-night dark:bg-white/15" />}
            {k === 'reports' ? <Flag className="relative h-4 w-4" /> : <Star className="relative h-4 w-4" />}
            <span className="relative">{w.tabs[k]}</span>
          </button>
        ))}
      </div>
      {tab === 'reports' ? <Reports w={w} /> : <Reviews w={w} />}
    </div>
  );
}

function Reports({ w }: { w: (typeof W)['ar'] }) {
  const { lang, err } = useI18n();
  const toast = useToast();
  const [status, setStatus] = useState('open');
  const data = useData<{ reports: any[] }>(`/api/feedback/admin/reports?status=${status}`, [status]);
  const [closing, setClosing] = useState<{ id: string; outcome: 'resolved' | 'dismissed' } | null>(null);
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState<string | null>(null);
  const act = async (id: string, fn: () => Promise<unknown>, ok?: string) => {
    setBusy(id);
    try {
      await fn();
      if (ok) toast(ok);
      void data.reload();
    } catch (e) {
      toast(err(e), 'error');
    } finally {
      setBusy(null);
    }
  };
  return (
    <>
      <div className="mb-4 flex flex-wrap gap-2">
        {Object.keys(w.filters).map((k) => (
          <button key={k} onClick={() => setStatus(k)} className={cx('rounded-full px-3.5 py-1.5 text-sm transition', status === k ? 'bg-night text-white dark:bg-white/15' : 'bg-surface text-muted ring-1 ring-line hover:text-ink')}>
            {w.filters[k]}
          </button>
        ))}
      </div>
      {!data.data ? (
        <Skeleton className="h-64 rounded-3xl" />
      ) : !data.data.reports.length ? (
        <EmptyState icon={<ShieldAlert className="h-6 w-6" />} title={w.none} />
      ) : (
        <ul className="space-y-3">
          {data.data.reports.map((r) => {
            const reason = REASONS.find((x) => x.k === r.reason);
            const openNow = r.status === 'open' || r.status === 'handling';
            return (
              <motion.li key={r.id} layout className="card p-4 sm:p-5">
                <div className="flex flex-wrap items-start gap-3">
                  <div className="flex min-w-0 flex-1 items-center gap-3">
                    <Avatar name={r.store_name ?? r.target_name} src={r.logo_url ?? r.target_image} size={44} />
                    <div className="min-w-0">
                      <p className="text-xs text-muted">{w.about}</p>
                      <p className="flex items-center gap-1.5 truncate font-semibold">
                        {r.store_name ? <Store className="h-4 w-4 text-olive" /> : <UserRound className="h-4 w-4 text-sky" />}
                        {r.store_name ?? r.target_name}
                        {r.store_name && <span className="font-normal text-muted">· {r.target_name}</span>}
                      </p>
                      {r.target_reports > 1 && <p className="text-xs font-medium text-stitch">{w.prior.replace('{n}', String(r.target_reports))}</p>}
                    </div>
                  </div>
                  <Badge tone={r.status === 'open' ? 'warn' : r.status === 'handling' ? 'info' : r.status === 'resolved' ? 'good' : 'neutral'}>{w.st[r.status]}</Badge>
                </div>
                <div className="mt-3 rounded-2xl bg-bg/70 p-3 ring-1 ring-line">
                  {reason && (
                    <span className={cx('mb-1.5 inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-medium', reason.c)}>
                      <reason.icon className="h-3.5 w-3.5" /> {lang === 'ar' ? reason.ar : reason.en}
                    </span>
                  )}
                  <p className="whitespace-pre-line break-words text-sm">{r.details}</p>
                  <p className="mt-1.5 text-[11px] text-muted">
                    {w.from.replace('{name}', r.reporter_name ?? '—')} · {relative(r.created_at, lang)}
                    {r.handler_name ? ` · ${w.handler.replace('{name}', r.handler_name)}` : ''}
                  </p>
                </div>
                {r.resolution && <p className="mt-2 rounded-xl bg-olive/[0.07] px-3 py-2 text-sm">{r.resolution}</p>}
                {openNow && (
                  <div className="mt-3 flex flex-wrap gap-2">
                    {r.status === 'open' && (
                      <Button size="sm" variant="secondary" loading={busy === r.id} icon={<Hand className="h-4 w-4" />} onClick={() => act(r.id, () => post(`/api/feedback/admin/reports/${r.id}/claim`))}>
                        {w.take}
                      </Button>
                    )}
                    <Button size="sm" icon={<Check className="h-4 w-4" />} onClick={() => (setClosing({ id: r.id, outcome: 'resolved' }), setNote(''))}>
                      {w.resolve}
                    </Button>
                    <Button size="sm" variant="secondary" icon={<X className="h-4 w-4" />} onClick={() => (setClosing({ id: r.id, outcome: 'dismissed' }), setNote(''))}>
                      {w.dismiss}
                    </Button>
                  </div>
                )}
                {closing?.id === r.id && (
                  <div className="mt-3 flex flex-col gap-2 sm:flex-row">
                    <input autoFocus value={note} onChange={(e) => setNote(e.target.value)} maxLength={1000} placeholder={w.resolution} className="field h-11 flex-1 text-sm" />
                    <Button
                      size="sm"
                      disabled={note.trim().length < 3}
                      loading={busy === r.id}
                      onClick={() => act(r.id, async () => (await post(`/api/feedback/admin/reports/${r.id}/resolve`, { outcome: closing!.outcome, resolution: note.trim() }), setClosing(null)), w.done)}
                    >
                      {closing?.outcome === 'resolved' ? w.resolve : w.dismiss}
                    </Button>
                  </div>
                )}
              </motion.li>
            );
          })}
        </ul>
      )}
    </>
  );
}

function Reviews({ w }: { w: (typeof W)['ar'] }) {
  const { lang, err } = useI18n();
  const toast = useToast();
  const confirm = useConfirm();
  const [sort, setSort] = useState('worst');
  const data = useData<{ stores: any[] }>(`/api/feedback/admin/stores?sort=${sort}`, [sort]);
  const [sel, setSel] = useState<string | null>(null);
  const [detail, setDetail] = useState<any>(null);
  const [bulk, setBulk] = useState<{ public: string; owner: string }>({ public: 'off', owner: 'none' });
  const openStore = async (id: string) => {
    setSel(id);
    setDetail(null);
    try {
      setDetail(await get(`/api/feedback/admin/stores/${id}`));
    } catch (e) {
      toast(err(e), 'error');
    }
  };
  const save = async (body: Record<string, string>) => {
    try {
      await patch(`/api/feedback/admin/stores/${sel}/settings`, body);
      toast(w.saved);
      void openStore(sel!);
      void data.reload();
    } catch (e) {
      toast(err(e), 'error');
    }
  };
  const Seg = ({ value, opts, onPick }: { value: string; opts: Record<string, string>; onPick: (k: string) => void }) => (
    <div className="flex flex-wrap gap-1.5">
      {Object.entries(opts).map(([k, l]) => (
        <button key={k} type="button" onClick={() => onPick(k)} className={cx('rounded-full px-3 py-1.5 text-sm transition', value === k ? 'bg-night text-white dark:bg-white/15' : 'bg-sunk text-ink/80 hover:text-ink')}>
          {l}
        </button>
      ))}
    </div>
  );
  return (
    <>
      <section className="card mb-4 grid gap-4 p-4 sm:p-5 lg:grid-cols-[1fr_1fr_auto] lg:items-end">
        <div>
          <p className="mb-1.5 text-xs font-medium text-muted">{w.pub}</p>
          <Seg value={bulk.public} opts={w.pubOpts} onPick={(k) => setBulk({ ...bulk, public: k })} />
        </div>
        <div>
          <p className="mb-1.5 text-xs font-medium text-muted">{w.own}</p>
          <Seg value={bulk.owner} opts={w.ownOpts} onPick={(k) => setBulk({ ...bulk, owner: k })} />
        </div>
        <Button
          variant="secondary"
          onClick={async () => {
            if (!(await confirm({ title: w.allQ, body: w.allB, confirmLabel: w.forAll }))) return;
            try {
              await post('/api/feedback/admin/settings-all', bulk);
              toast(w.saved);
              void data.reload();
            } catch (e) {
              toast(err(e), 'error');
            }
          }}
        >
          {w.forAll}
        </Button>
      </section>
      <div className="mb-3 flex flex-wrap gap-2">
        {Object.keys(w.sort).map((k) => (
          <button key={k} onClick={() => setSort(k)} className={cx('rounded-full px-3.5 py-1.5 text-sm transition', sort === k ? 'bg-night text-white dark:bg-white/15' : 'bg-surface text-muted ring-1 ring-line hover:text-ink')}>
            {w.sort[k]}
          </button>
        ))}
      </div>
      {!data.data ? (
        <Skeleton className="h-64 rounded-3xl" />
      ) : (
        <ul className="card divide-y divide-line overflow-hidden">
          {data.data.stores.map((s, i) => (
            <li key={s.id}>
              <button onClick={() => openStore(s.id)} className="flex w-full items-center gap-3 px-4 py-3 text-start transition hover:bg-sunk/60">
                <span className="num w-6 text-center text-sm text-muted">{i + 1}</span>
                <Avatar name={s.store_name} src={s.logo_url} size={40} />
                <span className="min-w-0 flex-1">
                  <span className="block truncate font-semibold">{s.store_name}</span>
                  <span className="flex flex-wrap gap-x-2 text-[11px] text-muted">
                    <span>{s.owner_name}</span>
                    <span>· {w.orders.replace('{n}', String(s.orders))}</span>
                    {s.low > 0 && <span className="text-stitch">· {w.low.replace('{n}', String(s.low))}</span>}
                    {s.reports > 0 && <span className={s.reports_open ? 'font-semibold text-stitch' : ''}>· {w.reportsN.replace('{n}', String(s.reports))}</span>}
                    {s.disputes > 0 && <span>· {w.disputes.replace('{n}', String(s.disputes))}</span>}
                  </span>
                </span>
                <span className="text-end">
                  {s.count ? (
                    <>
                      <span className="num block font-display text-xl leading-none">{Number(s.avg).toFixed(1)}</span>
                      <Stars v={Number(s.avg)} size="h-3 w-3" />
                      <span className="block text-[11px] text-muted">{w.reviews.replace('{n}', String(s.count))}</span>
                    </>
                  ) : (
                    <span className="text-xs text-muted">—</span>
                  )}
                </span>
              </button>
            </li>
          ))}
        </ul>
      )}

      <Sheet open={!!sel} onClose={() => setSel(null)} title={detail?.store?.store_name ?? '…'} wide>
        {!detail ? (
          <Skeleton className="h-60" />
        ) : (
          <div className="space-y-4">
            <div className="flex items-center justify-between gap-3 rounded-2xl bg-night p-4 text-white dark:bg-white/[0.06]">
              <div>
                <p className="num font-display text-3xl">{detail.summary.avg ? Number(detail.summary.avg).toFixed(1) : '—'}</p>
                <Stars v={Number(detail.summary.avg ?? 0)} />
                <p className="text-xs text-white/60">{w.reviews.replace('{n}', String(detail.summary.count))}</p>
              </div>
              <Link to={`/s/${detail.store.slug}`} className="rounded-full bg-white/15 px-3 py-1.5 text-sm hover:bg-white/25">
                {w.open}
              </Link>
            </div>
            <div className="grid gap-3 sm:grid-cols-2">
              <div className="rounded-2xl p-3 ring-1 ring-line">
                <p className="mb-1.5 text-xs font-medium text-muted">{w.pub}</p>
                <Seg value={detail.store.review_public} opts={w.pubOpts} onPick={(k) => save({ public: k })} />
                {detail.store.review_public !== 'off' && <p className="mt-2 text-[11px] text-muted">{detail.store.review_show ? w.shows : w.hides}</p>}
              </div>
              <div className="rounded-2xl p-3 ring-1 ring-line">
                <p className="mb-1.5 text-xs font-medium text-muted">{w.own}</p>
                <Seg value={detail.store.review_owner} opts={w.ownOpts} onPick={(k) => save({ owner: k })} />
              </div>
            </div>
            {!detail.reviews.length ? (
              <p className="py-4 text-center text-sm text-muted">{w.noReviews}</p>
            ) : (
              <ul className="space-y-2.5">
                {detail.reviews.map((r: any) => (
                  <li key={r.id} className={cx('rounded-2xl p-3.5 ring-1 ring-line', r.hidden && 'opacity-60')}>
                    <div className="flex items-start justify-between gap-2">
                      <div className="min-w-0">
                        <p className="truncate text-sm font-semibold">{r.full_name}</p>
                        <p className="text-[11px] text-muted">
                          {w.bought.replace('{n}', String(r.orders))} · {relative(r.updated_at, lang)}
                          {r.anonymous && <span className="ms-1 rounded-full bg-sunk px-1.5">{w.anon}</span>}
                          {r.hidden && <span className="ms-1 rounded-full bg-stitch/10 px-1.5 text-stitch">{w.hidden}</span>}
                        </p>
                      </div>
                      <Stars v={r.stars} size="h-3.5 w-3.5" />
                    </div>
                    {r.body && <p className="mt-1.5 whitespace-pre-line text-sm">{r.body}</p>}
                    {r.versions?.length > 0 && (
                      <details className="mt-2 text-xs">
                        <summary className="flex cursor-pointer items-center gap-1 text-sky">
                          <History className="h-3.5 w-3.5" /> {w.edited.replace('{n}', String(r.edits))}
                        </summary>
                        <ul className="mt-1.5 space-y-1">
                          {r.versions.map((v: any, k: number) => (
                            <li key={k} className="rounded-lg bg-sunk px-2.5 py-1.5">
                              <Stars v={v.stars} size="h-3 w-3" /> <span className="text-muted">· {relative(v.at, lang)}</span>
                              {v.body && <p className="mt-0.5">{v.body}</p>}
                            </li>
                          ))}
                        </ul>
                      </details>
                    )}
                    <button
                      onClick={async () => {
                        try {
                          await patch(`/api/feedback/admin/reviews/${r.id}`, { hidden: !r.hidden });
                          void openStore(sel!);
                        } catch (e) {
                          toast(err(e), 'error');
                        }
                      }}
                      className="mt-2 inline-flex items-center gap-1 text-xs text-muted hover:text-ink"
                    >
                      {r.hidden ? <Eye className="h-3.5 w-3.5" /> : <EyeOff className="h-3.5 w-3.5" />} {r.hidden ? w.show : w.hide}
                    </button>
                  </li>
                ))}
              </ul>
            )}
            {detail.reports.length > 0 && (
              <div>
                <p className="mb-1.5 text-sm font-semibold">{w.storeReports}</p>
                <ul className="space-y-1.5">
                  {detail.reports.map((r: any) => (
                    <li key={r.id} className="rounded-xl bg-stitch/[0.05] px-3 py-2 text-sm">
                      <span className="text-[11px] text-muted">
                        {r.reporter} · {w.st[r.status]} · {relative(r.created_at, lang)}
                      </span>
                      <p>{r.details}</p>
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </div>
        )}
      </Sheet>
    </>
  );
}
