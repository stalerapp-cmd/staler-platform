import { useEffect, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { AnimatePresence, motion } from 'framer-motion';
import { Ban, Bell, BellOff, CalendarClock, Check, FastForward, History, Inbox, Pause, Pencil, Play, Plus, Repeat, Send, ShieldOff, Trash2, X } from 'lucide-react';
import { del, get, post, put } from '../lib/api';
import { useI18n } from '../lib/i18n';
import { useData } from '../lib/hooks';
import { money, relative } from '../lib/format';
import { useAccounts } from '../lib/accounts';
import { fmtIban } from '../components/Bank';
import { useToast } from '../components/Toast';
import { useConfirm } from '../components/Confirm';
import { useSecureAction } from '../components/SecureAction';
import { BeneficiaryPicker } from '../components/Beneficiaries';
import { AmountInput, Avatar, Badge, Button, EmptyState, ErrorNote, PageHeader, Select, Sheet, Skeleton, Toggle, cx } from '../components/ui';

const EVERY: Record<string, [string, string]> = { once: ['مرة وحدة', 'once'], week: ['كل أسبوع', 'every week'], '2weeks': ['كل أسبوعين', 'every 2 weeks'], month: ['كل شهر', 'every month'], days: ['كل {n} يوم', 'every {n} days'] };
const every = (o: any, ar: boolean) => (EVERY[o.every]?.[ar ? 0 : 1] ?? o.every).replace('{n}', String(o.every_days ?? ''));
const CATS: [string, string][] = [
  ['ولادي', 'Children'],
  ['أهلي', 'Family'],
  ['دين وأقساط', 'Debt & instalments'],
  ['إيجار وفواتير', 'Rent & bills'],
  ['موظفين', 'Staff'],
  ['ادخار', 'Savings'],
];
const REMIND: [number | null, string, string][] = [
  [null, 'لا', 'No'],
  [0, 'بنفس اليوم', 'Same day'],
  [1, 'قبل بيوم', 'A day before'],
  [2, 'قبل يومين', 'Two days before'],
  [7, 'قبل أسبوع', 'A week before'],
];
const fmtDate = (iso: string, ar: boolean) => new Intl.DateTimeFormat(ar ? 'ar-u-nu-latn' : 'en-GB', { weekday: 'short', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }).format(new Date(iso));
const localInput = (d: Date) => {
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}`;
};

/** Scheduled payments (standing orders): ones you send, ones waiting for your yes, and who you blocked. */
export default function Scheduled() {
  const { lang, err } = useI18n();
  const ar = lang === 'ar';
  const toast = useToast();
  const confirm = useConfirm();
  const secure = useSecureAction();
  const [sp, setSp] = useSearchParams();
  const tab = (sp.get('tab') as 'mine' | 'incoming' | 'blocked') || 'mine';
  const setTab = (k: string) => setSp(k === 'mine' ? {} : { tab: k }, { replace: true });
  const data = useData<{ orders: any[]; incoming: any[]; optouts: any[]; totals: { monthly: string; last30: string } }>('/api/scheduled');
  const blocks = useData<{ blocks: any[] }>(tab === 'blocked' ? '/api/blocks' : null, [tab]);
  const [form, setForm] = useState<any>(null);
  const [runs, setRuns] = useState<any>(null);
  const [blocking, setBlocking] = useState(false);
  const d = data.data;
  const pendingIn = (d?.incoming ?? []).filter((o) => o.consent === 'pending');
  const live = (d?.orders ?? []).filter((o) => o.active && !o.paused_by_admin && o.consent === 'accepted');
  const next = [...live].sort((a, b) => +new Date(a.next_run_at) - +new Date(b.next_run_at))[0];

  const act = async (fn: () => Promise<unknown>, ok: string) => {
    try {
      await fn();
      toast(ok);
      void data.reload();
    } catch (e) {
      toast(err(e), 'error');
    }
  };

  return (
    <div>
      <PageHeader
        title={ar ? 'الدفعات المجدولة' : 'Scheduled payments'}
        lead={ar ? 'مصاري بتطلع من حسابك لحالها بالموعد — مصروف، قسط، إيجار. اللي بتبعتله بيوافق أول، وبتوقفها بكبسة.' : 'Money that leaves your account on time by itself — pocket money, an instalment, rent. The receiver accepts first; pause with one tap.'}
        actions={
          <Button icon={<Plus className="h-4 w-4" />} onClick={() => setForm({})} aria-label={ar ? 'دفعة جديدة' : 'New payment'}>
            <span className="hidden sm:inline">{ar ? 'دفعة جديدة' : 'New payment'}</span>
          </Button>
        }
      />
      {secure.element}
      <div className="mb-5 grid grid-cols-3 gap-1 rounded-2xl bg-surface p-1 ring-1 ring-line" role="tablist">
        {(
          [
            ['mine', ar ? 'دفعاتي' : 'Mine', Repeat, 0],
            ['incoming', ar ? 'دفعات إلك' : 'To you', Inbox, pendingIn.length],
            ['blocked', ar ? 'المحظورين' : 'Blocked', Ban, 0],
          ] as const
        ).map(([k, l, I, n]) => (
          <button key={k} role="tab" aria-selected={tab === k} onClick={() => setTab(k)} className={cx('relative flex items-center justify-center gap-1.5 rounded-xl px-2 py-2.5 text-sm transition', tab === k ? 'bg-night font-semibold text-white dark:bg-white/15' : 'text-muted hover:text-ink')}>
            <I className="hidden h-4 w-4 shrink-0 min-[420px]:block" /> <span className="truncate">{l}</span>
            {n > 0 && <span className="num grid h-5 min-w-5 place-items-center rounded-full bg-stitch px-1 text-[11px] font-bold text-white">{n}</span>}
          </button>
        ))}
      </div>

      {!d ? (
        <Skeleton className="h-64 rounded-3xl" />
      ) : tab === 'mine' ? (
        <>
          <div className="mb-5 grid grid-cols-2 gap-3 sm:grid-cols-[1.4fr_1fr_1fr]">
            <div className="col-span-2 rounded-3xl bg-night p-5 text-white sm:col-span-1 dark:bg-white/[0.07]">
              <p className="text-xs text-white/65">{ar ? 'الدفعة الجاية' : 'Next payment'}</p>
              {next ? (
                <>
                  <p className="num mt-1 font-display text-2xl">{money(next.amount, lang)}</p>
                  <p className="truncate text-sm text-white/75">
                    {next.to_name} · {relative(next.next_run_at, lang)}
                  </p>
                </>
              ) : (
                <p className="mt-2 text-sm text-white/70">—</p>
              )}
            </div>
            <div className="rounded-3xl bg-surface p-4 shadow-card">
              <p className="text-xs text-muted">{ar ? 'بالشهر تقريبًا' : 'Per month (about)'}</p>
              <p className="num mt-1 font-display text-xl">{money(d.totals.monthly, lang)}</p>
            </div>
            <div className="rounded-3xl bg-surface p-4 shadow-card">
              <p className="text-xs text-muted">{ar ? 'انبعت آخر 30 يوم' : 'Sent, last 30 days'}</p>
              <p className="num mt-1 font-display text-xl">{money(d.totals.last30, lang)}</p>
            </div>
          </div>
          {!d.orders.length ? (
            <EmptyState icon={<Repeat className="h-6 w-6" />} title={ar ? 'ما في دفعات مجدولة لسا' : 'No scheduled payments yet'} action={<Button icon={<Plus className="h-4 w-4" />} onClick={() => setForm({})}>{ar ? 'دفعة جديدة' : 'New payment'}</Button>} />
          ) : (
            <ul className="grid gap-3 lg:grid-cols-2">
              <AnimatePresence initial={false}>
                {d.orders.map((o) => {
                  const on = o.active && !o.paused_by_admin && o.consent === 'accepted';
                  const pct = o.ends === 'count' && o.max_runs ? Math.min(100, (o.runs / o.max_runs) * 100) : null;
                  return (
                    <motion.li key={o.id} layout initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} className={cx('overflow-hidden rounded-3xl bg-surface shadow-card ring-1 ring-line', !o.active && 'opacity-75')}>
                      {o.awaiting && on && (
                        <p className="flex items-center gap-2 bg-gold/15 px-4 py-2 text-sm font-medium">
                          <Bell className="h-4 w-4" /> {ar ? 'حان موعدها — ادفعها' : 'Due — pay it'}
                        </p>
                      )}
                      <div className="p-4">
                        <div className="flex items-start gap-3">
                          <Avatar name={o.to_name} size={44} />
                          <div className="min-w-0 flex-1">
                            <p className="truncate font-semibold">{o.title || o.to_name}</p>
                            <p className="truncate text-xs text-muted">{[o.title ? o.to_name : null, o.category, fmtIban(o.to_iban)].filter(Boolean).join(' · ')}</p>
                          </div>
                          <div className="text-end">
                            <p className="num font-display text-xl">{money(o.amount, lang)}</p>
                            <p className="text-xs text-muted">{every(o, ar)}</p>
                          </div>
                        </div>
                        <div className="mt-3 flex flex-wrap gap-1.5 text-xs">
                          {o.consent === 'pending' ? (
                            <Badge tone="warn">{ar ? 'بستنى موافقته' : 'Waiting for them'}</Badge>
                          ) : o.paused_by_admin ? (
                            <Badge tone="bad">{ar ? 'موقوفة من البنك' : 'Paused by the bank'}</Badge>
                          ) : o.finished_at && !o.active ? (
                            <Badge tone="neutral">{ar ? 'خلصت' : 'Finished'}</Badge>
                          ) : !o.active ? (
                            <Badge tone="neutral">{ar ? 'موقوفة' : 'Paused'}</Badge>
                          ) : (
                            <span className="inline-flex items-center gap-1 rounded-full bg-olive/12 px-2.5 py-1 font-medium text-olive">
                              <CalendarClock className="h-3.5 w-3.5" /> {fmtDate(o.next_run_at, ar)}
                            </span>
                          )}
                          <span className="rounded-full bg-sunk px-2.5 py-1">
                            {o.every === 'once' ? (ar ? 'مرة وحدة' : 'once') : o.ends === 'count' ? `${o.runs} / ${o.max_runs}` : o.ends === 'until' && o.end_date ? `${ar ? 'لحد' : 'until'} ${String(o.end_date).slice(0, 10)}` : ar ? 'لحد ما توقفها' : 'until you stop it'}
                          </span>
                          <span className="inline-flex items-center gap-1 rounded-full bg-sunk px-2.5 py-1">
                            {o.remind_before != null ? <Bell className="h-3.5 w-3.5" /> : <BellOff className="h-3.5 w-3.5" />}
                            {o.auto ? (ar ? 'بتنبعت لحالها' : 'goes by itself') : ar ? 'تذكير بس' : 'reminder only'}
                          </span>
                          {o.fail_count > 0 && <Badge tone="bad">{ar ? 'آخر محاولة ما زبطت' : 'Last try failed'}</Badge>}
                        </div>
                        {pct != null && (
                          <div className="mt-3 h-1.5 overflow-hidden rounded-full bg-sunk">
                            <div className="h-full rounded-full bg-olive" style={{ width: `${pct}%` }} />
                          </div>
                        )}
                        {o.paused_by_admin && o.admin_note && <p className="mt-2 text-xs text-stitch">{o.admin_note}</p>}
                      </div>
                      <div className="flex items-center gap-1 border-t border-line px-2 py-1.5">
                        {on && (
                          <button onClick={() => act(() => secure.run((totp) => post(`/api/scheduled/${o.id}/pay-now`, totp ? { totp } : {})), ar ? 'انبعتت' : 'Sent')} className="inline-flex items-center gap-1.5 rounded-full bg-night px-3 py-1.5 text-xs font-semibold text-white dark:bg-white/15">
                            <Send className="h-3.5 w-3.5 flip-rtl" /> {ar ? 'ادفع هلّأ' : 'Pay now'}
                          </button>
                        )}
                        {on && o.every !== 'once' && (
                          <button onClick={() => act(() => post(`/api/scheduled/${o.id}/skip`), ar ? 'انتقلت للموعد الجاي' : 'Skipped')} className="inline-flex items-center gap-1.5 rounded-full px-3 py-1.5 text-xs hover:bg-sunk">
                            <FastForward className="h-3.5 w-3.5" /> <span className="hidden min-[400px]:inline">{ar ? 'تخطّى' : 'Skip'}</span>
                          </button>
                        )}
                        {!o.paused_by_admin && !o.finished_at && (
                          <button
                            onClick={() => act(() => secure.run((totp) => put(`/api/scheduled/${o.id}`, { active: !o.active, ...(totp ? { totp } : {}) })), o.active ? (ar ? 'وقّفناها' : 'Paused') : ar ? 'رجعت تشتغل' : 'Resumed')}
                            className={cx('inline-flex items-center gap-1.5 rounded-full px-3 py-1.5 text-xs font-semibold', o.active ? 'text-stitch hover:bg-stitch/10' : 'bg-olive/12 text-olive')}
                          >
                            {o.active ? <Pause className="h-3.5 w-3.5" /> : <Play className="h-3.5 w-3.5" />} {o.active ? (ar ? 'وقّف' : 'Pause') : ar ? 'شغّل' : 'Resume'}
                          </button>
                        )}
                        <span className="ms-auto flex">
                          <button onClick={() => setRuns(o)} className="grid h-8 w-8 place-items-center rounded-full text-muted hover:bg-sunk" aria-label={ar ? 'السجل' : 'History'}>
                            <History className="h-4 w-4" />
                          </button>
                          {o.active && (
                            <button onClick={() => setForm(o)} className="grid h-8 w-8 place-items-center rounded-full text-muted hover:bg-sunk" aria-label={ar ? 'عدّل' : 'Edit'}>
                              <Pencil className="h-4 w-4" />
                            </button>
                          )}
                          <button
                            onClick={async () => {
                              if (!(await confirm({ title: ar ? 'تلغي الدفعة المجدولة؟' : 'Cancel this scheduled payment?', body: ar ? 'ما رح ينبعت إشي بعد هيك.' : 'Nothing more is sent.', tone: 'danger', confirmLabel: ar ? 'ألغيها' : 'Cancel it' }))) return;
                              void act(() => del(`/api/scheduled/${o.id}`), ar ? 'انلغت' : 'Cancelled');
                            }}
                            className="grid h-8 w-8 place-items-center rounded-full text-muted hover:bg-stitch/10 hover:text-stitch"
                            aria-label={ar ? 'ألغيها' : 'Cancel'}
                          >
                            <Trash2 className="h-4 w-4" />
                          </button>
                        </span>
                      </div>
                    </motion.li>
                  );
                })}
              </AnimatePresence>
            </ul>
          )}
        </>
      ) : tab === 'incoming' ? (
        <Incoming list={d.incoming} optouts={d.optouts} onChange={() => data.reload()} />
      ) : (
        <section>
          <div className="mb-3 flex items-center justify-between gap-2">
            <p className="text-sm text-muted">{ar ? 'اللي بتبلكه ما بيقدر يحوّلك ولا تحوّله، ولا يدفع طلبات الدفع تبعتك، ولا يبعتلك دفعات مجدولة.' : 'Someone you block can’t transfer to you or receive from you, pay your requests, or schedule payments to you.'}</p>
            <Button size="sm" variant="secondary" icon={<Ban className="h-4 w-4" />} onClick={() => setBlocking(true)}>
              {ar ? 'بلّك' : 'Block'}
            </Button>
          </div>
          {!blocks.data ? (
            <Skeleton className="h-24" />
          ) : !blocks.data.blocks.length ? (
            <EmptyState icon={<Ban className="h-6 w-6" />} title={ar ? 'ما في حدا محظور' : 'Nobody is blocked'} />
          ) : (
            <ul className="divide-y divide-line rounded-3xl bg-surface shadow-card">
              {blocks.data.blocks.map((b) => (
                <li key={b.id} className="flex items-center gap-3 px-4 py-3">
                  <Avatar name={b.full_name} size={38} />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate font-semibold">{b.full_name}</span>
                    <span className="block text-xs text-muted">{b.by_team ? (ar ? 'من البنك' : 'By the bank') : `@${b.username} · ${relative(b.created_at, lang)}`}</span>
                  </span>
                  {!b.by_team && (
                    <button
                      onClick={async () => {
                        try {
                          await del(`/api/blocks/${b.id}`);
                          void blocks.reload();
                        } catch (e) {
                          toast(err(e), 'error');
                        }
                      }}
                      className="inline-flex items-center gap-1 rounded-full bg-sunk px-3 py-1.5 text-xs font-semibold"
                    >
                      <ShieldOff className="h-3.5 w-3.5" /> {ar ? 'شيل البلوك' : 'Unblock'}
                    </button>
                  )}
                </li>
              ))}
            </ul>
          )}
        </section>
      )}

      <OrderSheet value={form} onClose={() => setForm(null)} secure={secure} onDone={() => (setForm(null), void data.reload())} />
      <RunsSheet order={runs} onClose={() => setRuns(null)} />
      <BlockSheet open={blocking} onClose={() => setBlocking(false)} onDone={() => (setBlocking(false), void blocks.reload())} />
    </div>
  );
}

function Incoming({ list, optouts, onChange }: { list: any[]; optouts: any[]; onChange: () => void }) {
  const { lang, err } = useI18n();
  const ar = lang === 'ar';
  const toast = useToast();
  const [ask, setAsk] = useState<any>(null);
  const [stop, setStop] = useState(false);
  const go = async (o: any, action: 'accept' | 'decline', stopIt = false) => {
    try {
      await post(`/api/scheduled/incoming/${o.id}`, { action, stop: stopIt });
      toast(action === 'accept' ? (ar ? 'وافقت' : 'Accepted') : ar ? 'رفضت' : 'Declined');
      setAsk(null);
      onChange();
    } catch (e) {
      toast(err(e), 'error');
    }
  };
  return (
    <section className="space-y-3">
      <p className="text-sm text-muted">{ar ? 'ما حدا بيقدر يبعتلك دفعات مجدولة بلا موافقتك. لما توافق على حدا، دفعاته الجاية إلك بتمشي بلا ما يسألك مرة ثانية.' : 'Nobody can schedule payments to you without your yes. Once you accept someone, their later ones go through without asking again.'}</p>
      {!list.length ? (
        <EmptyState icon={<Inbox className="h-6 w-6" />} title={ar ? 'ما في دفعات إلك' : 'Nothing scheduled to you'} />
      ) : (
        <ul className="space-y-2.5">
          {list.map((o) => (
            <li key={o.id} className={cx('rounded-3xl bg-surface p-4 shadow-card ring-1', o.consent === 'pending' ? 'ring-gold/50' : 'ring-line')}>
              <div className="flex items-center gap-3">
                <Avatar name={o.owner_name} size={42} />
                <div className="min-w-0 flex-1">
                  <p className="truncate font-semibold">{o.owner_name}</p>
                  <p className="truncate text-xs text-muted">{[o.title, o.category].filter(Boolean).join(' · ') || relative(o.created_at, lang)}</p>
                </div>
                <div className="text-end">
                  <p className="num font-display text-lg">{money(o.amount, lang)}</p>
                  <p className="text-xs text-muted">{every(o, ar)}</p>
                </div>
              </div>
              {o.consent === 'pending' ? (
                <div className="mt-3 flex gap-2">
                  <Button size="sm" icon={<Check className="h-4 w-4" />} onClick={() => go(o, 'accept')}>
                    {ar ? 'وافق' : 'Accept'}
                  </Button>
                  <Button size="sm" variant="secondary" icon={<X className="h-4 w-4" />} onClick={() => (setStop(false), setAsk(o))}>
                    {ar ? 'ارفض' : 'Decline'}
                  </Button>
                </div>
              ) : (
                <div className="mt-3 flex items-center justify-between gap-2">
                  <Badge tone="good">{ar ? 'وافقت' : 'Accepted'}</Badge>
                  <button onClick={() => (setStop(false), setAsk(o))} className="text-xs text-stitch">
                    {ar ? 'وقّف دفعاته إلي' : 'Stop their payments'}
                  </button>
                </div>
              )}
            </li>
          ))}
        </ul>
      )}
      {optouts.length > 0 && (
        <div>
          <p className="mb-2 text-sm font-semibold">{ar ? 'ممنوعين يبعتولك دفعات مجدولة' : 'Can’t schedule payments to you'}</p>
          <ul className="flex flex-wrap gap-2">
            {optouts.map((x) => (
              <li key={x.id} className="inline-flex items-center gap-2 rounded-full bg-sunk py-1 pe-1 ps-3 text-sm">
                {x.full_name}
                <button
                  onClick={async () => {
                    await del(`/api/scheduled/optouts/${x.id}`).catch((e) => toast(err(e), 'error'));
                    onChange();
                  }}
                  className="rounded-full bg-surface px-2.5 py-1 text-xs"
                >
                  {ar ? 'اسمحله' : 'Allow'}
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}
      <Sheet open={!!ask} onClose={() => setAsk(null)} title={ar ? 'ترفض دفعاته؟' : 'Decline?'}>
        {ask && (
          <div className="space-y-4">
            <p className="text-sm text-muted">{ar ? `${ask.owner_name} بيوصله إنك رفضت، وكل دفعاته المجدولة إلك بتوقف.` : `${ask.owner_name} is told, and all their scheduled payments to you stop.`}</p>
            <label className="flex cursor-pointer items-start gap-3 rounded-2xl bg-sunk/60 p-3.5">
              <input type="checkbox" checked={stop} onChange={(e) => setStop(e.target.checked)} className="mt-0.5 h-5 w-5" />
              <span className="text-sm">
                <b className="block">{ar ? 'ما بدي يطلب مرة ثانية' : 'Don’t let them ask again'}</b>
                <span className="text-xs text-muted">{ar ? 'بتقدر تسمحله بعدين.' : 'You can allow it later.'}</span>
              </span>
            </label>
            <Button block variant="danger-solid" onClick={() => go(ask, 'decline', stop)}>
              {ar ? 'ارفض' : 'Decline'}
            </Button>
          </div>
        )}
      </Sheet>
    </section>
  );
}

function OrderSheet({ value, onClose, secure, onDone }: { value: any; onClose: () => void; secure: any; onDone: () => void }) {
  const { lang, err } = useI18n();
  const ar = lang === 'ar';
  const { accounts, primary } = useAccounts();
  const [f, setF] = useState<any>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    if (!value) {
      setF(null);
      return;
    }
    const t = new Date(Date.now() + 86400000);
    t.setHours(9, 0, 0, 0);
    setError(null);
    setF(
      value.id
        ? { id: value.id, to: value.to_name, title: value.title ?? '', category: value.category ?? '', amount: Number(value.amount).toFixed(2), every: value.every, everyDays: value.every_days ?? 10, start: localInput(new Date(value.next_run_at)), ends: value.ends, endDate: value.end_date ? String(value.end_date).slice(0, 10) : '', maxRuns: value.max_runs ?? 12, auto: value.auto, remind: value.remind_before }
        : { from: primary?.id ?? '', to: '', title: '', category: '', amount: '', every: 'month', everyDays: 10, start: localInput(t), ends: 'never', endDate: '', maxRuns: 12, auto: true, remind: 1 },
    );
  }, [value, primary?.id]);
  const [holder, setHolder] = useState<string | null>(null);
  useEffect(() => {
    if (!f || f.id || f.to.trim().length < 3) {
      setHolder(null);
      return;
    }
    const h = setTimeout(() => {
      get<{ holder: string }>(`/api/accounts/lookup?q=${encodeURIComponent(f.to.trim())}`)
        .then((r) => setHolder(r.holder))
        .catch(() => setHolder(null));
    }, 400);
    return () => clearTimeout(h);
  }, [f?.to, f?.id]);
  if (!f) return <Sheet open={false} onClose={onClose} title="">{null}</Sheet>;
  const set = (p: any) => setF({ ...f, ...p });
  const ok = Number(f.amount) > 0 && (f.id || (f.from && f.to.trim().length >= 3)) && (f.ends !== 'until' || f.endDate) && (f.ends !== 'count' || f.maxRuns > 0);
  const Seg = ({ k, opts }: { k: string; opts: [string, string][] }) => (
    <div className={cx('grid gap-1 rounded-2xl bg-sunk p-1', opts.length === 3 ? 'grid-cols-3' : 'grid-cols-2 sm:grid-cols-4')}>
      {opts.map(([v, l]) => (
        <button key={v} type="button" onClick={() => set({ [k]: v })} className={cx('rounded-xl px-2 py-2.5 text-sm transition', f[k] === v ? 'bg-surface font-semibold shadow-card' : 'text-muted')}>
          {l}
        </button>
      ))}
    </div>
  );
  const save = async () => {
    setBusy(true);
    setError(null);
    const b: any = {
      title: f.title.trim() || undefined,
      category: f.category.trim() || undefined,
      amount: Number(f.amount).toFixed(2),
      every: f.every,
      ...(f.every === 'days' ? { everyDays: Number(f.everyDays) } : {}),
      ends: f.every === 'once' ? 'never' : f.ends,
      ...(f.ends === 'until' ? { endDate: f.endDate } : {}),
      ...(f.ends === 'count' ? { maxRuns: Number(f.maxRuns) } : {}),
      auto: f.auto,
      remindBefore: f.remind,
    };
    try {
      await secure.run((totp?: string) =>
        f.id
          ? put(`/api/scheduled/${f.id}`, { ...b, title: f.title.trim() || null, category: f.category.trim() || null, nextAt: new Date(f.start).toISOString(), ...(totp ? { totp } : {}) })
          : post('/api/scheduled', { ...b, fromAccountId: f.from, to: f.to.trim(), startAt: new Date(f.start).toISOString(), ...(totp ? { totp } : {}) }),
      );
      onDone();
    } catch (e) {
      setError(err(e));
    } finally {
      setBusy(false);
    }
  };
  return (
    <Sheet open={!!value} onClose={onClose} title={f.id ? (ar ? 'عدّل الدفعة' : 'Edit payment') : ar ? 'دفعة مجدولة جديدة' : 'New scheduled payment'}>
      <div className="space-y-5">
        {!f.id && (
          <>
            {accounts.length > 1 && <Select block label={ar ? 'من حساب' : 'From account'} value={f.from} onChange={(v: string) => set({ from: v })} options={accounts.map((a) => ({ value: a.id, label: `${a.nickname ?? a.account_number} · ${money(a.balance, lang)}` }))} />}
            <BeneficiaryPicker value={f.to} onPick={(v) => set({ to: v })} />
            <label className="block">
              <span className="mb-1.5 block text-sm font-medium text-ink/80">{ar ? 'لمين؟' : 'To whom?'}</span>
              <input value={f.to} onChange={(e) => set({ to: e.target.value })} placeholder={ar ? 'IBAN، رقم الحساب أو @اسم المستخدم' : 'IBAN, account number or @username'} className="field" dir="ltr" />
              {holder && <span className="mt-1.5 inline-flex items-center gap-1 text-xs text-olive"><Check className="h-3.5 w-3.5" /> {holder}</span>}
            </label>
          </>
        )}
        <div className="grid gap-3 sm:grid-cols-2">
          <label className="block">
            <span className="mb-1.5 block text-sm font-medium text-ink/80">{ar ? 'اسم للدفعة (اختياري)' : 'Name (optional)'}</span>
            <input value={f.title} onChange={(e) => set({ title: e.target.value })} maxLength={60} placeholder={ar ? 'مصروف، قسط، إيجار…' : 'Pocket money, rent…'} className="field" />
          </label>
          <div>
            <span className="mb-1.5 block text-sm font-medium text-ink/80">{ar ? 'فئة (اختياري)' : 'Category (optional)'}</span>
            <div className="flex flex-wrap gap-1.5">
              {CATS.map(([a, e]) => {
                const v = ar ? a : e;
                return (
                  <button key={a} type="button" onClick={() => set({ category: f.category === v ? '' : v })} className={cx('rounded-full px-3 py-1.5 text-xs', f.category === v ? 'bg-night text-white dark:bg-white/20' : 'bg-sunk')}>
                    {v}
                  </button>
                );
              })}
            </div>
          </div>
        </div>
        <AmountInput label={ar ? 'المبلغ كل مرة' : 'Amount each time'} value={f.amount} onChange={(v) => set({ amount: v })} />
        <div>
          <p className="mb-1.5 text-sm font-medium text-ink/80">{ar ? 'كل قديش؟' : 'How often?'}</p>
          <Seg
            k="every"
            opts={[
              ['once', ar ? 'مرة وحدة' : 'Once'],
              ['week', ar ? 'كل أسبوع' : 'Weekly'],
              ['month', ar ? 'كل شهر' : 'Monthly'],
              ['days', ar ? 'عدد أيام' : 'Every N days'],
            ]}
          />
          {f.every === 'days' && (
            <div className="mt-2 flex items-center gap-2 text-sm">
              {ar ? 'كل' : 'Every'} <input type="number" min={1} max={365} value={f.everyDays} onChange={(e) => set({ everyDays: Number(e.target.value) })} className="field h-11 w-24 text-center" /> {ar ? 'يوم' : 'days'}
            </div>
          )}
          {f.every === 'week' && (
            <button type="button" onClick={() => set({ every: '2weeks' })} className="mt-2 text-xs text-sky">
              {ar ? 'بدك كل أسبوعين؟' : 'Every two weeks instead?'}
            </button>
          )}
        </div>
        <label className="block">
          <span className="mb-1.5 block text-sm font-medium text-ink/80">{f.every === 'once' ? (ar ? 'إمتى؟' : 'When?') : ar ? (f.id ? 'الدفعة الجاية' : 'أول دفعة') : f.id ? 'Next payment' : 'First payment'}</span>
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
                <input type="number" min={1} max={1000} value={f.maxRuns} onChange={(e) => set({ maxRuns: Number(e.target.value) })} className="field h-11 w-24 text-center" /> {ar ? 'دفعة' : 'payments'}
                {Number(f.amount) > 0 && <span className="text-muted">· {ar ? 'المجموع' : 'total'} {money((Number(f.amount) * f.maxRuns).toFixed(2), lang)}</span>}
              </div>
            )}
          </div>
        )}
        <div className="rounded-2xl bg-sunk/60 p-3.5">
          <Toggle checked={f.auto} onChange={(v) => set({ auto: v })} label={ar ? 'تنبعت لحالها بالموعد' : 'Send it by itself on time'} />
          <p className="mt-1 text-xs text-muted">{f.auto ? (ar ? 'بلا ما تتدخل — وبتوقفها وقت ما بدك.' : 'No need to do anything — pause any time.') : ar ? 'بنذكّرك وإنت بتدفعها بكبسة.' : 'We remind you; you pay with one tap.'}</p>
        </div>
        <div>
          <p className="mb-1.5 text-sm font-medium text-ink/80">{ar ? 'ذكّرني' : 'Remind me'}</p>
          <div className="flex flex-wrap gap-1.5">
            {REMIND.map(([v, a, e]) => (
              <button key={String(v)} type="button" onClick={() => set({ remind: v })} className={cx('rounded-full px-3.5 py-1.5 text-sm', f.remind === v ? 'bg-night text-white dark:bg-white/20' : 'bg-sunk')}>
                {ar ? a : e}
              </button>
            ))}
          </div>
        </div>
        {!f.id && <p className="text-xs text-muted">{ar ? 'أول مرة بتبعتله، بيوصله طلب يوافق عليه — والدفعات بتبلّش بس لما يوافق.' : 'The first time, they get a request — payments start only once they accept.'}</p>}
        <ErrorNote>{error}</ErrorNote>
        <Button block size="lg" loading={busy} disabled={!ok} icon={<Check className="h-4 w-4" />} onClick={save}>
          {f.id ? (ar ? 'احفظ' : 'Save') : ar ? 'شغّل الدفعة' : 'Start it'}
        </Button>
      </div>
    </Sheet>
  );
}

function RunsSheet({ order, onClose }: { order: any; onClose: () => void }) {
  const { lang } = useI18n();
  const ar = lang === 'ar';
  const data = useData<{ runs: any[] }>(order ? `/api/scheduled/${order.id}/runs` : null, [order?.id]);
  const ST: Record<string, [string, 'good' | 'bad' | 'neutral']> = { done: [ar ? 'انبعتت' : 'Sent', 'good'], failed: [ar ? 'ما زبطت' : 'Failed', 'bad'], skipped: [ar ? 'تخطّيتها' : 'Skipped', 'neutral'] };
  return (
    <Sheet open={!!order} onClose={onClose} title={ar ? 'السجل' : 'History'}>
      {!data.data ? (
        <Skeleton className="h-32" />
      ) : !data.data.runs.length ? (
        <EmptyState icon={<History className="h-6 w-6" />} title={ar ? 'لسا ما انبعت إشي' : 'Nothing sent yet'} />
      ) : (
        <ul className="divide-y divide-line">
          {data.data.runs.map((r) => (
            <li key={r.id} className="flex items-center justify-between gap-3 py-2.5 text-sm">
              <span className="min-w-0">
                <b className="num">{money(r.amount, lang)}</b>
                {r.error && <span className="block truncate text-xs text-stitch">{r.error}</span>}
              </span>
              <span className="text-end">
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

function BlockSheet({ open, onClose, onDone }: { open: boolean; onClose: () => void; onDone: () => void }) {
  const { lang, err } = useI18n();
  const ar = lang === 'ar';
  const toast = useToast();
  const [to, setTo] = useState('');
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    setTo('');
  }, [open]);
  return (
    <Sheet open={open} onClose={onClose} title={ar ? 'بلّك حدا' : 'Block someone'}>
      <div className="space-y-4">
        <input value={to} onChange={(e) => setTo(e.target.value)} placeholder={ar ? 'IBAN، رقم الحساب أو @اسم المستخدم' : 'IBAN, account number or @username'} className="field" dir="ltr" />
        <p className="text-xs text-muted">{ar ? 'ما بيوصله إشعار، والدفعات المجدولة بينكم بتوقف.' : 'They aren’t told; scheduled payments between you stop.'}</p>
        <Button
          block
          variant="danger-solid"
          loading={busy}
          disabled={to.trim().length < 3}
          icon={<Ban className="h-4 w-4" />}
          onClick={async () => {
            setBusy(true);
            try {
              const r = await post<{ holder: string }>('/api/blocks', { to: to.trim() });
              toast(ar ? `انبلك ${r.holder}` : `${r.holder} blocked`);
              onDone();
            } catch (e) {
              toast(err(e), 'error');
            } finally {
              setBusy(false);
            }
          }}
        >
          {ar ? 'بلّك' : 'Block'}
        </Button>
      </div>
    </Sheet>
  );
}
