import { AnimatePresence, motion } from 'framer-motion';
import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Ban, Check, MessageCircle, Pencil, Search, SendHorizontal, Star, Trash2, UserPlus, Users } from 'lucide-react';
import { del, get, patch, post } from '../lib/api';
import { useI18n } from '../lib/i18n';
import { useData } from '../lib/hooks';
import { fill } from '../lib/format';
import { useToast } from '../components/Toast';
import { BlockPicker } from '../components/PrivacySettings';
import { useConfirm } from '../components/Confirm';
import { Avatar, Button, EmptyState, ErrorNote, Field, PageHeader, Sheet, Skeleton, cx } from '../components/ui';

export default function Contacts() {
  const { t, err, lang } = useI18n();
  const nav = useNavigate();
  const toast = useToast();
  const confirm = useConfirm();
  const [q, setQ] = useState('');
  const { data, reload } = useData<{ contacts: any[] }>(`/api/contacts${q.trim() ? `?q=${encodeURIComponent(q.trim())}` : ''}`, [q]);
  const [add, setAdd] = useState(false);
  const [rename, setRename] = useState<any>(null);
  const [blocking, setBlocking] = useState<any>(null);
  const [nick, setNick] = useState('');

  const message = async (c: any) => {
    try {
      const r = await post('/api/messages/conversations', { type: 'user_to_user', recipientId: c.user_id });
      nav(`/app/messages/${r.conversationId}`);
    } catch (e) {
      toast(err(e), 'error');
    }
  };

  const list = data?.contacts ?? [];
  const groups = list.reduce<Record<string, any[]>>((g, c) => {
    const k = c.favourite ? '★' : String(Array.from(String(c.nickname || c.full_name || '?').trim())[0] ?? '?').toUpperCase();
    (g[k] ??= []).push(c);
    return g;
  }, {});

  return (
    <div className="mx-auto max-w-2xl">
      <PageHeader title={t.contacts.title} lead={t.contacts.lead} actions={<Button icon={<UserPlus className="h-4 w-4" />} onClick={() => setAdd(true)}>{t.contacts.add}</Button>} />
      <label className="relative mb-4 block">
        <span className="sr-only">{t.contacts.search}</span>
        <Search className="pointer-events-none absolute start-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted" />
        <input value={q} onChange={(e) => setQ(e.target.value)} placeholder={t.contacts.search} className="field h-12 ps-10" type="search" />
      </label>
      {!data ? (
        <Skeleton className="h-48 rounded-2xl" />
      ) : !list.length ? (
        <EmptyState icon={<Users className="h-6 w-6" />} title={t.contacts.none} />
      ) : (
        <div className="space-y-5">
          {Object.entries(groups).map(([k, cs]) => (
            <section key={k}>
              <p className="mb-1.5 px-2 text-xs font-semibold text-muted">{k === '★' ? t.contacts.favourite : k}</p>
              <ul className="card divide-y divide-line">
                <AnimatePresence initial={false}>
                  {cs.map((c) => (
                    <motion.li key={c.id} layout exit={{ opacity: 0, height: 0 }} className="flex items-center gap-3 p-3">
                      <Avatar name={c.nickname || c.full_name} src={c.profile_image} size={44} />
                      <div className="min-w-0 flex-1">
                        <p className="truncate font-medium">{c.nickname || c.full_name}</p>
                        <p className="num truncate text-xs text-muted">
                          {c.nickname ? `${c.full_name} · ` : ''}
                          {c.wallet_id}
                        </p>
                      </div>
                      <button
                        onClick={async () => {
                          await patch(`/api/contacts/${c.id}`, { favourite: !c.favourite });
                          void reload();
                        }}
                        className={cx('rounded-lg p-2 transition', c.favourite ? 'text-gold' : 'text-muted hover:text-gold')}
                        aria-label={t.contacts.favourite}
                      >
                        <Star className={cx('h-4 w-4', c.favourite && 'fill-current')} />
                      </button>
                      <button onClick={() => nav(`/app/send?to=${encodeURIComponent(c.wallet_id)}`)} className="rounded-lg p-2 text-muted hover:bg-sunk hover:text-ink" aria-label={t.contacts.pay}>
                        <SendHorizontal className="h-4 w-4 flip-rtl" />
                      </button>
                      <button onClick={() => message(c)} className="rounded-lg p-2 text-muted hover:bg-sunk hover:text-ink" aria-label={t.contacts.message}>
                        <MessageCircle className="h-4 w-4" />
                      </button>
                      <button onClick={() => (setRename(c), setNick(c.nickname ?? ''))} className="rounded-lg p-2 text-muted hover:bg-sunk hover:text-ink" aria-label={t.contacts.rename}>
                        <Pencil className="h-4 w-4" />
                      </button>
                      <button
                        onClick={async () => {
                          if (!(await confirm({ title: fill(t.contacts.removeQ, { name: c.nickname || c.full_name }), body: t.contacts.removeB, confirmLabel: t.contacts.remove, tone: 'danger' }))) return;
                          await del(`/api/contacts/${c.id}`);
                          void reload();
                        }}
                        className="rounded-lg p-2 text-muted hover:bg-stitch/10 hover:text-stitch"
                        aria-label={t.contacts.remove}
                      >
                        <Trash2 className="h-4 w-4" />
                      </button>
                    </motion.li>
                  ))}
                </AnimatePresence>
              </ul>
            </section>
          ))}
        </div>
      )}

      <AddContact open={add} onClose={() => setAdd(false)} saved={list} onDone={() => (setAdd(false), void reload())} />
      <Sheet open={!!rename} onClose={() => setRename(null)} title={t.contacts.rename}>
        <form
          className="space-y-4"
          onSubmit={async (e) => {
            e.preventDefault();
            await patch(`/api/contacts/${rename.id}`, { nickname: nick.trim() || null });
            setRename(null);
            void reload();
          }}
        >
          <Field label={t.contacts.nickname} value={nick} onChange={(e) => setNick(e.target.value)} maxLength={60} autoFocus />
          <Button block>{t.common.save}</Button>
          <button type="button" onClick={() => (setBlocking(rename), setRename(null))} className="mx-auto flex items-center gap-1.5 py-1 text-xs text-muted hover:text-stitch">
            <Ban className="h-3.5 w-3.5" /> {lang === 'ar' ? 'بلّك هالشخص' : 'Block this person'}
          </button>
        </form>
      </Sheet>
      <BlockPicker open={!!blocking} onClose={() => setBlocking(null)} preset={blocking ? { id: blocking.user_id, full_name: blocking.full_name, profile_image: blocking.profile_image } : null} onDone={() => (setBlocking(null), void reload())} />
    </div>
  );
}

