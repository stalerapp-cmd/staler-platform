import { useState } from 'react';
import { Landmark, Pause, Play, Repeat, Search, Trash2, UserPlus, Users, Wallet } from 'lucide-react';
import { del, get, post } from '../lib/api';
import { useConfirm } from '../components/Confirm';
import { useI18n } from '../lib/i18n';
import { useData } from '../lib/hooks';
import { money, relative } from '../lib/format';
import { useToast } from '../components/Toast';
import { Avatar, Badge, EmptyState, PageHeader, Sheet, Skeleton, cx } from '../components/ui';

const EVERY: Record<string, [string, string]> = { once: ['مرة وحدة', 'once'], week: ['كل أسبوع', 'weekly'], '2weeks': ['كل أسبوعين', 'every 2 weeks'], month: ['كل شهر', 'monthly'], days: ['كل {n} يوم', 'every {n} days'] };
const every = (p: any, ar: boolean) => (EVERY[p.every]?.[ar ? 0 : 1] ?? p.every).replace('{n}', String(p.every_days ?? ''));

/** Admins: who sends money regularly to whom (children, staff…), and the power to pause it. */
export function AdminGroups() {
  const { lang, err } = useI18n();
  const ar = lang === 'ar';
  const toast = useToast();
  const confirm = useConfirm();
  const [who, setWho] = useState('');
  const [q, setQ] = useState('');
  const data = useData<{ owners: any[]; totals: any }>(`/api/admin/people/owners${q.trim() ? `?q=${encodeURIComponent(q.trim())}` : ''}`, [q]);
  const [sel, setSel] = useState<any>(null);
  const [detail, setDetail] = useState<any>(null);
  const open = async (o: any) => {
    setSel(o);
    setDetail(null);
    try {
      setDetail(await get(`/api/admin/people/owners/${o.id}`));
    } catch (e) {
      toast(err(e), 'error');
    }
  };
  const pause = async (id: string, paused: boolean) => {
    const note = paused ? window.prompt(ar ? 'سبب الإيقاف (بيوصل لصاحب التحويل)' : 'Reason (the owner sees it)') ?? undefined : undefined;
    try {
      await post(`/api/admin/people/payouts/${id}/pause`, { paused, ...(note ? { note } : {}) });
      toast(paused ? (ar ? 'انوقف' : 'Paused') : ar ? 'رجع يشتغل' : 'Resumed');
      void open(sel);
      void data.reload();
    } catch (e) {
      toast(err(e), 'error');
    }
  };
  const remove = async (m: any) => {
    if (!(await confirm({ title: ar ? `تشيل ${m.full_name}؟` : `Remove ${m.full_name}?`, body: ar ? 'بتوقف كل الدفعات المجدولة إله. صاحب الفئة بيوصله إشعار.' : 'All their scheduled payments stop. The owner is told.', tone: 'danger', confirmLabel: ar ? 'شيل' : 'Remove' }))) return;
    try {
      await del(`/api/admin/people/members/${m.id}`);
      void open(sel);
      void data.reload();
    } catch (e) {
      toast(err(e), 'error');
    }
  };
  const add = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      await post(`/api/admin/people/owners/${sel.id}/members`, { who: who.trim() });
      setWho('');
      toast(ar ? 'انضاف' : 'Added');
      void open(sel);
    } catch (e2) {
      toast(err(e2), 'error');
    }
  };
  const t = data.data?.totals;
  return (
    <div>
      <PageHeader title={ar ? 'الفئات والدفعات المجدولة' : 'Groups & scheduled payments'} lead={ar ? 'مين بيدفع لمين بشكل مجدول — ولاده، موظفينه، قرايبه، دين — أديش وكل قديش، مين لسا ما وافق، وكل الحركات. بتقدر توقف أي دفعة، تشيل حدا أو تضيفه.' : 'Who pays whom on a schedule — children, staff, relatives, debts — how much and how often, who hasn’t accepted yet, every movement. Pause any payment, remove or add people.'} />
      {t && (
        <div className="mb-5 grid grid-cols-3 gap-3">
          {[
            [ar ? 'تحويلات شغّالة' : 'Active transfers', t.active],
            [ar ? 'أشخاص بفئات' : 'People in groups', t.members],
            [ar ? 'انبعت آخر 30 يوم' : 'Sent, last 30 days', money(t.last30, lang)],
          ].map(([l, v], i) => (
            <div key={String(l)} className={cx('rounded-3xl p-4', i === 2 ? 'bg-night text-white dark:bg-white/[0.07]' : 'bg-surface shadow-card')}>
              <p className={cx('text-xs', i === 2 ? 'text-white/65' : 'text-muted')}>{l}</p>
              <p className="num mt-1 font-display text-xl sm:text-2xl">{v}</p>
            </div>
          ))}
        </div>
      )}
      <label className="relative mb-4 block">
        <Search className="pointer-events-none absolute start-4 top-1/2 h-5 w-5 -translate-y-1/2 text-muted" />
        <input value={q} onChange={(e) => setQ(e.target.value)} placeholder={ar ? 'دوّر بالاسم أو الإيميل' : 'Search name or e-mail'} className="field h-12 rounded-2xl ps-12" type="search" />
      </label>
      {!data.data ? (
        <Skeleton className="h-64 rounded-3xl" />
      ) : !data.data.owners.length ? (
        <EmptyState icon={<Users className="h-6 w-6" />} title={ar ? 'ما حدا عامل دفعات مجدولة لسا' : 'No scheduled payments yet'} />
      ) : (
        <ul className="card divide-y divide-line overflow-hidden">
          {data.data.owners.map((o) => (
            <li key={o.id}>
              <button onClick={() => open(o)} className="flex w-full items-center gap-3 px-4 py-3 text-start transition hover:bg-sunk/60">
                <Avatar name={o.full_name} src={o.profile_image} size={42} />
                <span className="min-w-0 flex-1">
                  <span className="block truncate font-semibold">{o.full_name}</span>
                  <span className="block truncate text-xs text-muted">
                    {ar ? `${o.groups} فئة · ${o.members} شخص · ${o.active_payouts} تحويل شغّال` : `${o.groups} groups · ${o.members} people · ${o.active_payouts} active`}
                    {o.paused > 0 && <span className="text-stitch">{ar ? ` · ${o.paused} موقوف` : ` · ${o.paused} paused`}</span>}
                    {o.failed30 > 0 && <span className="text-stitch">{ar ? ` · ${o.failed30} فشل` : ` · ${o.failed30} failed`}</span>}
                  </span>
                </span>
                <span className="num shrink-0 text-sm font-semibold">{money(o.last30, lang)}</span>
              </button>
            </li>
          ))}
        </ul>
      )}

      <Sheet open={!!sel} onClose={() => setSel(null)} title={sel?.full_name ?? ''} wide>
        {!detail ? (
          <Skeleton className="h-60" />
        ) : (
          <div className="space-y-5">
            <form onSubmit={add} className="flex gap-2">
              <input value={who} onChange={(e) => setWho(e.target.value)} placeholder={ar ? 'ضيف حدا لناسه: رقم محفظة أو إيميل' : 'Add someone: wallet ID or e-mail'} className="field flex-1" dir="auto" />
              <button disabled={who.trim().length < 3} className="inline-flex shrink-0 items-center gap-1.5 rounded-2xl bg-night px-4 text-sm font-semibold text-white disabled:opacity-50 dark:bg-white/15">
                <UserPlus className="h-4 w-4" /> {ar ? 'ضيف' : 'Add'}
              </button>
            </form>
            {detail.groups.map((g: any) => (
              <section key={g.id ?? 'none'}>
                <p className="mb-2 font-semibold">
                  {g.name ?? (ar ? 'بلا فئة' : 'No group')} {g.workplace && <span className="text-sm font-normal text-muted">· {g.workplace}</span>}
                </p>
                <ul className="space-y-2">
                  {g.members.map((m: any) => (
                    <li key={m.id} className="rounded-2xl p-3 ring-1 ring-line">
                      <div className="flex items-center gap-2.5">
                        <Avatar name={m.full_name} src={m.profile_image} size={34} />
                        <span className="min-w-0 flex-1">
                          <span className="block truncate text-sm font-semibold">
                            {m.full_name}
                            {m.role_title && <span className="font-normal text-muted"> · {m.role_title}</span>}
                          </span>
                          <span className="block text-xs text-muted">{ar ? `استلم ${money(m.paid_total ?? 0, lang)}` : `received ${money(m.paid_total ?? 0, lang)}`}</span>
                        </span>
                        {m.consent === 'pending' && <Badge tone="warn">{ar ? 'بستنى موافقته' : 'Not accepted yet'}</Badge>}
                        <button onClick={() => remove(m)} className="grid h-8 w-8 place-items-center rounded-full text-muted hover:bg-stitch/10 hover:text-stitch" aria-label={ar ? 'شيل' : 'Remove'}>
                          <Trash2 className="h-4 w-4" />
                        </button>
                      </div>
                      {(m.payouts ?? []).map((p: any) => (
                        <div key={p.id} className="mt-2 flex flex-wrap items-center gap-2 rounded-xl bg-sunk/60 px-3 py-2 text-sm">
                          <Repeat className="h-4 w-4 text-olive" />
                          <b className="num">{money(p.amount, lang)}</b>
                          <span className="text-muted">{every(p, ar)}</span>
                          <span className="inline-flex items-center gap-1 text-xs text-muted">
                            {p.source === 'bank' ? <Landmark className="h-3.5 w-3.5" /> : <Wallet className="h-3.5 w-3.5" />}→{p.dest === 'bank' ? <Landmark className="h-3.5 w-3.5" /> : <Wallet className="h-3.5 w-3.5" />}
                          </span>
                          {p.paused_by_admin ? <Badge tone="bad">{ar ? 'موقوف من الإدارة' : 'Paused by admin'}</Badge> : p.active ? <Badge tone="good">{ar ? 'شغّال' : 'Active'}</Badge> : <Badge tone="neutral">{ar ? 'موقوف من صاحبه' : 'Paused by owner'}</Badge>}
                          <button onClick={() => pause(p.id, !p.paused_by_admin)} className="ms-auto inline-flex items-center gap-1 rounded-full bg-surface px-3 py-1 text-xs font-semibold ring-1 ring-line">
                            {p.paused_by_admin ? <Play className="h-3.5 w-3.5" /> : <Pause className="h-3.5 w-3.5" />} {p.paused_by_admin ? (ar ? 'شغّله' : 'Resume') : ar ? 'أوقفه' : 'Pause'}
                          </button>
                        </div>
                      ))}
                    </li>
                  ))}
                </ul>
              </section>
            ))}
            <section>
              <p className="mb-2 font-semibold">{ar ? 'كل الحركات' : 'All movements'}</p>
              <ul className="divide-y divide-line rounded-2xl ring-1 ring-line">
                {detail.runs.map((r: any) => (
                  <li key={r.id} className="flex items-center justify-between gap-2 px-3 py-2 text-sm">
                    <span className="min-w-0 truncate">
                      {r.full_name} · <b className="num">{money(r.amount, lang)}</b> <span className="text-xs text-muted">{r.kind === 'bonus' ? (ar ? 'مكافأة' : 'bonus') : ''}</span>
                    </span>
                    <span className="shrink-0 text-end">
                      <Badge tone={r.status === 'done' ? 'good' : r.status === 'waiting' ? 'warn' : 'bad'}>{r.status}</Badge>
                      <span className="block text-[11px] text-muted">{relative(r.ran_at, lang)}</span>
                    </span>
                  </li>
                ))}
              </ul>
            </section>
          </div>
        )}
      </Sheet>
    </div>
  );
}
