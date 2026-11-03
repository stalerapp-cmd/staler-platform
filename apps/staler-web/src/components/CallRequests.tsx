import { useMemo, useState } from 'react';
import { CalendarClock, CheckCircle2, Clock, Phone, PhoneCall, Video, XCircle } from 'lucide-react';
import { patch, post } from '../lib/api';
import { useI18n } from '../lib/i18n';
import { useData } from '../lib/hooks';
import { relative } from '../lib/format';
import { callEngine } from '../lib/callEngine';
import { useToast } from './Toast';
import { TOPICS } from './SupportDesk';
import { Badge, Button, ErrorNote, Sheet, cx } from './ui';

export const fmtSlot = (iso: string, lang: string) =>
  new Intl.DateTimeFormat(lang === 'ar' ? 'ar-u-nu-latn' : 'en-GB', { weekday: 'long', day: 'numeric', month: 'long', hour: '2-digit', minute: '2-digit', timeZone: 'Asia/Hebron' }).format(new Date(iso));
const dayKey = (iso: string) => new Date(iso).toLocaleDateString('en-CA', { timeZone: 'Asia/Hebron' });

/** Pick a free time, grouped by day. */
export function SlotPicker({ slots, value, onPick }: { slots: string[]; value: string | null; onPick: (iso: string) => void }) {
  const { lang } = useI18n();
  const days = useMemo(() => {
    const m = new Map<string, string[]>();
    for (const s of slots) m.set(dayKey(s), [...(m.get(dayKey(s)) ?? []), s]);
    return [...m.entries()];
  }, [slots]);
  const [day, setDay] = useState<string | null>(null);
  const cur = days.find(([d]) => d === (day ?? days[0]?.[0]));
  if (!days.length) return <p className="text-sm text-muted">{lang === 'ar' ? 'ما في مواعيد فاضية هالأسبوعين.' : 'No free times in the next two weeks.'}</p>;
  return (
    <div>
      <div className="-mx-1 flex gap-1.5 overflow-x-auto px-1 pb-1 [scrollbar-width:none]">
        {days.map(([d, list]) => {
          const on = cur?.[0] === d;
          const dt = new Date(list[0]!);
          return (
            <button key={d} type="button" onClick={() => setDay(d)} className={cx('flex shrink-0 flex-col items-center rounded-2xl px-3 py-2 text-xs transition', on ? 'bg-night text-white dark:bg-white/20' : 'bg-sunk')}>
              <span>{new Intl.DateTimeFormat(lang === 'ar' ? 'ar' : 'en-GB', { weekday: 'short', timeZone: 'Asia/Hebron' }).format(dt)}</span>
              <span className="num text-base font-semibold">{new Intl.DateTimeFormat('en-GB', { day: 'numeric', timeZone: 'Asia/Hebron' }).format(dt)}</span>
            </button>
          );
        })}
      </div>
      <div className="mt-2 grid grid-cols-4 gap-1.5 sm:grid-cols-6">
        {cur?.[1].map((s) => (
          <button key={s} type="button" onClick={() => onPick(s)} className={cx('num rounded-xl py-2 text-sm transition', value === s ? 'bg-olive text-white' : 'bg-surface ring-1 ring-line hover:ring-ink/30')}>
            {new Intl.DateTimeFormat('en-GB', { hour: '2-digit', minute: '2-digit', timeZone: 'Asia/Hebron' }).format(new Date(s))}
          </button>
        ))}
      </div>
    </div>
  );
}

