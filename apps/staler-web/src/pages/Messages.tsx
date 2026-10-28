import { AnimatePresence, motion } from 'framer-motion';
import { useEffect, useRef, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { ArrowLeft, LifeBuoy, MessageCirclePlus, MessagesSquare, SendHorizontal } from 'lucide-react';
import { get, patch, post } from '../lib/api';
import { useAuth } from '../lib/auth';
import { useI18n } from '../lib/i18n';
import { useData, usePolling } from '../lib/hooks';
import { relative } from '../lib/format';
import { useToast } from '../components/Toast';
import { Avatar, Button, EmptyState, PageHeader, Sheet, Skeleton, cx } from '../components/ui';

function title(c: any, t: any) {
  if (c.type === 'support') return t.messages.supportTitle;
  return c.participants?.[0]?.full_name ?? c.title ?? '—';
}

function Chat({ id }: { id: string }) {
  const { t, lang, err } = useI18n();
  const { user } = useAuth();
  const toast = useToast();
  const [msgs, setMsgs] = useState<any[] | null>(null);
  const [text, setText] = useState('');
  const [sending, setSending] = useState(false);
  const end = useRef<HTMLDivElement>(null);
  const load = async () => {
    try {
      const d = await get(`/api/messages/conversations/${id}/messages?limit=100`);
      setMsgs(d.messages);
    } catch (e) {
      toast(err(e), 'error');
    }
  };
  useEffect(() => {
    setMsgs(null);
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id]);
  usePolling(load, 4000);
  useEffect(() => end.current?.scrollIntoView({ behavior: 'smooth' }), [msgs?.length]);

  const send = async (e: React.FormEvent) => {
    e.preventDefault();
    const content = text.trim();
    if (!content) return;
    setSending(true);
    try {
      const r = await post(`/api/messages/conversations/${id}/messages`, { content });
      setMsgs((m) => [...(m ?? []), { ...r.message, sender_name: user?.full_name }]);
      setText('');
    } catch (e2) {
      toast(err(e2), 'error');
    } finally {
      setSending(false);
    }
  };

  return (
    <div className="flex h-[calc(100dvh-14rem)] min-h-[420px] flex-col lg:h-[calc(100dvh-10rem)]">
      <div className="flex-1 space-y-3 overflow-y-auto p-4">
        {!msgs ? (
          <Skeleton className="h-16 w-2/3" />
        ) : (
          <AnimatePresence initial={false}>
            {msgs.map((m) => (
              <motion.div key={m.id} initial={{ opacity: 0, y: 8, scale: 0.98 }} animate={{ opacity: 1, y: 0, scale: 1 }} className={cx('flex items-end gap-2', m.mine && 'flex-row-reverse')}>
                {!m.mine && <Avatar name={m.sender_name} src={m.sender_image} size={30} />}
                <div className={cx('max-w-[78%] rounded-2xl px-4 py-2.5', m.mine ? 'rounded-ee-md bg-night text-white dark:bg-sky/30' : 'rounded-es-md bg-sunk')}>
                  {!m.mine && <p className="mb-0.5 text-xs font-medium text-stitch">{m.sender_name}</p>}
                  {/* Rendered as text — never as HTML — so message content can't inject markup. */}
                  <p className="whitespace-pre-wrap break-words">{m.content}</p>
                  <p className={cx('mt-1 text-[11px]', m.mine ? 'text-white/60' : 'text-muted')}>
                    {relative(m.created_at, lang)}
                    {m.is_edited ? ` · ${t.messages.edited}` : ''}
                  </p>
                </div>
              </motion.div>
            ))}
          </AnimatePresence>
        )}
        <div ref={end} />
      </div>
      <form onSubmit={send} className="flex items-end gap-2 border-t border-line p-3">
        <textarea
          value={text}
          onChange={(e) => setText(e.target.value.slice(0, 2000))}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !e.shiftKey) {
              e.preventDefault();
              void send(e as any);
            }
          }}
          rows={1}
          placeholder={t.messages.placeholder}
          className="field max-h-32 min-h-[46px] flex-1 resize-none py-2.5"
        />
        <Button aria-label={t.messages.send} loading={sending} disabled={!text.trim()} className="h-[46px] w-[46px] !px-0">
          <SendHorizontal className="h-5 w-5 flip-rtl" />
        </Button>
      </form>
    </div>
  );
}

