import { useEffect, useMemo, useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import {
  ArrowLeft,
  Baby,
  Bell,
  BellOff,
  Briefcase,
  CalendarClock,
  Check,
  Contact,
  FastForward,
  Gift,
  Handshake,
  HeartHandshake,
  History,
  Landmark,
  Pause,
  Pencil,
  Play,
  Plus,
  Receipt,
  Repeat,
  Search,
  Send,
  Trash2,
  Truck,
  Users,
  Wallet,
  type LucideIcon,
} from 'lucide-react';
import { del, get, post, put } from '../lib/api';
import { useAuth } from '../lib/auth';
import { useI18n } from '../lib/i18n';
import { useData } from '../lib/hooks';
import { money, relative } from '../lib/format';
import { useToast } from '../components/Toast';
import { useConfirm } from '../components/Confirm';
import { useSecureAction } from '../components/SecureAction';
import { AmountInput, Avatar, Badge, Button, EmptyState, ErrorNote, PageHeader, Sheet, Skeleton, Toggle, cx } from '../components/ui';

// ------------------------------------------------------------- vocabulary
type Kind = 'family' | 'relatives' | 'debt' | 'bills' | 'staff' | 'suppliers' | 'partners' | 'custom';
const KIND: Record<Kind, { icon: LucideIcon; c: string; ar: string; en: string; work?: boolean }> = {
  family: {
    icon: Baby,
    c: 'bg-sky/10 text-sky',
    ar: 'ولادي',
    en: 'My children',
  },
  relatives: {
    icon: HeartHandshake,
    c: 'bg-stitch/10 text-stitch',
    ar: 'أهلي وقرايبي',
    en: 'Family & relatives',
  },
  debt: {
    icon: Receipt,
    c: 'bg-gold/15 text-[rgb(150_105_10)] dark:text-gold',
    ar: 'ديون وأقساط',
    en: 'Debts & instalments',
  },
  bills: {
    icon: CalendarClock,
    c: 'bg-night/10 text-night dark:bg-white/10 dark:text-white',
    ar: 'إيجار وفواتير',
    en: 'Rent & bills',
  },
  staff: {
    icon: Briefcase,
    c: 'bg-olive/12 text-olive',
    ar: 'موظفيني',
    en: 'My staff',
    work: true,
  },
  suppliers: {
    icon: Truck,
    c: 'bg-[#7A2E8C]/10 text-[#7A2E8C] dark:text-[#d7a3e2]',
    ar: 'موردين',
    en: 'Suppliers',
  },
  partners: {
    icon: Handshake,
    c: 'bg-[#0F5F5C]/10 text-[#0F5F5C] dark:text-[#8fd3cf]',
    ar: 'شركاء',
    en: 'Partners',
  },
  custom: { icon: Users, c: 'bg-sunk text-ink/80', ar: 'فئة', en: 'Group' },
};
/** What fits each kind of account: staff, suppliers and partners belong to stores. */
const SUGGEST: Record<string, Kind[]> = {
  user: ['family', 'relatives', 'debt', 'bills'],
  exchange: ['family', 'relatives', 'debt', 'bills'],
  merchant: ['staff', 'suppliers', 'partners', 'debt', 'family'],
  admin: ['family', 'relatives', 'debt'],
};
const kindOf = (k: string): (typeof KIND)[Kind] => KIND[(k as Kind) in KIND ? (k as Kind) : 'custom'];

const T = {
  ar: {
    title: 'الدفعات المجدولة',
    lead: 'مصاري بتروح لحالها لناسك بالموعد — مصروف الولاد، راتب، قسط دين، إيجار. إنت بتحدد المبلغ وكل قديش ولحد إمتى، ونحنا بنذكّرك قبل. وبتوقفها بكبسة.',
    newPay: 'دفعة مجدولة جديدة',
    monthly: 'بيطلع بالشهر تقريبًا',
    last30: 'انبعت آخر 30 يوم',
    next: 'الدفعة الجاية',
    none: 'ما في دفعات مجدولة لسا',
    noneLead: 'ابدأ بأول دفعة — بتاخد أقل من دقيقة.',
    all: 'الكل',
    addCat: 'فئة',
    paused: 'موقوفة',
    pausedAdmin: 'موقوفة من الإدارة',
    finished: 'خلصت',
    due: 'حان موعدها — ادفعها',
    failed: 'آخر محاولة ما زبطت',
    payNow: 'ادفع هلّأ',
    skip: 'تخطّى هالمرة',
    pause: 'وقّف',
    resume: 'شغّل',
    edit: 'عدّل',
    remove: 'احذف',
    history: 'السجل',
    bonus: 'مكافأة',
    of: '{n} من {m}',
    until: 'لحد {d}',
    forever: 'لحد ما توقفها',
    once: 'مرة وحدة',
    every: {
      week: 'كل أسبوع',
      '2weeks': 'كل أسبوعين',
      month: 'كل شهر',
      days: 'كل {n} يوم',
      once: 'مرة وحدة',
    } as Record<string, string>,
    auto: 'بتنبعت لحالها',
    manual: 'بتذكّرك وإنت بتدفع',
    remindTxt: ['بنفس اليوم', 'قبل بيوم', 'قبل يومين', 'قبل {n} أيام'],
    people: 'ناسك',
    team: 'فريق الشغل',
  },
  en: {
    title: 'Scheduled payments',
    lead: 'Money that goes to your people on time by itself — pocket money, a salary, a debt instalment, rent. You set how much, how often and until when; we remind you first. Pause with one tap.',
    newPay: 'New scheduled payment',
    monthly: 'Goes out per month (about)',
    last30: 'Sent, last 30 days',
    next: 'Next payment',
    none: 'No scheduled payments yet',
    noneLead: 'Start with the first one — it takes under a minute.',
    all: 'All',
    addCat: 'Group',
    paused: 'Paused',
    pausedAdmin: 'Paused by the team',
    finished: 'Finished',
    due: 'Due — pay it',
    failed: 'Last try failed',
    payNow: 'Pay now',
    skip: 'Skip this one',
    pause: 'Pause',
    resume: 'Resume',
    edit: 'Edit',
    remove: 'Delete',
    history: 'History',
    bonus: 'Bonus',
    of: '{n} of {m}',
    until: 'until {d}',
    forever: 'until you stop it',
    once: 'once',
    every: {
      week: 'every week',
      '2weeks': 'every 2 weeks',
      month: 'every month',
      days: 'every {n} days',
      once: 'once',
    } as Record<string, string>,
    auto: 'goes out by itself',
    manual: 'reminds you to pay',
    remindTxt: ['same day', 'a day before', 'two days before', '{n} days before'],
    people: 'Your people',
    team: 'Work team',
  },
};

const fmtDate = (iso: string, lang: string, withTime = true) =>
  new Intl.DateTimeFormat(lang === 'ar' ? 'ar-u-nu-latn' : 'en-GB', {
    weekday: 'short',
    day: 'numeric',
    month: 'short',
    ...(withTime ? { hour: '2-digit', minute: '2-digit' } : {}),
  }).format(new Date(iso));
const remindLabel = (n: number | null, w: (typeof T)['ar']) => (n == null ? null : n <= 2 ? w.remindTxt[n]! : w.remindTxt[3]!.replace('{n}', String(n)));

/** Scheduled payments to your people — the page. */
export default function People() {
  const { lang, err } = useI18n();
  const ar = lang === 'ar';
  const w = T[ar ? 'ar' : 'en'];
  const { user } = useAuth();
  const role = user?.role ?? 'user';
  const toast = useToast();
  const confirm = useConfirm();
  const secure = useSecureAction();
  const data = useData<{
    groups: any[];
    schedules: any[];
    people: any[];
    totals: { last30: string; monthly: string };
    bankLinked: boolean;
  }>('/api/people/overview');
  const [cat, setCat] = useState<string>('all');
  const [wizard, setWizard] = useState<any>(null);
  const [catForm, setCatForm] = useState<any>(null);
  const [runs, setRuns] = useState<any>(null);
  const [bonus, setBonus] = useState<any>(null);
  const [busy, setBusy] = useState<string | null>(null);

  const d = data.data;
  const groups = d?.groups ?? [];
  const schedules = useMemo(() => (d?.schedules ?? []).filter((s) => cat === 'all' || (cat === 'none' ? !s.group_id : s.group_id === cat)), [d, cat]);
  const live = (d?.schedules ?? []).filter((s) => s.active && !s.paused_by_admin);
  const next = [...live].sort((a, b) => +new Date(a.next_run_at) - +new Date(b.next_run_at))[0];
  const workGroups = groups.filter((g) => g.is_work);
  const workPeople = (d?.people ?? []).filter((p) => workGroups.some((g) => g.id === p.group_id));
  const suggest = (SUGGEST[role] ?? SUGGEST.user!).filter((k) => !groups.some((g) => g.kind === k));

  const act = async (key: string, fn: () => Promise<unknown>, ok?: string) => {
    setBusy(key);
    try {
      await fn();
      if (ok) toast(ok);
      await data.reload();
    } catch (e) {
      toast(err(e), 'error');
    } finally {
      setBusy(null);
    }
  };
  const cadence = (s: any) => (s.every === 'days' ? w.every.days!.replace('{n}', String(s.every_days)) : w.every[s.every]);
  const endText = (s: any) =>
    s.every === 'once'
      ? w.once
      : s.ends === 'count'
        ? w.of.replace('{n}', String(s.runs)).replace('{m}', String(s.max_runs))
        : s.ends === 'until' && s.end_date
          ? w.until.replace('{d}', fmtDate(s.end_date, lang, false))
          : w.forever;

  return (
    <div>
      <PageHeader
        title={w.title}
        lead={w.lead}
        actions={
          <Button icon={<Plus className="h-4 w-4" />} onClick={() => setWizard({ step: 0 })}>
            <span className="hidden sm:inline">{w.newPay}</span>
          </Button>
        }
      />
      {secure.element}

      {!d ? (
        <Skeleton className="h-72 rounded-3xl" />
      ) : (
        <>
          {/* the next payment, and totals */}
          <div className="mb-5 grid grid-cols-2 gap-3 sm:grid-cols-[1.4fr_1fr_1fr]">
            <div className="relative col-span-2 overflow-hidden rounded-3xl bg-night p-5 sm:col-span-1 text-white dark:bg-white/[0.07]">
              <span className="pointer-events-none absolute -end-8 -top-8 h-32 w-32 rounded-full border border-dashed border-gold/30" />
              <p className="text-xs text-white/65">{w.next}</p>
              {next ? (
                <div className="mt-2 flex items-center gap-3">
                  <Avatar name={next.nickname || next.full_name} src={next.profile_image} size={44} />
                  <div className="min-w-0">
                    <p className="num font-display text-2xl leading-tight">{money(next.amount, lang)}</p>
                    <p className="truncate text-sm text-white/75">
                      {next.nickname || next.full_name} · {relative(next.next_run_at, lang)}
                    </p>
                  </div>
                </div>
              ) : (
                <p className="mt-2 text-sm text-white/70">—</p>
              )}
            </div>
            <div className="rounded-3xl bg-surface p-4 shadow-card sm:p-5">
              <p className="text-xs text-muted">{w.monthly}</p>
              <p className="num mt-1 font-display text-xl sm:text-2xl">{money(d.totals.monthly, lang)}</p>
            </div>
            <div className="rounded-3xl bg-surface p-4 shadow-card sm:p-5">
              <p className="text-xs text-muted">{w.last30}</p>
              <p className="num mt-1 font-display text-xl sm:text-2xl">{money(d.totals.last30, lang)}</p>
            </div>
          </div>

          {/* categories: only to sort; suggestions fit the kind of account */}
          <div className="-mx-4 mb-4 flex gap-2 overflow-x-auto px-4 pb-1 [scrollbar-width:none] sm:mx-0 sm:flex-wrap sm:px-0">
            {[{ id: 'all', name: w.all, kind: 'custom' }, ...groups].map((g) => {
              const on = cat === g.id;
              const K = kindOf(g.kind);
              return (
                <button
                  key={g.id}
                  onClick={() => setCat(g.id)}
                  onDoubleClick={() =>
                    g.id !== 'all' &&
                    setCatForm({
                      ...g,
                      seniorAfterMonths: g.senior_after_months,
                    })
                  }
                  className={cx(
                    'flex shrink-0 items-center gap-2 rounded-full px-3.5 py-2 text-sm transition',
                    on ? 'bg-night text-white dark:bg-white/15' : 'bg-surface ring-1 ring-line hover:ring-ink/25',
                  )}
                >
                  {g.id !== 'all' && <K.icon className="h-4 w-4" />}
                  {g.name}
                  {g.id !== 'all' && <span className={cx('num rounded-full px-1.5 text-[11px]', on ? 'bg-white/20' : 'bg-sunk')}>{g.count}</span>}
                </button>
              );
            })}
            {suggest.slice(0, 3).map((k) => (
              <button
                key={k}
                onClick={() =>
                  setCatForm({
                    name: KIND[k][ar ? 'ar' : 'en'],
                    kind: k,
                    is_work: !!KIND[k].work,
                  })
                }
                className="flex shrink-0 items-center gap-1.5 rounded-full border border-dashed border-line px-3 py-2 text-sm text-ink/75 hover:border-ink/40"
              >
                {(() => {
                  const I = KIND[k].icon;
                  return <I className="h-4 w-4" />;
                })()}
                {KIND[k][ar ? 'ar' : 'en']} <Plus className="h-3.5 w-3.5" />
              </button>
            ))}
            <button
              onClick={() => setCatForm({ name: '', kind: 'custom', is_work: false })}
              className="flex shrink-0 items-center gap-1.5 rounded-full border border-dashed border-line px-3 py-2 text-sm text-ink/75 hover:border-ink/40"
            >
              <Plus className="h-4 w-4" /> {w.addCat}
            </button>
            {cat !== 'all' && cat !== 'none' && (
              <button
                onClick={() =>
                  setCatForm({
                    ...groups.find((g) => g.id === cat),
                    seniorAfterMonths: groups.find((g) => g.id === cat)?.senior_after_months,
                  })
                }
                className="flex shrink-0 items-center gap-1.5 rounded-full px-3 py-2 text-sm text-sky"
              >
                <Pencil className="h-4 w-4" /> {w.edit}
              </button>
            )}
          </div>

          {/* the payments */}
          {!schedules.length ? (
            <div className="card grid place-items-center gap-3 px-6 py-12 text-center">
              <span className="grid h-16 w-16 place-items-center rounded-2xl bg-olive/12 text-olive">
                <Repeat className="h-8 w-8" />
              </span>
              <p className="text-lg font-semibold">{w.none}</p>
              <p className="max-w-sm text-sm text-muted">{w.noneLead}</p>
              <Button icon={<Plus className="h-4 w-4" />} onClick={() => setWizard({ step: 0, groupId: cat !== 'all' ? cat : null })}>
                {w.newPay}
              </Button>
            </div>
          ) : (
            <ul className="grid gap-3 lg:grid-cols-2">
              <AnimatePresence initial={false}>
                {schedules.map((s) => {
                  const on = s.active && !s.paused_by_admin && s.consent !== 'pending';
                  const g = groups.find((x) => x.id === s.group_id);
                  const pct = s.ends === 'count' && s.max_runs ? Math.min(100, (s.runs / s.max_runs) * 100) : null;
                  return (
                    <motion.li key={s.id} layout initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }} className={cx('card overflow-hidden', !on && 'opacity-80')}>
                      {s.awaiting && on && (
                        <div className="flex items-center justify-between gap-2 bg-gold/15 px-4 py-2 text-sm font-medium text-[rgb(120_85_10)] dark:text-gold">
                          <span className="flex items-center gap-2">
                            <Bell className="h-4 w-4" /> {w.due}
                          </span>
                        </div>
                      )}
                      <div className="p-4">
                        <div className="flex items-start gap-3">
                          <Avatar name={s.nickname || s.full_name} src={s.profile_image} size={48} />
                          <div className="min-w-0 flex-1">
                            <p className="truncate font-semibold">{s.title || s.nickname || s.full_name}</p>
                            <p className="truncate text-xs text-muted">{[s.title ? s.nickname || s.full_name : null, g?.name].filter(Boolean).join(' · ') || s.wallet_id}</p>
                          </div>
                          <div className="text-end">
                            <p className="num font-display text-xl leading-tight">{money(s.amount, lang)}</p>
                            <p className="text-xs text-muted">{cadence(s)}</p>
                          </div>
                        </div>

                        <div className="mt-3 flex flex-wrap items-center gap-1.5 text-xs">
                          {s.consent === 'pending' ? (
                            <Badge tone="warn">{ar ? 'بستنى موافقته' : 'Waiting for them to accept'}</Badge>
                          ) : s.paused_by_admin ? (
                            <Badge tone="bad">{w.pausedAdmin}</Badge>
                          ) : s.finished_at ? (
                            <Badge tone="neutral">{w.finished}</Badge>
                          ) : !s.active ? (
                            <Badge tone="neutral">{w.paused}</Badge>
                          ) : (
                            <span className="inline-flex items-center gap-1 rounded-full bg-olive/12 px-2.5 py-1 font-medium text-olive">
                              <CalendarClock className="h-3.5 w-3.5" /> {fmtDate(s.next_run_at, lang)}
                            </span>
                          )}
                          <span className="inline-flex items-center gap-1 rounded-full bg-sunk px-2.5 py-1">
                            {s.source === 'bank' ? <Landmark className="h-3.5 w-3.5" /> : <Wallet className="h-3.5 w-3.5" />}
                            <ArrowLeft className="h-3 w-3 rtl:rotate-0 ltr:rotate-180" />
                            {s.dest === 'bank' ? <Landmark className="h-3.5 w-3.5" /> : <Wallet className="h-3.5 w-3.5" />}
                          </span>
                          <span className="rounded-full bg-sunk px-2.5 py-1">{endText(s)}</span>
                          <span className="inline-flex items-center gap-1 rounded-full bg-sunk px-2.5 py-1">
                            {s.remind_before != null ? <Bell className="h-3.5 w-3.5" /> : <BellOff className="h-3.5 w-3.5" />}
                            {s.remind_before != null ? remindLabel(s.remind_before, w) : s.auto ? w.auto : w.manual}
                          </span>
                          {s.fail_count > 0 && <Badge tone="bad">{w.failed}</Badge>}
                        </div>
                        {pct != null && (
                          <div className="mt-3 h-1.5 overflow-hidden rounded-full bg-sunk">
                            <motion.div initial={{ width: 0 }} animate={{ width: `${pct}%` }} className="h-full rounded-full bg-olive" />
                          </div>
                        )}
                        {s.paused_by_admin && s.admin_note && <p className="mt-2 text-xs text-stitch">{s.admin_note}</p>}
                      </div>

                      <div className="flex items-center gap-1 border-t border-line bg-bg/40 px-2 py-1.5">
                        {on && (
                          <button
                            onClick={() => act(`pay${s.id}`, () => secure.run((totp) => post(`/api/people/schedules/${s.id}/pay-now`, totp ? { totp } : {})), ar ? 'انبعتت' : 'Sent')}
                            className="inline-flex items-center gap-1.5 rounded-full bg-night px-3 py-1.5 text-xs font-semibold text-white dark:bg-white/15"
                          >
                            <Send className="h-3.5 w-3.5 flip-rtl" /> {w.payNow}
                          </button>
                        )}
                        {on && s.every !== 'once' && (
                          <button
                            onClick={() => act(`skip${s.id}`, () => post(`/api/people/schedules/${s.id}/skip`), ar ? 'انتقلت للموعد الجاي' : 'Skipped')}
                            className="inline-flex items-center gap-1.5 rounded-full px-3 py-1.5 text-xs hover:bg-sunk"
                          >
                            <FastForward className="h-3.5 w-3.5" /> <span className="hidden min-[400px]:inline">{w.skip}</span>
                          </button>
                        )}
                        {!s.paused_by_admin && !s.finished_at && (
                          <button
                            onClick={() =>
                              act(
                                `pause${s.id}`,
                                () =>
                                  secure.run((totp) =>
                                    put(`/api/people/schedules/${s.id}`, {
                                      active: !s.active,
                                      ...(totp ? { totp } : {}),
                                    }),
                                  ),
                                s.active ? (ar ? 'وقّفناها' : 'Paused') : ar ? 'رجعت تشتغل' : 'Resumed',
                              )
                            }
                            className={cx('inline-flex items-center gap-1.5 rounded-full px-3 py-1.5 text-xs font-semibold', s.active ? 'text-stitch hover:bg-stitch/10' : 'bg-olive/12 text-olive')}
                          >
                            {s.active ? <Pause className="h-3.5 w-3.5" /> : <Play className="h-3.5 w-3.5" />} {s.active ? w.pause : w.resume}
                          </button>
                        )}
                        <span className="ms-auto flex">
                          <button onClick={() => setRuns(s)} className="grid h-8 w-8 place-items-center rounded-full text-muted hover:bg-sunk" title={w.history} aria-label={w.history}>
                            <History className="h-4 w-4" />
                          </button>
                          <button onClick={() => setWizard(fromSchedule(s))} className="grid h-8 w-8 place-items-center rounded-full text-muted hover:bg-sunk" title={w.edit} aria-label={w.edit}>
                            <Pencil className="h-4 w-4" />
                          </button>
                          <button
                            onClick={async () => {
                              if (
                                !(await confirm({
                                  title: ar ? 'تحذف الدفعة المجدولة؟' : 'Delete this scheduled payment?',
                                  body: ar ? 'ما رح ينبعت إشي بعد هيك. السجل بيضل.' : 'Nothing more is sent. History stays.',
                                  tone: 'danger',
                                  confirmLabel: w.remove,
                                }))
                              )
                                return;
                              await act(`del${s.id}`, () => del(`/api/people/payouts/${s.id}`));
                            }}
                            className="grid h-8 w-8 place-items-center rounded-full text-muted hover:bg-stitch/10 hover:text-stitch"
                            title={w.remove}
                            aria-label={w.remove}
                          >
                            <Trash2 className="h-4 w-4" />
                          </button>
                        </span>
                      </div>
                      {busy?.endsWith(s.id) && <div className="h-0.5 animate-pulse bg-olive" />}
                    </motion.li>
                  );
                })}
              </AnimatePresence>
            </ul>
          )}

          {/* work groups: titles, seniority, bonuses, shown on profiles if they agree */}
          {workPeople.length > 0 && <WorkTeam people={workPeople} groups={workGroups} onBonus={setBonus} onChange={() => data.reload()} />}
        </>
      )}

      <Wizard
        value={wizard}
        onClose={() => setWizard(null)}
        groups={groups}
        bankLinked={!!d?.bankLinked}
        secure={secure}
        onDone={() => {
          setWizard(null);
          void data.reload();
        }}
      />
      <CategorySheet value={catForm} onClose={() => setCatForm(null)} onDone={() => (setCatForm(null), void data.reload())} />
      <RunsSheet payout={runs} onClose={() => setRuns(null)} />
      <BonusSheet value={bonus} onClose={() => setBonus(null)} secure={secure} onDone={() => (setBonus(null), void data.reload())} />
    </div>
  );
}

