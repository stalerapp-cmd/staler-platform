import { useState } from 'react';
import { motion } from 'framer-motion';
import { Clock3, Crown, Gavel, Headset, MessageSquareQuote, ShieldAlert, Star, Timer } from 'lucide-react';
import { get } from '../lib/api';
import { useI18n } from '../lib/i18n';
import { useData } from '../lib/hooks';
import { relative } from '../lib/format';
import { topicOf } from '../components/SupportDesk';
import { Avatar, Badge, EmptyState, PageHeader, Sheet, Skeleton, cx } from '../components/ui';

const W = {
  ar: {
    title: 'أداء الفريق',
    lead: 'للسوبر أدمن بس: مين استلم طلبات دعم، أديش بسرعة بيرد، وكيف قيّمه الناس — مع النزاعات والبلاغات اللي حلّها.',
    tabs: { team: 'الفريق', chats: 'كل محادثات الدعم' },
    periods: [
      [30, '30 يوم'],
      [90, '3 شهور'],
      [365, 'سنة'],
    ] as [number, string][],
    taken: 'استلم',
    open: 'مفتوحة',
    closed: 'سكّر',
    reply: 'أول رد',
    rating: 'التقييم',
    ratings: '{n} تقييم',
    declined: '{n} ما حبّوا يقيّموا',
    disputes: 'نزاعات',
    reports: 'بلاغات',
    actions: 'عمليات',
    noRating: 'لسا ما في تقييمات',
    comments: 'آخر التعليقات',
    min: 'د',
    hr: 'س',
    super: 'سوبر أدمن',
    st: { waiting: 'بستنى', active: 'شغّالة', closed: 'مسكّرة' } as Record<string, string>,
    all: 'الكل',
    by: 'مع {name}',
    nobody: 'لسا ما حدا استلم',
    readOnly: 'عرض بس — ما بتقدر تكتب بمحادثة غيرك.',
    best: 'الأعلى تقييمًا',
  },
  en: {
    title: 'Team performance',
    lead: 'Super admin only: who took support requests, how fast they answer, how people rated them — and the disputes and reports they settled.',
    tabs: { team: 'Team', chats: 'All support chats' },
    periods: [
      [30, '30 days'],
      [90, '3 months'],
      [365, 'Year'],
    ] as [number, string][],
    taken: 'Taken',
    open: 'Open',
    closed: 'Closed',
    reply: 'First reply',
    rating: 'Rating',
    ratings: '{n} ratings',
    declined: '{n} chose not to rate',
    disputes: 'Disputes',
    reports: 'Reports',
    actions: 'Actions',
    noRating: 'No ratings yet',
    comments: 'Latest comments',
    min: 'm',
    hr: 'h',
    super: 'Super admin',
    st: { waiting: 'Waiting', active: 'Active', closed: 'Closed' } as Record<string, string>,
    all: 'All',
    by: 'With {name}',
    nobody: 'Not taken yet',
    readOnly: 'View only — you can’t write in someone else’s chat.',
    best: 'Top rated',
  },
};

const fmtMin = (m: number | null, w: (typeof W)['ar']) => (m == null ? '—' : m < 60 ? `${Math.round(m)}${w.min}` : `${(m / 60).toFixed(1)}${w.hr}`);

function Stars({ v, size = 'h-4 w-4' }: { v: number; size?: string }) {
  return (
    <span className="inline-flex">
      {[1, 2, 3, 4, 5].map((n) => (
        <Star key={n} className={cx(size, n <= Math.round(v) ? 'fill-gold text-gold' : 'text-line')} />
      ))}
    </span>
  );
}

