import { useMemo, useState } from 'react';
import { motion } from 'framer-motion';
import { ArrowDownWideNarrow, ArrowUpNarrowWide, Check, GitBranch, ImagePlus, Layers, MapPin, Package, Pencil, Plus, Star, Store, Trash2, Truck, X } from 'lucide-react';
import { assetUrl, del, post, put, upload } from '../lib/api';
import { useI18n } from '../lib/i18n';
import { useData } from '../lib/hooks';
import { money, relative } from '../lib/format';
import { useToast } from '../components/Toast';
import { useConfirm } from '../components/Confirm';
import { SECTION_ICONS, SECTION_IDEAS, sectionIcon } from '../components/StoreSections';
import { Stars } from './AdminReports';
import { Avatar, Badge, Button, EmptyState, Skeleton, Toggle, cx } from '../components/ui';

const tr = (ar: boolean, a: string, e: string) => (ar ? a : e);

function Panel({ title, icon: Icon, tone, children, aside }: { title: string; icon: typeof Store; tone: string; children: React.ReactNode; aside?: React.ReactNode }) {
  return (
    <motion.section initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} className="card p-5 sm:p-6">
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
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

/** A bar whose length shows a share of the biggest value. */
function Bar({ v, max, tone = 'bg-stitch' }: { v: number; max: number; tone?: string }) {
  return (
    <span className="block h-2 overflow-hidden rounded-full bg-sunk">
      <motion.span initial={{ width: 0 }} animate={{ width: `${max ? (v / max) * 100 : 0}%` }} transition={{ duration: 0.6 }} className={cx('block h-full rounded-full', tone)} />
    </span>
  );
}

// ---------------------------------------------------------------- analytics
export function Analytics() {
  const { lang } = useI18n();
  const ar = lang === 'ar';
  const [scope, setScope] = useState('store');
  const [days, setDays] = useState(90);
  const [placeDesc, setPlaceDesc] = useState(true);
  const [prodBy, setProdBy] = useState<'units' | 'revenue' | 'buyers'>('units');
  const data = useData<any>(`/api/merchant/crm/analytics?scope=${encodeURIComponent(scope)}&days=${days}`, [scope, days]);
  const d = data.data;
  const places = useMemo(() => {
    const list = [...(d?.places ?? [])];
    return placeDesc ? list : list.reverse();
  }, [d, placeDesc]);
  const products = useMemo(() => [...(d?.products ?? [])].sort((a, b) => (prodBy === 'revenue' ? Number(b.revenue) - Number(a.revenue) : b[prodBy] - a[prodBy])), [d, prodBy]);
  const opts = d?.options?.stores ?? [];
  const mainId = d?.options?.mainId;
  const branches = opts.filter((x: any) => String(x.parent_id ?? x.id) === String(mainId));
  const others = opts.filter((x: any) => !x.parent_id && String(x.id) !== String(mainId));
  const maxPlace = Math.max(1, ...places.map((p: any) => p.customers));
  const maxProd = Math.max(1, ...products.map((p: any) => (prodBy === 'revenue' ? Number(p.revenue) : p[prodBy])));

  return (
    <div className="space-y-5">
      <div className="flex flex-col gap-3 rounded-3xl bg-surface p-3 shadow-card sm:flex-row sm:items-center sm:justify-between">
        <div className="-mx-1 flex gap-1.5 overflow-x-auto px-1 [scrollbar-width:none]">
          <button onClick={() => setScope('store')} className={cx('inline-flex shrink-0 items-center gap-1.5 rounded-full px-3.5 py-1.5 text-sm transition', scope === 'store' ? 'bg-night text-white dark:bg-white/15' : 'bg-sunk text-ink/80')}>
            <Store className="h-4 w-4" /> {branches.length > 1 ? tr(ar, 'المتجر بكل فروعه', 'Store, all branches') : tr(ar, 'هالمتجر', 'This store')}
          </button>
          {branches.length > 1 &&
            branches.map((b: any) => (
              <button key={b.id} onClick={() => setScope(`branch:${b.id}`)} className={cx('inline-flex shrink-0 items-center gap-1.5 rounded-full px-3.5 py-1.5 text-sm transition', scope === `branch:${b.id}` ? 'bg-night text-white dark:bg-white/15' : 'bg-sunk text-ink/80')}>
                <GitBranch className="h-4 w-4" /> {b.parent_id ? b.branch_name ?? b.city : tr(ar, 'الفرع الرئيسي', 'Main branch')}
              </button>
            ))}
          {others.length > 0 && (
            <button onClick={() => setScope('all')} className={cx('inline-flex shrink-0 items-center gap-1.5 rounded-full px-3.5 py-1.5 text-sm transition', scope === 'all' ? 'bg-stitch text-white' : 'bg-sunk text-ink/80')}>
              <Layers className="h-4 w-4" /> {tr(ar, 'كل متاجري مع بعض', 'All my stores together')}
            </button>
          )}
        </div>
        <div className="flex gap-1.5">
          {[
            [30, tr(ar, '30 يوم', '30 days')],
            [90, tr(ar, '3 شهور', '3 months')],
            [365, tr(ar, 'سنة', 'Year')],
            [0, tr(ar, 'الكل', 'All')],
          ].map(([v, l]) => (
            <button key={v} onClick={() => setDays(Number(v))} className={cx('rounded-full px-3 py-1.5 text-sm transition', days === v ? 'bg-night text-white dark:bg-white/15' : 'text-muted hover:text-ink')}>
              {l}
            </button>
          ))}
        </div>
      </div>

      {!d ? (
        <Skeleton className="h-80 rounded-3xl" />
      ) : (
        <>
          <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
            {[
              [tr(ar, 'المبيعات', 'Revenue'), money(d.totals.revenue, lang)],
              [tr(ar, 'الطلبات', 'Orders'), d.totals.orders],
              [tr(ar, 'الزباين', 'Customers'), d.totals.customers],
              [tr(ar, 'متوسط الطلب', 'Average order'), money(d.totals.avg_order, lang)],
            ].map(([l, v], i) => (
              <motion.div key={String(l)} initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: i * 0.05 }} className={cx('rounded-3xl p-4', i === 0 ? 'bg-night text-white dark:bg-white/[0.07]' : 'bg-surface shadow-card')}>
                <p className={cx('text-xs', i === 0 ? 'text-white/65' : 'text-muted')}>{l}</p>
                <p className="num mt-1 font-display text-2xl">{v}</p>
              </motion.div>
            ))}
          </div>

          <div className="grid gap-5 lg:grid-cols-2">
            <Panel
              title={tr(ar, 'زباينك من وين', 'Where your customers are from')}
              icon={MapPin}
              tone="bg-stitch/10 text-stitch"
              aside={
                <button onClick={() => setPlaceDesc(!placeDesc)} className="inline-flex items-center gap-1.5 rounded-full bg-sunk px-3 py-1.5 text-xs font-medium">
                  {placeDesc ? <ArrowDownWideNarrow className="h-4 w-4" /> : <ArrowUpNarrowWide className="h-4 w-4" />}
                  {placeDesc ? tr(ar, 'من الأكثر للأقل', 'Most first') : tr(ar, 'من الأقل للأكثر', 'Fewest first')}
                </button>
              }
            >
              {!places.length ? (
                <p className="py-6 text-center text-sm text-muted">{tr(ar, 'لسا ما في طلبات بهالفترة', 'No orders in this period')}</p>
              ) : (
                <ul className="space-y-2.5">
                  {places.map((p: any) => (
                    <li key={p.place ?? '—'}>
                      <div className="mb-1 flex items-center justify-between gap-2 text-sm">
                        <span className="truncate font-medium">{p.place ?? tr(ar, 'مش معروف', 'Unknown')}</span>
                        <span className="num shrink-0 text-xs text-muted">
                          {tr(ar, `${p.customers} زبون · ${p.orders} طلب · `, `${p.customers} customers · ${p.orders} orders · `)}
                          {money(p.revenue, lang)}
                        </span>
                      </div>
                      <Bar v={p.customers} max={maxPlace} />
                    </li>
                  ))}
                </ul>
              )}
              <p className="mt-3 text-[11px] text-muted">{tr(ar, 'المكان من البلد اللي كتبه الزبون بملفه، أو من وين بيفتح التطبيق (تقريبي).', 'From the town in the customer’s profile, or roughly where they open the app.')}</p>
            </Panel>

            {(d.branches.length > 1 || scope === 'all') && (
              <Panel title={scope === 'all' ? tr(ar, 'متاجرك وفروعك', 'Your stores and branches') : tr(ar, 'الفروع', 'Branches')} icon={GitBranch} tone="bg-olive/12 text-olive">
                <ul className="space-y-3">
                  {d.branches.map((b: any) => (
                    <li key={b.id} className="rounded-2xl bg-bg/70 p-3 ring-1 ring-line">
                      <div className="flex items-center justify-between gap-2">
                        <p className="truncate font-semibold">
                          {b.store_name}
                          {b.branch_name ? <span className="font-normal text-muted"> · {b.branch_name}</span> : b.is_main ? '' : ''}
                        </p>
                        <span className="num shrink-0 text-sm">{money(b.revenue, lang)}</span>
                      </div>
                      <p className="text-xs text-muted">{tr(ar, `${b.orders} طلب · ${b.customers} زبون`, `${b.orders} orders · ${b.customers} customers`)}</p>
                      {b.top_places?.length > 0 && (
                        <div className="mt-2 flex flex-wrap gap-1">
                          {b.top_places.map((p: any) => (
                            <span key={p.place ?? '—'} className="rounded-full bg-sunk px-2 py-0.5 text-[11px]">
                              {p.place ?? '—'} · <b className="num">{p.customers}</b>
                            </span>
                          ))}
                        </div>
                      )}
                    </li>
                  ))}
                </ul>
              </Panel>
            )}
          </div>

          {scope === 'all' && d.stores.length > 1 && (
            <Panel title={tr(ar, 'كل متجر لحال', 'Each store')} icon={Store} tone="bg-sky/10 text-sky">
              <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
                {d.stores.map((s: any) => (
                  <div key={s.id} className="rounded-2xl bg-bg/70 p-4 ring-1 ring-line">
                    <p className="font-semibold">{s.store_name}</p>
                    <p className="num mt-1 font-display text-2xl">{money(s.revenue, lang)}</p>
                    <p className="text-xs text-muted">{tr(ar, `${s.orders} طلب · ${s.customers} زبون`, `${s.orders} orders · ${s.customers} customers`)}</p>
                  </div>
                ))}
              </div>
            </Panel>
          )}

          <Panel
            title={tr(ar, 'المنتجات الأكثر مبيعًا', 'Best-selling products')}
            icon={Package}
            tone="bg-gold/15 text-[rgb(150_105_10)] dark:text-gold"
            aside={
              <div className="flex gap-1">
                {(
                  [
                    ['units', tr(ar, 'القطع', 'Units')],
                    ['revenue', tr(ar, 'المبيعات', 'Revenue')],
                    ['buyers', tr(ar, 'المشترين', 'Buyers')],
                  ] as const
                ).map(([k, l]) => (
                  <button key={k} onClick={() => setProdBy(k)} className={cx('rounded-full px-3 py-1 text-xs transition', prodBy === k ? 'bg-night text-white dark:bg-white/15' : 'bg-sunk')}>
                    {l}
                  </button>
                ))}
              </div>
            }
          >
            {!products.length ? (
              <p className="py-6 text-center text-sm text-muted">{tr(ar, 'لسا ما انباع إشي بهالفترة', 'Nothing sold in this period')}</p>
            ) : (
              <ol className="space-y-2">
                {products.slice(0, 20).map((p: any, i: number) => (
                  <li key={p.id} className="flex items-center gap-3">
                    <span className={cx('num grid h-7 w-7 shrink-0 place-items-center rounded-full text-xs font-bold', i < 3 ? 'bg-gold text-night' : 'bg-sunk text-muted')}>{i + 1}</span>
                    {p.image_url ? <img src={assetUrl(p.image_url)!} alt="" className="h-10 w-10 shrink-0 rounded-xl object-cover" /> : <span className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-sunk"><Package className="h-4 w-4 text-muted" /></span>}
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center justify-between gap-2 text-sm">
                        <span className="truncate font-medium">{p.name}</span>
                        <span className="num shrink-0 text-xs text-muted">{tr(ar, `${p.units} قطعة · ${p.orders} طلب · ${p.buyers} مشتري`, `${p.units} units · ${p.orders} orders · ${p.buyers} buyers`)}</span>
                      </div>
                      <div className="mt-1 flex items-center gap-2">
                        <span className="flex-1">
                          <Bar v={prodBy === 'revenue' ? Number(p.revenue) : p[prodBy]} max={maxProd} tone="bg-gold" />
                        </span>
                        <span className="num shrink-0 text-xs font-semibold">{money(p.revenue, lang)}</span>
                      </div>
                    </div>
                  </li>
                ))}
              </ol>
            )}
          </Panel>
        </>
      )}
    </div>
  );
}

