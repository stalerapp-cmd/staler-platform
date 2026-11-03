import { useEffect, useState } from 'react';
import { ArrowLeftRight, Ban, Search, ShieldOff, UserRound } from 'lucide-react';
import { del, get, post } from '../lib/api';
import { useI18n } from '../lib/i18n';
import { useData } from '../lib/hooks';
import { relative } from '../lib/format';
import { useToast } from '../components/Toast';
import { useConfirm } from '../components/Confirm';
import { Avatar, Badge, Button, EmptyState, ErrorNote, PageHeader, Sheet, Skeleton, cx } from '../components/ui';

const ROLE: Record<string, [string, string]> = { user: ['شخص', 'Person'], merchant: ['تاجر', 'Merchant'], exchange: ['صرّاف', 'Cash agent'], admin: ['إدارة', 'Admin'] };

/** Admins: every block between accounts — who blocked whom, and the power to lift or add one. */
export function AdminBlocks() {
  const { lang, err } = useI18n();
  const ar = lang === 'ar';
  const toast = useToast();
  const confirm = useConfirm();
  const [q, setQ] = useState('');
  const [by, setBy] = useState<'all' | 'people' | 'team'>('all');
  const data = useData<{ blocks: any[]; totals: { all: number; team: number } }>(`/api/admin/blocks?${new URLSearchParams({ by, ...(q.trim() ? { q: q.trim() } : {}) })}`, [q, by]);
  const [adding, setAdding] = useState(false);
  const lift = async (b: any) => {
    if (!(await confirm({ title: ar ? 'تشيل البلوك؟' : 'Lift this block?', body: ar ? `${b.blocked.full_name} و${b.blocker.full_name} بيرجعوا يقدروا يتعاملوا مع بعض.` : 'They can deal with each other again.', confirmLabel: ar ? 'شيل البلوك' : 'Lift' }))) return;
    try {
      await del(`/api/admin/blocks/${b.id}`);
      toast(ar ? 'انشال البلوك' : 'Block lifted');
      void data.reload();
    } catch (e) {
      toast(err(e), 'error');
    }
  };
  const t = data.data?.totals;
  return (
    <div>
      <PageHeader
        title={ar ? 'البلوكات' : 'Blocks'}
        lead={ar ? 'مين بلّك مين — ناس، تجار، صرّافين. بتقدر تشيل أي بلوك أو تفصل بين حسابين بنفسك.' : 'Who blocked whom — people, merchants, cash agents. Lift any block or keep two accounts apart yourself.'}
        actions={
          <Button icon={<Ban className="h-4 w-4" />} onClick={() => setAdding(true)}>
            <span className="hidden sm:inline">{ar ? 'افصل بين حسابين' : 'Keep two apart'}</span>
          </Button>
        }
      />
      <div className="mb-4 flex flex-wrap items-center gap-2">
        {(
          [
            ['all', ar ? 'الكل' : 'All', t?.all],
            ['people', ar ? 'من الناس' : 'By people', t ? t.all - t.team : undefined],
            ['team', ar ? 'من الإدارة' : 'By the team', t?.team],
          ] as const
        ).map(([k, l, n]) => (
          <button key={k} onClick={() => setBy(k)} className={cx('inline-flex items-center gap-1.5 rounded-full px-3.5 py-1.5 text-sm transition', by === k ? 'bg-night text-white dark:bg-white/15' : 'bg-surface text-muted ring-1 ring-line hover:text-ink')}>
            {l} {n != null && <span className="num text-xs opacity-75">{n}</span>}
          </button>
        ))}
      </div>
      <label className="relative mb-4 block">
        <Search className="pointer-events-none absolute start-4 top-1/2 h-5 w-5 -translate-y-1/2 text-muted" />
        <input value={q} onChange={(e) => setQ(e.target.value)} placeholder={ar ? 'دوّر بالاسم أو الإيميل' : 'Search name or e-mail'} className="field h-12 rounded-2xl ps-12" type="search" />
      </label>
      {!data.data ? (
        <Skeleton className="h-48 rounded-3xl" />
      ) : !data.data.blocks.length ? (
        <EmptyState icon={<Ban className="h-6 w-6" />} title={ar ? 'ما في بلوكات' : 'No blocks'} />
      ) : (
        <ul className="card divide-y divide-line overflow-hidden">
          {data.data.blocks.map((b) => (
            <li key={b.id} className="flex flex-wrap items-center gap-3 px-4 py-3">
              <Who u={b.blocker} ar={ar} />
              <span className="flex flex-col items-center text-[11px] text-stitch">
                <Ban className="h-4 w-4" />
                {ar ? 'بلّك' : 'blocked'}
              </span>
              <Who u={b.blocked} ar={ar} />
              <span className="ms-auto flex items-center gap-2">
                <span className="text-end text-[11px] text-muted">
                  {b.by_team ? <Badge tone="info">{ar ? `الإدارة · ${b.admin_name ?? ''}` : `Team · ${b.admin_name ?? ''}`}</Badge> : null}
                  <span className="block">{relative(b.created_at, lang)}</span>
                </span>
                <button onClick={() => lift(b)} className="inline-flex items-center gap-1 rounded-full bg-sunk px-3 py-1.5 text-xs font-semibold hover:bg-olive/15">
                  <ShieldOff className="h-3.5 w-3.5" /> {ar ? 'شيل' : 'Lift'}
                </button>
              </span>
              {b.note && <p className="w-full text-xs text-muted">“{b.note}”</p>}
            </li>
          ))}
        </ul>
      )}
      <AddBlock open={adding} onClose={() => setAdding(false)} onDone={() => (setAdding(false), void data.reload())} />
    </div>
  );
}

