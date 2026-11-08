import { useEffect, useRef, useState } from 'react';
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { ArrowLeft, Hand, LifeBuoy, MessageCirclePlus, PhoneCall, SendHorizontal, Star } from 'lucide-react';
import { CallRequestsSheet } from '../components/CallRequests';
import { StartMessage } from '../components/StartMessage';
import { createPortal } from 'react-dom';
import { get, post } from '../lib/api';
import { useI18n } from '../lib/i18n';
import { useData, usePolling } from '../lib/hooks';
import { useAuth } from '../lib/auth';
import { useToast } from '../components/Toast';
import { useConfirm } from '../components/Confirm';
import { relative } from '../lib/format';
import { TOPICS, topicName } from '../lib/supportTopics';
import { Avatar, Badge, Button, EmptyState, ErrorNote, PageHeader, Sheet, Skeleton, cx } from '../components/ui';

const W = {
  en: { title: 'Support', lead: 'Write to the TalerBank team. We usually answer within a working day.', hello: 'Hi! How can we help? Tell us what happened and we’ll reply here.', ph: 'Write a message', send: 'Send', team: 'TalerBank support', you: 'You', inbox: 'Support inbox', inboxLead: 'Customer messages. Unanswered ones are on top.', none: 'No messages yet.', waiting: 'waiting', back: 'Back' },
  ar: { title: 'الدعم', lead: 'اكتب لفريق TalerBank. عادةً منرد خلال يوم عمل.', hello: 'أهلين! كيف منقدر نساعدك؟ احكيلنا شو صار ومنرد عليك هون.', ph: 'اكتب رسالة', send: 'إرسال', team: 'دعم TalerBank', you: 'إنت', inbox: 'صندوق الدعم', inboxLead: 'رسائل الزبائن. اللي ما انرد عليها فوق.', none: 'ما في رسائل لسا.', waiting: 'بستنى رد', back: 'رجوع' },
};
const useW = () => {
  const { lang } = useI18n();
  return W[lang === 'ar' ? 'ar' : 'en'];
};

const wideQ = '(min-width: 1024px)';
function useWide() {
  const [wide, setWide] = useState(() => window.matchMedia(wideQ).matches);
  useEffect(() => {
    const m = window.matchMedia(wideQ);
    const on = () => setWide(m.matches);
    m.addEventListener('change', on);
    return () => m.removeEventListener('change', on);
  }, []);
  return wide;
}