function NewChat({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { t, err } = useI18n();
  const nav = useNavigate();
  const toast = useToast();
  const [q, setQ] = useState('');
  const [users, setUsers] = useState<any[]>([]);
  useEffect(() => {
    if (q.trim().length < 2) return setUsers([]);
    const h = setTimeout(() => {
      get(`/api/messages/search-users?q=${encodeURIComponent(q.trim())}`)
        .then((d) => setUsers(d.users))
        .catch(() => setUsers([]));
    }, 250);
    return () => clearTimeout(h);
  }, [q]);
  const start = async (body: any) => {
    try {
      const r = await post('/api/messages/conversations', body);
      onClose();
      nav(`/app/messages/${r.conversationId}`);
    } catch (e) {
      toast(err(e), 'error');
    }
  };
  return (
    <Sheet open={open} onClose={onClose} title={t.messages.newChat}>
      <Button block variant="secondary" icon={<LifeBuoy className="h-5 w-5" />} onClick={() => start({ type: 'support' })}>
        {t.messages.support}
      </Button>
      <div className="my-5 border-t border-dashed border-line" />
      <input value={q} onChange={(e) => setQ(e.target.value)} placeholder={t.messages.searchPeople} className="field" autoFocus />
      <ul className="mt-3 max-h-72 overflow-y-auto">
        {users.map((u) => (
          <li key={u.id}>
            <button onClick={() => start({ type: 'user_to_user', recipientId: u.id })} className="flex w-full items-center gap-3 rounded-xl px-2 py-2.5 text-start hover:bg-sunk">
              <Avatar name={u.full_name} src={u.profile_image} size={36} />
              <span>{u.full_name}</span>
            </button>
          </li>
        ))}
      </ul>
    </Sheet>
  );
}

export default function Messages() {
  const { t, lang } = useI18n();
  const { id } = useParams();
  const convs = useData<{ conversations: any[] }>('/api/messages/conversations');
  usePolling(() => convs.reload(), 10_000);
  const [newOpen, setNewOpen] = useState(false);
  const current = convs.data?.conversations.find((c) => String(c.id) === id);

  return (
    <div>
      <PageHeader
        title={t.messages.title}
        actions={
          <Button icon={<MessageCirclePlus className="h-4 w-4" />} onClick={() => setNewOpen(true)}>
            {t.messages.newChat}
          </Button>
        }
      />
      <div className="card grid overflow-hidden lg:grid-cols-[320px_1fr]">
        <aside className={cx('border-line lg:border-e', id && 'hidden lg:block')}>
          {!convs.data ? (
            <div className="space-y-3 p-4">
              {[0, 1, 2].map((i) => (
                <Skeleton key={i} className="h-14" />
              ))}
            </div>
          ) : !convs.data.conversations.length ? (
            <EmptyState icon={<MessagesSquare className="h-6 w-6" />} title={t.messages.none} />
          ) : (
            <ul className="max-h-[70dvh] overflow-y-auto p-2">
              {convs.data.conversations.map((c) => (
                <li key={c.id}>
                  <Link to={`/app/messages/${c.id}`} className={cx('flex items-center gap-3 rounded-xl p-3 transition hover:bg-sunk', String(c.id) === id && 'bg-sunk')}>
                    {c.type === 'support' ? (
                      <span className="grid h-10 w-10 place-items-center rounded-full bg-olive/15 text-olive">
                        <LifeBuoy className="h-5 w-5" />
                      </span>
                    ) : (
                      <Avatar name={title(c, t)} src={c.participants?.[0]?.profile_image} />
                    )}
                    <span className="min-w-0 flex-1">
                      <span className="flex items-center justify-between gap-2">
                        <span className="truncate font-medium">{title(c, t)}</span>
                        {c.lastMessage && <span className="shrink-0 text-[11px] text-muted">{relative(c.lastMessage.created_at, lang)}</span>}
                      </span>
                      <span className="flex items-center justify-between gap-2">
                        <span className="truncate text-sm text-muted">{c.lastMessage?.content ?? '—'}</span>
                        {c.unread > 0 && <span className="num grid h-5 min-w-5 place-items-center rounded-full bg-stitch px-1.5 text-[11px] text-white">{c.unread}</span>}
                      </span>
                    </span>
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </aside>
        <section className={cx(!id && 'hidden lg:block')}>
          {id ? (
            <>
              <div className="flex items-center justify-between gap-3 border-b border-line px-4 py-3">
                <div className="flex items-center gap-3">
                  <Link to="/app/messages" className="rounded-lg p-1.5 text-muted lg:hidden" aria-label={t.common.back}>
                    <ArrowLeft className="h-5 w-5 flip-rtl" />
                  </Link>
                  <p className="font-medium">{current ? title(current, t) : '…'}</p>
                </div>
                {current?.status === 'active' && current.type === 'support' && (
                  <button className="text-sm text-muted hover:text-stitch" onClick={() => patch(`/api/messages/conversations/${id}/close`).then(() => convs.reload())}>
                    {t.messages.closeChat}
                  </button>
                )}
              </div>
              {current?.status === 'closed' && <p className="bg-sunk px-4 py-2 text-center text-sm text-muted">{t.messages.closed}</p>}
              <Chat id={id} />
            </>
          ) : (
            <div className="grid h-full min-h-[420px] place-items-center text-muted">{t.messages.pick}</div>
          )}
        </section>
      </div>
      <NewChat open={newOpen} onClose={() => setNewOpen(false)} />
    </div>
  );
}