export function AdminTeam() {
  const { lang } = useI18n();
  const w = W[lang === 'ar' ? 'ar' : 'en'];
  const [tab, setTab] = useState<'team' | 'chats'>('team');
  const [days, setDays] = useState(90);
  const team = useData<{ admins: any[] }>(`/api/admin/team?days=${days}`, [days]);
  const [status, setStatus] = useState<string>('');
  const [who, setWho] = useState<string>('');
  const chats = useData<{ items: any[] }>(tab === 'chats' ? `/api/messages/support/all?${new URLSearchParams({ ...(status ? { status } : {}), ...(who ? { admin: who } : {}) })}` : null, [tab, status, who]);
  const [view, setView] = useState<any>(null);
  const [msgs, setMsgs] = useState<any[] | null>(null);
  const open = async (c: any) => {
    setView(c);
    setMsgs(null);
    try {
      setMsgs((await get<{ messages: any[] }>(`/api/messages/conversations/${c.id}/messages?limit=100`)).messages);
    } catch {
      setMsgs([]);
    }
  };
  const admins = team.data?.admins ?? [];
  const best = [...admins].filter((a) => a.ratings > 0).sort((a, b) => Number(b.rating) - Number(a.rating))[0];

  return (
    <div>
      <PageHeader title={w.title} lead={w.lead} />
      <div className="mb-5 flex flex-wrap items-center justify-between gap-3">
        <div className="flex rounded-2xl bg-surface p-1 ring-1 ring-line" role="tablist">
          {(['team', 'chats'] as const).map((k) => (
            <button key={k} role="tab" aria-selected={tab === k} onClick={() => setTab(k)} className={cx('relative rounded-xl px-4 py-2 text-sm font-medium transition', tab === k ? 'text-white' : 'text-muted hover:text-ink')}>
              {tab === k && <motion.span layoutId="team-tab" className="absolute inset-0 rounded-xl bg-night dark:bg-white/15" />}
              <span className="relative">{w.tabs[k]}</span>
            </button>
          ))}
        </div>
        {tab === 'team' && (
          <div className="flex gap-1.5">
            {w.periods.map(([d, l]) => (
              <button key={d} onClick={() => setDays(d)} className={cx('rounded-full px-3.5 py-1.5 text-sm transition', days === d ? 'bg-night text-white dark:bg-white/15' : 'bg-surface text-muted ring-1 ring-line hover:text-ink')}>
                {l}
              </button>
            ))}
          </div>
        )}
      </div>

      {tab === 'team' ? (
        !team.data ? (
          <div className="grid gap-4 md:grid-cols-2">
            {[0, 1].map((i) => (
              <Skeleton key={i} className="h-72 rounded-3xl" />
            ))}
          </div>
        ) : (
          <div className="grid gap-4 md:grid-cols-2">
            {admins.map((a, i) => {
              const dist = a.stars ?? {};
              const total = Object.values(dist).reduce((s: number, n: any) => s + Number(n), 0) as number;
              return (
                <motion.section key={a.id} initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: i * 0.04 }} className="card overflow-hidden">
                  <div className="flex items-center gap-3 border-b border-line p-4">
                    <Avatar name={a.full_name} src={a.profile_image} size={48} />
                    <div className="min-w-0 flex-1">
                      <p className="flex items-center gap-1.5 truncate font-semibold">
                        {a.full_name}
                        {a.admin_level === 'super_admin' && <Crown className="h-4 w-4 text-gold" />}
                        {best?.id === a.id && <Badge tone="good">{w.best}</Badge>}
                      </p>
                      <p className="truncate text-xs text-muted" dir="ltr">
                        {a.email}
                      </p>
                    </div>
                    <div className="text-end">
                      {a.ratings ? (
                        <>
                          <p className="num font-display text-2xl leading-none">{Number(a.rating).toFixed(1)}</p>
                          <Stars v={Number(a.rating)} size="h-3.5 w-3.5" />
                        </>
                      ) : (
                        <p className="text-xs text-muted">{w.noRating}</p>
                      )}
                    </div>
                  </div>
                  <div className="grid grid-cols-3 divide-x divide-line rtl:divide-x-reverse">
                    {(
                      [
                        [Headset, w.taken, a.taken],
                        [Clock3, w.open, a.open_now],
                        [Timer, w.reply, fmtMin(a.reply_minutes == null ? null : Number(a.reply_minutes), w)],
                      ] as const
                    ).map(([Icon, l, v]) => (
                      <div key={l} className="p-3 text-center">
                        <Icon className="mx-auto h-4 w-4 text-muted" />
                        <p className="num mt-1 font-display text-xl">{v}</p>
                        <p className="text-[11px] text-muted">{l}</p>
                      </div>
                    ))}
                  </div>
                  <div className="space-y-3 border-t border-line p-4">
                    {total > 0 && (
                      <div className="space-y-1">
                        {[5, 4, 3, 2, 1].map((n) => {
                          const c = Number(dist[n] ?? 0);
                          return (
                            <div key={n} className="flex items-center gap-2 text-xs">
                              <span className="num w-3 text-muted">{n}</span>
                              <Star className="h-3 w-3 fill-gold text-gold" />
                              <span className="h-1.5 flex-1 overflow-hidden rounded-full bg-sunk">
                                <motion.span initial={{ width: 0 }} animate={{ width: `${(c / total) * 100}%` }} className="block h-full rounded-full bg-gold" />
                              </span>
                              <span className="num w-5 text-end text-muted">{c}</span>
                            </div>
                          );
                        })}
                        <p className="pt-1 text-[11px] text-muted">
                          {w.ratings.replace('{n}', String(a.ratings))}
                          {a.declined ? ` · ${w.declined.replace('{n}', String(a.declined))}` : ''}
                        </p>
                      </div>
                    )}
                    <div className="flex flex-wrap gap-1.5 text-xs">
                      <span className="inline-flex items-center gap-1 rounded-full bg-sunk px-2.5 py-1">
                        <Gavel className="h-3.5 w-3.5" /> {w.disputes} <b className="num">{a.disputes}</b>
                      </span>
                      <span className="inline-flex items-center gap-1 rounded-full bg-sunk px-2.5 py-1">
                        <ShieldAlert className="h-3.5 w-3.5" /> {w.reports} <b className="num">{a.reports}</b>
                      </span>
                      <span className="inline-flex items-center gap-1 rounded-full bg-sunk px-2.5 py-1">
                        {w.closed} <b className="num">{a.closed}</b>
                      </span>
                      <span className="inline-flex items-center gap-1 rounded-full bg-sunk px-2.5 py-1">
                        {w.actions} <b className="num">{a.actions}</b>
                      </span>
                    </div>
                    {a.comments?.length > 0 && (
                      <div>
                        <p className="mb-1.5 flex items-center gap-1.5 text-xs font-semibold text-muted">
                          <MessageSquareQuote className="h-3.5 w-3.5" /> {w.comments}
                        </p>
                        <ul className="space-y-1.5">
                          {a.comments.slice(0, 3).map((c: any) => (
                            <li key={c.conversation_id} className="rounded-xl bg-bg/70 px-3 py-2 text-sm ring-1 ring-line">
                              <span className="flex items-center justify-between gap-2 text-[11px] text-muted">
                                <span>{c.customer}</span>
                                <Stars v={c.stars} size="h-3 w-3" />
                              </span>
                              “{c.comment}”
                            </li>
                          ))}
                        </ul>
                      </div>
                    )}
                  </div>
                </motion.section>
              );
            })}
          </div>
        )
      ) : (
        <>
          <div className="mb-4 flex flex-wrap gap-2">
            {(['', 'waiting', 'active', 'closed'] as const).map((k) => (
              <button key={k || 'all'} onClick={() => setStatus(k)} className={cx('rounded-full px-3.5 py-1.5 text-sm transition', status === k ? 'bg-night text-white dark:bg-white/15' : 'bg-surface text-muted ring-1 ring-line hover:text-ink')}>
                {k ? w.st[k] : w.all}
              </button>
            ))}
            <select value={who} onChange={(e) => setWho(e.target.value)} className="field h-9 w-auto rounded-full py-0 text-sm">
              <option value="">{w.all}</option>
              {admins.map((a) => (
                <option key={a.id} value={a.id}>
                  {a.full_name}
                </option>
              ))}
            </select>
          </div>
          {!chats.data ? (
            <Skeleton className="h-64 rounded-3xl" />
          ) : !chats.data.items.length ? (
            <EmptyState icon={<Headset className="h-6 w-6" />} title={lang === 'ar' ? 'ما في محادثات' : 'No chats'} />
          ) : (
            <ul className="card divide-y divide-line overflow-hidden">
              {chats.data.items.map((c) => {
                const T = topicOf(c.topic);
                return (
                  <li key={c.id}>
                    <button onClick={() => open(c)} className="flex w-full items-center gap-3 px-4 py-3 text-start transition hover:bg-sunk/60">
                      <Avatar name={c.customer_name} src={c.customer_image} size={38} />
                      <span className="min-w-0 flex-1">
                        <span className="flex flex-wrap items-center gap-x-2 text-sm">
                          <b className="font-semibold">{c.customer_name}</b>
                          {T && <span className={cx('rounded-full px-2 py-px text-[11px]', T.c)}>{lang === 'ar' ? T.ar : T.en}</span>}
                        </span>
                        <span className="block truncate text-xs text-muted">{c.last ?? '—'}</span>
                        <span className="text-[11px] text-muted">
                          {c.admin_name ? w.by.replace('{name}', c.admin_name) : w.nobody} · {relative(c.created_at, lang)}
                        </span>
                      </span>
                      <span className="flex flex-col items-end gap-1">
                        <Badge tone={c.status === 'closed' ? 'neutral' : c.assigned_to ? 'info' : 'warn'}>{w.st[c.status === 'closed' ? 'closed' : c.assigned_to ? 'active' : 'waiting']}</Badge>
                        {c.stars ? <Stars v={c.stars} size="h-3 w-3" /> : null}
                      </span>
                    </button>
                  </li>
                );
              })}
            </ul>
          )}
        </>
      )}

      <Sheet open={!!view} onClose={() => setView(null)} title={view?.customer_name ?? ''} wide>
        <p className="mb-3 rounded-xl bg-sunk px-3 py-2 text-xs text-muted">{w.readOnly}</p>
        {view?.stars && (
          <div className="mb-3 rounded-2xl bg-gold/10 p-3 text-sm">
            <Stars v={view.stars} /> {view.comment && <p className="mt-1">“{view.comment}”</p>}
          </div>
        )}
        {!msgs ? (
          <Skeleton className="h-40" />
        ) : (
          <ul className="space-y-2">
            {msgs.map((m) => {
              const staffMsg = m.sender_role === 'admin';
              return (
                <li key={m.id} className={cx('flex', staffMsg ? 'justify-end' : 'justify-start')}>
                  <div className={cx('max-w-[80%] rounded-2xl px-3.5 py-2 text-sm', staffMsg ? 'bg-night text-white dark:bg-white/15' : 'bg-sunk')}>
                    <p className={cx('mb-0.5 text-[11px]', staffMsg ? 'text-white/60' : 'text-muted')}>
                      {m.sender_name} · {relative(m.created_at, lang)}
                    </p>
                    <p className="whitespace-pre-line break-words">{m.is_deleted ? '—' : m.content}</p>
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </Sheet>
    </div>
  );
}