/** Find someone on S-Taler by name, e-mail or wallet ID — like starting a chat — then confirm. */
function AddContact({ open, onClose, saved, onDone }: { open: boolean; onClose: () => void; saved: any[]; onDone: () => void }) {
  const { t, err, lang } = useI18n();
  const ar = lang === 'ar';
  const toast = useToast();
  const [q, setQ] = useState('');
  const [users, setUsers] = useState<any[] | null>(null);
  const [pick, setPick] = useState<any>(null);
  const [nick, setNick] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    setQ('');
    setPick(null);
    setNick('');
    setError(null);
  }, [open]);
  useEffect(() => {
    if (q.trim().length < 2) {
      setUsers(null);
      return;
    }
    const h = setTimeout(() => {
      get<{ users: any[] }>(`/api/messages/search-users?q=${encodeURIComponent(q.trim())}`)
        .then((d) => setUsers(d.users))
        .catch(() => setUsers([]));
    }, 220);
    return () => clearTimeout(h);
  }, [q]);
  const have = new Set(saved.map((c) => String(c.user_id)));
  const ROLE: Record<string, string> = ar ? { user: 'شخص', merchant: 'متجر', exchange: 'صرّاف' } : { user: 'Person', merchant: 'Store', exchange: 'Cash agent' };
  return (
    <Sheet open={open} onClose={onClose} title={t.contacts.add}>
      {pick ? (
        <div className="space-y-4">
          <div className="flex items-center gap-3 rounded-2xl bg-sky/[0.07] p-3 ring-1 ring-sky/25">
            <Avatar name={pick.full_name} src={pick.profile_image} size={48} />
            <div className="min-w-0 flex-1">
              <p className="truncate font-semibold">{pick.full_name}</p>
              <p className="truncate text-xs text-muted">
                {[ROLE[pick.role], pick.wallet_id].filter(Boolean).join(' · ')}
              </p>
            </div>
            <button onClick={() => setPick(null)} className="rounded-full px-3 py-1.5 text-xs text-sky hover:bg-sky/10">
              {ar ? 'غيّر' : 'Change'}
            </button>
          </div>
          <Field label={`${t.contacts.nickname} (${t.common.optional})`} value={nick} onChange={(e) => setNick(e.target.value)} maxLength={60} placeholder={ar ? 'مثلًا: أبو أحمد، المحاسب…' : 'e.g. Mum, the accountant…'} />
          <ErrorNote>{error}</ErrorNote>
          <Button
            block
            size="lg"
            loading={busy}
            icon={<UserPlus className="h-4 w-4" />}
            onClick={async () => {
              setBusy(true);
              setError(null);
              try {
                await post('/api/contacts', { userId: pick.id, ...(nick.trim() ? { nickname: nick.trim() } : {}) });
                toast(ar ? `انضاف ${pick.full_name} لجهات اتصالك` : `${pick.full_name} added`);
                onDone();
              } catch (e) {
                setError(err(e));
              } finally {
                setBusy(false);
              }
            }}
          >
            {ar ? `أضف ${pick.full_name}` : `Add ${pick.full_name}`}
          </Button>
        </div>
      ) : (
        <div>
          <label className="relative block">
            <Search className="pointer-events-none absolute start-4 top-1/2 h-5 w-5 -translate-y-1/2 text-muted" />
            <input autoFocus value={q} onChange={(e) => setQ(e.target.value)} placeholder={ar ? 'دوّر بالاسم، الإيميل أو رقم المحفظة' : 'Search name, e-mail or wallet ID'} className="field ps-12" type="search" />
          </label>
          <div className="mt-3 max-h-80 overflow-y-auto">
            {users === null ? (
              <p className="px-2 py-8 text-center text-sm text-muted">{ar ? 'اكتب حرفين أو أكثر لتلاقي ناس على S‑Taler' : 'Type 2+ letters to find people on S-Taler'}</p>
            ) : !users.length ? (
              <p className="px-2 py-8 text-center text-sm text-muted">{ar ? 'ما لقينا حدا بهالاسم' : 'Nobody found'}</p>
            ) : (
              users.map((u) => {
                const already = have.has(String(u.id));
                return (
                  <button key={u.id} disabled={already} onClick={() => setPick(u)} className="flex w-full items-center gap-3 rounded-xl px-2 py-2.5 text-start transition hover:bg-sunk disabled:opacity-60">
                    <Avatar name={u.full_name} src={u.profile_image} size={38} />
                    <span className="min-w-0 flex-1">
                      <span className="block truncate font-medium">{u.full_name}</span>
                      <span className="block truncate text-xs text-muted">{[ROLE[u.role], u.wallet_id].filter(Boolean).join(' · ')}</span>
                    </span>
                    {already ? (
                      <span className="inline-flex shrink-0 items-center gap-1 text-xs text-olive">
                        <Check className="h-3.5 w-3.5" /> {ar ? 'عندك' : 'Saved'}
                      </span>
                    ) : (
                      <UserPlus className="h-4 w-4 shrink-0 text-muted" />
                    )}
                  </button>
                );
              })
            )}
          </div>
        </div>
      )}
    </Sheet>
  );
}