/** The customer's support calls: ask for one, book a time, call when it's open, or cancel. */
export function CallRequestsSheet({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { lang, err } = useI18n();
  const ar = lang === 'ar';
  const toast = useToast();
  const data = useData<{ requests: any[] }>(open ? '/api/calls/requests?scope=mine' : null, [open]);
  const hours = useData<{ slots: string[]; hours: any }>(open ? '/api/calls/hours' : null, [open]);
  const [desc, setDesc] = useState('');
  const [topic, setTopic] = useState<string | null>(null);
  const [pick, setPick] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const reqs = data.data?.requests ?? [];
  const live = reqs.filter((r) => ['requested', 'accepted', 'scheduled', 'missed'].includes(r.status));
  const act = async (fn: () => Promise<unknown>, ok?: string) => {
    setBusy(true);
    setError(null);
    try {
      await fn();
      if (ok) toast(ok);
      await data.reload();
      await hours.reload();
    } catch (e) {
      setError(err(e));
    } finally {
      setBusy(false);
    }
  };
  const ST: Record<string, [string, 'neutral' | 'good' | 'warn' | 'bad' | 'info']> = {
    requested: [ar ? 'بستنى الفريق' : 'Waiting for the team', 'warn'],
    accepted: [ar ? 'اختار موعد' : 'Pick a time', 'info'],
    scheduled: [ar ? 'محجوز' : 'Booked', 'good'],
    missed: [ar ? 'فاتت — اختار موعد ثاني' : 'Missed — pick another', 'bad'],
    declined: [ar ? 'ما انقبل' : 'Declined', 'neutral'],
    cancelled: [ar ? 'انلغى' : 'Cancelled', 'neutral'],
    done: [ar ? 'خلص' : 'Done', 'good'],
  };
  return (
    <Sheet open={open} onClose={onClose} title={ar ? 'مكالمة مع الدعم' : 'Call support'}>
      <div className="space-y-5">
        {live.map((r) => (
          <div key={r.id} className="rounded-3xl bg-bg/70 p-4 ring-1 ring-line">
            <div className="flex items-start justify-between gap-2">
              <p className="line-clamp-2 text-sm">{r.description}</p>
              <Badge tone={ST[r.status]![1]}>{ST[r.status]![0]}</Badge>
            </div>
            <p className="mt-1 text-[11px] text-muted">
              {r.initiated_by === 'admin' ? (ar ? 'الدعم طلب المكالمة' : 'Support asked for this call') : relative(r.created_at, lang)}
              {r.admin_name ? ` · ${ar ? 'مع' : 'with'} ${r.admin_name}` : ''}
            </p>
            {r.status === 'scheduled' && r.slot_at && (
              <p className="mt-2 flex items-center gap-2 rounded-2xl bg-olive/[0.08] px-3 py-2 text-sm font-medium">
                <CalendarClock className="h-4 w-4 text-olive" /> {fmtSlot(r.slot_at, lang)}
              </p>
            )}
            {['accepted', 'missed', 'scheduled'].includes(r.status) && (
              <details className="mt-3" open={r.status !== 'scheduled'}>
                <summary className="cursor-pointer text-sm font-semibold text-sky">{r.status === 'scheduled' ? (ar ? 'غيّر الموعد' : 'Change the time') : ar ? 'اختار وقت بناسبك' : 'Pick a time'}</summary>
                <div className="mt-2">
                  <SlotPicker slots={hours.data?.slots ?? []} value={pick[r.id] ?? null} onPick={(s) => setPick({ ...pick, [r.id]: s })} />
                  <Button size="sm" className="mt-2" disabled={!pick[r.id]} loading={busy} onClick={() => act(() => post(`/api/calls/requests/${r.id}/slot`, { at: pick[r.id] }), ar ? 'انحجز الموعد' : 'Booked')}>
                    {ar ? 'احجز الموعد' : 'Book it'}
                  </Button>
                </div>
              </details>
            )}
            <div className="mt-3 flex flex-wrap gap-2">
              {r.button_visible && ['accepted', 'scheduled', 'missed'].includes(r.status) && (
                <>
                  <Button size="sm" icon={<Phone className="h-4 w-4" />} onClick={() => void callEngine.start(r.id, false).catch((e) => toast(err(e), 'error'))}>
                    {ar ? 'اتصل' : 'Call'}
                  </Button>
                  <Button size="sm" variant="secondary" icon={<Video className="h-4 w-4" />} onClick={() => void callEngine.start(r.id, true).catch((e) => toast(err(e), 'error'))}>
                    {ar ? 'بالفيديو' : 'Video'}
                  </Button>
                </>
              )}
              <button type="button" onClick={() => act(() => patch(`/api/calls/requests/${r.id}`, { status: 'cancelled' }), ar ? 'انلغت' : 'Cancelled')} className="inline-flex items-center gap-1 rounded-full px-3 py-1.5 text-xs text-muted hover:bg-stitch/10 hover:text-stitch">
                <XCircle className="h-3.5 w-3.5" /> {ar ? 'انحلّت؟ الغِ المكالمة' : 'Sorted? Cancel the call'}
              </button>
            </div>
          </div>
        ))}

        {live.length < 2 && (
          <div className="space-y-3">
            <p className="flex items-center gap-2 font-semibold">
              <PhoneCall className="h-5 w-5 text-olive" /> {ar ? 'اطلب مكالمة' : 'Ask for a call'}
            </p>
            <div className="flex flex-wrap gap-1.5">
              {TOPICS.map((x) => (
                <button key={x.k} type="button" onClick={() => setTopic(topic === x.k ? null : x.k)} className={cx('inline-flex items-center gap-1.5 rounded-full px-3 py-1.5 text-xs transition', topic === x.k ? 'bg-night text-white dark:bg-white/20' : 'bg-sunk')}>
                  <x.icon className="h-3.5 w-3.5" /> {ar ? x.ar : x.en}
                </button>
              ))}
            </div>
            <textarea value={desc} onChange={(e) => setDesc(e.target.value)} rows={4} maxLength={1000} placeholder={ar ? 'احكيلنا شو المشكلة بالتفصيل — بنرد عليك بالرسائل، وإذا لازم مكالمة بتختار وقتها.' : 'Describe the problem — we reply by message, and if a call is needed you pick its time.'} className="field resize-none py-3 text-sm" />
            {hours.data?.hours && (
              <p className="flex items-center gap-1.5 text-xs text-muted">
                <Clock className="h-3.5 w-3.5" /> {ar ? `ساعات المكالمات: ${hours.data.hours.from}–${hours.data.hours.to}` : `Call hours: ${hours.data.hours.from}–${hours.data.hours.to}`}
              </p>
            )}
            <ErrorNote>{error}</ErrorNote>
            <Button
              block
              loading={busy}
              disabled={desc.trim().length < 10}
              icon={<CheckCircle2 className="h-4 w-4" />}
              onClick={() =>
                act(async () => {
                  await post('/api/calls/requests', { description: desc.trim(), ...(topic ? { topic } : {}) });
                  setDesc('');
                }, ar ? 'وصل طلبك للفريق' : 'Sent to the team')
              }
            >
              {ar ? 'ابعت الطلب' : 'Send request'}
            </Button>
          </div>
        )}

        {reqs.filter((r) => !live.includes(r)).length > 0 && (
          <div>
            <p className="mb-1.5 text-xs font-medium text-muted">{ar ? 'قبل' : 'Earlier'}</p>
            <ul className="divide-y divide-line text-sm">
              {reqs
                .filter((r) => !live.includes(r))
                .map((r) => (
                  <li key={r.id} className="flex items-center justify-between gap-2 py-2">
                    <span className="line-clamp-1 text-muted">{r.description}</span>
                    <Badge tone={ST[r.status]![1]}>{ST[r.status]![0]}</Badge>
                  </li>
                ))}
            </ul>
          </div>
        )}
      </div>
    </Sheet>
  );
}
