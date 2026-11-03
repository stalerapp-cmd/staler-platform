import { useEffect, useState } from 'react';
import { motion } from 'framer-motion';
import { CalendarClock, Check, Clock, Eye, EyeOff, Phone, PhoneCall, Search, Video, X } from 'lucide-react';
import { get, patch, post, put } from '../lib/api';
import { useI18n } from '../lib/i18n';
import { useData } from '../lib/hooks';
import { relative } from '../lib/format';
import { callEngine } from '../lib/callEngine';
import { useToast } from '../components/Toast';
import { fmtSlot } from '../components/CallRequests';
import { topicOf } from '../components/SupportDesk';
import { DAY, WEEK } from '../components/AgentPlaces';
import { Avatar, Badge, Button, EmptyState, PageHeader, Skeleton, cx } from '../components/ui';

type Tab = 'queue' | 'scheduled' | 'closed' | 'ask' | 'hours';

/** Support calls: requests to accept, booked calls to make, the team's hours, and asking someone for a call. */
export function AdminCalls() {
  const { lang, err } = useI18n();
  const ar = lang === 'ar';
  const toast = useToast();
  const [tab, setTab] = useState<Tab>('queue');
  const list = useData<{ requests: any[] }>(['queue', 'scheduled', 'closed'].includes(tab) ? `/api/calls/requests?scope=${tab}` : null, [tab]);
  const act = async (fn: () => Promise<unknown>, ok?: string) => {
    try {
      await fn();
      if (ok) toast(ok);
      void list.reload();
    } catch (e) {
      toast(err(e), 'error');
    }
  };
  const TABS: [Tab, string][] = [
    ['queue', ar ? 'طلبات جديدة' : 'New requests'],
    ['scheduled', ar ? 'مواعيد' : 'Booked'],
    ['closed', ar ? 'منتهية' : 'Closed'],
    ['ask', ar ? 'اطلب مكالمة' : 'Ask for a call'],
    ['hours', ar ? 'ساعات التوفر' : 'Hours'],
  ];
  return (
    <div>
      <PageHeader title={ar ? 'مكالمات الدعم' : 'Support calls'} lead={ar ? 'الزبون بيطلب مكالمة ويكتب المشكلة؛ بتقبل أو بترفض، وهو بيختار وقت ضمن ساعاتكم. بالوقت إنتو بتتصلوا — أو بتظهرله زر «اتصل» وبتخفيه وقت ما بدكم.' : 'Customers ask for a call and describe the problem; you accept or decline, and they book a time within your hours. Then you call — or show them a “Call” button you can hide again.'} />
      <div className="-mx-4 mb-5 flex gap-1.5 overflow-x-auto px-4 [scrollbar-width:none] sm:mx-0 sm:px-0" role="tablist">
        {TABS.map(([k, l]) => (
          <button key={k} role="tab" aria-selected={tab === k} onClick={() => setTab(k)} className={cx('relative shrink-0 rounded-full px-4 py-2 text-sm transition', tab === k ? 'text-white' : 'bg-surface text-muted ring-1 ring-line hover:text-ink')}>
            {tab === k && <motion.span layoutId="calls-tab" className="absolute inset-0 rounded-full bg-night dark:bg-white/15" />}
            <span className="relative">{l}</span>
          </button>
        ))}
      </div>

      {tab === 'hours' ? (
        <Hours />
      ) : tab === 'ask' ? (
        <AskCall onSent={() => setTab('scheduled')} />
      ) : !list.data ? (
        <Skeleton className="h-64 rounded-3xl" />
      ) : !list.data.requests.length ? (
        <EmptyState icon={<PhoneCall className="h-6 w-6" />} title={ar ? 'ما في إشي هون' : 'Nothing here'} />
      ) : (
        <ul className="space-y-3">
          {list.data.requests.map((r) => {
            const T = topicOf(r.topic);
            return (
              <li key={r.id} className="card p-4 sm:p-5">
                <div className="flex items-start gap-3">
                  <Avatar name={r.user_name} src={r.user_image} size={44} />
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-1.5">
                      <span className="font-semibold">{r.user_name}</span>
                      {T && <span className={cx('rounded-full px-2 py-0.5 text-[11px]', T.c)}>{ar ? T.ar : T.en}</span>}
                      {r.initiated_by === 'admin' && <Badge tone="info">{ar ? 'إحنا طلبناها' : 'We asked'}</Badge>}
                      {r.cancel_requested && <Badge tone="warn">{ar ? 'الزبون لغاها' : 'Customer cancelled'}</Badge>}
                    </div>
                    <p className="mt-1 whitespace-pre-line text-sm">{r.description}</p>
                    <p className="mt-1 text-[11px] text-muted">
                      {relative(r.created_at, lang)}
                      {r.admin_name ? ` · ${ar ? 'مع' : 'with'} ${r.admin_name}` : ''}
                    </p>
                    {r.slot_at && (
                      <p className={cx('mt-2 inline-flex items-center gap-2 rounded-2xl px-3 py-1.5 text-sm font-medium', r.status === 'missed' ? 'bg-stitch/10 text-stitch' : 'bg-olive/[0.08]')}>
                        <CalendarClock className="h-4 w-4" /> {fmtSlot(r.slot_at, lang)} {r.status === 'missed' && (ar ? '· ما رد' : '· missed')}
                      </p>
                    )}
                    {r.status === 'accepted' && !r.slot_at && <p className="mt-2 text-xs text-muted">{ar ? 'بستنى الزبون يختار وقت.' : 'Waiting for the customer to pick a time.'}</p>}
                  </div>
                </div>
                <div className="mt-3 flex flex-wrap gap-2">
                  {r.status === 'requested' && (
                    <>
                      <Button size="sm" icon={<Check className="h-4 w-4" />} onClick={() => act(() => post(`/api/calls/requests/${r.id}/answer`, { accept: true }), ar ? 'انقبل — الزبون بيختار وقت' : 'Accepted')}>
                        {ar ? 'اقبل' : 'Accept'}
                      </Button>
                      <Button size="sm" variant="secondary" icon={<X className="h-4 w-4" />} onClick={() => act(() => post(`/api/calls/requests/${r.id}/answer`, { accept: false }), ar ? 'انرفض' : 'Declined')}>
                        {ar ? 'ارفض' : 'Decline'}
                      </Button>
                    </>
                  )}
                  {['accepted', 'scheduled', 'missed'].includes(r.status) && (
                    <>
                      <Button size="sm" icon={<Phone className="h-4 w-4" />} onClick={() => void callEngine.start(r.id, false).catch((e) => toast(err(e), 'error'))}>
                        {ar ? 'اتصل' : 'Call'}
                      </Button>
                      <Button size="sm" variant="secondary" icon={<Video className="h-4 w-4" />} onClick={() => void callEngine.start(r.id, true).catch((e) => toast(err(e), 'error'))}>
                        {ar ? 'فيديو' : 'Video'}
                      </Button>
                      <Button
                        size="sm"
                        variant="secondary"
                        icon={r.button_visible ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                        onClick={() => act(() => patch(`/api/calls/requests/${r.id}`, { buttonVisible: !r.button_visible }), r.button_visible ? (ar ? 'انخفى الزر' : 'Hidden') : ar ? 'صار يقدر يتصل' : 'They can call now')}
                      >
                        {r.button_visible ? (ar ? 'اخفي زر الاتصال' : 'Hide call button') : ar ? 'خليه يقدر يتصل' : 'Let them call'}
                      </Button>
                      <Button size="sm" variant="secondary" icon={<Check className="h-4 w-4" />} onClick={() => act(() => patch(`/api/calls/requests/${r.id}`, { status: 'done' }), ar ? 'خلصت' : 'Done')}>
                        {ar ? 'خلصت' : 'Done'}
                      </Button>
                    </>
                  )}
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}

function Hours() {
  const { lang, err } = useI18n();
  const ar = lang === 'ar';
  const toast = useToast();
  const data = useData<{ hours: { days: number[]; from: string; to: string; slot: number } }>('/api/calls/hours');
  const [h, setH] = useState<any>(null);
  useEffect(() => {
    if (data.data && !h) setH(data.data.hours);
  }, [data.data, h]);
  if (!h) return <Skeleton className="h-40 rounded-3xl" />;
  return (
    <section className="card space-y-4 p-5 sm:p-6">
      <p className="flex items-center gap-2 font-semibold">
        <Clock className="h-5 w-5 text-sky" /> {ar ? 'إمتى بتقدروا تحكوا مع الناس؟' : 'When can the team take calls?'}
      </p>
      <div className="flex flex-wrap gap-1.5">
        {WEEK.map((d) => {
          const on = h.days.includes(d);
          return (
            <button key={d} type="button" onClick={() => setH({ ...h, days: on ? h.days.filter((x: number) => x !== d) : [...h.days, d] })} className={cx('rounded-full px-3.5 py-1.5 text-sm', on ? 'bg-night text-white dark:bg-white/20' : 'bg-sunk')}>
              {DAY[ar ? 'ar' : 'en'][d]}
            </button>
          );
        })}
      </div>
      <div className="grid grid-cols-3 gap-3">
        <label className="text-sm">
          <span className="mb-1 block text-xs text-muted">{ar ? 'من' : 'From'}</span>
          <input type="time" value={h.from} onChange={(e) => setH({ ...h, from: e.target.value })} className="field" />
        </label>
        <label className="text-sm">
          <span className="mb-1 block text-xs text-muted">{ar ? 'لـ' : 'To'}</span>
          <input type="time" value={h.to} onChange={(e) => setH({ ...h, to: e.target.value })} className="field" />
        </label>
        <label className="text-sm">
          <span className="mb-1 block text-xs text-muted">{ar ? 'مدة الموعد (دقيقة)' : 'Slot (minutes)'}</span>
          <input type="number" min={10} max={120} value={h.slot} onChange={(e) => setH({ ...h, slot: Number(e.target.value) })} className="field" />
        </label>
      </div>
      <Button
        onClick={async () => {
          try {
            await put('/api/calls/hours', h);
            toast(ar ? 'انحفظت الساعات' : 'Hours saved');
          } catch (e) {
            toast(err(e), 'error');
          }
        }}
      >
        {ar ? 'احفظ' : 'Save'}
      </Button>
    </section>
  );
}

function AskCall({ onSent }: { onSent: () => void }) {
  const { lang, err } = useI18n();
  const ar = lang === 'ar';
  const toast = useToast();
  const [q, setQ] = useState('');
  const [found, setFound] = useState<any[]>([]);
  const [who, setWho] = useState<any>(null);
  const [desc, setDesc] = useState('');
  useEffect(() => {
    if (q.trim().length < 2) return setFound([]);
    const h = setTimeout(() => {
      get<{ users: any[] }>(`/api/admin/users?q=${encodeURIComponent(q.trim())}&limit=8`)
        .then((r) => setFound(r.users ?? []))
        .catch(() => setFound([]));
    }, 220);
    return () => clearTimeout(h);
  }, [q]);
  return (
    <section className="card space-y-4 p-5 sm:p-6">
      <p className="text-sm text-muted">{ar ? 'صار خلل عند حدا أو تاجر؟ اطلب منه مكالمة — بيوصله الطلب وبيختار وقت ضمن ساعاتكم.' : 'Something wrong for someone or a store? Ask them for a call — they pick a time within your hours.'}</p>
      {who ? (
        <div className="flex items-center gap-3 rounded-2xl bg-sky/[0.07] p-3">
          <Avatar name={who.full_name} src={who.profile_image} size={38} />
          <span className="min-w-0 flex-1 truncate font-semibold">{who.full_name}</span>
          <button onClick={() => setWho(null)} className="grid h-8 w-8 place-items-center rounded-full hover:bg-sunk" aria-label="✕">
            <X className="h-4 w-4" />
          </button>
        </div>
      ) : (
        <div>
          <label className="relative block">
            <Search className="pointer-events-none absolute start-4 top-1/2 h-5 w-5 -translate-y-1/2 text-muted" />
            <input value={q} onChange={(e) => setQ(e.target.value)} placeholder={ar ? 'دوّر بالاسم أو الإيميل' : 'Search name or e-mail'} className="field h-12 rounded-2xl ps-12" type="search" />
          </label>
          {found.length > 0 && (
            <ul className="mt-2 overflow-hidden rounded-2xl ring-1 ring-line">
              {found.map((u) => (
                <li key={u.id}>
                  <button onClick={() => setWho(u)} className="flex w-full items-center gap-3 px-3.5 py-2.5 text-start hover:bg-sunk/60">
                    <Avatar name={u.full_name} src={u.profile_image} size={32} />
                    <span className="min-w-0 flex-1 truncate text-sm">{u.full_name}</span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
      <textarea value={desc} onChange={(e) => setDesc(e.target.value)} rows={3} maxLength={1000} placeholder={ar ? 'ليش بدكم تحكوا معه (بيوصله)' : 'Why you want to talk (they see it)'} className="field resize-none py-3 text-sm" />
      <Button
        disabled={!who || desc.trim().length < 10}
        icon={<PhoneCall className="h-4 w-4" />}
        onClick={async () => {
          try {
            await post('/api/calls/requests', { userId: who.id, description: desc.trim() });
            toast(ar ? 'انبعت الطلب' : 'Request sent');
            setWho(null);
            setDesc('');
            onSent();
          } catch (e) {
            toast(err(e), 'error');
          }
        }}
      >
        {ar ? 'ابعت طلب مكالمة' : 'Send call request'}
      </Button>
    </section>
  );
}
