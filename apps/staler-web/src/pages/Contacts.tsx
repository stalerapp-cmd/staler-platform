import { AnimatePresence, motion } from 'framer-motion';
import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { MessageCircle, Pencil, Search, SendHorizontal, Star, Trash2, UserPlus, Users } from 'lucide-react';
import { del, patch, post } from '../lib/api';
import { useI18n } from '../lib/i18n';
import { useData } from '../lib/hooks';
import { fill } from '../lib/format';
import { useToast } from '../components/Toast';
import { useConfirm } from '../components/Confirm';
import { Avatar, Button, EmptyState, ErrorNote, Field, PageHeader, Sheet, Skeleton, cx } from '../components/ui';

export default function Contacts() {
  const { t, err } = useI18n();
  const nav = useNavigate();
  const toast = useToast();
  const confirm = useConfirm();
  const [q, setQ] = useState('');
  const { data, reload } = useData<{ contacts: any[] }>(`/api/contacts${q.trim() ? `?q=${encodeURIComponent(q.trim())}` : ''}`, [q]);
  const [add, setAdd] = useState(false);
  const [who, setWho] = useState('');
  const [nick, setNick] = useState('');
  const [rename, setRename] = useState<any>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

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

      <Sheet open={add} onClose={() => setAdd(false)} title={t.contacts.add}>
        <form
          className="space-y-4"
          onSubmit={async (e) => {
            e.preventDefault();
            setBusy(true);
            setError(null);
            const v = who.trim();
            try {
              await post('/api/contacts', { ...(v.includes('@') ? { email: v } : { walletId: v }), ...(nick.trim() ? { nickname: nick.trim() } : {}) });
              toast(t.contacts.found);
              setAdd(false);
              setWho('');
              setNick('');
              void reload();
            } catch (e2) {
              setError(err(e2));
            } finally {
              setBusy(false);
            }
          }}
        >
          <Field label={t.contacts.who} dir="ltr" value={who} onChange={(e) => setWho(e.target.value)} required />
          <Field label={`${t.contacts.nickname} (${t.common.optional})`} value={nick} onChange={(e) => setNick(e.target.value)} maxLength={60} />
          <ErrorNote>{error}</ErrorNote>
          <Button block loading={busy}>
            {t.contacts.add}
          </Button>
        </form>
      </Sheet>
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
        </form>
      </Sheet>
    </div>
  );
}