function Who({ u, ar }: { u: any; ar: boolean }) {
  return (
    <span className="flex min-w-0 items-center gap-2">
      <Avatar name={u.full_name} src={u.profile_image} size={34} />
      <span className="min-w-0">
        <span className="block max-w-[9rem] truncate text-sm font-semibold sm:max-w-[14rem]">{u.full_name}</span>
        <span className="block text-[11px] text-muted">{ROLE[u.role]?.[ar ? 0 : 1] ?? u.role}</span>
      </span>
    </span>
  );
}

function UserFind({ value, onPick, label }: { value: any; onPick: (u: any) => void; label: string }) {
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
      get<{ users: any[] }>(`/api/admin/users?${new URLSearchParams({ q: q.trim(), limit: '8' })}`)
        .then((r) => setFound(r.users.filter((u) => u.role !== 'admin')))
        .catch(() => setFound([]));
    }, 220);
    return () => clearTimeout(h);
  }, [q]);
  return (
    <div>
      <p className="mb-1.5 text-sm font-medium text-ink/80">{label}</p>
      {value ? (
        <div className="flex items-center gap-3 rounded-2xl bg-sunk/60 p-2.5">
          <Avatar name={value.full_name} src={value.profile_image} size={36} />
          <span className="min-w-0 flex-1">
            <span className="block truncate text-sm font-semibold">{value.full_name}</span>
            <span className="block truncate text-xs text-muted" dir="ltr">
              {value.email}
            </span>
          </span>
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
                    <Avatar name={u.full_name} src={u.profile_image} size={30} />
                    <span className="min-w-0 flex-1 truncate text-sm">{u.full_name}</span>
                    <span className="text-[11px] text-muted">{ROLE[u.role]?.[ar ? 0 : 1]}</span>
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

function AddBlock({ open, onClose, onDone }: { open: boolean; onClose: () => void; onDone: () => void }) {
  const { lang, err } = useI18n();
  const ar = lang === 'ar';
  const toast = useToast();
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
  const go = async () => {
    setBusy(true);
    setError(null);
    try {
      await post('/api/admin/blocks', { blockerId: a.id, blockedId: b.id, ...(note.trim() ? { note: note.trim() } : {}) });
      toast(ar ? 'انفصلوا' : 'Kept apart');
      onDone();
    } catch (e) {
      setError(err(e));
    } finally {
      setBusy(false);
    }
  };
  return (
    <Sheet open={open} onClose={onClose} title={ar ? 'افصل بين حسابين' : 'Keep two accounts apart'}>
      <div className="space-y-4">
        <UserFind label={ar ? 'احمي هالشخص' : 'Protect this person'} value={a} onPick={setA} />
        <div className="flex justify-center text-muted">
          <ArrowLeftRight className="h-5 w-5" />
        </div>
        <UserFind label={ar ? 'من هالشخص' : 'From this person'} value={b} onPick={setB} />
        <input value={note} onChange={(e) => setNote(e.target.value)} maxLength={300} placeholder={ar ? 'السبب (للفريق بس)' : 'Reason (team only)'} className="field" />
        <p className="flex items-start gap-2 rounded-2xl bg-sunk/60 p-3 text-xs text-muted">
          <UserRound className="mt-0.5 h-4 w-4 shrink-0" />
          {ar ? 'بيصير بلوك من الإدارة: ما بيتعاملوا مع بعض أبدًا، وصاحب الحماية ما بيقدر يشيله لحاله.' : 'A team block: no dealings either way, and the protected person can’t lift it themselves.'}
        </p>
        <ErrorNote>{error}</ErrorNote>
        <Button block variant="danger" loading={busy} disabled={!a || !b || a.id === b.id} icon={<Ban className="h-4 w-4" />} onClick={go}>
          {ar ? 'افصل بينهم' : 'Keep them apart'}
        </Button>
      </div>
    </Sheet>
  );
}
