import { useEffect, useMemo, useState } from 'react';
import { motion } from 'framer-motion';
import { AlertTriangle, BellRing, Gift, Info, Mail, Megaphone, Search, Send, UserRound, Users, X, type LucideIcon } from 'lucide-react';
import { get, post } from '../lib/api';
import { useI18n } from '../lib/i18n';
import { useData } from '../lib/hooks';
import { fill, relative } from '../lib/format';
import { useToast } from '../components/Toast';
import { useConfirm } from '../components/Confirm';
import { Avatar, Badge, Button, ErrorNote, Field, PageHeader, TextArea, Toggle, cx } from '../components/ui';

/** The kinds of account an announcement can go to in this app. */
const ROLES: { k: string; ar: string; en: string }[] = [
  { k: 'user', ar: 'العملاء', en: 'Customers' },
  { k: 'admin', ar: 'الإدارة', en: 'Admins' },
];

const W = {
  ar: {
    title: 'الإشعارات والتعميمات',
    lead: 'ابعت إشعار لكل الناس، أو لنوع معيّن من الحسابات، أو لأشخاص بعينهم — وبتقدر تبعته بالإيميل كمان.',
    who: 'لمين بدك تبعته؟',
    all: 'كل الناس',
    allD: 'كل الحسابات الفعّالة',
    roles: 'حسب نوع الحساب',
    rolesD: 'اختار نوع أو أكثر',
    people: 'أشخاص بعينهم',
    peopleD: 'دوّر واختار أسماء',
    findPh: 'دوّر بالاسم أو الإيميل',
    noFound: 'ما لقينا حدا بهالاسم',
    picked: '{n} شخص مختار',
    content: 'الرسالة',
    tTitle: 'العنوان',
    tBody: 'نص الرسالة',
    tone: 'نوعها',
    tones: { info: 'معلومة', important: 'مهم', offer: 'عرض أو خبر حلو' } as Record<string, string>,
    email: 'ابعتها بالإيميل كمان',
    emailD: 'لحد 300 شخص، رسالة رسالة حتى ما ينضغط سيرفر الإيميل.',
    preview: 'هيك رح تبين عندهم',
    reach: 'رح توصل لـ {n} شخص',
    reachNone: 'ما في حدا بهالاختيار',
    send: 'ابعت الإشعار',
    confirmT: 'تبعت الإشعار؟',
    confirmB: 'رح يوصل لـ {n} شخص فورًا، وما في تراجع بعد الإرسال.',
    sent: 'انبعت لـ {n} شخص',
    sentMail: 'وانبعت بالإيميل لـ {n}',
    history: 'اللي انبعت قبل',
    histNone: 'لسا ما انبعت إشي.',
    toAll: 'للكل',
    toRoles: 'لـ: {list}',
    toPeople: 'لـ {n} شخص',
    toOne: 'لـ {name}',
    by: 'من {name}',
    reached: '{n} وصله',
    viaMail: 'بالإيميل كمان',
  },
  en: {
    title: 'Notifications & announcements',
    lead: 'Send a notification to everyone, to certain kinds of account, or to specific people — by e-mail too if you like.',
    who: 'Who should get it?',
    all: 'Everyone',
    allD: 'Every active account',
    roles: 'By kind of account',
    rolesD: 'Pick one or more',
    people: 'Specific people',
    peopleD: 'Search and pick names',
    findPh: 'Search by name or e-mail',
    noFound: 'Nobody matches that',
    picked: '{n} people picked',
    content: 'Message',
    tTitle: 'Title',
    tBody: 'Message',
    tone: 'Kind',
    tones: { info: 'Information', important: 'Important', offer: 'Offer or good news' } as Record<string, string>,
    email: 'Also send it by e-mail',
    emailD: 'Up to 300 people, one at a time so the mail server isn’t flooded.',
    preview: 'How it will look to them',
    reach: 'It will reach {n} people',
    reachNone: 'Nobody matches this choice',
    send: 'Send notification',
    confirmT: 'Send this notification?',
    confirmB: 'It reaches {n} people right away and can’t be taken back.',
    sent: 'Sent to {n} people',
    sentMail: 'and e-mailed to {n}',
    history: 'Sent before',
    histNone: 'Nothing sent yet.',
    toAll: 'To everyone',
    toRoles: 'To: {list}',
    toPeople: 'To {n} people',
    toOne: 'To {name}',
    by: 'By {name}',
    reached: 'reached {n}',
    viaMail: 'also by e-mail',
  },
};

