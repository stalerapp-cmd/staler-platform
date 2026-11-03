import { useMemo, useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import {
  ArrowDown,
  ArrowUp,
  Baby,
  Briefcase,
  CalendarClock,
  Gift,
  HeartHandshake,
  History,
  Landmark,
  Pause,
  Pencil,
  Play,
  Plus,
  Repeat,
  Star,
  Trash2,
  UserPlus,
  Users,
  Wallet,
  type LucideIcon,
} from 'lucide-react';
import { del, post, put } from '../lib/api';
import { useI18n } from '../lib/i18n';
import { useData } from '../lib/hooks';
import { money, relative } from '../lib/format';
import { useToast } from '../components/Toast';
import { useConfirm } from '../components/Confirm';
import { useSecureAction } from '../components/SecureAction';
import { AmountInput, Avatar, Badge, Button, EmptyState, ErrorNote, Field, PageHeader, Sheet, Skeleton, Toggle, cx } from '../components/ui';

const KIND: Record<string, { icon: LucideIcon; c: string; ar: string; en: string }> = {
  family: { icon: Baby, c: 'bg-sky/10 text-sky', ar: 'ولادي', en: 'My children' },
  staff: { icon: Briefcase, c: 'bg-olive/12 text-olive', ar: 'موظفيني', en: 'My staff' },
  relatives: { icon: HeartHandshake, c: 'bg-stitch/10 text-stitch', ar: 'قرايبي', en: 'My relatives' },
  custom: { icon: Users, c: 'bg-gold/15 text-[rgb(150_105_10)] dark:text-gold', ar: 'فئة', en: 'Group' },
};
const EVERY: Record<string, [string, string]> = { week: ['كل أسبوع', 'Every week'], '2weeks': ['كل أسبوعين', 'Every 2 weeks'], month: ['كل شهر', 'Every month'] };

const monthsSince = (d?: string | null) => (d ? Math.max(0, Math.floor((Date.now() - new Date(d).getTime()) / (30.44 * 86400000))) : null);
const tenure = (m: number | null, ar: boolean) => {
  if (m == null) return null;
  const y = Math.floor(m / 12);
  const mm = m % 12;
  if (ar) return y ? `${y} ${y === 1 ? 'سنة' : y === 2 ? 'سنتين' : 'سنين'}${mm ? ` و${mm} شهر` : ''}` : `${mm} شهر`;
  return y ? `${y}y${mm ? ` ${mm}m` : ''}` : `${mm}m`;
};

/** Your people in groups you name, and money that goes to them on its own. */
export default function People() {
  const { lang, err } = useI18n();
  const ar = lang === 'ar';
  const toast = useToast();
  const confirm = useConfirm();
  const secure = useSecureAction();
  const data = useData<{ groups: any[]; totals: { last30: string; monthly: string }; bankLinked: boolean }>('/api/people/groups');
  const [gid, setGid] = useState<string | null>(null);
  const [groupForm, setGroupForm] = useState<any>(null);
  const [addOpen, setAddOpen] = useState(false);
  const [person, setPerson] = useState({ who: '', nickname: '', roleTitle: '', since: '', invite: false });
  const [pay, setPay] = useState<any>(null);
  const [bonus, setBonus] = useState<any>(null);
  const [edit, setEdit] = useState<any>(null);
  const [runs, setRuns] = useState<any>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const groups = data.data?.groups ?? [];
  const g = groups.find((x) => x.id === gid) ?? groups[0];
  const members = useMemo(() => [...(g?.members ?? [])].sort((a, b) => Number(b.favourite) - Number(a.favourite) || a.sort - b.sort), [g]);

  const act = async (fn: () => Promise<unknown>, ok?: string) => {
    setBusy(true);
    setError(null);
    try {
      await fn();
      if (ok) toast(ok);
      await data.reload();
      return true;
    } catch (e) {
      setError(err(e));
      toast(err(e), 'error');
      return false;
    } finally {
      setBusy(false);
    }
  };

  const newGroup = (kind: string) => setGroupForm({ name: kind === 'custom' ? '' : KIND[kind]![ar ? 'ar' : 'en'], kind, workplace: '', seniorAfterMonths: kind === 'staff' ? 24 : null });
  const move = async (i: number, d: -1 | 1) => {
    const list = members.map((m) => m.id);
    const j = i + d;
    if (j < 0 || j >= list.length) return;
    [list[i], list[j]] = [list[j]!, list[i]!];
    await act(() => put('/api/people/members-order', { ids: list }));
  };

  return (
    <div>
      <PageHeader title={ar ? 'ناسي والتحويلات' : 'My people & transfers'} lead={ar ? 'رتّب ناسك بفئات (ولادك، موظفينك، قرايبك أو فئة بتسميها)، وحوّلهم مصاري لحالها كل فترة — من محفظتك أو بنكك، لمحفظتهم أو بنكهم. وبتوقفها وقت ما بدك.' : 'Sort your people into groups (children, staff, relatives or your own), and send them money on a schedule — from your wallet or bank, to their wallet or bank. Stop whenever you like.'} />
      {secure.element}

      {!data.data ? (
        <Skeleton className="h-72 rounded-3xl" />
      ) : (
        <>
          <div className="mb-5 grid grid-cols-2 gap-3 sm:grid-cols-3">
            <div className="rounded-3xl bg-night p-4 text-white dark:bg-white/[0.07]">
              <p className="text-xs text-white/65">{ar ? 'بيطلع شهريًا تقريبًا' : 'Goes out per month (about)'}</p>
              <p className="num mt-1 font-display text-2xl">{money(data.data.totals.monthly, lang)}</p>
            </div>
            <div className="rounded-3xl bg-surface p-4 shadow-card">
              <p className="text-xs text-muted">{ar ? 'انبعت آخر 30 يوم' : 'Sent in the last 30 days'}</p>
              <p className="num mt-1 font-display text-2xl">{money(data.data.totals.last30, lang)}</p>
            </div>
            <div className="col-span-2 rounded-3xl bg-surface p-4 shadow-card sm:col-span-1">
              <p className="text-xs text-muted">{ar ? 'ناسك' : 'Your people'}</p>
              <p className="num mt-1 font-display text-2xl">{groups.reduce((s, x) => s + x.members.length, 0)}</p>
            </div>
          </div>

          {/* groups */}
          <div className="-mx-4 mb-5 flex gap-2 overflow-x-auto px-4 pb-1 [scrollbar-width:none] sm:mx-0 sm:flex-wrap sm:px-0">
            {groups.map((x) => {
              const K = KIND[x.kind] ?? KIND.custom!;
              const on = g?.id === x.id;
              return (
                <button key={x.id} onClick={() => setGid(x.id)} className={cx('relative flex shrink-0 items-center gap-2 rounded-2xl px-3.5 py-2.5 text-sm transition', on ? 'text-white' : 'bg-surface ring-1 ring-line hover:ring-ink/25')}>
                  {on && <motion.span layoutId="ppl-group" className="absolute inset-0 rounded-2xl bg-night shadow-lift dark:bg-white/15" />}
                  <span className={cx('relative grid h-7 w-7 place-items-center rounded-lg', on ? 'bg-white/15' : K.c)}>
                    <K.icon className="h-4 w-4" />
                  </span>
                  <span className="relative font-medium">{x.name}</span>
                  <span className={cx('num relative rounded-full px-1.5 text-xs', on ? 'bg-white/20' : 'bg-sunk')}>{x.members.length}</span>
                </button>
              );
            })}
            {(['family', 'staff', 'relatives'] as const)
              .filter((k) => !groups.some((x) => x.kind === k))
              .map((k) => {
                const K = KIND[k]!;
                return (
                  <button key={k} onClick={() => newGroup(k)} className="flex shrink-0 items-center gap-2 rounded-2xl border border-dashed border-line px-3.5 py-2.5 text-sm text-ink/80 transition hover:border-ink/40">
                    <K.icon className="h-4 w-4" /> {ar ? K.ar : K.en} <Plus className="h-3.5 w-3.5" />
                  </button>
                );
              })}
            <button onClick={() => newGroup('custom')} className="flex shrink-0 items-center gap-2 rounded-2xl border border-dashed border-line px-3.5 py-2.5 text-sm text-ink/80 transition hover:border-ink/40">
              <Plus className="h-4 w-4" /> {ar ? 'فئة جديدة' : 'New group'}
            </button>
          </div>

          {!g ? (
            <EmptyState icon={<Users className="h-6 w-6" />} title={ar ? 'ابدأ بفئة — ولادك، موظفينك، أو اسم بتختاره' : 'Start with a group — children, staff, or a name you choose'} />
          ) : (
            <section className="card overflow-hidden">
              <div className="flex flex-wrap items-center justify-between gap-3 border-b border-line p-4 sm:px-5">
                <div className="min-w-0">
                  <h2 className="truncate text-lg font-semibold">{g.name}</h2>
                  <p className="text-xs text-muted">
                    {[g.workplace, g.senior_after_months ? (ar ? `قديم بعد ${g.senior_after_months} شهر` : `long-standing after ${g.senior_after_months} months`) : null].filter(Boolean).join(' · ') || (ar ? 'فئة خاصة فيك' : 'Your own group')}
                  </p>
                </div>
                <div className="flex gap-2">
                  <Button size="sm" variant="secondary" icon={<Pencil className="h-4 w-4" />} onClick={() => setGroupForm({ id: g.id, name: g.name, kind: g.kind, workplace: g.workplace ?? '', seniorAfterMonths: g.senior_after_months })}>
                    {ar ? 'عدّل' : 'Edit'}
                  </Button>
                  <Button size="sm" icon={<UserPlus className="h-4 w-4" />} onClick={() => setAddOpen(true)}>
                    {ar ? 'أضف شخص' : 'Add person'}
                  </Button>
                </div>
              </div>
              {!members.length ? (
                <p className="p-8 text-center text-sm text-muted">{ar ? 'لسا ما في حدا بهالفئة.' : 'Nobody in this group yet.'}</p>
              ) : (
                <ul className="divide-y divide-line">
                  <AnimatePresence initial={false}>
                    {members.map((m, i) => {
                      const months = monthsSince(m.since);
                      const senior = g.senior_after_months && months != null ? months >= g.senior_after_months : null;
                      return (
                        <motion.li key={m.id} layout initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="p-4 sm:px-5">
                          <div className="flex items-start gap-3">
                            <Avatar name={m.nickname || m.full_name} src={m.profile_image} size={46} />
                            <div className="min-w-0 flex-1">
                              <div className="flex flex-wrap items-center gap-1.5">
                                <span className="truncate font-semibold">{m.nickname || m.full_name}</span>
                                {m.role_title && <Badge tone="neutral">{m.role_title}</Badge>}
                                {senior != null && <Badge tone={senior ? 'good' : 'info'}>{senior ? (ar ? 'قديم' : 'Long-standing') : ar ? 'جديد' : 'New'}</Badge>}
                                {m.link_status === 'accepted' && <Badge tone="good">{ar ? 'وافق يبين بملفه' : 'Shows on profile'}</Badge>}
                                {m.link_status === 'invited' && <Badge tone="warn">{ar ? 'بستنى موافقته' : 'Invitation sent'}</Badge>}
                              </div>
                              <p className="truncate text-xs text-muted">
                                {[m.nickname ? m.full_name : null, months != null ? (ar ? `صرله ${tenure(months, ar)}` : `${tenure(months, ar)} with you`) : null, Number(m.paid_total) > 0 ? (ar ? `استلم ${money(m.paid_total, lang)}` : `received ${money(m.paid_total, lang)}`) : null].filter(Boolean).join(' · ')}
                              </p>
                              {m.payouts.map((p: any) => (
                                <div key={p.id} className={cx('mt-2 flex flex-wrap items-center gap-2 rounded-2xl px-3 py-2 text-sm ring-1', p.active && !p.paused_by_admin ? 'bg-olive/[0.06] ring-olive/20' : 'bg-sunk/60 ring-line')}>
                                  <Repeat className="h-4 w-4 text-olive" />
                                  <b className="num">{money(p.amount, lang)}</b>
                                  <span className="text-muted">{EVERY[p.every]![ar ? 0 : 1]}</span>
                                  <span className="inline-flex items-center gap-1 text-xs text-muted">
                                    {p.source === 'bank' ? <Landmark className="h-3.5 w-3.5" /> : <Wallet className="h-3.5 w-3.5" />}→{p.dest === 'bank' ? <Landmark className="h-3.5 w-3.5" /> : <Wallet className="h-3.5 w-3.5" />}
                                  </span>
                                  {p.paused_by_admin ? (
                                    <Badge tone="bad">{ar ? 'موقوف من الإدارة' : 'Paused by the team'}</Badge>
                                  ) : p.active ? (
                                    <span className="inline-flex items-center gap-1 text-xs text-muted">
                                      <CalendarClock className="h-3.5 w-3.5" /> {relative(p.next_run_at, lang)}
                                    </span>
                                  ) : (
                                    <Badge tone="neutral">{ar ? 'موقوف' : 'Paused'}</Badge>
                                  )}
                                  {p.fail_count > 0 && <Badge tone="bad">{ar ? 'آخر محاولة ما زبطت' : 'Last try failed'}</Badge>}
                                  <span className="ms-auto flex gap-1">
                                    {!p.paused_by_admin && (
                                      <button
                                        onClick={() => act(() => secure.run((totp) => put(`/api/people/payouts/${p.id}`, { active: !p.active, ...(totp ? { totp } : {}) })), p.active ? (ar ? 'وقّفناه' : 'Paused') : ar ? 'رجع يشتغل' : 'Running again')}
                                        className="grid h-8 w-8 place-items-center rounded-full hover:bg-surface"
                                        title={p.active ? (ar ? 'وقّف' : 'Pause') : ar ? 'شغّل' : 'Resume'}
                                      >
                                        {p.active ? <Pause className="h-4 w-4" /> : <Play className="h-4 w-4" />}
                                      </button>
                                    )}
                                    <button onClick={() => setPay({ member: m, id: p.id, amount: Number(p.amount).toFixed(2), every: p.every, source: p.source, dest: p.dest, note: p.note ?? '', raise: '' })} className="grid h-8 w-8 place-items-center rounded-full hover:bg-surface" title={ar ? 'عدّل' : 'Edit'}>
                                      <Pencil className="h-4 w-4" />
                                    </button>
                                    <button
                                      onClick={async () => {
                                        if (!(await confirm({ title: ar ? 'توقف التحويل نهائيًا؟' : 'Stop this transfer?', body: ar ? 'ما رح ينبعت إشي بعد هيك.' : 'Nothing more will be sent.', tone: 'danger', confirmLabel: ar ? 'أوقفه' : 'Stop' }))) return;
                                        await act(() => del(`/api/people/payouts/${p.id}`));
                                      }}
                                      className="grid h-8 w-8 place-items-center rounded-full text-stitch hover:bg-stitch/10"
                                      title={ar ? 'أوقفه نهائيًا' : 'Stop'}
                                    >
                                      <Trash2 className="h-4 w-4" />
                                    </button>
                                  </span>
                                  {p.admin_note && p.paused_by_admin && <p className="w-full text-xs text-stitch">{p.admin_note}</p>}
                                </div>
                              ))}
                              <div className="mt-2.5 flex flex-wrap gap-1.5">
                                <button onClick={() => setPay({ member: m, amount: '', every: 'month', source: 'wallet', dest: 'wallet', note: '', start: '' })} className="inline-flex items-center gap-1.5 rounded-full bg-night px-3 py-1.5 text-xs font-medium text-white dark:bg-white/15">
                                  <Repeat className="h-3.5 w-3.5" /> {ar ? 'تحويل دوري' : 'Recurring transfer'}
                                </button>
                                <button onClick={() => setBonus({ member: m, amount: '', source: 'wallet', note: '' })} className="inline-flex items-center gap-1.5 rounded-full bg-gold/15 px-3 py-1.5 text-xs font-medium text-[rgb(150_105_10)] dark:text-gold">
                                  <Gift className="h-3.5 w-3.5" /> {ar ? 'مكافأة' : 'Bonus'}
                                </button>
                                <button onClick={() => setRuns(m)} className="inline-flex items-center gap-1.5 rounded-full bg-sunk px-3 py-1.5 text-xs">
                                  <History className="h-3.5 w-3.5" /> {ar ? 'السجل' : 'History'}
                                </button>
                                <button onClick={() => setEdit({ ...m, since: m.since ? String(m.since).slice(0, 10) : '', nickname: m.nickname ?? '', roleTitle: m.role_title ?? '', groupId: m.group_id })} className="inline-flex items-center gap-1.5 rounded-full bg-sunk px-3 py-1.5 text-xs">
                                  <Pencil className="h-3.5 w-3.5" /> {ar ? 'تفاصيل' : 'Details'}
                                </button>
                              </div>
                            </div>
                            <div className="flex shrink-0 flex-col items-center gap-0.5">
                              <button onClick={() => act(() => put(`/api/people/members/${m.id}`, { favourite: !m.favourite }))} className="grid h-8 w-8 place-items-center rounded-full hover:bg-sunk" title={ar ? 'مفضّل' : 'Favourite'}>
                                <Star className={cx('h-4 w-4', m.favourite ? 'fill-gold text-gold' : 'text-muted')} />
                              </button>
                              <button disabled={i === 0} onClick={() => move(i, -1)} className="grid h-7 w-7 place-items-center rounded-full text-muted hover:bg-sunk disabled:opacity-30" aria-label="↑">
                                <ArrowUp className="h-3.5 w-3.5" />
                              </button>
                              <button disabled={i === members.length - 1} onClick={() => move(i, 1)} className="grid h-7 w-7 place-items-center rounded-full text-muted hover:bg-sunk disabled:opacity-30" aria-label="↓">
                                <ArrowDown className="h-3.5 w-3.5" />
                              </button>
                            </div>
                          </div>
                        </motion.li>
                      );
                    })}
                  </AnimatePresence>
                </ul>
              )}
            </section>
          )}
        </>
      )}

      {/* group form */}
      <Sheet open={!!groupForm} onClose={() => setGroupForm(null)} title={groupForm?.id ? (ar ? 'عدّل الفئة' : 'Edit group') : ar ? 'فئة جديدة' : 'New group'}>
        {groupForm && (
          <div className="space-y-4">
            <Field label={ar ? 'اسم الفئة' : 'Group name'} value={groupForm.name} onChange={(e) => setGroupForm({ ...groupForm, name: e.target.value })} maxLength={40} placeholder={ar ? 'مثلًا: فريق المحل، الشغيلة، ولادي' : 'e.g. Shop team, My children'} />
            <div className="flex flex-wrap gap-1.5">
              {Object.entries(KIND).map(([k, K]) => (
                <button key={k} type="button" onClick={() => setGroupForm({ ...groupForm, kind: k })} className={cx('inline-flex items-center gap-1.5 rounded-full px-3 py-1.5 text-sm', groupForm.kind === k ? 'bg-night text-white dark:bg-white/20' : 'bg-sunk')}>
                  <K.icon className="h-4 w-4" /> {k === 'custom' ? (ar ? 'غير' : 'Other') : ar ? K.ar : K.en}
                </button>
              ))}
            </div>
            <Field label={ar ? 'اسم مكان الشغل (اختياري — بيبين بملفاتهم إذا وافقوا)' : 'Workplace name (optional — shown on their profiles if they agree)'} value={groupForm.workplace} onChange={(e) => setGroupForm({ ...groupForm, workplace: e.target.value })} maxLength={80} />
            <Field
              label={ar ? 'بعد كم شهر بيصير «قديم»؟ (اختياري)' : 'After how many months is someone “long-standing”? (optional)'}
              type="number"
              min={1}
              value={groupForm.seniorAfterMonths ?? ''}
              onChange={(e) => setGroupForm({ ...groupForm, seniorAfterMonths: e.target.value ? Number(e.target.value) : null })}
            />
            <ErrorNote>{error}</ErrorNote>
            <div className="flex gap-2">
              <Button
                className="flex-1"
                loading={busy}
                disabled={!groupForm.name.trim()}
                onClick={async () => {
                  const body = { name: groupForm.name.trim(), kind: groupForm.kind, workplace: groupForm.workplace.trim() || null, seniorAfterMonths: groupForm.seniorAfterMonths || null };
                  const ok = await act(async () => {
                    if (groupForm.id) await put(`/api/people/groups/${groupForm.id}`, body);
                    else setGid((await post<{ group: any }>('/api/people/groups', body)).group.id);
                  });
                  if (ok) setGroupForm(null);
                }}
              >
                {ar ? 'احفظ' : 'Save'}
              </Button>
              {groupForm.id && (
                <Button
                  variant="secondary"
                  onClick={async () => {
                    if (!(await confirm({ title: ar ? 'تحذف الفئة؟' : 'Delete the group?', body: ar ? 'بتنحذف معها تحويلاتها الدورية.' : 'Its recurring transfers stop too.', tone: 'danger', confirmLabel: ar ? 'احذف' : 'Delete' }))) return;
                    if (await act(() => del(`/api/people/groups/${groupForm.id}`))) setGroupForm(null);
                  }}
                >
                  <Trash2 className="h-4 w-4" />
                </Button>
              )}
            </div>
          </div>
        )}
      </Sheet>

      {/* add person */}
      <Sheet open={addOpen} onClose={() => setAddOpen(false)} title={ar ? `أضف لـ «${g?.name ?? ''}»` : `Add to “${g?.name ?? ''}”`}>
        <div className="space-y-4">
          <Field label={ar ? 'رقم المحفظة أو الإيميل' : 'Wallet ID or e-mail'} value={person.who} onChange={(e) => setPerson({ ...person, who: e.target.value })} dir="ltr" />
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label={ar ? 'اسم بتحبه (اختياري)' : 'A name you like (optional)'} value={person.nickname} onChange={(e) => setPerson({ ...person, nickname: e.target.value })} maxLength={60} />
            <Field label={ar ? 'الصفة (اختياري)' : 'Title (optional)'} value={person.roleTitle} onChange={(e) => setPerson({ ...person, roleTitle: e.target.value })} maxLength={60} placeholder={ar ? 'خبّاز، محاسب، ابني…' : 'Baker, accountant, son…'} />
          </div>
          <Field label={ar ? 'من إمتى معك؟ (اختياري)' : 'With you since (optional)'} type="date" value={person.since} onChange={(e) => setPerson({ ...person, since: e.target.value })} />
          <div className="rounded-2xl bg-sunk/60 p-3">
            <Toggle checked={person.invite} onChange={(v) => setPerson({ ...person, invite: v })} label={ar ? 'اطلب منه يبين بملفه إنه تابع لهون' : 'Ask them to show it on their profile'} />
            <p className="mt-1 text-xs text-muted">{ar ? 'بيوصله طلب؛ إذا وافق بيبين بملفه «هون» ومن قديش. وبيقدر يخفيه.' : 'They get a request; if they accept, their profile shows it and for how long. They can hide it.'}</p>
          </div>
          <ErrorNote>{error}</ErrorNote>
          <Button
            block
            loading={busy}
            disabled={person.who.trim().length < 3}
            onClick={async () => {
              const ok = await act(() => post(`/api/people/groups/${g.id}/members`, { who: person.who.trim(), nickname: person.nickname.trim() || undefined, roleTitle: person.roleTitle.trim() || undefined, since: person.since || undefined, invite: person.invite }), ar ? 'انضاف' : 'Added');
              if (ok) {
                setAddOpen(false);
                setPerson({ who: '', nickname: '', roleTitle: '', since: '', invite: false });
              }
            }}
          >
            {ar ? 'أضف' : 'Add'}
          </Button>
        </div>
      </Sheet>

      {/* recurring transfer */}
      <Sheet open={!!pay} onClose={() => setPay(null)} title={pay?.id ? (ar ? 'عدّل التحويل الدوري' : 'Edit recurring transfer') : ar ? `تحويل دوري لـ ${pay?.member?.nickname || pay?.member?.full_name || ''}` : 'Recurring transfer'}>
        {pay && (
          <div className="space-y-4">
            <AmountInput label={ar ? 'المبلغ' : 'Amount'} value={pay.amount} onChange={(v) => setPay({ ...pay, amount: v })} />
            {pay.id && (
              <div className="flex flex-wrap items-center gap-1.5">
                <span className="text-xs text-muted">{ar ? 'زيادة:' : 'Raise:'}</span>
                {[5, 10, 15, 20].map((n) => (
                  <button key={n} type="button" onClick={() => setPay({ ...pay, amount: (Number(pay.amount) * (1 + n / 100)).toFixed(2) })} className="rounded-full bg-olive/12 px-3 py-1 text-xs font-semibold text-olive">
                    +{n}%
                  </button>
                ))}
              </div>
            )}
            <div className="flex flex-wrap gap-1.5">
              {Object.entries(EVERY).map(([k, l]) => (
                <button key={k} type="button" onClick={() => setPay({ ...pay, every: k })} className={cx('rounded-full px-3.5 py-1.5 text-sm', pay.every === k ? 'bg-night text-white dark:bg-white/20' : 'bg-sunk')}>
                  {l[ar ? 0 : 1]}
                </button>
              ))}
            </div>
            <div className="grid grid-cols-2 gap-3">
              {(
                [
                  ['source', ar ? 'من' : 'From', ar ? 'محفظتي' : 'My wallet', ar ? 'بنكي' : 'My bank'],
                  ['dest', ar ? 'إلى' : 'To', ar ? 'محفظته' : 'Their wallet', ar ? 'بنكه' : 'Their bank'],
                ] as const
              ).map(([k, l, a, b]) => (
                <div key={k}>
                  <p className="mb-1.5 text-xs font-medium text-muted">{l}</p>
                  <div className="grid grid-cols-2 gap-1 rounded-2xl bg-sunk p-1">
                    {(['wallet', 'bank'] as const).map((v) => (
                      <button
                        key={v}
                        type="button"
                        disabled={k === 'source' && v === 'bank' && !data.data?.bankLinked}
                        onClick={() => setPay({ ...pay, [k]: v })}
                        className={cx('flex items-center justify-center gap-1 rounded-xl py-2 text-xs transition disabled:opacity-40', pay[k] === v ? 'bg-surface font-semibold shadow-card' : 'text-muted')}
                      >
                        {v === 'bank' ? <Landmark className="h-3.5 w-3.5" /> : <Wallet className="h-3.5 w-3.5" />} {v === 'wallet' ? a : b}
                      </button>
                    ))}
                  </div>
                </div>
              ))}
            </div>
            {!data.data?.bankLinked && <p className="text-xs text-muted">{ar ? 'لتحوّل من بنكك، اربط حسابك البنكي أول.' : 'Link your bank account to send from it.'}</p>}
            {pay.dest === 'bank' && <p className="text-xs text-muted">{ar ? 'إذا ما عنده بنك مربوط، المبلغ بيضل بمحفظته.' : 'If they have no linked bank, it stays in their wallet.'}</p>}
            {!pay.id && <Field label={ar ? 'أول تحويل (فاضي = هلّأ)' : 'First transfer (empty = now)'} type="datetime-local" value={pay.start} onChange={(e) => setPay({ ...pay, start: e.target.value })} />}
            <Field label={ar ? 'ملاحظة بتوصله (اختياري)' : 'A note they see (optional)'} value={pay.note} onChange={(e) => setPay({ ...pay, note: e.target.value })} maxLength={120} placeholder={ar ? 'راتب، مصروف…' : 'Salary, allowance…'} />
            <ErrorNote>{error}</ErrorNote>
            <Button
              block
              size="lg"
              loading={busy}
              disabled={!(Number(pay.amount) > 0)}
              onClick={async () => {
                const body = { amount: Number(pay.amount).toFixed(2), every: pay.every, source: pay.source, dest: pay.dest, note: pay.note.trim() || undefined };
                const ok = await act(() =>
                  secure.run((totp) =>
                    pay.id
                      ? put(`/api/people/payouts/${pay.id}`, { ...body, note: pay.note.trim() || null, ...(totp ? { totp } : {}) })
                      : post(`/api/people/members/${pay.member.id}/payouts`, { ...body, ...(pay.start ? { startAt: new Date(pay.start).toISOString() } : {}), ...(totp ? { totp } : {}) }),
                  ),
                ar ? 'انحفظ' : 'Saved',
                );
                if (ok) setPay(null);
              }}
            >
              {pay.id ? (ar ? 'احفظ' : 'Save') : ar ? 'شغّل التحويل' : 'Start transfers'}
            </Button>
          </div>
        )}
      </Sheet>

      {/* bonus */}
      <Sheet open={!!bonus} onClose={() => setBonus(null)} title={ar ? `مكافأة لـ ${bonus?.member?.nickname || bonus?.member?.full_name || ''}` : 'Bonus'}>
        {bonus && (
          <div className="space-y-4">
            <AmountInput label={ar ? 'المبلغ' : 'Amount'} value={bonus.amount} onChange={(v) => setBonus({ ...bonus, amount: v })} />
            {bonus.member.payouts?.[0] && (
              <div className="flex flex-wrap items-center gap-1.5">
                <span className="text-xs text-muted">{ar ? 'نسبة من التحويل الدوري:' : 'Share of the regular amount:'}</span>
                {[10, 25, 50, 100].map((n) => (
                  <button key={n} type="button" onClick={() => setBonus({ ...bonus, amount: ((Number(bonus.member.payouts[0].amount) * n) / 100).toFixed(2) })} className="rounded-full bg-gold/15 px-3 py-1 text-xs font-semibold">
                    {n}%
                  </button>
                ))}
              </div>
            )}
            <Field label={ar ? 'ملاحظة (اختياري)' : 'Note (optional)'} value={bonus.note} onChange={(e) => setBonus({ ...bonus, note: e.target.value })} maxLength={120} placeholder={ar ? 'مكافأة العيد، شغل ممتاز…' : 'Eid bonus, great work…'} />
            <ErrorNote>{error}</ErrorNote>
            <Button
              block
              size="lg"
              variant="stitch"
              loading={busy}
              disabled={!(Number(bonus.amount) > 0)}
              icon={<Gift className="h-4 w-4" />}
              onClick={async () => {
                const ok = await act(() => secure.run((totp) => post(`/api/people/members/${bonus.member.id}/bonus`, { amount: Number(bonus.amount).toFixed(2), source: bonus.source, note: bonus.note.trim() || undefined, ...(totp ? { totp } : {}) })), ar ? 'انبعتت المكافأة' : 'Bonus sent');
                if (ok) setBonus(null);
              }}
            >
              {ar ? 'ابعت هلّأ' : 'Send now'}
            </Button>
          </div>
        )}
      </Sheet>

      {/* details */}
      <Sheet open={!!edit} onClose={() => setEdit(null)} title={edit?.full_name ?? ''}>
        {edit && (
          <div className="space-y-4">
            <div className="grid gap-3 sm:grid-cols-2">
              <Field label={ar ? 'اسم بتحبه' : 'Nickname'} value={edit.nickname} onChange={(e) => setEdit({ ...edit, nickname: e.target.value })} maxLength={60} />
              <Field label={ar ? 'الصفة' : 'Title'} value={edit.roleTitle} onChange={(e) => setEdit({ ...edit, roleTitle: e.target.value })} maxLength={60} />
            </div>
            <Field label={ar ? 'من إمتى معك' : 'With you since'} type="date" value={edit.since} onChange={(e) => setEdit({ ...edit, since: e.target.value })} />
            <label className="block">
              <span className="mb-1.5 block text-sm font-medium text-ink/80">{ar ? 'الفئة' : 'Group'}</span>
              <select value={edit.groupId} onChange={(e) => setEdit({ ...edit, groupId: e.target.value })} className="field">
                {groups.map((x) => (
                  <option key={x.id} value={x.id}>
                    {x.name}
                  </option>
                ))}
              </select>
            </label>
            {edit.link_status !== 'accepted' && (
              <Toggle checked={edit.invite ?? edit.link_status === 'invited'} onChange={(v) => setEdit({ ...edit, invite: v })} label={ar ? 'اطلب منه يبين بملفه إنه تابع لهون' : 'Ask them to show it on their profile'} />
            )}
            <ErrorNote>{error}</ErrorNote>
            <div className="flex gap-2">
              <Button
                className="flex-1"
                loading={busy}
                onClick={async () => {
                  const ok = await act(() =>
                    put(`/api/people/members/${edit.id}`, {
                      nickname: edit.nickname.trim() || null,
                      roleTitle: edit.roleTitle.trim() || null,
                      since: edit.since || null,
                      groupId: edit.groupId,
                      ...(edit.invite !== undefined ? { invite: edit.invite } : {}),
                    }),
                  );
                  if (ok) setEdit(null);
                }}
              >
                {ar ? 'احفظ' : 'Save'}
              </Button>
              <Button
                variant="secondary"
                onClick={async () => {
                  if (!(await confirm({ title: ar ? 'تشيله من الفئة؟' : 'Remove from the group?', body: ar ? 'تحويلاته الدورية بتوقف.' : 'Their recurring transfers stop.', tone: 'danger', confirmLabel: ar ? 'شيله' : 'Remove' }))) return;
                  if (await act(() => del(`/api/people/members/${edit.id}`))) setEdit(null);
                }}
              >
                <Trash2 className="h-4 w-4" />
              </Button>
            </div>
          </div>
        )}
      </Sheet>

      <RunsSheet member={runs} onClose={() => setRuns(null)} />
    </div>
  );
}

function RunsSheet({ member, onClose }: { member: any; onClose: () => void }) {
  const { lang } = useI18n();
  const ar = lang === 'ar';
  const data = useData<{ runs: any[] }>(member ? `/api/people/runs?member=${member.id}` : null, [member?.id]);
  return (
    <Sheet open={!!member} onClose={onClose} title={ar ? `سجل ${member?.nickname || member?.full_name || ''}` : 'History'}>
      {!data.data ? (
        <Skeleton className="h-40" />
      ) : !data.data.runs.length ? (
        <p className="py-6 text-center text-sm text-muted">{ar ? 'لسا ما انبعت إشي.' : 'Nothing sent yet.'}</p>
      ) : (
        <ul className="divide-y divide-line">
          {data.data.runs.map((r) => (
            <li key={r.id} className="flex items-center justify-between gap-3 py-2.5 text-sm">
              <span>
                <b className="num">{money(r.amount, lang)}</b> <span className="text-muted">· {r.kind === 'bonus' ? (ar ? 'مكافأة' : 'bonus') : ar ? 'دوري' : 'scheduled'}</span>
                {r.error && <span className="block text-xs text-stitch">{r.error}</span>}
              </span>
              <span className="text-end">
                <Badge tone={r.status === 'done' ? 'good' : r.status === 'waiting' ? 'warn' : 'bad'}>{r.status === 'done' ? (ar ? 'انبعت' : 'Sent') : r.status === 'waiting' ? (ar ? 'بستنى البنك' : 'Waiting') : ar ? 'ما زبط' : 'Failed'}</Badge>
                <span className="block text-[11px] text-muted">{relative(r.ran_at, lang)}</span>
              </span>
            </li>
          ))}
        </ul>
      )}
    </Sheet>
  );
}
