import { useState } from 'react';
import { motion } from 'framer-motion';
import { ArrowDownToLine, ArrowUpFromLine, BarChart3, CalendarDays, Clock, MapPin, Plus, Repeat, Trash2, Users } from 'lucide-react';
import { useI18n } from '../lib/i18n';
import { useData } from '../lib/hooks';
import { money } from '../lib/format';
import { MapView } from './MapView';
import { TownField } from './TownField';
import { Avatar, Field, Skeleton, cx } from './ui';

export type AgentPlace = { id?: string; name: string; city: string | null; address: string | null; lat: number | null; lng: number | null; days: number[]; hours: string | null; directions: string | null };

/** Week order as people say it here: Saturday first. 0 = Sunday … 6 = Saturday. */
export const WEEK = [6, 0, 1, 2, 3, 4, 5];
export const DAY = {
  ar: ['الأحد', 'الاثنين', 'الثلاثاء', 'الأربعاء', 'الخميس', 'الجمعة', 'السبت'],
  en: ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'],
};
export const daysLabel = (days: number[], lang: string) => {
  const names = DAY[lang === 'ar' ? 'ar' : 'en'];
  if (!days?.length || days.length === 7) return lang === 'ar' ? 'كل يوم' : 'Every day';
  return WEEK.filter((d) => days.includes(d))
    .map((d) => names[d])
    .join(lang === 'ar' ? '، ' : ', ');
};
export const isToday = (days: number[]) => !days?.length || days.includes(new Date().getDay());

/** The other places an agent works from, and which days they're there. */
export function AgentPlacesEditor({ value, onChange }: { value: AgentPlace[]; onChange: (v: AgentPlace[]) => void }) {
  const { lang } = useI18n();
  const ar = lang === 'ar';
  const names = DAY[ar ? 'ar' : 'en'];
  const set = (i: number, p: Partial<AgentPlace>) => onChange(value.map((x, k) => (k === i ? { ...x, ...p } : x)));
  return (
    <div className="space-y-4">
      {value.map((p, i) => (
        <motion.div key={p.id ?? i} layout initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} className="rounded-3xl bg-bg/60 p-4 ring-1 ring-line">
          <div className="mb-3 flex items-center justify-between gap-2">
            <p className="flex items-center gap-2 font-semibold">
              <span className="num grid h-7 w-7 place-items-center rounded-full bg-gold/20 text-xs text-[rgb(150_105_10)] dark:text-gold">{i + 2}</span>
              {p.name || (ar ? 'مكان جديد' : 'New place')}
            </p>
            <button type="button" onClick={() => onChange(value.filter((_, k) => k !== i))} className="grid h-8 w-8 place-items-center rounded-full text-muted hover:bg-stitch/10 hover:text-stitch" aria-label={ar ? 'شيل' : 'Remove'}>
              <Trash2 className="h-4 w-4" />
            </button>
          </div>
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label={ar ? 'اسم المكان' : 'Place name'} value={p.name} onChange={(e) => set(i, { name: e.target.value })} maxLength={60} placeholder={ar ? 'مثلًا: كشك السوق' : 'e.g. Market kiosk'} />
            <TownField label={ar ? 'البلد' : 'Town'} value={p.city ?? ''} onChange={(v) => set(i, { city: v })} />
            <Field label={ar ? 'العنوان' : 'Address'} value={p.address ?? ''} onChange={(e) => set(i, { address: e.target.value })} maxLength={160} />
            <Field label={ar ? 'الدوام هناك' : 'Hours there'} value={p.hours ?? ''} onChange={(e) => set(i, { hours: e.target.value })} maxLength={120} placeholder="9:00–14:00" />
          </div>
          <p className="mb-1.5 mt-3 flex items-center gap-1.5 text-sm font-medium text-ink/80">
            <CalendarDays className="h-4 w-4" /> {ar ? 'أي أيام بتكون هناك؟' : 'Which days are you there?'}
          </p>
          <div className="flex flex-wrap gap-1.5">
            {WEEK.map((d) => {
              const on = p.days.includes(d);
              return (
                <button key={d} type="button" onClick={() => set(i, { days: on ? p.days.filter((x) => x !== d) : [...p.days, d] })} className={cx('rounded-full px-3 py-1.5 text-sm transition', on ? 'bg-night text-white dark:bg-white/20' : 'bg-sunk text-ink/75 hover:text-ink')}>
                  {names[d]}
                </button>
              );
            })}
          </div>
          <p className="mt-1 text-xs text-muted">{p.days.length ? daysLabel(p.days, lang) : ar ? 'ولا يوم مختار = كل يوم' : 'None picked = every day'}</p>
          <div className="mt-3">
            <MapView className="h-48 rounded-2xl" zoom={14} pins={p.lat != null && p.lng != null ? [{ id: 'p', lat: p.lat, lng: p.lng, kind: 'agent', label: p.name }] : []} onPick={(x) => set(i, { lat: x.lat, lng: x.lng })} search onSearchPick={(x) => set(i, { lat: x.lat, lng: x.lng })} />
            <p className="mt-1 text-xs text-muted">{ar ? 'اكبس على الخريطة بمكانك هناك.' : 'Tap the map where you are there.'}</p>
          </div>
          <Field className="mt-3" label={ar ? 'كيف يوصلولك هناك (اختياري)' : 'How to find you there (optional)'} value={p.directions ?? ''} onChange={(e) => set(i, { directions: e.target.value })} maxLength={400} />
        </motion.div>
      ))}
      {value.length < 6 && (
        <button
          type="button"
          onClick={() => onChange([...value, { name: '', city: null, address: null, lat: null, lng: null, days: [], hours: null, directions: null }])}
          className="flex w-full items-center justify-center gap-2 rounded-3xl border-2 border-dashed border-line py-4 text-sm font-medium text-ink/80 transition hover:border-gold hover:text-ink"
        >
          <Plus className="h-4 w-4" /> {ar ? 'أضف مكان ثاني' : 'Add another place'}
        </button>
      )}
    </div>
  );
}