// ----------------------------------------------------------------- sections
export function Sections(_: { category?: string | null }) {
  const { lang, err } = useI18n();
  const prof = useData<{ merchant: any }>('/api/merchant/profile');
  const category = prof.data?.merchant?.category;
  const ar = lang === 'ar';
  const toast = useToast();
  const confirm = useConfirm();
  const data = useData<{ sections: any[] }>('/api/merchant/crm/sections');
  const products = useData<{ products: any[] }>('/api/merchant/products');
  const [edit, setEdit] = useState<{ id?: string; name: string; icon: string; imageUrl: string | null } | null>(null);
  const [pick, setPick] = useState<any>(null);
  const [busy, setBusy] = useState(false);
  const ideas = SECTION_IDEAS[category ?? ''] ?? SECTION_IDEAS.other!;
  const have = new Set((data.data?.sections ?? []).map((s) => s.name));
  const save = async () => {
    if (!edit) return;
    setBusy(true);
    try {
      const body = { name: edit.name.trim(), icon: edit.icon, imageUrl: edit.imageUrl };
      if (edit.id) await put(`/api/merchant/crm/sections/${edit.id}`, body);
      else await post('/api/merchant/crm/sections', body);
      setEdit(null);
      void data.reload();
    } catch (e) {
      toast(err(e), 'error');
    } finally {
      setBusy(false);
    }
  };
  const quick = async (name: string, icon: string) => {
    try {
      await post('/api/merchant/crm/sections', { name, icon });
      void data.reload();
    } catch (e) {
      toast(err(e), 'error');
    }
  };
  const toggleProduct = async (secId: string, pid: string, on: boolean) => {
    try {
      await post(`/api/merchant/crm/sections/${secId}/products`, on ? { remove: [pid] } : { add: [pid] });
      void products.reload();
      void data.reload();
    } catch (e) {
      toast(err(e), 'error');
    }
  };
  return (
    <div className="space-y-5">
      <Panel
        title={tr(ar, 'أقسام متجرك', 'Your store’s sections')}
        icon={Layers}
        tone="bg-sky/10 text-sky"
        aside={
          <Button size="sm" icon={<Plus className="h-4 w-4" />} onClick={() => setEdit({ name: '', icon: 'grid', imageUrl: null })}>
            {tr(ar, 'قسم جديد', 'New section')}
          </Button>
        }
      >
        <p className="-mt-2 mb-4 text-sm text-muted">{tr(ar, 'رتّب منتجاتك بأقسام بتبين بصفحة متجرك كصور كبيرة — الزبون بيختار قسم أو أكثر وبيدوّر جواته. منتجات الخصم بتنجمع لحالها بقسم «عروض».', 'Group products into sections shown as big tiles on your store page — people pick one or more and search inside. Discounted items gather on their own in “On offer”.')}</p>
        {ideas.some((x) => !have.has(ar ? x.ar : x.en)) && (
          <div className="mb-4">
            <p className="mb-2 text-xs font-medium text-muted">{tr(ar, 'اقتراحات لمتجرك — كبسة وبينضاف', 'Ideas for your store — one tap adds it')}</p>
            <div className="flex flex-wrap gap-2">
              {ideas
                .filter((x) => !have.has(ar ? x.ar : x.en))
                .map((x) => {
                  const I = sectionIcon(x.icon);
                  return (
                    <button key={x.en} onClick={() => quick(ar ? x.ar : x.en, x.icon)} className="inline-flex items-center gap-1.5 rounded-full border border-dashed border-line px-3 py-1.5 text-sm transition hover:border-sky hover:text-sky">
                      <I className="h-4 w-4" /> {ar ? x.ar : x.en} <Plus className="h-3.5 w-3.5" />
                    </button>
                  );
                })}
            </div>
          </div>
        )}
        {!data.data ? (
          <Skeleton className="h-32" />
        ) : !data.data.sections.length ? (
          <EmptyState icon={<Layers className="h-6 w-6" />} title={tr(ar, 'لسا ما في أقسام', 'No sections yet')} />
        ) : (
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
            {data.data.sections.map((s) => {
              const I = sectionIcon(s.icon);
              return (
                <div key={s.id} className="group relative h-32 overflow-hidden rounded-2xl bg-night text-white shadow-card">
                  {s.image_url && <img src={assetUrl(s.image_url)!} alt="" className="absolute inset-0 h-full w-full object-cover" />}
                  <span className="absolute inset-0 bg-gradient-to-t from-black/75 to-black/10" />
                  <span className="absolute start-2.5 top-2.5 grid h-8 w-8 place-items-center rounded-lg bg-white/20 backdrop-blur">
                    <I className="h-4 w-4" />
                  </span>
                  <div className="absolute end-2 top-2 flex gap-1 opacity-100 sm:opacity-0 sm:transition sm:group-hover:opacity-100">
                    <button onClick={() => setEdit({ id: s.id, name: s.name, icon: s.icon ?? 'grid', imageUrl: s.image_url })} className="grid h-7 w-7 place-items-center rounded-full bg-white/90 text-night" aria-label="✎">
                      <Pencil className="h-3.5 w-3.5" />
                    </button>
                    <button
                      onClick={async () => {
                        if (!(await confirm({ title: tr(ar, `تحذف قسم «${s.name}»؟`, `Delete “${s.name}”?`), body: tr(ar, 'المنتجات بتضل، بس بتطلع من هالقسم.', 'The products stay; they just leave this section.'), tone: 'danger', confirmLabel: tr(ar, 'احذف', 'Delete') }))) return;
                        await del(`/api/merchant/crm/sections/${s.id}`);
                        void data.reload();
                      }}
                      className="grid h-7 w-7 place-items-center rounded-full bg-white/90 text-stitch"
                      aria-label="🗑"
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </button>
                  </div>
                  <button onClick={() => setPick(s)} className="absolute inset-x-2.5 bottom-2.5 text-start">
                    <span className="block truncate font-semibold">{s.name}</span>
                    <span className="text-xs text-white/75 underline-offset-2 hover:underline">{tr(ar, `${s.count} منتج · اختار المنتجات`, `${s.count} products · choose`)}</span>
                  </button>
                </div>
              );
            })}
          </div>
        )}
      </Panel>

      {/* add / edit a section */}
      {edit && (
        <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} className="card space-y-4 p-5">
          <div className="flex items-center justify-between">
            <h3 className="text-lg">{edit.id ? tr(ar, 'عدّل القسم', 'Edit section') : tr(ar, 'قسم جديد', 'New section')}</h3>
            <button onClick={() => setEdit(null)} className="grid h-8 w-8 place-items-center rounded-full hover:bg-sunk" aria-label="✕">
              <X className="h-4 w-4" />
            </button>
          </div>
          <input value={edit.name} onChange={(e) => setEdit({ ...edit, name: e.target.value })} maxLength={40} placeholder={tr(ar, 'اسم القسم', 'Section name')} className="field" />
          <div>
            <p className="mb-2 text-xs font-medium text-muted">{tr(ar, 'أيقونة', 'Icon')}</p>
            <div className="flex flex-wrap gap-1.5">
              {Object.entries(SECTION_ICONS).map(([k, I]) => (
                <button key={k} onClick={() => setEdit({ ...edit, icon: k })} className={cx('grid h-9 w-9 place-items-center rounded-xl transition', edit.icon === k ? 'bg-night text-white dark:bg-white/20' : 'bg-sunk text-ink/70 hover:text-ink')} aria-label={k}>
                  <I className="h-4 w-4" />
                </button>
              ))}
            </div>
          </div>
          <label className="flex cursor-pointer items-center gap-3 rounded-2xl border-2 border-dashed border-line p-3 transition hover:border-sky">
            {edit.imageUrl ? <img src={assetUrl(edit.imageUrl)!} alt="" className="h-14 w-20 rounded-xl object-cover" /> : <ImagePlus className="h-6 w-6 text-sky" />}
            <span className="text-sm">{tr(ar, 'صورة للقسم (اختياري — بدونها بنستعمل صورة أحدث منتج فيه)', 'A picture (optional — otherwise the newest product’s)')}</span>
            <input
              type="file"
              accept="image/jpeg,image/png,image/webp"
              className="sr-only"
              onChange={async (e) => {
                const f = e.target.files?.[0];
                e.target.value = '';
                if (!f) return;
                const fd = new FormData();
                fd.append('image', f);
                try {
                  const r = await upload<{ url: string }>('/api/merchant/uploads/image', fd);
                  setEdit((x) => (x ? { ...x, imageUrl: r.url } : x));
                } catch (e2) {
                  toast(err(e2), 'error');
                }
              }}
            />
          </label>
          <Button block loading={busy} disabled={!edit.name.trim()} onClick={save}>
            {tr(ar, 'احفظ', 'Save')}
          </Button>
        </motion.div>
      )}

      {/* choose products for a section */}
      {pick && (
        <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} className="card p-5">
          <div className="mb-3 flex items-center justify-between">
            <h3 className="text-lg">{tr(ar, `منتجات «${pick.name}»`, `Products in “${pick.name}”`)}</h3>
            <button onClick={() => setPick(null)} className="grid h-8 w-8 place-items-center rounded-full hover:bg-sunk" aria-label="✕">
              <X className="h-4 w-4" />
            </button>
          </div>
          <ul className="grid gap-2 sm:grid-cols-2">
            {(products.data?.products ?? []).map((p) => {
              const on = (p.section_ids ?? []).includes(pick.id);
              return (
                <li key={p.id}>
                  <button onClick={() => toggleProduct(pick.id, p.id, on)} className={cx('flex w-full items-center gap-3 rounded-2xl p-2.5 text-start ring-1 transition', on ? 'bg-sky/[0.07] ring-sky/40' : 'ring-line hover:ring-ink/25')}>
                    {p.image_url ? <img src={assetUrl(p.image_url)!} alt="" className="h-10 w-10 rounded-xl object-cover" /> : <span className="grid h-10 w-10 place-items-center rounded-xl bg-sunk"><Package className="h-4 w-4 text-muted" /></span>}
                    <span className="min-w-0 flex-1 truncate text-sm font-medium">{p.name}</span>
                    <span className={cx('grid h-6 w-6 place-items-center rounded-full', on ? 'bg-sky text-white' : 'bg-sunk')}>{on && <Check className="h-3.5 w-3.5" />}</span>
                  </button>
                </li>
              );
            })}
          </ul>
        </motion.div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------- wholesale
export function Wholesale() {
  const { lang, err } = useI18n();
  const ar = lang === 'ar';
  const toast = useToast();
  const data = useData<any>('/api/merchant/crm/wholesale');
  const [terms, setTerms] = useState<string | null>(null);
  const d = data.data;
  const t = terms ?? d?.terms ?? '';
  const setOn = async (enabled: boolean) => {
    try {
      await put('/api/merchant/crm/wholesale', { enabled, terms: t || null });
      void data.reload();
    } catch (e) {
      toast(err(e), 'error');
    }
  };
  const decide = async (id: string, decision: string) => {
    try {
      await post(`/api/merchant/crm/wholesale/${id}/${decision}`);
      void data.reload();
    } catch (e) {
      toast(err(e), 'error');
    }
  };
  if (!d) return <Skeleton className="h-64 rounded-3xl" />;
  const pending = d.buyers.filter((b: any) => b.status === 'pending');
  const approved = d.buyers.filter((b: any) => b.status === 'approved');
  return (
    <div className="space-y-5">
      <Panel title={tr(ar, 'البيع بالجملة', 'Selling wholesale')} icon={Truck} tone="bg-[#1F4D3A]/10 text-[#1F4D3A] dark:text-[#9fd8bd]">
        <div className="rounded-2xl bg-sunk/60 p-3.5">
          <Toggle checked={d.enabled} onChange={setOn} label={tr(ar, 'بتتعامل مع تجار جملة', 'You deal with wholesale buyers')} />
          <p className="mt-1 text-xs text-muted">{tr(ar, 'التجار بيقدّموا من صفحة متجرك، وإنت بتوافق. المقبولين بيشوفوا أسعار الجملة وبتنحسب لحالها وقت الدفع لما يوصلوا للكمية.', 'Traders apply from your store page and you approve them. Approved ones see wholesale prices, applied at checkout from the minimum quantity.')}</p>
        </div>
        <label className="mt-4 block">
          <span className="mb-1.5 block text-sm font-medium text-ink/80">{tr(ar, 'شروط الجملة (بتبين للتجار)', 'Wholesale terms (traders see them)')}</span>
          <textarea value={t} onChange={(e) => setTerms(e.target.value)} rows={3} maxLength={1500} placeholder={tr(ar, 'مثلًا: أقل طلب 10 قطع · الدفع عند الاستلام · التوصيل مجاني فوق 500', 'e.g. Minimum 10 units · Free delivery over 500')} className="field resize-none py-3 text-sm" />
        </label>
        <div className="mt-3 flex flex-wrap items-center justify-between gap-2">
          <p className="text-xs text-muted">{tr(ar, `${d.products} منتج عليه سعر جملة — حطّ سعر الجملة وأقل كمية من صفحة المنتجات.`, `${d.products} products have a wholesale price — set it on each product.`)}</p>
          <Button size="sm" variant="secondary" onClick={() => setOn(d.enabled)}>
            {tr(ar, 'احفظ الشروط', 'Save terms')}
          </Button>
        </div>
      </Panel>
      <Panel title={tr(ar, 'تجار الجملة', 'Wholesale buyers')} icon={Store} tone="bg-olive/12 text-olive" aside={pending.length ? <Badge tone="warn">{tr(ar, `${pending.length} طلب جديد`, `${pending.length} new`)}</Badge> : null}>
        {!d.buyers.length ? (
          <EmptyState icon={<Truck className="h-6 w-6" />} title={tr(ar, 'لسا ما حدا قدّم', 'Nobody applied yet')} />
        ) : (
          <ul className="space-y-2.5">
            {[...pending, ...approved, ...d.buyers.filter((b: any) => b.status === 'rejected')].map((b: any) => (
              <li key={b.id} className="flex flex-wrap items-center gap-3 rounded-2xl p-3 ring-1 ring-line">
                <Avatar name={b.full_name} src={b.profile_image} size={40} />
                <div className="min-w-0 flex-1">
                  <p className="truncate font-semibold">{b.business_name ?? b.full_name}</p>
                  <p className="truncate text-xs text-muted">
                    {b.full_name} · {relative(b.created_at, lang)}
                    {b.status === 'approved' && ` · ${tr(ar, `${b.orders} طلب جملة · ${money(b.spent, lang)}`, `${b.orders} orders · ${money(b.spent, lang)}`)}`}
                  </p>
                  {b.note && <p className="mt-0.5 text-xs">“{b.note}”</p>}
                </div>
                {b.status === 'pending' ? (
                  <div className="flex gap-1.5">
                    <Button size="sm" icon={<Check className="h-4 w-4" />} onClick={() => decide(b.id, 'approve')}>
                      {tr(ar, 'اقبل', 'Approve')}
                    </Button>
                    <Button size="sm" variant="secondary" onClick={() => decide(b.id, 'reject')}>
                      {tr(ar, 'ارفض', 'Decline')}
                    </Button>
                  </div>
                ) : (
                  <div className="flex items-center gap-2">
                    <Badge tone={b.status === 'approved' ? 'good' : 'neutral'}>{b.status === 'approved' ? tr(ar, 'تاجر جملة', 'Approved') : tr(ar, 'مرفوض', 'Declined')}</Badge>
                    <button onClick={() => decide(b.id, 'remove')} className="text-xs text-muted hover:text-stitch">
                      {tr(ar, 'شيله', 'Remove')}
                    </button>
                  </div>
                )}
              </li>
            ))}
          </ul>
        )}
      </Panel>
    </div>
  );
}

// ------------------------------------------------------------------ reviews
export function MyReviews() {
  const { lang, err } = useI18n();
  const ar = lang === 'ar';
  const toast = useToast();
  const data = useData<any>('/api/feedback/merchant/reviews');
  const d = data.data;
  if (!d) return <Skeleton className="h-64 rounded-3xl" />;
  const s = d.settings;
  return (
    <div className="space-y-5">
      <Panel title={tr(ar, 'تقييمات متجرك', 'Your store’s reviews')} icon={Star} tone="bg-gold/15 text-[rgb(150_105_10)] dark:text-gold">
        {s.owner === 'none' ? (
          <p className="rounded-2xl bg-sunk/70 p-4 text-sm text-muted">{tr(ar, 'الزباين بيقيّموا متجرك بعد ما يشتروا. الإدارة لسا ما فتحت عرض التقييمات لمتجرك — لما تفتحها بتبين هون.', 'Customers rate your store after buying. The team hasn’t opened reviews to you yet — once they do, they show here.')}</p>
        ) : (
          <>
            <div className="flex flex-wrap items-center gap-5">
              <div>
                <p className="num font-display text-4xl leading-none">{d.summary?.avg ? Number(d.summary.avg).toFixed(1) : '—'}</p>
                <Stars v={Number(d.summary?.avg ?? 0)} />
                <p className="text-xs text-muted">{tr(ar, `${d.summary?.count ?? 0} تقييم`, `${d.summary?.count ?? 0} reviews`)}</p>
              </div>
              {s.public !== 'off' && (
                <div className="min-w-[14rem] flex-1 rounded-2xl bg-sunk/60 p-3">
                  <Toggle
                    checked={s.show}
                    onChange={async (v) => {
                      try {
                        await put('/api/feedback/merchant/reviews/show', { show: v });
                        void data.reload();
                      } catch (e) {
                        toast(err(e), 'error');
                      }
                    }}
                    label={tr(ar, 'اعرضها بصفحة متجري', 'Show them on my store page')}
                  />
                  <p className="mt-1 text-xs text-muted">{s.public === 'full' ? tr(ar, 'بتبين النجوم وبعض التعليقات.', 'Stars and some comments show.') : tr(ar, 'بتبين النجوم والعدد بس.', 'Only the stars and count show.')}</p>
                </div>
              )}
            </div>
            {s.owner === 'anonymous' && <p className="mt-3 text-xs text-muted">{tr(ar, 'بتشوف التقييمات بلا أسماء.', 'You see reviews without names.')}</p>}
            <ul className="mt-4 space-y-2.5">
              {d.reviews.map((r: any) => (
                <li key={r.id} className="rounded-2xl p-3.5 ring-1 ring-line">
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-sm font-medium">{r.name ?? tr(ar, 'زبون', 'A customer')}</span>
                    <Stars v={r.stars} size="h-3.5 w-3.5" />
                  </div>
                  {r.body && <p className="mt-1 text-sm">{r.body}</p>}
                  <p className="mt-1 text-[11px] text-muted">
                    {relative(r.at, lang)}
                    {r.edited && ` · ${tr(ar, 'معدّل', 'edited')}`}
                  </p>
                </li>
              ))}
            </ul>
          </>
        )}
      </Panel>
    </div>
  );
}

