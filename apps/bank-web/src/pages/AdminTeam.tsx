import { Link } from 'react-router-dom';
import { Clock3, Crown, LifeBuoy, MessageSquareQuote, Plane, Star } from 'lucide-react';
import { useI18n } from '../lib/i18n';
import { useData } from '../lib/hooks';
import { relative } from '../lib/format';
import { Avatar, Badge, EmptyState, PageHeader, Skeleton } from '../components/ui';

const fmtD = (x: string, ar: boolean) => new Intl.DateTimeFormat(ar ? 'ar-u-nu-latn' : 'en-GB', { day: 'numeric', month: 'short' }).format(new Date(String(x).slice(0, 10)));

/** Super admin: how each staff member does on support — and who is away. */
export default function AdminTeam() {
  const { lang } = useI18n();
  const ar = lang === 'ar';
  const data = useData<{ admins: any[]; comments: any[] }>('/api/admin/support-team');
  const mins = (m: number | null) => (m == null ? '—' : m < 60 ? (ar ? `${m} د` : `${m} min`) : ar ? `${Math.round(m / 60)} س` : `${Math.round(m / 60)} h`);
  const list = data.data?.admins ?? [];
  const best = [...list].filter((a) => a.ratings >= 1).sort((a, b) => Number(b.stars) - Number(a.stars))[0];
  return (
    <div>
      <PageHeader
        title={ar ? 'أداء الفريق' : 'Team performance'}
        lead={ar ? 'مين استلم محادثات دعم، أديش بسرعة رد أول مرة، وتقييمات الزباين. ومن «كل المحادثات» بالدعم بتقرأ أي محادثة وبتحوّلها.' : 'Who took support chats, how fast they first replied, and customer ratings. From “Everything” in support you read and hand on any chat.'}
        actions={
          <div className="flex gap-2">
            <Link to="/app/admin/support" className="inline-flex items-center gap-1.5 rounded-xl bg-surface px-3 py-2 text-sm font-semibold text-ink ring-1 ring-line">
              <LifeBuoy className="h-4 w-4" /> {ar ? 'الدعم' : 'Support'}
            </Link>
            <Link to="/app/admin/leaves" className="inline-flex items-center gap-1.5 rounded-xl bg-surface px-3 py-2 text-sm font-semibold text-ink ring-1 ring-line">
              <Plane className="h-4 w-4" /> {ar ? 'الإجازات' : 'Leave'}
            </Link>
          </div>
        }
      />
      {!data.data ? (
        <Skeleton className="h-56 rounded-3xl" />
      ) : (
        <>
          <ul className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
            {list.map((a) => (
              <li key={a.id} className="card p-4">
                <div className="flex items-center gap-3">
                  <Avatar name={a.full_name} size={44} />
                  <div className="min-w-0 flex-1">
                    <p className="flex flex-wrap items-center gap-1.5 font-semibold">
                      <span className="truncate">{a.full_name}</span>
                      {a.admin_level === 'super_admin' && <Crown className="h-4 w-4 text-gold" />}
                      {best?.id === a.id && <Badge tone="good">{ar ? 'الأعلى تقييمًا' : 'Top rated'}</Badge>}
                    </p>
                    <p className="truncate text-xs text-muted">{a.last_login_at ? (ar ? `آخر دخول ${relative(a.last_login_at, lang)}` : `Last seen ${relative(a.last_login_at, lang)}`) : a.email}</p>
                  </div>
                </div>
                {a.leave && (
                  <p className="mt-2 rounded-xl bg-gold/12 px-3 py-1.5 text-xs">
                    {a.leave.kind === 'off' ? (ar ? 'موقوف عن الدعم' : 'Off support') : ar ? 'إجازة' : 'Leave'} {fmtD(a.leave.starts_on, ar)} ← {fmtD(a.leave.ends_on, ar)}
                  </p>
                )}
                <dl className="mt-3 grid grid-cols-4 gap-2 text-center">
                  {[
                    [ar ? 'مفتوحة' : 'Open', a.open_now],
                    [ar ? 'استلم ٣٠ي' : 'Taken 30d', a.taken_30d],
                    [<Clock3 key="c" className="mx-auto h-3.5 w-3.5" />, mins(a.first_reply_min)],
                    [<Star key="s" className="mx-auto h-3.5 w-3.5" />, a.stars ? `${a.stars} (${a.ratings})` : '—'],
                  ].map(([l, v], i) => (
                    <div key={i} className="rounded-xl bg-sunk/60 px-1 py-2">
                      <dt className="text-[11px] text-muted">{l}</dt>
                      <dd className="num mt-0.5 text-sm font-semibold">{v}</dd>
                    </div>
                  ))}
                </dl>
              </li>
            ))}
          </ul>
          <h2 className="mb-3 mt-8 flex items-center gap-2 text-xl">
            <MessageSquareQuote className="h-5 w-5 text-gold" /> {ar ? 'شو حكوا الزباين' : 'What customers said'}
          </h2>
          {!data.data.comments.length ? (
            <EmptyState icon={<MessageSquareQuote className="h-6 w-6" />} title={ar ? 'لسا ما في تعليقات' : 'No comments yet'} />
          ) : (
            <ul className="grid gap-2 sm:grid-cols-2">
              {data.data.comments.map((c, i) => (
                <li key={i} className="card p-4">
                  <p className="text-gold">{'★'.repeat(c.stars)}</p>
                  <p className="mt-1 text-sm">«{c.comment}»</p>
                  <p className="mt-1 text-xs text-muted">
                    {c.customer} → {c.admin_name ?? '—'} · {relative(c.created_at, lang)}
                  </p>
                </li>
              ))}
            </ul>
          )}
        </>
      )}
    </div>
  );
}