/** What helps an agent plan: cash in and out, busy days and hours, who comes back, and from where. */
export function AgentInsights() {
  const { lang } = useI18n();
  const ar = lang === 'ar';
  const [days, setDays] = useState(30);
  const data = useData<any>(`/api/exchange/insights?days=${days}`, [days]);
  const d = data.data;
  const names = DAY[ar ? 'ar' : 'en'];
  const wd = WEEK.map((k) => ({ k, n: d?.weekdays?.find((x: any) => x.d === k)?.n ?? 0 }));
  const maxWd = Math.max(1, ...wd.map((x) => x.n));
  const busiest = wd.reduce((a, b) => (b.n > a.n ? b : a), wd[0]!);
  const hrs = Array.from({ length: 15 }, (_, i) => i + 8).map((h) => ({ h, n: d?.hours?.find((x: any) => x.h === h)?.n ?? 0 }));
  const maxH = Math.max(1, ...hrs.map((x) => x.n));
  const peak = hrs.reduce((a, b) => (b.n > a.n ? b : a), hrs[0]!);
  const t = d?.totals;
  const repeatPct = t?.customers ? Math.round((t.repeat / t.customers) * 100) : 0;
  return (
    <section className="card mt-6 p-5 sm:p-6">
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <h2 className="flex items-center gap-3 text-lg">
          <span className="grid h-9 w-9 place-items-center rounded-xl bg-sky/10 text-sky">
            <BarChart3 className="h-[18px] w-[18px]" />
          </span>
          {ar ? 'شغلك بالأرقام' : 'Your work in numbers'}
        </h2>
        <div className="flex gap-1">
          {[
            [7, ar ? 'أسبوع' : 'Week'],
            [30, ar ? 'شهر' : 'Month'],
            [90, ar ? '3 شهور' : '3 months'],
            [0, ar ? 'الكل' : 'All'],
          ].map(([v, l]) => (
            <button key={v} onClick={() => setDays(Number(v))} className={cx('rounded-full px-3 py-1.5 text-sm transition', days === v ? 'bg-night text-white dark:bg-white/15' : 'text-muted hover:text-ink')}>
              {l}
            </button>
          ))}
        </div>
      </div>
      {!d ? (
        <Skeleton className="h-64" />
      ) : (
        <div className="space-y-5">
          <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
            {[
              [ArrowDownToLine, ar ? 'إيداع' : 'Cash in', money(t.in_total, lang), ar ? `${t.in_count} عملية` : `${t.in_count} operations`, 'bg-olive/12 text-olive'],
              [ArrowUpFromLine, ar ? 'سحب' : 'Cash out', money(t.out_total, lang), ar ? `${t.out_count} عملية` : `${t.out_count} operations`, 'bg-stitch/10 text-stitch'],
              [Users, ar ? 'زباين' : 'Customers', t.customers, ar ? `متوسط العملية ${money(t.avg_amount, lang)}` : `avg ${money(t.avg_amount, lang)}`, 'bg-sky/10 text-sky'],
              [Repeat, ar ? 'رجعوا مرة ثانية' : 'Came back', `${repeatPct}%`, ar ? `${t.repeat} زبون` : `${t.repeat} people`, 'bg-gold/15 text-[rgb(150_105_10)] dark:text-gold'],
            ].map(([Icon, l, v, sub, c]: any) => (
              <div key={l} className="rounded-2xl bg-bg/70 p-3.5 ring-1 ring-line">
                <span className={cx('grid h-8 w-8 place-items-center rounded-lg', c)}>
                  <Icon className="h-4 w-4" />
                </span>
                <p className="mt-2 text-xs text-muted">{l}</p>
                <p className="num font-display text-xl">{v}</p>
                <p className="text-[11px] text-muted">{sub}</p>
              </div>
            ))}
          </div>
          <div className="grid gap-5 lg:grid-cols-2">
            <div>
              <p className="mb-2 flex items-center justify-between text-sm font-semibold">
                <span className="flex items-center gap-1.5">
                  <CalendarDays className="h-4 w-4" /> {ar ? 'أيام الأسبوع' : 'Days of the week'}
                </span>
                {busiest.n > 0 && <span className="text-xs font-normal text-muted">{ar ? `أكثر يوم: ${names[busiest.k]}` : `Busiest: ${names[busiest.k]}`}</span>}
              </p>
              <div className="flex h-36 items-end gap-1.5">
                {wd.map((x) => (
                  <div key={x.k} className="flex flex-1 flex-col items-center gap-1">
                    <span className="num text-[10px] text-muted">{x.n || ''}</span>
                    <motion.span initial={{ height: 0 }} animate={{ height: `${(x.n / maxWd) * 100}%` }} className={cx('w-full min-h-[3px] rounded-t-lg', x.k === busiest.k && x.n ? 'bg-gold' : 'bg-sky/40')} />
                    <span className="text-[10px] text-muted">{names[x.k]!.slice(0, ar ? 3 : 3)}</span>
                  </div>
                ))}
              </div>
            </div>
            <div>
              <p className="mb-2 flex items-center justify-between text-sm font-semibold">
                <span className="flex items-center gap-1.5">
                  <Clock className="h-4 w-4" /> {ar ? 'ساعات اليوم' : 'Hours of the day'}
                </span>
                {peak.n > 0 && <span className="text-xs font-normal text-muted">{ar ? `أكثر وقت: ${peak.h}:00` : `Peak: ${peak.h}:00`}</span>}
              </p>
              <div className="flex h-36 items-end gap-1" dir="ltr">
                {hrs.map((x) => (
                  <div key={x.h} className="flex flex-1 flex-col items-center gap-1">
                    <motion.span initial={{ height: 0 }} animate={{ height: `${(x.n / maxH) * 100}%` }} className={cx('w-full min-h-[3px] rounded-t-md', x.h === peak.h && x.n ? 'bg-gold' : 'bg-olive/40')} />
                    <span className="num text-[9px] text-muted">{x.h}</span>
                  </div>
                ))}
              </div>
            </div>
          </div>
          <div className="grid gap-5 lg:grid-cols-2">
            <div>
              <p className="mb-2 flex items-center gap-1.5 text-sm font-semibold">
                <MapPin className="h-4 w-4" /> {ar ? 'زباينك من وين' : 'Where your customers are from'}
              </p>
              {!d.places.length ? (
                <p className="text-sm text-muted">—</p>
              ) : (
                <ul className="space-y-1.5">
                  {d.places.slice(0, 8).map((p: any) => (
                    <li key={p.place ?? '—'} className="flex items-center justify-between rounded-xl bg-bg/70 px-3 py-2 text-sm ring-1 ring-line">
                      <span>{p.place ?? (ar ? 'مش معروف' : 'Unknown')}</span>
                      <span className="num text-xs text-muted">{ar ? `${p.customers} زبون` : `${p.customers} people`}</span>
                    </li>
                  ))}
                </ul>
              )}
            </div>
            <div>
              <p className="mb-2 flex items-center gap-1.5 text-sm font-semibold">
                <Repeat className="h-4 w-4" /> {ar ? 'زباينك الدايمين' : 'Your regulars'}
              </p>
              {!d.top.length ? (
                <p className="text-sm text-muted">—</p>
              ) : (
                <ul className="space-y-1.5">
                  {d.top.slice(0, 6).map((p: any) => (
                    <li key={p.uid} className="flex items-center gap-2.5 rounded-xl bg-bg/70 px-3 py-2 text-sm ring-1 ring-line">
                      <Avatar name={p.full_name} src={p.profile_image} size={28} />
                      <span className="min-w-0 flex-1 truncate">{p.full_name}</span>
                      <span className="num text-xs text-muted">{ar ? `${p.ops} مرة · ${money(p.total, lang)}` : `${p.ops}× · ${money(p.total, lang)}`}</span>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </div>
        </div>
      )}
    </section>
  );
}
