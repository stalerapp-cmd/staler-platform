import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { motion } from 'framer-motion';
import { BellRing, CalendarClock, CircleCheck, Clock3, DoorClosed, Hourglass, MapPinned, Megaphone, Send, ShieldCheck, Users, XCircle, type LucideIcon } from 'lucide-react';
import { post } from '../lib/api';
import { useI18n } from '../lib/i18n';
import { useData } from '../lib/hooks';
import { fill, relative } from '../lib/format';
import { useToast } from './Toast';
import { useConfirm } from './Confirm';
import { placeLabel } from './PlacePicker';
import { Button, ErrorNote, Field, TextArea, cx } from './ui';

type Kind = 'moved' | 'hours' | 'closed' | 'news';

const W = {
  ar: {
    title: 'تحديثات لزباينك',
    lead: 'غيّرت مكانك أو دوامك؟ عندك عرض؟ خبّر الناس اللي تعاملوا معك — أو اطلب من الإدارة تعمّمه على منطقتك.',
    kinds: { moved: 'نقلت مكاني', hours: 'تغيّر الدوام', closed: 'مسكّر مؤقتًا', news: 'خبر أو عرض' } as Record<Kind, string>,
    starters: {
      moved: ['نقلنا مكاننا', 'صرنا بمكان جديد: '],
      hours: ['دوامنا تغيّر', 'من اليوم دوامنا: '],
      closed: ['مسكّرين مؤقتًا', 'رح نكون مسكّرين من … لحد … ونرجع إن شاء الله.'],
      news: ['', ''],
    } as Record<Kind, [string, string]>,
    to: 'لمين؟',
    customers: 'اللي تعاملوا معي',
    customersD: 'بيوصلهم فورًا',
    area: 'كل منطقتي',
    areaD: 'بعد موافقة الإدارة',
    areaOf: 'المنطقة: {place}',
    noArea: 'حط مدينتك بملف الوكيل لتقدر تعمّم على منطقتك.',
    reach: 'رح يوصل لـ {n} شخص',
    reachNone: 'لسا ما حدا تعامل معك',
    tTitle: 'العنوان',
    tBody: 'التفاصيل',
    movedHint: 'لا تنسى تحدّث مكانك على الخريطة وصور المحل من ملف الوكيل.',
    openProfile: 'افتح ملف الوكيل',
    send: 'ابعت التحديث',
    ask: 'ابعت الطلب للإدارة',
    confirmT: 'تبعت التحديث؟',
    confirmB: 'رح يوصل لـ {n} شخص فورًا.',
    sent: 'انبعت لـ {n} شخص',
    asked: 'انبعت طلبك للإدارة — رح يوصلك إشعار لما يردّوا.',
    limit: 'لحد 3 تحديثات باليوم. التحديث بيبين كمان على كرتك بالخريطة لمدة أسبوعين.',
    history: 'اللي بعتّه',
    none: 'لسا ما بعتت إشي.',
    st: { sent: 'انبعت', pending: 'بستنى الإدارة', rejected: 'ما انقبل' } as Record<string, string>,
    reached: 'وصل لـ {n}',
    toCustomers: 'لزباينك',
    toArea: 'لمنطقتك',
  },
  en: {
    title: 'Updates for your customers',
    lead: 'Moved or changed your hours? Have an offer? Tell the people who dealt with you — or ask the admins to announce it to your whole area.',
    kinds: { moved: 'I moved', hours: 'New hours', closed: 'Closed for now', news: 'News or offer' } as Record<Kind, string>,
    starters: {
      moved: ['We moved', 'Our new place: '],
      hours: ['New opening hours', 'From today we open: '],
      closed: ['Closed for a while', 'We are closed from … to … and will be back soon.'],
      news: ['', ''],
    } as Record<Kind, [string, string]>,
    to: 'Who for?',
    customers: 'People I served',
    customersD: 'Reaches them right away',
    area: 'My whole area',
    areaD: 'After the admins approve',
    areaOf: 'Area: {place}',
    noArea: 'Add your city to your agent profile to announce to your area.',
    reach: 'It will reach {n} people',
    reachNone: 'Nobody has dealt with you yet',
    tTitle: 'Title',
    tBody: 'Details',
    movedHint: 'Don’t forget to move your pin and update the shop photos in your agent profile.',
    openProfile: 'Open agent profile',
    send: 'Send update',
    ask: 'Send request to the admins',
    confirmT: 'Send this update?',
    confirmB: 'It reaches {n} people right away.',
    sent: 'Sent to {n} people',
    asked: 'Your request went to the admins — you’ll be notified when they answer.',
    limit: 'Up to 3 updates a day. An update also shows on your map card for two weeks.',
    history: 'What you sent',
    none: 'Nothing sent yet.',
    st: { sent: 'Sent', pending: 'Waiting for admins', rejected: 'Not approved' } as Record<string, string>,
    reached: 'reached {n}',
    toCustomers: 'to your customers',
    toArea: 'to your area',
  },
};

