import { useEffect, useState } from 'react';
import { ArrowLeftRight, Ban, Pause, Play, Repeat, Search, ShieldOff } from 'lucide-react';
import { del, get, post } from '../lib/api';
import { useI18n } from '../lib/i18n';
import { useData } from '../lib/hooks';
import { money, relative } from '../lib/format';
import { useToast } from '../components/Toast';
import { useConfirm } from '../components/Confirm';
import { Avatar, Badge, Button, EmptyState, ErrorNote, PageHeader, Sheet, Skeleton, cx } from '../components/ui';

const EVERY: Record<string, [string, string]> = { once: ['مرة وحدة', 'once'], week: ['كل أسبوع', 'weekly'], '2weeks': ['كل أسبوعين', 'every 2 weeks'], month: ['كل شهر', 'monthly'], days: ['كل {n} يوم', 'every {n} days'] };

/** Bank staff: every scheduled payment (pause any), and every block (lift, or keep two customers apart). */
export default function AdminScheduled() {
  const { lang, err } = useI18n();
  const ar = lang === 'ar';
  const toast = useToast();
  const confirm = useConfirm();
  const [tab, setTab] = useState<'orders' | 'blocks'>('orders');
  const [q, setQ] = useState('');
  const qs = q.trim() ? `?q=${encodeURIComponent(q.trim())}` : '';
  const orders = useData<{ orders: any[]; totals: any }>(tab === 'orders' ? `/api/admin/scheduled${qs}` : null, [tab, q]);
  const blocks = useData<{ blocks: any[] }>(tab === 'blocks' ? `/api/admin/blocks${qs}` : null, [tab, q]);
  const [adding, setAdding] = useState(false);
  const t = orders.data?.totals;

  const pause = async (o: any) => {
    const note = !o.paused_by_admin ? (window.prompt(ar ? 'السبب (بيوصل للطرفين)' : 'Reason (both sides see it)') ?? undefined) : undefined;
    try {
      await post(`/api/admin/scheduled/${o.id}/pause`, { paused: !o.paused_by_admin, ...(note ? { note } : {}) });
      toast(o.paused_by_admin ? (ar ? 'رجعت تشتغل' : 'Resumed') : ar ? 'انوقفت' : 'Paused');
      void orders.reload();
    } catch (e) {
      toast(err(e), 'error');
    }
  };

  return (
    <div>
      <PageHeader
        title={ar ? 'الدفعات المجدولة والبلوكات' : 'Scheduled payments & blocks'}
        lead={ar ? 'مين بيدفع لمين بشكل مجدول، مين لسا ما وافق، وكل البلوكات بين الزباين. بتقدر توقف أي دفعة، تشيل أي بلوك أو تفصل بين زبونين.' : 'Who pays whom on a schedule, who hasn’t accepted yet, and every block between customers. Pause any payment, lift any block, or keep two customers apart.'}
        actions={
          tab === 'blocks' ? (
            <Button icon={<Ban className="h-4 w-4" />} onClick={() => setAdding(true)}>
              <span className="hidden sm:inline">{ar ? 'افصل بين زبونين' : 'Keep two apart'}</span>
            </Button>
          ) : undefined
        }
      />
      <div className="mb-4 grid grid-cols-2 gap-1 rounded-2xl bg-surface p-1 ring-1 ring-line sm:w-96">
        {(
          [
            ['orders', ar ? 'الدفعات المجدولة' : 'Scheduled', Repeat],
            ['blocks', ar ? 'البلوكات' : 'Blocks', Ban],
          ] as const
        ).map(([k, l, I]) => (
          <button key={k} onClick={() => setTab(k)} className={cx('flex items-center justify-center gap-1.5 rounded-xl px-2 py-2.5 text-sm transition', tab === k ? 'bg-night font-semibold text-white dark:bg-white/15' : 'text-muted')}>
            <I className="h-4 w-4" /> {l}
          </button>
        ))}
      </div>
      {tab === 'orders' && t && (
        <div className="mb-4 grid grid-cols-3 gap-3">
          {[
            [ar ? 'شغّالة' : 'Active', t.active],
            [ar ? 'بتستنى موافقة' : 'Awaiting yes', t.pending],
            [ar ? 'آخر 30 يوم' : 'Last 30 days', money(t.last30, lang)],
          ].map(([l, v]) => (
            <div key={String(l)} className="rounded-3xl bg-surface p-4 shadow-card">
              <p className="text-xs text-muted">{l}</p>
              <p className="num mt-1 font-display text-xl">{v}</p>
            </div>
          ))}
        </div>
      )}
      <label className="relative mb-4 block">
        <Search className="pointer-events-none absolute start-4 top-1/2 h-5 w-5 -translate-y-1/2 text-muted" />
        <input value={q} onChange={(e) => setQ(e.target.value)} placeholder={ar ? 'دوّر بالاسم أو الإيميل' : 'Search name or e-mail'} className="field h-12 rounded-2xl ps-12" type="search" />
      </label>

      {tab === 'orders' ? (
        !orders.data ? (
          <Skeleton className="h-48 rounded-3xl" />
        ) : !orders.data.orders.length ? (
          <EmptyState icon={<Repeat className="h-6 w-6" />} title={ar ? 'ما في دفعات مجدولة' : 'No scheduled payments'} />
        ) : (
          <ul className="divide-y divide-line rounded-3xl bg-surface shadow-card">
            {orders.data.orders.map((o) => (
              <li key={o.id} className="flex flex-wrap items-center gap-3 px-4 py-3">
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-sm font-semibold">
                    {o.owner_name} ← {o.to_name}
                  </span>
                  <span className="block truncate text-xs text-muted">
                    <b className="num text-ink">{money(o.amount, lang)}</b> {(EVERY[o.every]?.[ar ? 0 : 1] ?? o.every).replace('{n}', String(o.every_days ?? ''))}
                    {o.title ? ` · ${o.title}` : ''} · {ar ? `${o.runs} دفعة` : `${o.runs} paid`} · {relative(o.created_at, lang)}
                  </span>
                </span>
                {!o.active ? <Badge tone="neutral">{ar ? 'منتهية' : 'Ended'}</Badge> : o.consent === 'pending' ? <Badge tone="warn">{ar ? 'بستنى موافقة' : 'Awaiting yes'}</Badge> : o.paused_by_admin ? <Badge tone="bad">{ar ? 'موقوفة' : 'Paused'}</Badge> : <Badge tone="good">{ar ? 'شغّالة' : 'Active'}</Badge>}
                {o.active && (
                  <button onClick={() => pause(o)} className="inline-flex items-center gap-1 rounded-full bg-sunk px-3 py-1.5 text-xs font-semibold">
                    {o.paused_by_admin ? <Play className="h-3.5 w-3.5" /> : <Pause className="h-3.5 w-3.5" />} {o.paused_by_admin ? (ar ? 'شغّلها' : 'Resume') : ar ? 'وقّفها' : 'Pause'}
                  </button>
                )}
              </li>
            ))}
          </ul>
        )
      ) : !blocks.data ? (
        <Skeleton className="h-48 rounded-3xl" />
      ) : !blocks.data.blocks.length ? (
        <EmptyState icon={<Ban className="h-6 w-6" />} title={ar ? 'ما في بلوكات' : 'No blocks'} />
      ) : (
        <ul className="divide-y divide-line rounded-3xl bg-surface shadow-card">
          {blocks.data.blocks.map((b) => (
            <li key={b.id} className="flex flex-wrap items-center gap-3 px-4 py-3">
              <span className="min-w-0 flex-1 text-sm">
                <b>{b.blocker.full_name}</b> <span className="text-stitch">{ar ? 'بلّك' : 'blocked'}</span> <b>{b.blocked.full_name}</b>
                <span className="block text-xs text-muted">
                  {b.by_team ? (ar ? `من البنك · ${b.admin_name ?? ''}` : `By the bank · ${b.admin_name ?? ''}`) : ''} {relative(b.created_at, lang)}
                  {b.note ? ` · «${b.note}»` : ''}
                </span>
              </span>
              <button
                onClick={async () => {
                  if (!(await confirm({ title: ar ? 'تشيل البلوك؟' : 'Lift this block?', confirmLabel: ar ? 'شيل' : 'Lift' }))) return;
                  try {
                    await del(`/api/admin/blocks/${b.id}`);
                    void blocks.reload();
                  } catch (e) {
                    toast(err(e), 'error');
                  }
                }}
                className="inline-flex items-center gap-1 rounded-full bg-sunk px-3 py-1.5 text-xs font-semibold"
              >
                <ShieldOff className="h-3.5 w-3.5" /> {ar ? 'شيل' : 'Lift'}
              </button>
            </li>
          ))}
        </ul>
      )}
      <KeepApart open={adding} onClose={() => setAdding(false)} onDone={() => (setAdding(false), void blocks.reload())} />
    </div>
  );
}