const fromSchedule = (s: any) => ({
  step: 1,
  id: s.id,
  person: {
    id: s.user_id,
    full_name: s.nickname || s.full_name,
    profile_image: s.profile_image,
  },
  groupId: s.group_id,
  title: s.title ?? '',
  amount: Number(s.amount).toFixed(2),
  every: s.every,
  everyDays: s.every_days ?? 10,
  start: toLocalInput(s.next_run_at),
  ends: s.ends,
  endDate: s.end_date ? String(s.end_date).slice(0, 10) : '',
  maxRuns: s.max_runs ?? 12,
  source: s.source,
  dest: s.dest,
  auto: s.auto,
  remind: s.remind_before,
});
function toLocalInput(iso: string) {
  const d = new Date(iso);
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}`;
}

// ----------------------------------------------------------------- wizard
function Wizard({ value, onClose, groups, bankLinked, secure, onDone }: { value: any; onClose: () => void; groups: any[]; bankLinked: boolean; secure: any; onDone: () => void }) {
  const { lang, err } = useI18n();
  const ar = lang === 'ar';
  const w = T[ar ? 'ar' : 'en'];
  const [f, setF] = useState<any>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    if (!value) {
      setF(null);
      return;
    }
    const tomorrow = new Date(Date.now() + 86400000);
    tomorrow.setHours(9, 0, 0, 0);
    setF({
      step: 0,
      person: null,
      groupId: null,
      title: '',
      amount: '',
      every: 'month',
      everyDays: 10,
      start: toLocalInput(tomorrow.toISOString()),
      ends: 'never',
      endDate: '',
      maxRuns: 12,
      source: 'wallet',
      dest: 'wallet',
      auto: true,
      remind: 1,
      ...value,
    });
    setError(null);
  }, [value]);
  if (!f)
    return (
      <Sheet open={false} onClose={onClose} title="">
        {null}
      </Sheet>
    );
  const set = (p: any) => setF({ ...f, ...p });
  const steps = [ar ? 'لمين' : 'Who', ar ? 'كم وكل قديش' : 'How much & how often', ar ? 'من وين والتذكير' : 'From where & reminder'];
  const ready0 = !!f.person;
  const ready1 = Number(f.amount) > 0 && (f.every !== 'days' || f.everyDays > 0) && (f.ends !== 'until' || f.endDate) && (f.ends !== 'count' || f.maxRuns > 0);
  const total = f.ends === 'count' && Number(f.amount) > 0 ? (Number(f.amount) * f.maxRuns).toFixed(2) : null;
  const cadence = f.every === 'days' ? w.every.days!.replace('{n}', String(f.everyDays)) : w.every[f.every];
  const save = async () => {
    setBusy(true);
    setError(null);
    const body: any = {
      title: f.title.trim() || undefined,
      amount: Number(f.amount).toFixed(2),
      every: f.every,
      ...(f.every === 'days' ? { everyDays: Number(f.everyDays) } : {}),
      ends: f.every === 'once' ? 'never' : f.ends,
      ...(f.ends === 'until' ? { endDate: f.endDate } : {}),
      ...(f.ends === 'count' ? { maxRuns: Number(f.maxRuns) } : {}),
      source: f.source,
      dest: f.dest,
      auto: f.auto,
      remindBefore: f.remind,
    };
    try {
      await secure.run((totp?: string) =>
        f.id
          ? put(`/api/people/schedules/${f.id}`, {
              ...body,
              title: f.title.trim() || null,
              nextAt: new Date(f.start).toISOString(),
              groupId: f.groupId || null,
              ...(totp ? { totp } : {}),
            })
          : post('/api/people/schedules', {
              ...body,
              ...(f.person.id ? { userId: f.person.id } : { who: f.person.who }),
              groupId: f.groupId || null,
              startAt: new Date(f.start).toISOString(),
              ...(totp ? { totp } : {}),
            }),
      );
      onDone();
    } catch (e) {
      setError(err(e));
    } finally {
      setBusy(false);
    }
  };
  const Seg = ({ k, opts }: { k: string; opts: [any, string, LucideIcon?][] }) => (
    <div className={cx('grid gap-1 rounded-2xl bg-sunk p-1', opts.length === 2 ? 'grid-cols-2' : opts.length === 3 ? 'grid-cols-3' : 'grid-cols-2 sm:grid-cols-4')}>
      {opts.map(([v, l, I]) => (
        <button
          key={String(v)}
          type="button"
          onClick={() => set({ [k]: v })}
          className={cx('flex items-center justify-center gap-1.5 rounded-xl px-2 py-2.5 text-sm transition', f[k] === v ? 'bg-surface font-semibold shadow-card' : 'text-muted hover:text-ink')}
        >
          {I && <I className="h-4 w-4" />} {l}
        </button>
      ))}
    </div>
  );
  return (
    <Sheet open={!!value} onClose={onClose} title={f.id ? (ar ? 'عدّل الدفعة' : 'Edit payment') : w.newPay}>
      {/* steps */}
      <div className="mb-5 flex items-center gap-2">
        {steps.map((s, i) => (
          <button
            key={s}
            type="button"
            disabled={i > f.step && !(i === 1 && ready0) && !(i === 2 && ready0 && ready1)}
            onClick={() => set({ step: i })}
            className="flex min-w-0 flex-1 flex-col items-center gap-1"
          >
            <span
              className={cx(
                'grid h-8 w-8 place-items-center rounded-full text-sm font-bold transition',
                i < f.step ? 'bg-olive text-white' : i === f.step ? 'bg-night text-white dark:bg-white/20' : 'bg-sunk text-muted',
              )}
            >
              {i < f.step ? <Check className="h-4 w-4" /> : i + 1}
            </span>
            <span className={cx('truncate text-[11px]', i === f.step ? 'font-semibold' : 'text-muted')}>{s}</span>
          </button>
        ))}
      </div>

      {f.step === 0 && (
        <div className="space-y-4">
          <PersonPicker value={f.person} onChange={(p) => set({ person: p })} locked={!!f.id} />
          <div>
            <p className="mb-1.5 text-sm font-medium text-ink/80">{ar ? 'بأي فئة؟ (اختياري — للترتيب بس)' : 'Which group? (optional — just to sort)'}</p>
            <div className="flex flex-wrap gap-1.5">
              <button type="button" onClick={() => set({ groupId: null })} className={cx('rounded-full px-3 py-1.5 text-sm', !f.groupId ? 'bg-night text-white dark:bg-white/20' : 'bg-sunk')}>
                {ar ? 'بلا فئة' : 'None'}
              </button>
              {groups.map((g) => {
                const K = kindOf(g.kind);
                return (
                  <button
                    key={g.id}
                    type="button"
                    onClick={() => set({ groupId: g.id })}
                    className={cx('inline-flex items-center gap-1.5 rounded-full px-3 py-1.5 text-sm', f.groupId === g.id ? 'bg-night text-white dark:bg-white/20' : 'bg-sunk')}
                  >
                    <K.icon className="h-4 w-4" /> {g.name}
                  </button>
                );
              })}
            </div>
          </div>
          <label className="block">
            <span className="mb-1.5 block text-sm font-medium text-ink/80">{ar ? 'اسم للدفعة (اختياري)' : 'A name for it (optional)'}</span>
            <input
              value={f.title}
              onChange={(e) => set({ title: e.target.value })}
              maxLength={60}
              placeholder={ar ? 'مصروف أحمد، راتب، قسط الدين، الإيجار…' : 'Pocket money, salary, loan instalment, rent…'}
              className="field"
            />
          </label>
          <Button block size="lg" disabled={!ready0} onClick={() => set({ step: 1 })}>
            {ar ? 'التالي' : 'Next'}
          </Button>
        </div>
      )}

      {f.step === 1 && (
        <div className="space-y-5">
          <AmountInput label={ar ? 'المبلغ كل مرة' : 'Amount each time'} value={f.amount} onChange={(v) => set({ amount: v })} />
          <div>
            <p className="mb-1.5 text-sm font-medium text-ink/80">{ar ? 'كل قديش؟' : 'How often?'}</p>
            <Seg
              k="every"
              opts={[
                ['once', w.every.once!],
                ['week', w.every.week!],
                ['month', w.every.month!],
                ['days', ar ? 'عدد أيام' : 'Every N days'],
              ]}
            />
            {f.every === 'days' && (
              <div className="mt-2 flex items-center gap-2 text-sm">
                {ar ? 'كل' : 'Every'}
                <input type="number" min={1} max={365} value={f.everyDays} onChange={(e) => set({ everyDays: Number(e.target.value) })} className="field h-11 w-24 text-center" />
                {ar ? 'يوم' : 'days'}
              </div>
            )}
            {f.every === 'week' && (
              <button type="button" onClick={() => set({ every: '2weeks' })} className="mt-2 text-xs text-sky">
                {ar ? 'بدك كل أسبوعين؟' : 'Every two weeks instead?'}
              </button>
            )}
          </div>
          <label className="block">
            <span className="mb-1.5 block text-sm font-medium text-ink/80">{f.every === 'once' ? (ar ? 'إمتى؟' : 'When?') : ar ? 'أول دفعة' : 'First payment'}</span>
            <input type="datetime-local" value={f.start} onChange={(e) => set({ start: e.target.value })} className="field" />
          </label>
          {f.every !== 'once' && (
            <div>
              <p className="mb-1.5 text-sm font-medium text-ink/80">{ar ? 'لحد إمتى؟' : 'Until when?'}</p>
              <Seg
                k="ends"
                opts={[
                  ['never', ar ? 'للأبد' : 'Forever'],
                  ['until', ar ? 'لتاريخ' : 'A date'],
                  ['count', ar ? 'عدد دفعات' : 'N payments'],
                ]}
              />
              {f.ends === 'until' && <input type="date" value={f.endDate} onChange={(e) => set({ endDate: e.target.value })} className="field mt-2" />}
              {f.ends === 'count' && (
                <div className="mt-2 flex flex-wrap items-center gap-2 text-sm">
                  <input type="number" min={1} max={1000} value={f.maxRuns} onChange={(e) => set({ maxRuns: Number(e.target.value) })} className="field h-11 w-24 text-center" />
                  {ar ? 'دفعة' : 'payments'}
                  {total && <span className="text-muted">· {ar ? `المجموع ${money(total, lang)}` : `total ${money(total, lang)}`}</span>}
                </div>
              )}
            </div>
          )}
          <div className="flex gap-2">
            <Button variant="secondary" onClick={() => set({ step: 0 })}>
              {ar ? 'رجوع' : 'Back'}
            </Button>
            <Button className="flex-1" size="lg" disabled={!ready1} onClick={() => set({ step: 2 })}>
              {ar ? 'التالي' : 'Next'}
            </Button>
          </div>
        </div>
      )}

      {f.step === 2 && (
        <div className="space-y-5">
          <div className="grid gap-3 sm:grid-cols-2">
            <div>
              <p className="mb-1.5 text-sm font-medium text-ink/80">{ar ? 'من وين؟' : 'From'}</p>
              <Seg
                k="source"
                opts={[
                  ['wallet', ar ? 'محفظتي' : 'My wallet', Wallet],
                  ['bank', ar ? 'بنكي' : 'My bank', Landmark],
                ]}
              />
              {f.source === 'bank' && !bankLinked && <p className="mt-1 text-xs text-stitch">{ar ? 'اربط حسابك البنكي أول.' : 'Link your bank account first.'}</p>}
            </div>
            <div>
              <p className="mb-1.5 text-sm font-medium text-ink/80">{ar ? 'لوين؟' : 'To'}</p>
              <Seg
                k="dest"
                opts={[
                  ['wallet', ar ? 'محفظته' : 'Their wallet', Wallet],
                  ['bank', ar ? 'بنكه' : 'Their bank', Landmark],
                ]}
              />
              {f.dest === 'bank' && <p className="mt-1 text-xs text-muted">{ar ? 'إذا ما عنده بنك مربوط، بتضل بمحفظته.' : 'Without a linked bank it stays in their wallet.'}</p>}
            </div>
          </div>
          <div className="rounded-2xl bg-sunk/60 p-3.5">
            <Toggle checked={f.auto} onChange={(v) => set({ auto: v })} label={ar ? 'تنبعت لحالها بالموعد' : 'Send it by itself on time'} />
            <p className="mt-1 text-xs text-muted">
              {f.auto ? (ar ? 'بلا ما تتدخل — وبتوقفها وقت ما بدك.' : 'No need to do anything — pause any time.') : ar ? 'بنذكّرك وإنت بتدفعها بكبسة.' : 'We remind you and you pay with one tap.'}
            </p>
          </div>
          <div>
            <p className="mb-1.5 text-sm font-medium text-ink/80">{ar ? 'ذكّرني' : 'Remind me'}</p>
            <div className="flex flex-wrap gap-1.5">
              {[
                [null, ar ? 'لا' : 'No'],
                [0, w.remindTxt[0]],
                [1, w.remindTxt[1]],
                [2, w.remindTxt[2]],
                [7, ar ? 'قبل أسبوع' : 'a week before'],
              ].map(([v, l]) => (
                <button
                  key={String(v)}
                  type="button"
                  onClick={() => set({ remind: v })}
                  className={cx('rounded-full px-3.5 py-1.5 text-sm transition', f.remind === v ? 'bg-night text-white dark:bg-white/20' : 'bg-sunk')}
                >
                  {l}
                </button>
              ))}
            </div>
          </div>
          {/* summary in one sentence */}
          <div className="rounded-2xl bg-olive/[0.07] p-4 text-sm leading-relaxed ring-1 ring-olive/20">
            <b className="num">{money(Number(f.amount || 0).toFixed(2), lang)}</b> {ar ? 'لـ' : 'to'} <b>{f.person?.full_name ?? f.person?.who}</b> — {cadence}
            {f.every !== 'once' &&
              (f.ends === 'count' ? ` · ${f.maxRuns} ${ar ? 'دفعة' : 'payments'}` : f.ends === 'until' && f.endDate ? ` · ${ar ? 'لحد' : 'until'} ${f.endDate}` : ` · ${w.forever}`)}
            {` · ${ar ? 'أول وحدة' : 'first'} ${fmtDate(new Date(f.start).toISOString(), lang)}`}
          </div>
          {!f.id && <p className="text-xs text-muted">{ar ? 'إذا مش من ناسك لسا، بيوصله طلب يوافق عليه — والدفعات بتبلّش بس لما يوافق.' : 'If they aren’t in your people yet, they get a request — payments start only once they accept.'}</p>}
          <ErrorNote>{error}</ErrorNote>
          <div className="flex gap-2">
            <Button variant="secondary" onClick={() => set({ step: 1 })}>
              {ar ? 'رجوع' : 'Back'}
            </Button>
            <Button className="flex-1" size="lg" loading={busy} disabled={f.source === 'bank' && !bankLinked} icon={<Check className="h-4 w-4" />} onClick={save}>
              {f.id ? (ar ? 'احفظ' : 'Save') : ar ? 'شغّل الدفعة' : 'Start it'}
            </Button>
          </div>
        </div>
      )}
    </Sheet>
  );
}

/** Who to pay: someone from your contacts, a name search, or a wallet ID / e-mail. */
function PersonPicker({ value, onChange, locked }: { value: any; onChange: (p: any) => void; locked?: boolean }) {
  const { lang } = useI18n();
  const ar = lang === 'ar';
  const [mode, setMode] = useState<'contacts' | 'search' | 'id'>('contacts');
  const contacts = useData<{ contacts: any[] }>(locked ? null : '/api/contacts');
  const [q, setQ] = useState('');
  const [found, setFound] = useState<any[]>([]);
  const [id, setId] = useState('');
  useEffect(() => {
    if (mode !== 'search' || q.trim().length < 2) {
      setFound([]);
      return;
    }
    const h = setTimeout(() => {
      get<{ users: any[] }>(`/api/messages/search-users?q=${encodeURIComponent(q.trim())}`)
        .then((r) => setFound(r.users))
        .catch(() => setFound([]));
    }, 220);
    return () => clearTimeout(h);
  }, [q, mode]);
  if (value)
    return (
      <div className="flex items-center gap-3 rounded-2xl bg-sky/[0.07] p-3 ring-1 ring-sky/25">
        <Avatar name={value.full_name ?? value.who} src={value.profile_image} size={44} />
        <div className="min-w-0 flex-1">
          <p className="truncate font-semibold">{value.full_name ?? value.who}</p>
          {value.wallet_id && (
            <p className="truncate text-xs text-muted" dir="ltr">
              {value.wallet_id}
            </p>
          )}
        </div>
        {!locked && (
          <button type="button" onClick={() => onChange(null)} className="rounded-full px-3 py-1.5 text-xs text-sky hover:bg-sky/10">
            {ar ? 'غيّر' : 'Change'}
          </button>
        )}
      </div>
    );
  const list =
    mode === 'contacts'
      ? (contacts.data?.contacts ?? []).map((c: any) => ({
          id: c.user_id,
          full_name: c.nickname || c.full_name,
          profile_image: c.profile_image,
          wallet_id: c.wallet_id,
        }))
      : found;
  return (
    <div>
      <p className="mb-1.5 text-sm font-medium text-ink/80">{ar ? 'لمين؟' : 'Who to pay?'}</p>
      <div className="mb-2 grid grid-cols-3 gap-1 rounded-2xl bg-sunk p-1">
        {(
          [
            ['contacts', ar ? 'جهات اتصالي' : 'Contacts', Contact],
            ['search', ar ? 'دوّر بالاسم' : 'Search', Search],
            ['id', ar ? 'رقم أو إيميل' : 'ID / e-mail', Wallet],
          ] as const
        ).map(([k, l, I]) => (
          <button
            key={k}
            type="button"
            onClick={() => setMode(k)}
            className={cx('flex items-center justify-center gap-1.5 rounded-xl px-1 py-2 text-xs transition sm:text-sm', mode === k ? 'bg-surface font-semibold shadow-card' : 'text-muted')}
          >
            <I className="h-4 w-4 shrink-0" /> <span className="truncate">{l}</span>
          </button>
        ))}
      </div>
      {mode === 'search' && <input autoFocus value={q} onChange={(e) => setQ(e.target.value)} placeholder={ar ? 'اكتب اسمه…' : 'Type a name…'} className="field mb-2" type="search" />}
      {mode === 'id' ? (
        <div className="flex gap-2">
          <input value={id} onChange={(e) => setId(e.target.value)} placeholder={ar ? 'رقم المحفظة أو الإيميل' : 'Wallet ID or e-mail'} className="field flex-1" dir="ltr" />
          <Button disabled={id.trim().length < 3} onClick={() => onChange({ who: id.trim() })}>
            {ar ? 'تمام' : 'OK'}
          </Button>
        </div>
      ) : (
        <ul className="max-h-64 overflow-y-auto rounded-2xl ring-1 ring-line">
          {!list.length ? (
            <li className="px-4 py-6 text-center text-sm text-muted">
              {mode === 'contacts'
                ? ar
                  ? 'ما عندك جهات اتصال — دوّر بالاسم أو اكتب رقمه.'
                  : 'No contacts yet — search or type their ID.'
                : q.trim().length < 2
                  ? ar
                    ? 'اكتب حرفين أو أكثر'
                    : 'Type 2+ letters'
                  : ar
                    ? 'ما لقينا حدا'
                    : 'Nobody found'}
            </li>
          ) : (
            list.map((p: any) => (
              <li key={p.id} className="border-b border-line last:border-b-0">
                <button type="button" onClick={() => onChange(p)} className="flex w-full items-center gap-3 px-3.5 py-2.5 text-start transition hover:bg-sunk/60">
                  <Avatar name={p.full_name} src={p.profile_image} size={36} />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-sm font-medium">{p.full_name}</span>
                    {p.wallet_id && (
                      <span className="block truncate text-xs text-muted" dir="ltr">
                        {p.wallet_id}
                      </span>
                    )}
                  </span>
                </button>
              </li>
            ))
          )}
        </ul>
      )}
    </div>
  );
}

function CategorySheet({ value, onClose, onDone }: { value: any; onClose: () => void; onDone: () => void }) {
  const { lang, err } = useI18n();
  const ar = lang === 'ar';
  const toast = useToast();
  const confirm = useConfirm();
  const [f, setF] = useState<any>(null);
  useEffect(() => {
    setF(
      value
        ? {
            name: value.name ?? '',
            kind: value.kind ?? 'custom',
            isWork: !!value.is_work,
            workplace: value.workplace ?? '',
            seniorAfterMonths: value.seniorAfterMonths ?? null,
            id: value.id,
          }
        : null,
    );
  }, [value]);
  if (!f)
    return (
      <Sheet open={false} onClose={onClose} title="">
        {null}
      </Sheet>
    );
  const save = async () => {
    const body = {
      name: f.name.trim(),
      kind: f.kind,
      isWork: f.isWork,
      workplace: f.isWork ? f.workplace.trim() || null : null,
      seniorAfterMonths: f.isWork ? f.seniorAfterMonths || null : null,
    };
    try {
      if (f.id) await put(`/api/people/groups/${f.id}`, body);
      else await post('/api/people/groups', body);
      onDone();
    } catch (e) {
      toast(err(e), 'error');
    }
  };
  return (
    <Sheet open={!!value} onClose={onClose} title={f.id ? (ar ? 'عدّل الفئة' : 'Edit group') : ar ? 'فئة جديدة' : 'New group'}>
      <div className="space-y-4">
        <label className="block">
          <span className="mb-1.5 block text-sm font-medium text-ink/80">{ar ? 'اسم الفئة' : 'Name'}</span>
          <input value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} maxLength={40} className="field" placeholder={ar ? 'سمّيها زي ما بدك' : 'Call it what you like'} />
        </label>
        <div className="rounded-2xl bg-sunk/60 p-3.5">
          <Toggle checked={f.isWork} onChange={(v) => setF({ ...f, isWork: v })} label={ar ? 'هاي فئة شغل (ناس بيشتغلوا معي)' : 'This is a work group (people who work with me)'} />
          <p className="mt-1 text-xs text-muted">
            {ar
              ? 'بتفتح: الصفة، من إمتى معك، قديم/جديد، المكافآت، وإنه يبين بملفهم وين بيشتغلوا إذا وافقوا.'
              : 'Adds: title, since when, long-standing/new, bonuses, and showing the workplace on their profile if they agree.'}
          </p>
        </div>
        {f.isWork && (
          <div className="grid gap-3 sm:grid-cols-2">
            <label className="block">
              <span className="mb-1.5 block text-sm font-medium text-ink/80">{ar ? 'اسم مكان الشغل' : 'Workplace name'}</span>
              <input value={f.workplace} onChange={(e) => setF({ ...f, workplace: e.target.value })} maxLength={80} className="field" />
            </label>
            <label className="block">
              <span className="mb-1.5 block text-sm font-medium text-ink/80">{ar ? '«قديم» بعد كم شهر؟' : '“Long-standing” after (months)'}</span>
              <input
                type="number"
                min={1}
                value={f.seniorAfterMonths ?? ''}
                onChange={(e) =>
                  setF({
                    ...f,
                    seniorAfterMonths: e.target.value ? Number(e.target.value) : null,
                  })
                }
                className="field"
              />
            </label>
          </div>
        )}
        <div className="flex gap-2">
          <Button className="flex-1" disabled={!f.name.trim()} onClick={save}>
            {ar ? 'احفظ' : 'Save'}
          </Button>
          {f.id && (
            <Button
              variant="secondary"
              onClick={async () => {
                if (
                  !(await confirm({
                    title: ar ? 'تحذف الفئة؟' : 'Delete the group?',
                    body: ar ? 'الدفعات بتضل، بس بتصير بلا فئة.' : 'Payments stay, just without a group.',
                    tone: 'danger',
                    confirmLabel: ar ? 'احذف' : 'Delete',
                  }))
                )
                  return;
                try {
                  await del(`/api/people/groups/${f.id}`);
                  onDone();
                } catch (e) {
                  toast(err(e), 'error');
                }
              }}
            >
              <Trash2 className="h-4 w-4" />
            </Button>
          )}
        </div>
      </div>
    </Sheet>
  );
}

/** Work groups only: titles, since when, long-standing or new, bonuses, workplace on their profile. */
function WorkTeam({ people, groups, onBonus, onChange }: { people: any[]; groups: any[]; onBonus: (p: any) => void; onChange: () => void }) {
  const { lang, err } = useI18n();
  const ar = lang === 'ar';
  const toast = useToast();
  const [edit, setEdit] = useState<any>(null);
  const months = (d?: string | null) => (d ? Math.max(0, Math.floor((Date.now() - new Date(d).getTime()) / (30.44 * 86400000))) : null);
  const save = async () => {
    try {
      await put(`/api/people/members/${edit.id}`, {
        roleTitle: edit.roleTitle.trim() || null,
        since: edit.since || null,
        ...(edit.invite !== undefined ? { invite: edit.invite } : {}),
      });
      setEdit(null);
      onChange();
    } catch (e) {
      toast(err(e), 'error');
    }
  };
  return (
    <section className="card mt-6 p-4 sm:p-5">
      <h2 className="mb-3 flex items-center gap-2 text-lg">
        <Briefcase className="h-5 w-5 text-olive" /> {ar ? 'فريق الشغل' : 'Work team'}
      </h2>
      <ul className="divide-y divide-line">
        {people.map((m) => {
          const g = groups.find((x) => x.id === m.group_id);
          const mo = months(m.since);
          const senior = g?.senior_after_months && mo != null ? mo >= g.senior_after_months : null;
          return (
            <li key={m.id} className="flex flex-wrap items-center gap-3 py-3">
              <Avatar name={m.nickname || m.full_name} src={m.profile_image} size={40} />
              <div className="min-w-0 flex-1">
                <p className="flex flex-wrap items-center gap-1.5 font-semibold">
                  {m.nickname || m.full_name}
                  {senior != null && <Badge tone={senior ? 'good' : 'info'}>{senior ? (ar ? 'قديم' : 'Long-standing') : ar ? 'جديد' : 'New'}</Badge>}
                  {m.link_status === 'accepted' && <Badge tone="good">{ar ? 'بيبين بملفه' : 'On profile'}</Badge>}
                  {m.link_status === 'invited' && <Badge tone="warn">{ar ? 'بستنى موافقته' : 'Invited'}</Badge>}
                </p>
                <p className="truncate text-xs text-muted">
                  {[m.role_title, mo != null ? (ar ? `صرله ${Math.floor(mo / 12) ? `${Math.floor(mo / 12)} سنة و` : ''}${mo % 12} شهر` : `${mo} months`) : null, g?.name].filter(Boolean).join(' · ')}
                </p>
              </div>
              <div className="flex gap-1.5">
                <button onClick={() => onBonus(m)} className="inline-flex items-center gap-1 rounded-full bg-gold/15 px-3 py-1.5 text-xs font-semibold text-[rgb(150_105_10)] dark:text-gold">
                  <Gift className="h-3.5 w-3.5" /> {ar ? 'مكافأة' : 'Bonus'}
                </button>
                <button
                  onClick={() =>
                    setEdit({
                      id: m.id,
                      name: m.full_name,
                      roleTitle: m.role_title ?? '',
                      since: m.since ? String(m.since).slice(0, 10) : '',
                      status: m.link_status,
                    })
                  }
                  className="grid h-8 w-8 place-items-center rounded-full text-muted hover:bg-sunk"
                  aria-label="✎"
                >
                  <Pencil className="h-4 w-4" />
                </button>
              </div>
            </li>
          );
        })}
      </ul>
      <Sheet open={!!edit} onClose={() => setEdit(null)} title={edit?.name ?? ''}>
        {edit && (
          <div className="space-y-4">
            <label className="block">
              <span className="mb-1.5 block text-sm font-medium text-ink/80">{ar ? 'الصفة' : 'Title'}</span>
              <input
                value={edit.roleTitle}
                onChange={(e) => setEdit({ ...edit, roleTitle: e.target.value })}
                maxLength={60}
                className="field"
                placeholder={ar ? 'محاسب، خبّاز، مندوب…' : 'Accountant, baker…'}
              />
            </label>
            <label className="block">
              <span className="mb-1.5 block text-sm font-medium text-ink/80">{ar ? 'من إمتى معك' : 'With you since'}</span>
              <input type="date" value={edit.since} onChange={(e) => setEdit({ ...edit, since: e.target.value })} className="field" />
            </label>
            {edit.status !== 'accepted' && (
              <Toggle
                checked={edit.invite ?? edit.status === 'invited'}
                onChange={(v) => setEdit({ ...edit, invite: v })}
                label={ar ? 'اطلب منه يبين بملفه إنه بيشتغل عندك' : 'Ask them to show it on their profile'}
              />
            )}
            <Button block onClick={save}>
              {ar ? 'احفظ' : 'Save'}
            </Button>
          </div>
        )}
      </Sheet>
    </section>
  );
}

function BonusSheet({ value, onClose, secure, onDone }: { value: any; onClose: () => void; secure: any; onDone: () => void }) {
  const { lang, err } = useI18n();
  const ar = lang === 'ar';
  const toast = useToast();
  const [amount, setAmount] = useState('');
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    setAmount('');
    setNote('');
  }, [value]);
  return (
    <Sheet open={!!value} onClose={onClose} title={ar ? `مكافأة لـ ${value?.nickname || value?.full_name || ''}` : 'Bonus'}>
      <div className="space-y-4">
        <AmountInput label={ar ? 'المبلغ' : 'Amount'} value={amount} onChange={setAmount} />
        <input
          value={note}
          onChange={(e) => setNote(e.target.value)}
          maxLength={120}
          placeholder={ar ? 'ملاحظة بتوصله (مكافأة العيد، شغل ممتاز…)' : 'A note (Eid bonus, great work…)'}
          className="field"
        />
        <Button
          block
          size="lg"
          variant="stitch"
          loading={busy}
          disabled={!(Number(amount) > 0)}
          icon={<Gift className="h-4 w-4" />}
          onClick={async () => {
            setBusy(true);
            try {
              await secure.run((totp?: string) =>
                post(`/api/people/members/${value.id}/bonus`, {
                  amount: Number(amount).toFixed(2),
                  note: note.trim() || undefined,
                  ...(totp ? { totp } : {}),
                }),
              );
              toast(ar ? 'انبعتت المكافأة' : 'Bonus sent');
              onDone();
            } catch (e) {
              toast(err(e), 'error');
            } finally {
              setBusy(false);
            }
          }}
        >
          {ar ? 'ابعت هلّأ' : 'Send now'}
        </Button>
      </div>
    </Sheet>
  );
}

function RunsSheet({ payout, onClose }: { payout: any; onClose: () => void }) {
  const { lang } = useI18n();
  const ar = lang === 'ar';
  const data = useData<{ runs: any[] }>(payout ? `/api/people/runs?member=${payout.member_id}` : null, [payout?.id]);
  const ST: Record<string, [string, 'good' | 'warn' | 'bad' | 'neutral']> = {
    done: [ar ? 'انبعتت' : 'Sent', 'good'],
    waiting: [ar ? 'بستنى البنك' : 'Waiting for bank', 'warn'],
    failed: [ar ? 'ما زبطت' : 'Failed', 'bad'],
    skipped: [ar ? 'تخطّيتها' : 'Skipped', 'neutral'],
  };
  return (
    <Sheet open={!!payout} onClose={onClose} title={ar ? `سجل ${payout?.nickname || payout?.full_name || ''}` : 'History'}>
      {!data.data ? (
        <Skeleton className="h-40" />
      ) : !data.data.runs.length ? (
        <EmptyState icon={<History className="h-6 w-6" />} title={ar ? 'لسا ما انبعت إشي' : 'Nothing sent yet'} />
      ) : (
        <ul className="divide-y divide-line">
          {data.data.runs.map((r) => (
            <li key={r.id} className="flex items-center justify-between gap-3 py-2.5 text-sm">
              <span className="min-w-0">
                <b className="num">{money(r.amount, lang)}</b>
                {r.kind === 'bonus' && <span className="text-muted"> · {ar ? 'مكافأة' : 'bonus'}</span>}
                {r.error && <span className="block truncate text-xs text-stitch">{r.error}</span>}
              </span>
              <span className="shrink-0 text-end">
                <Badge tone={ST[r.status]?.[1] ?? 'neutral'}>{ST[r.status]?.[0] ?? r.status}</Badge>
                <span className="block text-[11px] text-muted">{relative(r.ran_at, lang)}</span>
              </span>
            </li>
          ))}
        </ul>
      )}
    </Sheet>
  );
}