export const POST_LOOK: Record<Kind, { icon: LucideIcon; c: string }> = {
  moved: { icon: MapPinned, c: 'bg-stitch/10 text-stitch' },
  hours: { icon: CalendarClock, c: 'bg-sky/10 text-sky' },
  closed: { icon: DoorClosed, c: 'bg-ink/[0.06] text-ink/80' },
  news: { icon: Megaphone, c: 'bg-olive/12 text-olive' },
};

const ST: Record<string, { icon: LucideIcon; c: string }> = {
  sent: { icon: CircleCheck, c: 'text-olive' },
  pending: { icon: Hourglass, c: 'text-[rgb(150_105_10)] dark:text-gold' },
  rejected: { icon: XCircle, c: 'text-stitch' },
};

/** The agent's desk card for telling people about a move, new hours, closing or an offer. */
export function AgentUpdates() {
  const { lang, err } = useI18n();
  const w = W[lang === 'ar' ? 'ar' : 'en'];
  const toast = useToast();
  const confirm = useConfirm();
  const data = useData<{ posts: any[]; customers: number; area: string[]; city: string | null }>('/api/exchange/posts');
  const [kind, setKind] = useState<Kind>('moved');
  const [audience, setAudience] = useState<'customers' | 'area'>('customers');
  const [title, setTitle] = useState(w.starters.moved[0]);
  const [body, setBody] = useState(w.starters.moved[1]);
  const [count, setCount] = useState<number | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const area = data.data?.area ?? [];

  useEffect(() => {
    let alive = true;
    if (audience === 'area' && !area.length) {
      setCount(0);
      return;
    }
    post<{ count: number }>('/api/exchange/posts', { kind, title: 'xx', body: 'xx', audience, dryRun: true })
      .then((r) => alive && setCount(r.count))
      .catch(() => alive && setCount(null));
    return () => {
      alive = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [audience, area.length]);

  const pickKind = (k: Kind) => {
    // Swap the starter text only if the person hasn't written their own yet.
    const prev = w.starters[kind];
    if (title === prev[0]) setTitle(w.starters[k][0]);
    if (body === prev[1]) setBody(w.starters[k][1]);
    setKind(k);
  };

  const send = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    if (audience === 'customers' && !(await confirm({ title: w.confirmT, body: fill(w.confirmB, { n: count ?? 0 }), confirmLabel: w.send }))) return;
    setBusy(true);
    try {
      const r = await post<{ status: string; sent: number }>('/api/exchange/posts', { kind, title: title.trim(), body: body.trim(), audience });
      toast(r.status === 'pending' ? w.asked : fill(w.sent, { n: r.sent }));
      setTitle(w.starters[kind][0]);
      setBody(w.starters[kind][1]);
      void data.reload();
    } catch (e2) {
      setError(err(e2));
    } finally {
      setBusy(false);
    }
  };

  const ready = title.trim().length >= 2 && body.trim().length >= 2 && (audience === 'area' ? area.length > 0 : (count ?? 0) > 0);
  const K = POST_LOOK[kind];

  return (
    <section className="card mt-6 overflow-hidden">
      <div className="relative overflow-hidden bg-night px-5 py-5 text-white sm:px-6 dark:bg-white/[0.04]">
        <span className="pointer-events-none absolute -end-10 -top-12 h-40 w-40 rounded-full border border-dashed border-gold/30" />
        <h2 className="relative flex items-center gap-2.5 font-display text-2xl">
          <BellRing className="h-6 w-6 text-gold" /> {w.title}
        </h2>
        <p className="relative mt-1 max-w-xl text-sm text-white/65">{w.lead}</p>
      </div>
      <div className="grid gap-6 p-5 sm:p-6 lg:grid-cols-[minmax(0,1.3fr)_minmax(0,1fr)]">
        <form onSubmit={send} className="min-w-0 space-y-4">
          <div className="-mx-1 flex gap-2 overflow-x-auto px-1 pb-1 [scrollbar-width:none]" role="radiogroup">
            {(Object.keys(POST_LOOK) as Kind[]).map((k) => {
              const L = POST_LOOK[k];
              const on = kind === k;
              return (
                <button
                  key={k}
                  type="button"
                  role="radio"
                  aria-checked={on}
                  onClick={() => pickKind(k)}
                  className={cx('inline-flex shrink-0 items-center gap-2 rounded-full px-3.5 py-2 text-sm transition', on ? cx(L.c, 'font-semibold ring-1 ring-current') : 'bg-sunk text-ink/75 hover:text-ink')}
                >
                  <L.icon className="h-4 w-4" /> {w.kinds[k]}
                </button>
              );
            })}
          </div>

          <div>
            <p className="mb-2 text-sm font-medium text-ink/80">{w.to}</p>
            <div className="grid grid-cols-2 gap-2.5" role="radiogroup">
              {(
                [
                  ['customers', Users, w.customers, w.customersD],
                  ['area', ShieldCheck, w.area, w.areaD],
                ] as const
              ).map(([k, Icon, tt, d]) => {
                const on = audience === k;
                return (
                  <button
                    key={k}
                    type="button"
                    role="radio"
                    aria-checked={on}
                    onClick={() => setAudience(k)}
                    className={cx('flex items-start gap-2.5 rounded-2xl border p-3 text-start transition', on ? 'border-transparent bg-night text-white shadow-lift dark:bg-white/15' : 'border-line bg-surface hover:border-ink/25')}
                  >
                    <Icon className={cx('mt-0.5 h-[18px] w-[18px] shrink-0', on ? 'text-gold' : 'text-muted')} />
                    <span className="min-w-0">
                      <span className="block text-sm font-semibold">{tt}</span>
                      <span className={cx('block text-xs', on ? 'text-white/70' : 'text-muted')}>{d}</span>
                    </span>
                  </button>
                );
              })}
            </div>
            <p className={cx('mt-2.5 flex items-center gap-2 rounded-xl px-3 py-2 text-sm', audience === 'area' && !area.length ? 'bg-stitch/10 text-stitch' : count ? 'bg-olive/10 text-olive' : 'bg-sunk text-muted')}>
              <Users className="h-4 w-4 shrink-0" />
              {audience === 'area'
                ? area.length
                  ? `${fill(w.areaOf, { place: area.map((k) => placeLabel(k, lang)).join('، ') })}${count ? ` · ${fill(w.reach, { n: count })}` : ''}`
                  : w.noArea
                : count == null
                  ? '…'
                  : count
                    ? fill(w.reach, { n: count })
                    : w.reachNone}
            </p>
          </div>

          <Field label={w.tTitle} value={title} onChange={(e) => setTitle(e.target.value)} required minLength={2} maxLength={80} />
          <TextArea label={w.tBody} value={body} onChange={(e) => setBody(e.target.value)} required minLength={2} maxLength={500} rows={3} />
          {kind === 'moved' && (
            <p className="flex flex-wrap items-center gap-x-2 gap-y-1 rounded-xl bg-stitch/[0.06] px-3 py-2 text-xs text-ink/80">
              <MapPinned className="h-4 w-4 text-stitch" /> {w.movedHint}
              <Link to="/app/settings?tab=agent" className="font-semibold text-stitch underline-offset-2 hover:underline">
                {w.openProfile}
              </Link>
            </p>
          )}
          <ErrorNote>{error}</ErrorNote>
          <Button block size="lg" loading={busy} disabled={!ready} icon={<Send className="h-4 w-4 flip-rtl" />}>
            {audience === 'area' ? w.ask : w.send}
          </Button>
          <p className="text-center text-xs text-muted">{w.limit}</p>
        </form>

        <div className="min-w-0 space-y-4">
          {/* Live preview */}
          <div className="flex items-start gap-3 rounded-2xl bg-bg/70 p-3.5 ring-1 ring-line">
            <span className={cx('grid h-10 w-10 shrink-0 place-items-center rounded-xl', K.c)}>
              <K.icon className="h-5 w-5" />
            </span>
            <span className="min-w-0 flex-1">
              <span className="block font-semibold">{title.trim() || w.tTitle}</span>
              <span className="mt-0.5 block whitespace-pre-line break-words text-sm text-muted">{body.trim() || w.tBody}</span>
            </span>
            <BellRing className="h-4 w-4 shrink-0 text-muted" />
          </div>

          <div>
            <h3 className="mb-2 text-sm font-semibold text-ink/80">{w.history}</h3>
            {!data.data?.posts.length ? (
              <p className="rounded-2xl bg-sunk/60 p-4 text-center text-sm text-muted">{w.none}</p>
            ) : (
              <ul className="max-h-80 space-y-2 overflow-y-auto">
                {data.data.posts.map((p) => {
                  const L = POST_LOOK[p.kind as Kind] ?? POST_LOOK.news;
                  const S = ST[p.status] ?? ST.sent!;
                  return (
                    <motion.li key={p.id} layout className="flex items-start gap-3 rounded-2xl bg-surface p-3 ring-1 ring-line">
                      <span className={cx('grid h-8 w-8 shrink-0 place-items-center rounded-lg', L.c)}>
                        <L.icon className="h-4 w-4" />
                      </span>
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-sm font-semibold">{p.title}</span>
                        <span className="mt-0.5 flex flex-wrap items-center gap-x-2 text-[11px] text-muted">
                          <span className={cx('inline-flex items-center gap-1 font-medium', S.c)}>
                            <S.icon className="h-3.5 w-3.5" /> {w.st[p.status] ?? p.status}
                          </span>
                          <span>· {p.audience === 'area' ? w.toArea : w.toCustomers}</span>
                          {p.status === 'sent' && <span>· {fill(w.reached, { n: p.reach })}</span>}
                          <span className="inline-flex items-center gap-1">
                            · <Clock3 className="h-3 w-3" /> {relative(p.created_at, lang)}
                          </span>
                        </span>
                        {p.status === 'rejected' && p.note && <span className="mt-1 block text-xs text-stitch">{p.note}</span>}
                      </span>
                    </motion.li>
                  );
                })}
              </ul>
            )}
          </div>
        </div>
      </div>
    </section>
  );
}
