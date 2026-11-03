import { useEffect, useState } from 'react';
import { Ban, Check, Repeat, Search, ShieldOff, UserMinus, UsersRound, X } from 'lucide-react';
import { del, get, post } from '../lib/api';
import { useI18n } from '../lib/i18n';
import { useData } from '../lib/hooks';
import { money, relative } from '../lib/format';
import { useToast } from './Toast';
import { useConfirm } from './Confirm';
import { Avatar, Badge, Button, Sheet, Skeleton, cx } from './ui';

const EVERY: Record<string, [string, string]> = { once: ['مرة وحدة', 'once'], week: ['كل أسبوع', 'weekly'], '2weeks': ['كل أسبوعين', 'every 2 weeks'], month: ['كل شهر', 'monthly'], days: ['كل {n} يوم', 'every {n} days'] };

/** Settings → Privacy: who put me in their people (accept, decline, leave), and who I blocked. */
export function PrivacySettings() {
  return (
    <>
      <GroupsImIn />
      <Blocked />
    </>
  );
}

function GroupsImIn() {
  const { lang, err } = useI18n();
  const ar = lang === 'ar';
  const toast = useToast();
  const data = useData<{ memberships: any[]; optouts: any[] }>('/api/people/memberships');
  const [ask, setAsk] = useState<{ m: any; action: 'decline' | 'leave' } | null>(null);
  const [stop, setStop] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const act = async (m: any, action: 'accept' | 'decline' | 'leave', stopIt = false) => {
    setBusy(m.id);
    try {
      await post(`/api/people/memberships/${m.id}`, { action, stop: stopIt });
      toast(action === 'accept' ? (ar ? 'انضفت' : 'Added') : ar ? 'طلعت' : 'Removed');
      setAsk(null);
      void data.reload();
    } catch (e) {
      toast(err(e), 'error');
    } finally {
      setBusy(null);
    }
  };
  const list = data.data?.memberships ?? [];
  const off = data.data?.optouts ?? [];
  const who = (m: any) => m.store_name ?? m.owner_name;
  return (
    <section id="groups" className="card p-5 sm:p-6">
      <h2 className="mb-1 flex items-center gap-2 text-lg">
        <UsersRound className="h-5 w-5 text-olive" /> {ar ? 'ناس ضافوك عندهم' : 'People who added you'}
      </h2>
      <p className="mb-4 text-sm text-muted">{ar ? 'ما حدا بيقدر يحطك بفئة عنده أو يبعتلك دفعات مجدولة بلا موافقتك. وبتقدر تطلع وقت ما بدك.' : 'Nobody can put you in their groups or schedule payments to you without your yes. You can leave any time.'}</p>
      {!data.data ? (
        <Skeleton className="h-24" />
      ) : !list.length ? (
        <p className="rounded-2xl bg-sunk/60 p-4 text-center text-sm text-muted">{ar ? 'ما حدا ضافك لسا.' : 'Nobody has added you.'}</p>
      ) : (
        <ul className="space-y-2.5">
          {list.map((m) => (
            <li key={m.id} className={cx('rounded-2xl p-3.5 ring-1', m.consent === 'pending' ? 'bg-gold/[0.07] ring-gold/40' : 'ring-line')}>
              <div className="flex items-center gap-3">
                <Avatar name={who(m)} src={m.owner_image} size={42} />
                <div className="min-w-0 flex-1">
                  <p className="truncate font-semibold">{who(m)}</p>
                  <p className="truncate text-xs text-muted">
                    {[m.store_name ? m.owner_name : null, m.group_name ? (ar ? `بفئة «${m.group_name}»` : `in “${m.group_name}”`) : null, relative(m.asked_at ?? m.created_at, lang)].filter(Boolean).join(' · ')}
                  </p>
                </div>
                {m.consent === 'pending' ? <Badge tone="warn">{ar ? 'بستنى ردّك' : 'Waiting for you'}</Badge> : <Badge tone="good">{ar ? 'وافقت' : 'Accepted'}</Badge>}
              </div>
              {m.payments?.length > 0 && (
                <ul className="mt-2.5 space-y-1">
                  {m.payments.map((p: any, i: number) => (
                    <li key={i} className="flex flex-wrap items-center gap-2 rounded-xl bg-surface px-3 py-1.5 text-sm ring-1 ring-line">
                      <Repeat className="h-4 w-4 text-olive" />
                      <b className="num">{money(p.amount, lang)}</b>
                      <span className="text-muted">{(EVERY[p.every]?.[ar ? 0 : 1] ?? p.every).replace('{n}', String(p.every_days ?? ''))}</span>
                      {p.title && <span className="truncate text-xs text-muted">· {p.title}</span>}
                    </li>
                  ))}
                </ul>
              )}
              <div className="mt-3 flex flex-wrap gap-2">
                {m.consent === 'pending' ? (
                  <>
                    <Button size="sm" loading={busy === m.id} icon={<Check className="h-4 w-4" />} onClick={() => act(m, 'accept')}>
                      {ar ? 'وافق' : 'Accept'}
                    </Button>
                    <Button size="sm" variant="secondary" icon={<X className="h-4 w-4" />} onClick={() => (setStop(false), setAsk({ m, action: 'decline' }))}>
                      {ar ? 'ارفض' : 'Decline'}
                    </Button>
                  </>
                ) : (
                  <Button size="sm" variant="secondary" icon={<UserMinus className="h-4 w-4" />} onClick={() => (setStop(false), setAsk({ m, action: 'leave' }))}>
                    {ar ? 'اطلع من ناسه' : 'Leave'}
                  </Button>
                )}
              </div>
            </li>
          ))}
        </ul>
      )}

      {off.length > 0 && (
        <div className="mt-5">
          <p className="mb-2 text-sm font-semibold text-ink/80">{ar ? 'ممنوعين يضيفوك' : 'Can’t add you'}</p>
          <ul className="flex flex-wrap gap-2">
            {off.map((o) => (
              <li key={o.id} className="inline-flex items-center gap-2 rounded-full bg-sunk py-1 pe-1 ps-1 text-sm">
                <Avatar name={o.full_name} src={o.profile_image} size={26} />
                {o.full_name}
                <button
                  onClick={async () => {
                    await del(`/api/people/optouts/${o.id}`).catch((e) => toast(err(e), 'error'));
                    void data.reload();
                  }}
                  className="rounded-full bg-surface px-2.5 py-1 text-xs text-sky"
                >
                  {ar ? 'اسمحله' : 'Allow'}
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}

      <Sheet open={!!ask} onClose={() => setAsk(null)} title={ask?.action === 'leave' ? (ar ? 'تطلع من ناسه؟' : 'Leave?') : ar ? 'ترفض؟' : 'Decline?'}>
        {ask && (
          <div className="space-y-4">
            <p className="text-sm text-muted">{ar ? `${who(ask.m)} بيوصله إنك ${ask.action === 'leave' ? 'طلعت' : 'رفضت'}، والدفعات المجدولة إلك منه بتوقف.` : `${who(ask.m)} is told, and their scheduled payments to you stop.`}</p>
            <label className="flex cursor-pointer items-start gap-3 rounded-2xl bg-sunk/60 p-3.5">
              <input type="checkbox" checked={stop} onChange={(e) => setStop(e.target.checked)} className="mt-0.5 h-5 w-5 accent-[rgb(var(--stitch))]" />
              <span className="text-sm">
                <b className="block">{ar ? 'ما بدي يضيفني مرة ثانية' : 'Don’t let them add me again'}</b>
                <span className="text-xs text-muted">{ar ? 'بتقدر تسمحله بعدين من نفس المكان.' : 'You can allow it later from here.'}</span>
              </span>
            </label>
            <Button block variant="danger" loading={busy === ask.m.id} onClick={() => act(ask.m, ask.action, stop)}>
              {ask.action === 'leave' ? (ar ? 'اطلع' : 'Leave') : ar ? 'ارفض' : 'Decline'}
            </Button>
          </div>
        )}
      </Sheet>
    </section>
  );
}

function Blocked() {
  const { lang, err } = useI18n();
  const ar = lang === 'ar';
  const toast = useToast();
  const confirm = useConfirm();
  const data = useData<{ blocks: any[] }>('/api/blocks');
  const [adding, setAdding] = useState(false);
  const list = data.data?.blocks ?? [];
  const unblock = async (b: any) => {
    try {
      await del(`/api/blocks/${b.id}`);
      toast(ar ? 'شلنا البلوك' : 'Unblocked');
      void data.reload();
    } catch (e) {
      toast(err(e), 'error');
    }
  };
  return (
    <section id="blocked" className="card p-5 sm:p-6">
      <div className="mb-1 flex items-center justify-between gap-2">
        <h2 className="flex items-center gap-2 text-lg">
          <Ban className="h-5 w-5 text-stitch" /> {ar ? 'المحظورين' : 'Blocked'}
        </h2>
        <Button size="sm" variant="secondary" icon={<Ban className="h-4 w-4" />} onClick={() => setAdding(true)}>
          {ar ? 'بلّك حدا' : 'Block someone'}
        </Button>
      </div>
      <p className="mb-4 text-sm text-muted">{ar ? 'اللي بتبلكه ما بيقدر يبعتلك مصاري ولا رسائل، ولا يضيفك لجهات اتصاله أو لفئاته، ولا يلاقيك بالبحث — وإنت كمان ما بتتعامل معه.' : 'Someone you block can’t send you money or messages, add you to contacts or groups, or find you in search — and you can’t deal with them either.'}</p>
      {!data.data ? (
        <Skeleton className="h-16" />
      ) : !list.length ? (
        <p className="rounded-2xl bg-sunk/60 p-4 text-center text-sm text-muted">{ar ? 'ما في حدا محظور.' : 'Nobody is blocked.'}</p>
      ) : (
        <ul className="divide-y divide-line rounded-2xl ring-1 ring-line">
          {list.map((b) => (
            <li key={b.id} className="flex items-center gap-3 px-3.5 py-2.5">
              <Avatar name={b.full_name} src={b.profile_image} size={38} />
              <span className="min-w-0 flex-1">
                <span className="block truncate text-sm font-semibold">{b.full_name}</span>
                <span className="block truncate text-xs text-muted">{b.by_team ? (ar ? 'من الإدارة' : 'By the team') : relative(b.created_at, lang)}</span>
              </span>
              {!b.by_team && (
                <button
                  onClick={async () => {
                    if (await confirm({ title: ar ? `تشيل البلوك عن ${b.full_name}؟` : `Unblock ${b.full_name}?`, body: ar ? 'بيرجع يقدر يتعامل معك.' : 'They can deal with you again.', confirmLabel: ar ? 'شيل البلوك' : 'Unblock' }))
                      void unblock(b);
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
      <BlockPicker open={adding} onClose={() => setAdding(false)} onDone={() => (setAdding(false), void data.reload())} />
    </section>
  );
}

/** Find someone by name, wallet ID or e-mail, and block them. */
export function BlockPicker({ open, onClose, onDone, preset }: { open: boolean; onClose: () => void; onDone: () => void; preset?: { id: string; full_name: string; profile_image?: string | null } | null }) {
  const { lang, err } = useI18n();
  const ar = lang === 'ar';
  const toast = useToast();
  const [q, setQ] = useState('');
  const [found, setFound] = useState<any[]>([]);
  const [pick, setPick] = useState<any>(null);
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    setPick(preset ?? null);
    setQ('');
  }, [open, preset]);
  useEffect(() => {
    if (q.trim().length < 2) {
      setFound([]);
      return;
    }
    const h = setTimeout(() => {
      get<{ users: any[] }>(`/api/messages/search-users?q=${encodeURIComponent(q.trim())}`)
        .then((r) => setFound(r.users))
        .catch(() => setFound([]));
    }, 220);
    return () => clearTimeout(h);
  }, [q]);
  const go = async () => {
    setBusy(true);
    try {
      await post('/api/blocks', { userId: pick.id });
      toast(ar ? `انبلك ${pick.full_name}` : `${pick.full_name} blocked`);
      onDone();
    } catch (e) {
      toast(err(e), 'error');
    } finally {
      setBusy(false);
    }
  };
  return (
    <Sheet open={open} onClose={onClose} title={ar ? 'بلوك' : 'Block'}>
      {pick ? (
        <div className="space-y-4">
          <div className="flex items-center gap-3 rounded-2xl bg-stitch/[0.06] p-3 ring-1 ring-stitch/25">
            <Avatar name={pick.full_name} src={pick.profile_image} size={44} />
            <p className="min-w-0 flex-1 truncate font-semibold">{pick.full_name}</p>
            {!preset && (
              <button onClick={() => setPick(null)} className="text-xs text-sky">
                {ar ? 'غيّر' : 'Change'}
              </button>
            )}
          </div>
          <ul className="space-y-1.5 text-sm text-muted">
            <li>• {ar ? 'ما بيقدر يبعتلك مصاري ولا رسائل' : 'No money or messages between you'}</li>
            <li>• {ar ? 'بينشال من جهات الاتصال ومن الفئات عندكم الثنين، والدفعات المجدولة بينكم بتوقف' : 'Removed from each other’s contacts and groups; scheduled payments between you stop'}</li>
            <li>• {ar ? 'ما بيلاقيك بالبحث' : 'They can’t find you in search'}</li>
            <li>• {ar ? 'ما بيوصله إشعار إنك بلكته' : 'They aren’t told'}</li>
          </ul>
          <Button block variant="danger" loading={busy} icon={<Ban className="h-4 w-4" />} onClick={go}>
            {ar ? 'بلّك' : 'Block'}
          </Button>
        </div>
      ) : (
        <div>
          <label className="relative mb-2 block">
            <Search className="pointer-events-none absolute start-4 top-1/2 h-5 w-5 -translate-y-1/2 text-muted" />
            <input autoFocus value={q} onChange={(e) => setQ(e.target.value)} placeholder={ar ? 'الاسم، رقم المحفظة أو الإيميل' : 'Name, wallet ID or e-mail'} className="field ps-12" type="search" />
          </label>
          <ul className="max-h-72 overflow-y-auto">
            {found.map((u) => (
              <li key={u.id}>
                <button onClick={() => setPick(u)} className="flex w-full items-center gap-3 rounded-xl px-2 py-2 text-start hover:bg-sunk/60">
                  <Avatar name={u.full_name} src={u.profile_image} size={36} />
                  <span className="min-w-0 flex-1 truncate text-sm font-medium">{u.full_name}</span>
                  {u.wallet_id && (
                    <span className="text-xs text-muted" dir="ltr">
                      {u.wallet_id}
                    </span>
                  )}
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}
    </Sheet>
  );
}

/** Accept or decline being added, right where the request shows (a notification, the home page). */
export function InviteButtons({ memberId, onDone }: { memberId: string; onDone?: (accepted: boolean) => void }) {
  const { lang, err } = useI18n();
  const ar = lang === 'ar';
  const toast = useToast();
  const [state, setState] = useState<'idle' | 'busy' | 'accepted' | 'declined' | 'gone'>('idle');
  const go = async (action: 'accept' | 'decline') => {
    setState('busy');
    try {
      await post(`/api/people/memberships/${memberId}`, { action });
      setState(action === 'accept' ? 'accepted' : 'declined');
      onDone?.(action === 'accept');
    } catch (e: any) {
      if (e?.status === 404) setState('gone');
      else {
        setState('idle');
        toast(err(e), 'error');
      }
    }
  };
  if (state === 'accepted') return <p className="mt-2 inline-flex items-center gap-1.5 text-sm font-semibold text-olive"><Check className="h-4 w-4" /> {ar ? 'وافقت — صرت من ناسه' : 'Accepted'}</p>;
  if (state === 'declined') return <p className="mt-2 text-sm text-muted">{ar ? 'رفضت. بتقدر تمنعه يطلب مرة ثانية من الإعدادات ← الخصوصية.' : 'Declined. You can stop them asking again in Settings → Privacy.'}</p>;
  if (state === 'gone') return <p className="mt-2 text-sm text-muted">{ar ? 'هالطلب انتهى أو رديت عليه قبل.' : 'This request is no longer open.'}</p>;
  return (
    <div className="mt-2.5 flex gap-2" onClick={(e) => e.stopPropagation()} onKeyDown={(e) => e.stopPropagation()}>
      <Button size="sm" loading={state === 'busy'} icon={<Check className="h-4 w-4" />} onClick={() => go('accept')}>
        {ar ? 'وافق' : 'Accept'}
      </Button>
      <Button size="sm" variant="secondary" disabled={state === 'busy'} icon={<X className="h-4 w-4" />} onClick={() => go('decline')}>
        {ar ? 'ارفض' : 'Decline'}
      </Button>
    </div>
  );
}

/** Home: people waiting for your yes, so the request can't be missed. */
export function PendingInvites() {
  const { lang } = useI18n();
  const ar = lang === 'ar';
  const data = useData<{ memberships: any[] }>('/api/people/memberships');
  const list = (data.data?.memberships ?? []).filter((m) => m.consent === 'pending');
  if (!list.length) return null;
  return (
    <section className="mb-5 space-y-2">
      {list.map((m) => (
        <div key={m.id} className="rounded-3xl bg-gold/[0.08] p-4 ring-1 ring-gold/40">
          <div className="flex items-center gap-3">
            <Avatar name={m.store_name ?? m.owner_name} src={m.owner_image} size={42} />
            <div className="min-w-0 flex-1">
              <p className="font-semibold">{ar ? `${m.store_name ?? m.owner_name} بدّه يضيفك لناسه` : `${m.store_name ?? m.owner_name} wants to add you`}</p>
              <p className="truncate text-xs text-muted">
                {[m.group_name ? (ar ? `بفئة «${m.group_name}»` : `in “${m.group_name}”`) : null, m.payments?.[0] ? `${money(m.payments[0].amount, lang)} ${(EVERY[m.payments[0].every]?.[ar ? 0 : 1] ?? '').replace('{n}', String(m.payments[0].every_days ?? ''))}` : null].filter(Boolean).join(' · ')}
              </p>
            </div>
          </div>
          <InviteButtons memberId={m.id} onDone={() => setTimeout(() => void data.reload(), 1500)} />
        </div>
      ))}
    </section>
  );
}