/** The chat itself: on phones it fills the screen (lifted out of the animated page so `fixed` really is the screen). */
function ChatFrame({ title, subtitle, actions, banner, readOnly, avatar, backTo, messages, onSend, mine, hello }: { title: string; subtitle?: React.ReactNode; actions?: React.ReactNode; banner?: React.ReactNode; readOnly?: React.ReactNode; avatar: React.ReactNode; backTo: string; messages: any[] | null; onSend: (text: string) => Promise<void>; mine: (m: any) => boolean; hello?: string }) {
  const { lang, err } = useI18n();
  const w = useW();
  const wide = useWide();
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const end = useRef<HTMLDivElement>(null);
  useEffect(() => {
    end.current?.scrollIntoView({ block: 'end' });
  }, [messages?.length]);
  useEffect(() => {
    if (wide) return;
    document.body.style.overflow = 'hidden';
    return () => {
      document.body.style.overflow = '';
    };
  }, [wide]);
  const ui = (
    <section className={cx('flex flex-col bg-bg', wide ? 'card h-[calc(100dvh-12rem)] min-h-[440px] overflow-hidden' : 'fixed inset-0 z-[70] h-[100dvh]')}>
      <header className="safe-top flex shrink-0 items-center gap-3 border-b border-line bg-surface/95 px-2 py-2 backdrop-blur sm:px-4">
        <Link to={backTo} replace className="grid h-10 w-10 place-items-center rounded-xl text-ink hover:bg-sunk" aria-label={w.back}>
          <ArrowLeft className="h-5 w-5 flip-rtl" />
        </Link>
        {avatar}
        <div className="min-w-0 flex-1">
          <p className="truncate font-medium">{title}</p>
          {subtitle && <p className="truncate text-xs text-muted">{subtitle}</p>}
        </div>
        {actions && <div className="flex shrink-0 items-center gap-1">{actions}</div>}
      </header>
      <div className="flex-1 space-y-2 overflow-y-auto p-3 sm:p-4">
        {!messages ? (
          <Skeleton className="h-24 rounded-2xl" />
        ) : (
          <>
            {hello && (
              <div className="max-w-[85%] rounded-2xl rounded-ss-md bg-surface px-4 py-2.5 text-sm shadow-card">{hello}</div>
            )}
            {messages.map((m) => (
              <div key={m.id} className={cx('flex', mine(m) ? 'justify-end' : 'justify-start')}>
                <div className={cx('max-w-[85%] rounded-2xl px-4 py-2.5', mine(m) ? 'rounded-se-md bg-night text-white dark:bg-sky/30' : 'rounded-ss-md bg-surface shadow-card')}>
                  {!mine(m) && m.staff_name && <p className="mb-0.5 text-xs font-semibold text-gold">{m.staff_name}</p>}
                  <p className="whitespace-pre-wrap break-words text-[15px]">{m.body}</p>
                  <p className={cx('mt-1 text-[11px]', mine(m) ? 'text-white/60' : 'text-muted')}>{relative(m.created_at, lang)}</p>
                </div>
              </div>
            ))}
          </>
        )}
        <div ref={end} />
      </div>
      {error && (
        <div className="px-3">
          <ErrorNote>{error}</ErrorNote>
        </div>
      )}
      {banner && <div className="shrink-0 border-t border-line bg-surface/95 p-3">{banner}</div>}
      {readOnly ? (
        <div className="shrink-0 border-t border-line bg-surface/95 p-3 pb-[max(env(safe-area-inset-bottom),0.75rem)] text-center text-sm text-muted">{readOnly}</div>
      ) : (
      <form
        className="flex shrink-0 items-end gap-2 border-t border-line bg-surface/95 p-2.5 pb-[max(env(safe-area-inset-bottom),0.625rem)]"
        onSubmit={async (e) => {
          e.preventDefault();
          if (!text.trim() || busy) return;
          setBusy(true);
          setError(null);
          try {
            await onSend(text.trim());
            setText('');
          } catch (e2) {
            setError(err(e2));
          } finally {
            setBusy(false);
          }
        }}
      >
        <textarea
          rows={1}
          value={text}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !e.shiftKey && wide) {
              e.preventDefault();
              (e.currentTarget.form as HTMLFormElement).requestSubmit();
            }
          }}
          placeholder={w.ph}
          maxLength={2000}
          className="field max-h-32 min-h-[46px] flex-1 resize-none rounded-2xl py-2.5"
        />
        <Button aria-label={w.send} loading={busy} disabled={!text.trim()} className="h-[46px] w-[46px] !rounded-2xl !px-0">
          <SendHorizontal className="h-5 w-5 flip-rtl" />
        </Button>
      </form>
      )}
    </section>
  );
  return wide ? ui : createPortal(ui, document.body);
}

export { TOPICS, topicName } from '../lib/supportTopics';