const TONES: { k: 'info' | 'important' | 'offer'; icon: LucideIcon; c: string }[] = [
  { k: 'info', icon: Info, c: 'bg-sky/10 text-sky' },
  { k: 'important', icon: AlertTriangle, c: 'bg-stitch/10 text-stitch' },
  { k: 'offer', icon: Gift, c: 'bg-olive/12 text-olive' },
];

type Person = { id: string; full_name: string; email: string; role?: string; profile_image?: string | null };

/** Everything about telling people something: who, what, a live preview, and what was sent before. */
export function AdminNotify() {
  const { lang, err } = useI18n();
  const w = W[lang === 'ar' ? 'ar' : 'en'];
  const toast = useToast();
  const confirm = useConfirm();
  const history = useData<{ items: any[] }>('/api/admin/broadcasts');
  const [audience, setAudience] = useState<'all' | 'roles' | 'people'>('all');
  const [roles, setRoles] = useState<string[]>([]);
  const [people, setPeople] = useState<Person[]>([]);
  const [find, setFind] = useState('');
  const [found, setFound] = useState<Person[] | null>(null);
  const [title, setTitle] = useState('');
  const [body, setBody] = useState('');
  const [tone, setTone] = useState<'info' | 'important' | 'offer'>('info');
  const [email, setEmail] = useState(false);
  const [count, setCount] = useState<number | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const roleName = (k: string) => ROLES.find((r) => r.k === k)?.[lang === 'ar' ? 'ar' : 'en'] ?? k;

  const target = useMemo(
    () => ({ audience, ...(audience === 'roles' ? { roles } : {}), ...(audience === 'people' ? { userIds: people.map((p) => p.id) } : {}) }),
    [audience, roles, people],
  );

  // How many people the current choice reaches (asked as you change it).
  useEffect(() => {
    if ((audience === 'roles' && !roles.length) || (audience === 'people' && !people.length)) {
      setCount(0);
      return;
    }
    let alive = true;
    const h = setTimeout(async () => {
      try {
        const r = await post<{ count: number }>('/api/admin/broadcast', { title: 'xx', body: 'xx', ...target, dryRun: true });
        if (alive) setCount(r.count);
      } catch {
        if (alive) setCount(null);
      }
    }, 250);
    return () => {
      alive = false;
      clearTimeout(h);
    };
  }, [target, audience, roles.length, people.length]);

  // People search as you type.
  useEffect(() => {
    const q = find.trim();
    if (q.length < 2) {
      setFound(null);
      return;
    }
    let alive = true;
    const h = setTimeout(async () => {
      try {
        const r = await get<{ users: Person[] }>(`/api/admin/users?q=${encodeURIComponent(q)}&limit=8`);
        if (alive) setFound(r.users ?? []);
      } catch {
        if (alive) setFound([]);
      }
    }, 200);
    return () => {
      alive = false;
      clearTimeout(h);
    };
  }, [find]);

  const send = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    if (!(await confirm({ title: w.confirmT, body: fill(w.confirmB, { n: count ?? 0 }), confirmLabel: w.send }))) return;
    setBusy(true);
    try {
      const r = await post<{ sent: number; emailed: number }>('/api/admin/broadcast', { title: title.trim(), body: body.trim(), tone, email, ...target });
      toast(`${fill(w.sent, { n: r.sent })}${r.emailed ? ` ${fill(w.sentMail, { n: r.emailed })}` : ''}`);
      setTitle('');
      setBody('');
      void history.reload();
    } catch (e2) {
      setError(err(e2));
    } finally {
      setBusy(false);
    }
  };

  const T = TONES.find((x) => x.k === tone)!;
  const AUD: { k: 'all' | 'roles' | 'people'; icon: LucideIcon; t: string; d: string }[] = [
    { k: 'all', icon: Megaphone, t: w.all, d: w.allD },
    { k: 'roles', icon: Users, t: w.roles, d: w.rolesD },
    { k: 'people', icon: UserRound, t: w.people, d: w.peopleD },
  ];
  const ready = title.trim().length >= 2 && body.trim().length >= 2 && (count ?? 0) > 0;

  return (
    <div>
      <PageHeader title={w.title} lead={w.lead} />
      <div className="grid gap-5 lg:grid-cols-[minmax(0,1.35fr)_minmax(0,1fr)]">
        <form onSubmit={send} className="min-w-0 space-y-5">
          {/* Who */}
          <section className="card p-5 sm:p-6">
            <h2 className="mb-4 text-lg">{w.who}</h2>
            <div className="grid gap-2.5 sm:grid-cols-3" role="radiogroup">
              {AUD.map((a) => {
                const on = audience === a.k;
                return (
                  <button
                    key={a.k}
                    type="button"
                    role="radio"
                    aria-checked={on}
                    onClick={() => setAudience(a.k)}
                    className={cx('flex items-start gap-3 rounded-2xl border p-3.5 text-start transition', on ? 'border-transparent bg-night text-white shadow-lift dark:bg-white/15' : 'border-line bg-surface hover:border-ink/25')}
                  >
                    <span className={cx('grid h-9 w-9 shrink-0 place-items-center rounded-xl', on ? 'bg-white/15' : 'bg-sunk text-muted')}>
                      <a.icon className="h-[18px] w-[18px]" />
                    </span>
                    <span className="min-w-0">
                      <span className="block text-sm font-semibold">{a.t}</span>
                      <span className={cx('block text-xs', on ? 'text-white/70' : 'text-muted')}>{a.d}</span>
                    </span>
                  </button>
                );
              })}
            </div>

            {audience === 'roles' && (
              <motion.div initial={{ opacity: 0, y: -4 }} animate={{ opacity: 1, y: 0 }} className="mt-4 flex flex-wrap gap-2">
                {ROLES.map((r) => {
                  const on = roles.includes(r.k);
                  return (
                    <button
                      key={r.k}
                      type="button"
                      role="checkbox"
                      aria-checked={on}
                      onClick={() => setRoles(on ? roles.filter((x) => x !== r.k) : [...roles, r.k])}
                      className={cx('rounded-full px-4 py-2 text-sm transition', on ? 'bg-stitch text-white shadow-lift' : 'bg-sunk text-ink/80 hover:text-ink')}
                    >
                      {lang === 'ar' ? r.ar : r.en}
                    </button>
                  );
                })}
              </motion.div>
            )}

            {audience === 'people' && (
              <motion.div initial={{ opacity: 0, y: -4 }} animate={{ opacity: 1, y: 0 }} className="mt-4">
                {people.length > 0 && (
                  <div className="mb-3 flex flex-wrap gap-2">
                    {people.map((p) => (
                      <span key={p.id} className="inline-flex items-center gap-2 rounded-full bg-sky/10 py-1 pe-1 ps-1 text-sm">
                        <Avatar name={p.full_name} src={p.profile_image} size={24} />
                        <span className="max-w-[10rem] truncate">{p.full_name}</span>
                        <button type="button" onClick={() => setPeople(people.filter((x) => x.id !== p.id))} className="grid h-6 w-6 place-items-center rounded-full text-muted hover:bg-black/5 hover:text-ink" aria-label="✕">
                          <X className="h-3.5 w-3.5" />
                        </button>
                      </span>
                    ))}
                  </div>
                )}
                <label className="relative block">
                  <Search className="pointer-events-none absolute start-4 top-1/2 h-5 w-5 -translate-y-1/2 text-muted" />
                  <input value={find} onChange={(e) => setFind(e.target.value)} placeholder={w.findPh} type="search" className="field h-12 rounded-2xl ps-12" />
                </label>
                {found && (
                  <ul className="mt-2 overflow-hidden rounded-2xl ring-1 ring-line">
                    {found.length ? (
                      found.map((p) => {
                        const on = people.some((x) => x.id === p.id);
                        return (
                          <li key={p.id} className="border-b border-line last:border-b-0">
                            <button
                              type="button"
                              onClick={() => (on ? setPeople(people.filter((x) => x.id !== p.id)) : setPeople([...people, p]))}
                              className={cx('flex w-full items-center gap-3 px-3.5 py-2.5 text-start transition', on ? 'bg-sky/[0.07]' : 'hover:bg-sunk/60')}
                            >
                              <Avatar name={p.full_name} src={p.profile_image} size={34} />
                              <span className="min-w-0 flex-1">
                                <span className="block truncate text-sm font-medium">{p.full_name}</span>
                                <span className="block truncate text-xs text-muted" dir="ltr">
                                  {p.email}
                                </span>
                              </span>
                              {p.role && <Badge tone="neutral">{roleName(p.role)}</Badge>}
                              {on && <span className="grid h-5 w-5 place-items-center rounded-full bg-sky text-[11px] text-white">✓</span>}
                            </button>
                          </li>
                        );
                      })
                    ) : (
                      <li className="px-4 py-3 text-center text-sm text-muted">{w.noFound}</li>
                    )}
                  </ul>
                )}
              </motion.div>
            )}

            <p className={cx('mt-4 flex items-center gap-2 rounded-xl px-3 py-2 text-sm', count ? 'bg-olive/10 text-olive' : 'bg-sunk text-muted')}>
              <Users className="h-4 w-4" />
              {count == null ? '…' : count ? fill(w.reach, { n: count }) : w.reachNone}
            </p>
          </section>

          {/* What */}
          <section className="card space-y-4 p-5 sm:p-6">
            <h2 className="text-lg">{w.content}</h2>
            <div>
              <p className="mb-2 text-sm font-medium text-ink/80">{w.tone}</p>
              <div className="flex flex-wrap gap-2" role="radiogroup">
                {TONES.map((x) => (
                  <button
                    key={x.k}
                    type="button"
                    role="radio"
                    aria-checked={tone === x.k}
                    onClick={() => setTone(x.k)}
                    className={cx('inline-flex items-center gap-2 rounded-full px-3.5 py-2 text-sm transition', tone === x.k ? cx(x.c, 'font-semibold ring-1 ring-current') : 'bg-sunk text-ink/75 hover:text-ink')}
                  >
                    <x.icon className="h-4 w-4" /> {w.tones[x.k]}
                  </button>
                ))}
              </div>
            </div>
            <Field label={w.tTitle} value={title} onChange={(e) => setTitle(e.target.value)} required minLength={2} maxLength={80} />
            <TextArea label={w.tBody} value={body} onChange={(e) => setBody(e.target.value)} required minLength={2} maxLength={500} rows={4} />
            <div className="rounded-2xl bg-sunk/60 p-3.5">
              <Toggle checked={email} onChange={setEmail} label={w.email} />
              <p className="mt-1 flex items-start gap-1.5 text-xs text-muted">
                <Mail className="mt-0.5 h-3.5 w-3.5 shrink-0" /> {w.emailD}
              </p>
            </div>
            <ErrorNote>{error}</ErrorNote>
            <Button size="lg" block loading={busy} disabled={!ready} icon={<Send className="h-4 w-4 flip-rtl" />}>
              {w.send}
              {count ? <span className="num ms-1.5 rounded-full bg-white/20 px-2 py-0.5 text-xs">{count}</span> : null}
            </Button>
          </section>
        </form>

        {/* Preview + history */}
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
              <BellRing className="h-4 w-4 shrink-0 text-muted" />
            </div>
          </section>

          <section className="card overflow-hidden">
            <h2 className="border-b border-line px-5 py-4 text-lg">{w.history}</h2>
            {!history.data?.items.length ? (
              <p className="p-6 text-center text-sm text-muted">{w.histNone}</p>
            ) : (
              <ul className="max-h-[32rem] divide-y divide-line overflow-y-auto">
                {history.data.items.map((h) => {
                  const d = h.details ?? {};
                  const toneDef = TONES.find((x) => x.k === d.tone) ?? TONES[0]!;
                  const to =
                    h.action === 'admin.user_notified'
                      ? fill(w.toOne, { name: h.to_name ?? '—' })
                      : d.audience === 'people'
                        ? fill(w.toPeople, { n: d.people ?? 0 })
                        : d.roles?.length
                          ? fill(w.toRoles, { list: d.roles.map(roleName).join('، ') })
                          : d.role && d.role !== 'all'
                            ? fill(w.toRoles, { list: roleName(d.role) })
                            : w.toAll;
                  return (
                    <li key={h.id} className="flex items-start gap-3 px-5 py-3.5">
                      <span className={cx('mt-0.5 grid h-8 w-8 shrink-0 place-items-center rounded-lg', toneDef.c)}>
                        <toneDef.icon className="h-4 w-4" />
                      </span>
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-sm font-semibold">{d.title ?? '—'}</span>
                        {d.body && <span className="line-clamp-2 block text-xs text-muted">{d.body}</span>}
                        <span className="mt-1 flex flex-wrap gap-x-2 text-[11px] text-muted">
                          <span>{to}</span>
                          {d.count != null && <span>· {fill(w.reached, { n: d.count })}</span>}
                          {d.email && <span>· {w.viaMail}</span>}
                          <span>· {fill(w.by, { name: h.by_name ?? h.by_email ?? '—' })}</span>
                          <span>· {relative(h.created_at, lang)}</span>
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
    </div>
  );
}