function Find({ label, value, onPick }: { label: string; value: any; onPick: (u: any) => void }) {
  const { lang } = useI18n();
  const ar = lang === 'ar';
  const [q, setQ] = useState('');
  const [found, setFound] = useState<any[]>([]);
  useEffect(() => {
    if (q.trim().length < 2) {
      setFound([]);
      return;
    }
    const h = setTimeout(() => {
      get<{ users: any[] }>(`/api/admin/users?${new URLSearchParams({ q: q.trim() })}`)
        .then((r) => setFound(r.users.filter((u) => u.role !== 'admin').slice(0, 8)))
        .catch(() => setFound([]));
    }, 220);
    return () => clearTimeout(h);
  }, [q]);
  return (
    <div>
      <p className="mb-1.5 text-sm font-medium text-ink/80">{label}</p>
      {value ? (
        <div className="flex items-center gap-3 rounded-2xl bg-sunk/60 p-2.5">
          <Avatar name={value.full_name} size={34} />
          <span className="min-w-0 flex-1 truncate text-sm font-semibold">{value.full_name}</span>
          <button onClick={() => onPick(null)} className="text-xs text-sky">
            {ar ? 'غيّر' : 'Change'}
          </button>
        </div>
      ) : (
        <>
          <input value={q} onChange={(e) => setQ(e.target.value)} placeholder={ar ? 'الاسم أو الإيميل' : 'Name or e-mail'} className="field" type="search" />
          {found.length > 0 && (
            <ul className="mt-1.5 max-h-48 overflow-y-auto rounded-2xl ring-1 ring-line">
              {found.map((u) => (
                <li key={u.id}>
                  <button onClick={() => onPick(u)} className="flex w-full items-center gap-2.5 px-3 py-2 text-start hover:bg-sunk/60">
                    <Avatar name={u.full_name} size={28} />
                    <span className="min-w-0 flex-1 truncate text-sm">{u.full_name}</span>
                    <span className="truncate text-[11px] text-muted" dir="ltr">
                      {u.email}
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </>
      )}
    </div>
  );
}

function KeepApart({ open, onClose, onDone }: { open: boolean; onClose: () => void; onDone: () => void }) {
  const { lang, err } = useI18n();
  const ar = lang === 'ar';
  const [a, setA] = useState<any>(null);
  const [b, setB] = useState<any>(null);
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    setA(null);
    setB(null);
    setNote('');
    setError(null);
  }, [open]);
  return (
    <Sheet open={open} onClose={onClose} title={ar ? 'افصل بين زبونين' : 'Keep two customers apart'}>
      <div className="space-y-4">
        <Find label={ar ? 'احمي هالزبون' : 'Protect this customer'} value={a} onPick={setA} />
        <div className="flex justify-center text-muted">
          <ArrowLeftRight className="h-5 w-5" />
        </div>
        <Find label={ar ? 'من هالزبون' : 'From this customer'} value={b} onPick={setB} />
        <input value={note} onChange={(e) => setNote(e.target.value)} maxLength={300} placeholder={ar ? 'السبب (للفريق بس)' : 'Reason (staff only)'} className="field" />
        <ErrorNote>{error}</ErrorNote>
        <Button
          block
          variant="danger-solid"
          loading={busy}
          disabled={!a || !b || a.id === b.id}
          icon={<Ban className="h-4 w-4" />}
          onClick={async () => {
            setBusy(true);
            setError(null);
            try {
              await post('/api/admin/blocks', { blockerId: a.id, blockedId: b.id, ...(note.trim() ? { note: note.trim() } : {}) });
              onDone();
            } catch (e) {
              setError(err(e));
            } finally {
              setBusy(false);
            }
          }}
        >
          {ar ? 'افصل بينهم' : 'Keep them apart'}
        </Button>
      </div>
    </Sheet>
  );
}