/** Customer side: one conversation with the bank. */
export function SupportChat() {
  const w = useW();
  const { lang, err } = useI18n();
  const ar = lang === 'ar';
  const [d, setD] = useState<{ messages: any[]; thread: any } | null>(null);
  const [topic, setTopic] = useState<string | null>(null);
  const [params, setParams] = useSearchParams();
  const calls = params.get('calls') === '1';
  const setCalls = (v: boolean) => {
    const p = new URLSearchParams(params);
    if (v) p.set('calls', '1');
    else p.delete('calls');
    setParams(p, { replace: true });
  };
  const load = async () => {
    try {
      setD(await get<{ messages: any[]; thread: any }>('/api/support'));
    } catch {
      setD((x) => x ?? { messages: [], thread: null });
    }
  };
  useEffect(() => {
    void load();
  }, []);
  usePolling(load, 8000);
  const th = d?.thread;
  const fresh = !th || th.status === 'closed';
  return (
    <div>
      <div className="hidden lg:block">
        <PageHeader title={w.title} lead={w.lead} />
      </div>
      <ChatFrame
        title={w.team}
        subtitle={th && th.status === 'open' ? [topicName(th.topic, ar), th.assignedName ? (ar ? `معك ${th.assignedName}` : `With ${th.assignedName}`) : ar ? 'بستنى حدا من الفريق يستلم' : 'Waiting for the team'].filter(Boolean).join(' · ') : undefined}
        avatar={
          <span className="grid h-9 w-9 place-items-center rounded-full bg-olive/15 text-olive">
            <LifeBuoy className="h-5 w-5" />
          </span>
        }
        backTo="/app"
        actions={
          <button type="button" onClick={() => setCalls(true)} className="inline-flex h-9 items-center gap-1.5 rounded-full bg-olive/12 px-3 text-sm font-semibold text-olive hover:bg-olive/20" aria-label={ar ? 'مكالمة مع الدعم' : 'Call support'}>
            <PhoneCall className="h-4 w-4" /> <span className="hidden sm:inline">{ar ? 'مكالمة' : 'Call'}</span>
          </button>
        }
        hello={w.hello}
        messages={d?.messages ?? null}
        mine={(m) => !m.from_staff}
        banner={
          th?.ratingPending ? (
            <RateHelp onDone={load} />
          ) : fresh ? (
            <div>
              <p className="mb-2 text-xs text-muted">{ar ? 'شو موضوعك؟ (اختياري — بيوصّلك للشخص الصح أسرع)' : 'What is it about? (optional — reaches the right person faster)'}</p>
              <div className="flex flex-wrap gap-1.5">
                {TOPICS.map((x) => (
                  <button key={x.k} type="button" onClick={() => setTopic(topic === x.k ? null : x.k)} className={cx('rounded-full px-3 py-1.5 text-xs transition', topic === x.k ? 'bg-night text-white dark:bg-white/20' : 'bg-sunk hover:text-ink')}>
                    {ar ? x.ar : x.en}
                  </button>
                ))}
              </div>
            </div>
          ) : undefined
        }
        onSend={async (body) => {
          try {
            await post('/api/support', { body, ...(fresh && topic ? { topic } : {}) });
            setTopic(null);
            await load();
          } catch (e) {
            throw new Error(err(e));
          }
        }}
      />
      <CallRequestsSheet open={calls} onClose={() => setCalls(false)} />
    </div>
  );
}

function RateHelp({ onDone }: { onDone: () => void }) {
  const { lang, err } = useI18n();
  const ar = lang === 'ar';
  const [stars, setStars] = useState(0);
  const [comment, setComment] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const send = async (s: number | null) => {
    setBusy(true);
    setError(null);
    try {
      await post('/api/support/rating', { stars: s, ...(s && comment.trim() ? { comment: comment.trim() } : {}) });
      onDone();
    } catch (e) {
      setError(err(e));
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="space-y-2">
      <p className="text-sm font-semibold">{ar ? 'تسكّرت المحادثة — كيف كانت المساعدة؟' : 'Conversation closed — how was the help?'}</p>
      <div className="flex gap-1" role="radiogroup" aria-label={ar ? 'التقييم' : 'Rating'}>
        {[1, 2, 3, 4, 5].map((n) => (
          <button key={n} type="button" role="radio" aria-checked={stars === n} onClick={() => setStars(n)} className="p-1" aria-label={String(n)}>
            <Star className={cx('h-7 w-7 transition', n <= stars ? 'fill-gold text-gold' : 'text-line')} />
          </button>
        ))}
      </div>
      {stars > 0 && <input value={comment} onChange={(e) => setComment(e.target.value)} maxLength={500} placeholder={ar ? 'كلمة للفريق (اختياري)' : 'A word for the team (optional)'} className="field h-10 text-sm" />}
      {error && <ErrorNote>{error}</ErrorNote>}
      <div className="flex gap-2">
        <Button size="sm" loading={busy} disabled={!stars} onClick={() => send(stars)}>
          {ar ? 'ابعت التقييم' : 'Send rating'}
        </Button>
        <Button size="sm" variant="ghost" disabled={busy} onClick={() => send(null)}>
          {ar ? 'لا شكرًا' : 'No thanks'}
        </Button>
      </div>
      <p className="text-[11px] text-muted">{ar ? 'وإذا بدك تكمل، اكتب رسالة وبتنفتح محادثة جديدة.' : 'To carry on, write a message and a new conversation starts.'}</p>
    </div>
  );
}

/** Staff side: the queue, my conversations, and (super admin) every conversation. */
export function AdminSupport() {
  const w = useW();
  const { lang, err } = useI18n();
  const ar = lang === 'ar';
  const [view, setView] = useState<'queue' | 'mine' | 'all'>('queue');
  const [admin, setAdmin] = useState<string>('');
  const [status, setStatus] = useState<'' | 'open' | 'closed'>('');
  const [starting, setStarting] = useState(false);
  const [d, setD] = useState<{ threads: any[]; counts: any; isSuper: boolean } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const team = useData<{ admins: any[] }>(d?.isSuper ? '/api/admin/support-team' : null, [d?.isSuper]);
  const load = async () => {
    try {
      const qs = new URLSearchParams({ view, ...(admin && view === 'all' ? { admin } : {}), ...(status && view === 'all' ? { status } : {}) });
      setD(await get(`/api/admin/support?${qs}`));
      setError(null);
    } catch (e) {
      setError(err(e));
    }
  };
  useEffect(() => {
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [view, admin, status]);
  usePolling(load, 15000);
  const tabs: [typeof view, string, number | undefined][] = [
    ['queue', ar ? 'الطابور' : 'Queue', d?.counts?.queue],
    ['mine', ar ? 'محادثاتي' : 'Mine', d?.counts?.mine],
    ...(d?.isSuper ? ([['all', ar ? 'كل المحادثات' : 'Everything', undefined]] as [typeof view, string, undefined][]) : []),
  ];
  return (
    <div>
      <PageHeader
        title={w.inbox}
        lead={ar ? 'الطلب الجديد بيستنى بالطابور لحد ما حدا يستلمه — وبعدها بس هو بيرد. السوبر أدمن بيشوف كل اشي وبيحوّل. وبتقدر تبعت رسالة لأي زبون.' : 'A new request waits in the queue until someone takes it — then only they answer. The super admin sees everything and hands chats on. You can also write to any customer.'}
        actions={
          <Button icon={<MessageCirclePlus className="h-4 w-4" />} onClick={() => setStarting(true)}>
            {ar ? 'رسالة لزبون' : 'Message a customer'}
          </Button>
        }
      />
      <StartMessage open={starting} onClose={() => setStarting(false)} />
      <HandoffInbox />
      <div className={cx('mb-3 grid gap-1 rounded-2xl bg-surface p-1 ring-1 ring-line', tabs.length === 3 ? 'grid-cols-3' : 'grid-cols-2')}>
        {tabs.map(([k, l, n]) => (
          <button key={k} onClick={() => setView(k)} className={cx('flex items-center justify-center gap-1.5 rounded-xl px-2 py-2.5 text-sm transition', view === k ? 'bg-night font-semibold text-white dark:bg-white/15' : 'text-muted')}>
            {l}
            {n != null && n > 0 && <span className={cx('num rounded-full px-1.5 text-[11px]', view === k ? 'bg-white/20' : 'bg-sunk')}>{n}</span>}
          </button>
        ))}
      </div>
      {view === 'all' && (
        <div className="mb-3 space-y-2">
          <div className="-mx-4 flex gap-2 overflow-x-auto px-4 pb-1 [scrollbar-width:none] sm:mx-0 sm:flex-wrap sm:px-0">
            <button onClick={() => setAdmin('')} className={cx('shrink-0 rounded-full px-3.5 py-1.5 text-sm', !admin ? 'bg-night text-white dark:bg-white/15' : 'bg-surface ring-1 ring-line')}>
              {ar ? 'كل الفريق' : 'Whole team'}
            </button>
            {(team.data?.admins ?? []).map((a) => (
              <button key={a.id} onClick={() => setAdmin(a.id)} className={cx('flex shrink-0 items-center gap-1.5 rounded-full py-1 pe-3 ps-1 text-sm', admin === a.id ? 'bg-night text-white dark:bg-white/15' : 'bg-surface ring-1 ring-line')}>
                <Avatar name={a.full_name} size={24} /> {a.full_name}
                {a.open_now > 0 && <span className="num text-[11px] opacity-75">{a.open_now}</span>}
              </button>
            ))}
          </div>
          <div className="flex gap-2">
            {(['', 'open', 'closed'] as const).map((k) => (
              <button key={k || 'all'} onClick={() => setStatus(k)} className={cx('rounded-full px-3 py-1 text-xs', status === k ? 'bg-ink text-bg' : 'bg-sunk')}>
                {k === '' ? (ar ? 'الكل' : 'All') : k === 'open' ? (ar ? 'مفتوحة' : 'Open') : ar ? 'مسكّرة' : 'Closed'}
              </button>
            ))}
          </div>
        </div>
      )}
      {error && <ErrorNote>{error}</ErrorNote>}
      {!d ? (
        <Skeleton className="h-40 rounded-2xl" />
      ) : !d.threads.length ? (
        <EmptyState icon={<LifeBuoy className="h-6 w-6" />} title={view === 'queue' ? (ar ? 'ما في حدا بستنى' : 'Nobody is waiting') : w.none} />
      ) : (
        <ul className="card divide-y divide-line overflow-hidden">
          {d.threads.map((th) => (
            <li key={th.user_id}>
              <Link to={`/app/admin/support/${th.user_id}`} className="flex items-center gap-3 p-4 hover:bg-sunk/60">
                <Avatar name={th.full_name} />
                <span className="min-w-0 flex-1">
                  <span className="flex items-center justify-between gap-2">
                    <span className={cx('truncate', th.unread ? 'font-semibold' : 'font-medium')}>{th.full_name}</span>
                    <span className="shrink-0 text-[11px] text-muted">{th.last_at ? relative(th.last_at, lang) : ''}</span>
                  </span>
                  <span className="block truncate text-sm text-muted">{th.last_body ?? '—'}</span>
                  <span className="mt-1 flex flex-wrap gap-1">
                    {topicName(th.topic, ar) && <Badge>{topicName(th.topic, ar)}</Badge>}
                    {th.status === 'closed' ? <Badge>{ar ? 'مسكّرة' : 'Closed'}</Badge> : th.assigned_name ? <Badge tone="info">{th.assigned_name}</Badge> : <Badge tone="warn">{ar ? 'بستنى' : 'Waiting'}</Badge>}
                    {th.unread > 0 && <Badge tone="warn">{`${th.unread} · ${w.waiting}`}</Badge>}
                    {th.handoff?.status === 'pending' && <Badge tone="warn">{ar ? `انحوّلت لـ ${th.handoff.to_name}` : `Handed to ${th.handoff.to_name}`}</Badge>}
                    {th.handoff?.status === 'declined' && <Badge tone="bad">{ar ? 'طلب تحويل' : 'Move asked'}</Badge>}
                    {th.stars && <Badge tone="good">{'★'.repeat(th.stars)}</Badge>}
                  </span>
                </span>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

/** Chats the super admin handed to me: take it, or ask for it to move — saying why. */
function HandoffInbox() {
  const { lang, err } = useI18n();
  const ar = lang === 'ar';
  const nav = useNavigate();
  const [items, setItems] = useState<any[]>([]);
  const [asking, setAsking] = useState<string | null>(null);
  const [answer, setAnswer] = useState('');
  const [error, setError] = useState<string | null>(null);
  const load = async () => {
    try {
      setItems((await get<{ items: any[] }>('/api/admin/support-handoffs')).items);
    } catch {
      setItems([]);
    }
  };
  useEffect(() => {
    void load();
  }, []);
  usePolling(load, 20000);
  if (!items.length) return null;
  const act = async (x: any, action: 'accept' | 'decline') => {
    setError(null);
    try {
      await post(`/api/admin/support-handoffs/${x.id}`, action === 'accept' ? { action } : { action, answer: answer.trim() });
      setAsking(null);
      setAnswer('');
      void load();
      if (action === 'accept') nav(`/app/admin/support/${x.user_id}`);
    } catch (e) {
      setError(err(e));
    }
  };
  return (
    <section className="mb-4 space-y-2">
      <p className="flex items-center gap-2 text-sm font-semibold">
        <Hand className="h-4 w-4 text-stitch" /> {ar ? 'انحوّلتلك' : 'Handed to you'}
      </p>
      {items.map((x) => (
        <div key={x.id} className="rounded-2xl bg-stitch/[0.05] p-3.5 ring-1 ring-stitch/25">
          <p className="font-semibold">{x.customer_name}</p>
          <p className="text-xs text-muted">
            {[topicName(x.topic, ar), ar ? `من ${x.from_name ?? 'الإدارة'}` : `From ${x.from_name ?? 'the team'}`, relative(x.created_at, lang)].filter(Boolean).join(' · ')}
          </p>
          {x.reason && <p className="mt-1.5 rounded-xl bg-surface px-3 py-1.5 text-sm">«{x.reason}»</p>}
          {asking === x.id ? (
            <div className="mt-2.5 space-y-2">
              <textarea value={answer} onChange={(e) => setAnswer(e.target.value)} rows={2} maxLength={300} autoFocus placeholder={ar ? 'ليش لازم تنتقل؟ (مثلًا: عندي ظرف، مش اختصاصي…)' : 'Why should it move?'} className="field resize-none py-2.5 text-sm" />
              {error && <ErrorNote>{error}</ErrorNote>}
              <div className="flex gap-2">
                <Button size="sm" variant="secondary" onClick={() => setAsking(null)}>
                  {ar ? 'رجوع' : 'Back'}
                </Button>
                <Button size="sm" className="flex-1" disabled={answer.trim().length < 3} onClick={() => act(x, 'decline')}>
                  {ar ? 'ابعت الطلب' : 'Send'}
                </Button>
              </div>
            </div>
          ) : (
            <div className="mt-2.5 flex gap-2">
              <Button size="sm" className="flex-1" onClick={() => act(x, 'accept')}>
                {ar ? 'استلمها' : 'Take it'}
              </Button>
              <Button size="sm" variant="secondary" onClick={() => (setAsking(x.id), setAnswer(''))}>
                {ar ? 'اطلب تحويلها' : 'Ask to move it'}
              </Button>
            </div>
          )}
        </div>
      ))}
    </section>
  );
}

const awayText = (l: any, ar: boolean) => {
  if (!l) return null;
  const d = (x: string) => new Intl.DateTimeFormat(ar ? 'ar-u-nu-latn' : 'en-GB', { day: 'numeric', month: 'short' }).format(new Date(String(x).slice(0, 10)));
  const now = String(l.starts_on).slice(0, 10) <= new Date().toISOString().slice(0, 10);
  if (l.kind === 'off') return now ? (ar ? `موقوف عن الدعم لحد ${d(l.ends_on)}` : `Off support until ${d(l.ends_on)}`) : ar ? `موقوف من ${d(l.starts_on)}` : `Off from ${d(l.starts_on)}`;
  return now ? (ar ? `بإجازة لحد ${d(l.ends_on)}` : `On leave until ${d(l.ends_on)}`) : ar ? `إجازة من ${d(l.starts_on)}` : `Leave from ${d(l.starts_on)}`;
};

export function AdminSupportThread() {
  const { userId } = useParams();
  const { lang, err } = useI18n();
  const ar = lang === 'ar';
  const { user } = useAuth();
  const toast = useToast();
  const confirm = useConfirm();
  const [d, setD] = useState<any>(null);
  const [handing, setHanding] = useState(false);
  const load = async () => {
    try {
      setD(await get(`/api/admin/support/${userId}`));
    } catch (e) {
      setD((x: any) => x ?? { customer: null, messages: [], error: err(e) });
    }
  };
  useEffect(() => {
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [userId]);
  usePolling(load, 5000);
  const act = async (fn: () => Promise<unknown>, ok: string) => {
    try {
      await fn();
      toast(ok);
      void load();
    } catch (e) {
      toast(err(e), 'error');
    }
  };
  const t = d?.thread;
  const mine = !!d?.mine;
  const free = t?.status === 'open' && !t?.assigned_to;
  const closed = t?.status === 'closed';
  const btn = 'rounded-xl px-2.5 py-2 text-xs font-semibold transition hover:bg-sunk';
  return (
    <>
      <ChatFrame
        title={d?.customer ? d.customer.full_name : '…'}
        subtitle={d?.customer ? [d.customer.email, topicName(t?.topic, ar), closed ? (ar ? 'مسكّرة' : 'Closed') : t?.assigned_name ? (ar ? `مع ${t.assigned_name}` : `With ${t.assigned_name}`) : ar ? 'بالطابور' : 'In the queue'].filter(Boolean).join(' · ') : undefined}
        avatar={<Avatar name={d?.customer?.full_name} size={36} />}
        backTo="/app/admin/support"
        messages={d?.messages ?? null}
        mine={(m) => m.from_staff}
        actions={
          d?.customer && (
            <>
              {free && (
                <button className={cx(btn, 'bg-night text-white dark:bg-white/15')} onClick={() => act(() => post(`/api/admin/support/${userId}/claim`), ar ? 'صارت معك' : 'It’s yours')}>
                  {ar ? 'استلمها' : 'Take it'}
                </button>
              )}
              {mine && !closed && (
                <button className={btn} onClick={() => act(() => post(`/api/admin/support/${userId}/release`), ar ? 'رجعت للطابور' : 'Back in the queue')}>
                  {ar ? 'رجّعها' : 'Release'}
                </button>
              )}
              {(mine || d.isSuper) && !closed && (
                <button
                  className={btn}
                  onClick={async () => {
                    if (!(await confirm({ title: ar ? 'تسكّر المحادثة؟' : 'Close the conversation?', body: ar ? 'الزبون بيوصله طلب يقيّم المساعدة.' : 'The customer is asked to rate the help.', confirmLabel: ar ? 'سكّر' : 'Close' }))) return;
                    void act(() => post(`/api/admin/support/${userId}/close`), ar ? 'تسكّرت' : 'Closed');
                  }}
                >
                  {ar ? 'سكّر' : 'Close'}
                </button>
              )}
              {d.isSuper && (
                <button className={cx(btn, 'text-sky')} onClick={() => setHanding(true)}>
                  {ar ? 'حوّل' : 'Hand on'}
                </button>
              )}
            </>
          )
        }
        banner={
          d?.handoff && d.handoff.status !== 'replaced' && d.handoff.status !== 'accepted' ? (
            <p className={cx('rounded-xl px-3 py-2 text-xs', d.handoff.status === 'declined' ? 'bg-stitch/10 text-stitch' : 'bg-gold/15')}>
              {d.handoff.status === 'pending'
                ? ar
                  ? `انحوّلت لـ ${d.handoff.to_name}${d.handoff.reason ? ` — «${d.handoff.reason}»` : ''}`
                  : `Handed to ${d.handoff.to_name}${d.handoff.reason ? ` — “${d.handoff.reason}”` : ''}`
                : ar
                  ? `${d.handoff.to_name} طلب تحويلها: «${d.handoff.answer ?? ''}»`
                  : `${d.handoff.to_name} asked to move it: “${d.handoff.answer ?? ''}”`}
            </p>
          ) : undefined
        }
        readOnly={
          !d?.customer
            ? d?.error
            : closed
              ? ar
                ? 'المحادثة مسكّرة. إذا الزبون كتب، بترجع تنفتح.'
                : 'Closed. If the customer writes, it opens again.'
              : !mine && !free
                ? ar
                  ? `${t?.assigned_name ?? 'حدا ثاني'} ماسكها — إنت بتقرأ بس${d.isSuper ? '. لتكتب، حوّلها لنفسك.' : '.'}`
                  : `${t?.assigned_name ?? 'Someone else'} has it — you are only reading${d.isSuper ? '. To write, hand it to yourself.' : '.'}`
                : undefined
        }
        onSend={async (body) => {
          await post(`/api/admin/support/${userId}`, { body });
          await load();
        }}
      />
      {d?.isSuper && <HandSheet open={handing} onClose={() => setHanding(false)} userId={userId!} me={user?.id} current={t} onDone={() => (setHanding(false), void load())} />}
    </>
  );
}

function HandSheet({ open, onClose, userId, me, current, onDone }: { open: boolean; onClose: () => void; userId: string; me?: string; current: any; onDone: () => void }) {
  const { lang, err } = useI18n();
  const ar = lang === 'ar';
  const toast = useToast();
  const team = useData<{ admins: any[] }>(open ? '/api/admin/support-team' : null, [open]);
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState<string | null>(null);
  const hand = async (a: any) => {
    setBusy(a.id);
    try {
      const r = await post<{ reopened: boolean }>(`/api/admin/support/${userId}/hand`, { to: a.id, ...(reason.trim() ? { reason: reason.trim() } : {}) });
      toast(String(a.id) === String(me) ? (ar ? 'صارت معك — اكتب ردك' : 'It’s yours — write your reply') : ar ? `انحوّلت لـ ${a.full_name}${r.reopened ? ' وانفتحت' : ''}` : `Handed to ${a.full_name}`);
      setReason('');
      onDone();
    } catch (e) {
      toast(err(e), 'error');
    } finally {
      setBusy(null);
    }
  };
  const list = (team.data?.admins ?? []).filter((a) => a.admin_level === 'super_admin' || (a.admin_permissions ?? []).includes('support'));
  return (
    <Sheet open={open} onClose={onClose} title={ar ? 'حوّل المحادثة' : 'Hand on the conversation'}>
      <div className="space-y-3">
        {current?.status === 'closed' && <p className="rounded-xl bg-sunk/60 px-3 py-2 text-xs text-muted">{ar ? 'المحادثة مسكّرة — بترجع تنفتح لما تحوّلها.' : 'It’s closed — handing it on opens it again.'}</p>}
        <input value={reason} onChange={(e) => setReason(e.target.value)} maxLength={300} placeholder={ar ? 'ليش؟ (بيوصل معها — اختياري)' : 'Why? (sent with it — optional)'} className="field" />
        {!team.data ? (
          <Skeleton className="h-32" />
        ) : (
          <ul className="space-y-1.5">
            {list.map((a) => {
              const away = awayText(a.leave, ar);
              const self = String(a.id) === String(me);
              return (
                <li key={a.id}>
                  <button disabled={!!busy || (String(a.id) === String(current?.assigned_to) && current?.status === 'open')} onClick={() => hand(a)} className={cx('flex w-full items-center gap-3 rounded-2xl p-2.5 text-start ring-1 transition hover:bg-sunk/60 disabled:opacity-50', away ? 'ring-gold/50' : 'ring-line')}>
                    <Avatar name={a.full_name} size={36} />
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-sm font-semibold">{self ? (ar ? `${a.full_name} (إنت)` : `${a.full_name} (you)`) : a.full_name}</span>
                      <span className={cx('block truncate text-xs', away ? 'text-[rgb(150_105_10)] dark:text-gold' : 'text-muted')}>
                        {away ?? (ar ? `${a.open_now} مفتوحة معه` : `${a.open_now} open`)}
                      </span>
                    </span>
                    {busy === a.id && <span className="h-4 w-4 animate-spin rounded-full border-2 border-current border-t-transparent" />}
                  </button>
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </Sheet>
  );
}
