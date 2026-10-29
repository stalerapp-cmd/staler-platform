import { AnimatePresence, motion } from 'framer-motion';
import { Fragment, useEffect, useRef, useState } from 'react';
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { ArrowLeft, Copy, CornerUpLeft, ExternalLink, LifeBuoy, MessageCirclePlus, MessagesSquare, Pencil, SendHorizontal, Smile, Trash2, UserPlus, X } from 'lucide-react';
import { del, get, patch, post, PUBLIC_ORIGIN } from '../lib/api';
import { useI18n } from '../lib/i18n';
import { useData, usePolling } from '../lib/hooks';
import { relative } from '../lib/format';
import { useToast } from '../components/Toast';
import { Avatar, Button, EmptyState, PageHeader, Sheet, Skeleton, cx } from '../components/ui';
import { useConfirm } from '../components/Confirm';

const EMOJIS = ['❤️', '😂', '👍', '🙏', '😮', '😢', '🔥', '🎉', '👏', '😍', '🤝', '✅', '💰', '🛍️', '📦', '🚚', '😊', '😅', '🤔', '👌', '🌙', '☕', '🌹', '💯'];
const QUICK = EMOJIS.slice(0, 6);

function title(c: any, t: any) {
  if (c.type === 'support') return t.messages.supportTitle;
  return c.participants?.[0]?.full_name ?? c.title ?? '—';
}

function dayLabel(d: string, t: any, lang: string) {
  const day = new Date(d);
  const today = new Date();
  const y = new Date();
  y.setDate(today.getDate() - 1);
  if (day.toDateString() === today.toDateString()) return t.messages.today;
  if (day.toDateString() === y.toDateString()) return t.messages.yesterday;
  return new Intl.DateTimeFormat(lang === 'ar' ? 'ar-u-nu-latn' : 'en-GB', { day: 'numeric', month: 'long' }).format(day);
}

/** Text with clickable links; S-Taler links become a small card. */
function Rich({ text, mine }: { text: string; mine: boolean }) {
  const { t } = useI18n();
  const parts = text.split(/(https?:\/\/[^\s]+)/g);
  const own = (u: string) => {
    try {
      return [location.origin, PUBLIC_ORIGIN].includes(new URL(u).origin);
    } catch {
      return false;
    }
  };
  return (
    <>
      {parts.map((p, i) =>
        /^https?:\/\//.test(p) ? (
          own(p) ? (
            <Link
              key={i}
              to={new URL(p).pathname + new URL(p).search}
              className={cx('my-1.5 flex items-center gap-2 rounded-xl px-3 py-2 text-sm font-medium', mine ? 'bg-white/15 text-white' : 'bg-surface text-ink ring-1 ring-line')}
            >
              <ExternalLink className="h-4 w-4 shrink-0" /> <span className="truncate">{t.messages.openLink}</span>
            </Link>
          ) : (
            <a key={i} href={p} target="_blank" rel="noopener noreferrer nofollow" className="break-all underline underline-offset-2">
              {p}
            </a>
          )
        ) : (
          <Fragment key={i}>{p}</Fragment>
        ),
      )}
    </>
  );
}

function Chat({ id, conv }: { id: string; conv: any }) {
  const { t, lang, err } = useI18n();
  const toast = useToast();
  const confirm = useConfirm();
  const [msgs, setMsgs] = useState<any[] | null>(null);
  const [text, setText] = useState('');
  const [sending, setSending] = useState(false);
  const [reply, setReply] = useState<any>(null);
  const [editing, setEditing] = useState<any>(null);
  const [menu, setMenu] = useState<string | null>(null);
  const [menuDown, setMenuDown] = useState(false);
  const scroller = useRef<HTMLDivElement>(null);
  const [emoji, setEmoji] = useState(false);
  const end = useRef<HTMLDivElement>(null);
  const input = useRef<HTMLTextAreaElement>(null);
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
    setReply(null);
    setEditing(null);
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id]);
  usePolling(load, 4000);
  useEffect(() => {
    end.current?.scrollIntoView({ behavior: 'smooth', block: 'end' });
  }, [msgs?.length]);

  const send = async (e?: React.FormEvent) => {
    e?.preventDefault();
    const content = text.trim();
    if (!content) return;
    setSending(true);
    try {
      if (editing) {
        await patch(`/api/messages/messages/${editing.id}`, { content });
        setMsgs((m) => (m ?? []).map((x) => (x.id === editing.id ? { ...x, content, is_edited: true } : x)));
        setEditing(null);
      } else {
        const r = await post(`/api/messages/conversations/${id}/messages`, { content, ...(reply ? { replyTo: reply.id } : {}) });
        setMsgs((m) => [...(m ?? []), { ...r.message, reply: reply ? { name: reply.sender_name, content: reply.content } : null }]);
        setReply(null);
      }
      setText('');
      setEmoji(false);
    } catch (e2) {
      toast(err(e2), 'error');
    } finally {
      setSending(false);
    }
  };

  const react = async (m: any, e: string) => {
    setMenu(null);
    try {
      const r = await post(`/api/messages/messages/${m.id}/react`, { emoji: e });
      setMsgs((ms) => (ms ?? []).map((x) => (x.id === m.id ? { ...x, reactions: r.reactions } : x)));
    } catch (e2) {
      toast(err(e2), 'error');
    }
  };

  const remove = async (m: any) => {
    setMenu(null);
    if (!(await confirm({ title: t.messages.deleteQ, body: t.messages.deleteB, confirmLabel: t.messages.deleteOk, tone: 'danger' }))) return;
    try {
      await del(`/api/messages/messages/${m.id}`);
      setMsgs((ms) => (ms ?? []).map((x) => (x.id === m.id ? { ...x, is_deleted: true, content: '', reactions: {} } : x)));
    } catch (e) {
      toast(err(e), 'error');
    }
  };

  const closed = conv?.status === 'closed';
  return (
    <div className="flex min-h-0 flex-1 flex-col lg:h-[calc(100dvh-11rem)] lg:min-h-[420px] lg:flex-none" onClick={() => setMenu(null)}>
      <div ref={scroller} className="chat-ground flex-1 space-y-1 overflow-y-auto p-3 sm:p-4">
        {!msgs ? (
          <Skeleton className="h-16 w-2/3" />
        ) : (
          <AnimatePresence initial={false}>
            {msgs.map((m, i) => {
              const prev = msgs[i - 1];
              const newDay = !prev || new Date(prev.created_at).toDateString() !== new Date(m.created_at).toDateString();
              const grouped = prev && !newDay && prev.sender_id === m.sender_id;
              const reacts = Object.entries((m.reactions ?? {}) as Record<string, string[]>).filter(([, u]) => u.length);
              const canEdit = m.mine && !m.is_deleted && Date.now() - new Date(m.created_at).getTime() < 15 * 60_000;
              return (
                <Fragment key={m.id}>
                  {newDay && (
                    <div className="sticky top-0 z-10 flex justify-center py-2">
                      <span className="rounded-full bg-surface/90 px-3 py-1 text-xs text-muted shadow-sm ring-1 ring-line backdrop-blur">{dayLabel(m.created_at, t, lang)}</span>
                    </div>
                  )}
                  <motion.div
                    layout
                    initial={{ opacity: 0, y: 10, scale: 0.96 }}
                    animate={{ opacity: 1, y: 0, scale: 1 }}
                    className={cx('group flex items-end gap-2', m.mine && 'flex-row-reverse', grouped ? 'mt-0.5' : 'mt-3')}
                  >
                    {!m.mine && (grouped ? <span className="w-[30px]" /> : <Avatar name={m.sender_name} src={m.sender_image} size={30} />)}
                    <div className={cx('relative max-w-[80%]', reacts.length > 0 && 'mb-3')}>
                      <button
                        type="button"
                        onClick={(e) => {
                          e.stopPropagation();
                          if (m.is_deleted) return;
                          // Open the menu below the bubble when there's no room above it.
                          const top = (e.currentTarget as HTMLElement).getBoundingClientRect().top - (scroller.current?.getBoundingClientRect().top ?? 0);
                          setMenuDown(top < 240);
                          setMenu(menu === m.id ? null : m.id);
                        }}
                        onContextMenu={(e) => {
                          e.preventDefault();
                          if (m.is_deleted) return;
                          const top = (e.currentTarget as HTMLElement).getBoundingClientRect().top - (scroller.current?.getBoundingClientRect().top ?? 0);
                          setMenuDown(top < 240);
                          setMenu(m.id);
                        }}
                        className={cx(
                          'block rounded-[1.3rem] px-4 py-2.5 text-start shadow-sm transition active:scale-[0.99]',
                          m.mine ? 'bg-night text-white dark:bg-sky/30' : 'bg-surface ring-1 ring-line',
                          m.mine ? (grouped ? 'rounded-ee-md' : 'rounded-ee-md') : 'rounded-es-md',
                          m.is_deleted && 'italic opacity-70',
                        )}
                      >
                        {!m.mine && !grouped && conv?.type === 'support' && <p className="mb-0.5 text-xs font-medium text-stitch">{m.sender_name}</p>}
                        {m.reply && (
                          <span className={cx('mb-1.5 block rounded-lg border-s-4 px-2 py-1 text-xs', m.mine ? 'border-white/50 bg-white/10' : 'border-stitch/60 bg-sunk')}>
                            <span className="block font-medium">{m.reply.name}</span>
                            <span className="line-clamp-2 opacity-80">{m.reply.deleted ? t.messages.deleted : m.reply.content}</span>
                          </span>
                        )}
                        {m.is_deleted ? (
                          <span>{t.messages.deleted}</span>
                        ) : (
                          // Rendered as text — never as HTML — so message content can't inject markup.
                          <span className={cx('whitespace-pre-wrap break-words', /^(?:\p{Extended_Pictographic}[\ufe0f\u200d\p{Emoji_Modifier}]*){1,3}$/u.test(m.content.trim()) && 'text-4xl leading-tight')}>
                            <Rich text={m.content} mine={m.mine} />
                          </span>
                        )}
                        <span className={cx('mt-1 block text-[11px]', m.mine ? 'text-white/60' : 'text-muted')}>
                          {relative(m.created_at, lang)}
                          {m.is_edited && !m.is_deleted ? ` · ${t.messages.edited}` : ''}
                        </span>
                      </button>
                      {reacts.length > 0 && (
                        <div className={cx('absolute -bottom-3 flex gap-0.5', m.mine ? 'start-2' : 'end-2')}>
                          {reacts.map(([e, users]) => (
                            <motion.button
                              key={e}
                              initial={{ scale: 0 }}
                              animate={{ scale: 1 }}
                              onClick={(ev) => {
                                ev.stopPropagation();
                                void react(m, e);
                              }}
                              className="flex items-center gap-0.5 rounded-full bg-surface px-1.5 py-0.5 text-xs shadow ring-1 ring-line"
                            >
                              {e}
                              {users.length > 1 && <span className="num text-[10px] text-muted">{users.length}</span>}
                            </motion.button>
                          ))}
                        </div>
                      )}
                      <AnimatePresence>
                        {menu === m.id && (
                          <motion.div
                            initial={{ opacity: 0, scale: 0.9, y: 6 }}
                            animate={{ opacity: 1, scale: 1, y: 0 }}
                            exit={{ opacity: 0, scale: 0.9 }}
                            onClick={(e) => e.stopPropagation()}
                            className={cx('absolute z-20 w-max min-w-[13rem] rounded-2xl bg-surface p-1.5 shadow-card ring-1 ring-line', menuDown ? 'top-full mt-2' : 'bottom-full mb-2', m.mine ? 'end-0' : 'start-0')}
                          >
                            <div className="flex justify-between gap-0.5 border-b border-line px-1 pb-1.5">
                              {QUICK.map((e) => (
                                <motion.button key={e} whileHover={{ scale: 1.3 }} whileTap={{ scale: 0.9 }} onClick={() => react(m, e)} className="rounded-lg p-1 text-xl">
                                  {e}
                                </motion.button>
                              ))}
                            </div>
                            <div className="pt-1 text-sm">
                              <button
                                className="flex w-full items-center gap-2 rounded-xl px-3 py-2 hover:bg-sunk"
                                onClick={() => {
                                  setReply(m);
                                  setEditing(null);
                                  setMenu(null);
                                  input.current?.focus();
                                }}
                              >
                                <CornerUpLeft className="h-4 w-4" /> {t.messages.reply}
                              </button>
                              <button
                                className="flex w-full items-center gap-2 rounded-xl px-3 py-2 hover:bg-sunk"
                                onClick={() => {
                                  void navigator.clipboard?.writeText(m.content);
                                  setMenu(null);
                                  toast(t.shop.copied);
                                }}
                              >
                                <Copy className="h-4 w-4" /> {t.messages.copy}
                              </button>
                              {canEdit && (
                                <button
                                  className="flex w-full items-center gap-2 rounded-xl px-3 py-2 hover:bg-sunk"
                                  onClick={() => {
                                    setEditing(m);
                                    setReply(null);
                                    setText(m.content);
                                    setMenu(null);
                                    input.current?.focus();
                                  }}
                                >
                                  <Pencil className="h-4 w-4" /> {t.messages.edit}
                                </button>
                              )}
                              {m.mine && (
                                <button className="flex w-full items-center gap-2 rounded-xl px-3 py-2 text-stitch hover:bg-stitch/10" onClick={() => remove(m)}>
                                  <Trash2 className="h-4 w-4" /> {t.messages.delete}
                                </button>
                              )}
                            </div>
                          </motion.div>
                        )}
                      </AnimatePresence>
                    </div>
                  </motion.div>
                </Fragment>
              );
            })}
          </AnimatePresence>
        )}
        <div ref={end} />
      </div>
      {!closed && (
        <form onSubmit={send} className="border-t border-line bg-surface/95 p-2.5 pb-[max(env(safe-area-inset-bottom),0.625rem)] backdrop-blur lg:pb-2.5">
          <AnimatePresence>
            {(reply || editing) && (
              <motion.div initial={{ height: 0, opacity: 0 }} animate={{ height: 'auto', opacity: 1 }} exit={{ height: 0, opacity: 0 }} className="overflow-hidden">
                <div className="mb-2 flex items-center gap-2 rounded-xl border-s-4 border-stitch bg-sunk px-3 py-2 text-sm">
                  {editing ? <Pencil className="h-4 w-4 shrink-0" /> : <CornerUpLeft className="h-4 w-4 shrink-0" />}
                  <span className="min-w-0 flex-1 truncate">
                    <span className="font-medium">{editing ? t.messages.editing : `${t.messages.replyingTo} ${reply.sender_name ?? ''}`}</span>
                    {!editing && <span className="text-muted"> — {reply.content}</span>}
                  </span>
                  <button
                    type="button"
                    onClick={() => {
                      setReply(null);
                      if (editing) setText('');
                      setEditing(null);
                    }}
                    className="rounded-lg p-1 text-muted hover:text-ink"
                    aria-label={t.common.cancel}
                  >
                    <X className="h-4 w-4" />
                  </button>
                </div>
              </motion.div>
            )}
          </AnimatePresence>
          <AnimatePresence>
            {emoji && (
              <motion.div initial={{ height: 0, opacity: 0 }} animate={{ height: 'auto', opacity: 1 }} exit={{ height: 0, opacity: 0 }} className="overflow-hidden">
                <div className="mb-2 grid grid-cols-8 gap-1 rounded-2xl bg-sunk p-2 sm:grid-cols-12">
                  {EMOJIS.map((e) => (
                    <motion.button
                      type="button"
                      key={e}
                      whileHover={{ scale: 1.25 }}
                      whileTap={{ scale: 0.85 }}
                      onClick={() => {
                        setText((x) => x + e);
                        input.current?.focus();
                      }}
                      className="rounded-lg p-1.5 text-2xl"
                    >
                      {e}
                    </motion.button>
                  ))}
                </div>
              </motion.div>
            )}
          </AnimatePresence>
          <div className="flex items-end gap-2">
            <button type="button" onClick={() => setEmoji((v) => !v)} className={cx('grid h-[46px] w-[46px] shrink-0 place-items-center rounded-xl transition', emoji ? 'bg-gold/20 text-gold' : 'text-muted hover:bg-sunk')} aria-label={t.messages.emoji}>
              <Smile className="h-6 w-6" />
            </button>
            <textarea
              ref={input}
              value={text}
              onChange={(e) => setText(e.target.value.slice(0, 2000))}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && !e.shiftKey) {
                  e.preventDefault();
                  void send();
                }
                if (e.key === 'Escape') {
                  setReply(null);
                  setEditing(null);
                }
              }}
              rows={1}
              placeholder={t.messages.placeholder}
              className="field max-h-32 min-h-[46px] flex-1 resize-none rounded-2xl py-2.5"
            />
            <motion.div whileTap={{ scale: 0.88 }}>
              <Button aria-label={t.messages.send} loading={sending} disabled={!text.trim()} className="h-[46px] w-[46px] !rounded-2xl !px-0">
                <SendHorizontal className="h-5 w-5 flip-rtl" />
              </Button>
            </motion.div>
          </div>
        </form>
      )}
    </div>
  );
}

function NewChat({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { t, err } = useI18n();
  const nav = useNavigate();
  const toast = useToast();
  const [q, setQ] = useState('');
  const [users, setUsers] = useState<any[]>([]);
  const contacts = useData<{ contacts: any[] }>(open ? '/api/contacts' : null, [open]);
  useEffect(() => {
    if (q.trim().length < 2) {
      setUsers([]);
      return;
    }
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
  const mine = (contacts.data?.contacts ?? []).filter((c) => !q.trim() || `${c.nickname ?? ''} ${c.full_name}`.toLowerCase().includes(q.trim().toLowerCase()));
  return (
    <Sheet open={open} onClose={onClose} title={t.messages.newChat}>
      <Button block variant="secondary" icon={<LifeBuoy className="h-5 w-5" />} onClick={() => start({ type: 'support' })}>
        {t.messages.support}
      </Button>
      <div className="my-5 border-t border-dashed border-line" />
      <input value={q} onChange={(e) => setQ(e.target.value)} placeholder={t.messages.searchPeopleAny} className="field" autoFocus />
      <div className="mt-3 max-h-80 overflow-y-auto">
        {mine.length > 0 && <p className="px-2 pb-1 text-xs font-medium text-muted">{t.messages.contacts}</p>}
        {mine.map((c) => (
          <button key={c.id} onClick={() => start({ type: 'user_to_user', recipientId: c.user_id })} className="flex w-full items-center gap-3 rounded-xl px-2 py-2.5 text-start hover:bg-sunk">
            <Avatar name={c.nickname || c.full_name} src={c.profile_image} size={36} />
            <span className="min-w-0 flex-1">
              <span className="block truncate">{c.nickname || c.full_name}</span>
              {c.nickname && <span className="block truncate text-xs text-muted">{c.full_name}</span>}
            </span>
          </button>
        ))}
        {users.length > 0 && <p className="px-2 pb-1 pt-3 text-xs font-medium text-muted">{t.messages.everyone}</p>}
        {users.map((u) => (
          <button key={u.id} onClick={() => start({ type: 'user_to_user', recipientId: u.id })} className="flex w-full items-center gap-3 rounded-xl px-2 py-2.5 text-start hover:bg-sunk">
            <Avatar name={u.full_name} src={u.profile_image} size={36} />
            <span>{u.full_name}</span>
          </button>
        ))}
      </div>
    </Sheet>
  );
}

export default function Messages() {
  const { t, lang, err } = useI18n();
  const { id } = useParams();
  const toast = useToast();
  const convs = useData<{ conversations: any[] }>('/api/messages/conversations');
  usePolling(() => convs.reload(), 10_000);
  const [newOpen, setNewOpen] = useState(false);
  const confirm = useConfirm();
  const current = convs.data?.conversations.find((c) => String(c.id) === id);
  const nav = useNavigate();
  const [sp] = useSearchParams();
  // ?support=1 (e.g. from TalerBank's support button) opens the support chat straight away.
  useEffect(() => {
    if (sp.get('support') !== '1') return;
    post('/api/messages/conversations', { type: 'support' })
      .then((r) => nav(`/app/messages/${r.conversationId}`, { replace: true }))
      .catch(() => {});
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  const other = current?.type !== 'support' ? current?.participants?.[0] : null;

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
              {convs.data.conversations.map((c, i) => (
                <motion.li key={c.id} initial={{ opacity: 0, x: -8 }} animate={{ opacity: 1, x: 0 }} transition={{ delay: Math.min(i, 10) * 0.03 }}>
                  <Link to={`/app/messages/${c.id}`} className={cx('flex items-center gap-3 rounded-2xl p-3 transition hover:bg-sunk', String(c.id) === id && 'bg-sunk')}>
                    {c.type === 'support' ? (
                      <span className="grid h-10 w-10 place-items-center rounded-full bg-olive/15 text-olive">
                        <LifeBuoy className="h-5 w-5" />
                      </span>
                    ) : (
                      <span className="relative">
                        <Avatar name={title(c, t)} src={c.participants?.[0]?.profile_image} />
                        {c.unread > 0 && <span className="absolute -end-0.5 -top-0.5 h-3 w-3 rounded-full bg-stitch ring-2 ring-surface" />}
                      </span>
                    )}
                    <span className="min-w-0 flex-1">
                      <span className="flex items-center justify-between gap-2">
                        <span className={cx('truncate', c.unread > 0 ? 'font-semibold' : 'font-medium')}>{title(c, t)}</span>
                        {c.lastMessage && <span className="shrink-0 text-[11px] text-muted">{relative(c.lastMessage.created_at, lang)}</span>}
                      </span>
                      <span className="flex items-center justify-between gap-2">
                        <span className={cx('truncate text-sm', c.unread > 0 ? 'text-ink' : 'text-muted')}>{c.lastMessage?.content ?? '—'}</span>
                        {c.unread > 0 && <span className="num grid h-5 min-w-5 place-items-center rounded-full bg-stitch px-1.5 text-[11px] text-white">{c.unread}</span>}
                      </span>
                    </span>
                  </Link>
                </motion.li>
              ))}
            </ul>
          )}
        </aside>
        {/* Phones: an open chat takes the whole screen like a messaging app (above the tab bar, composer above the keyboard). */}
        <section className={cx(id ? 'fixed inset-0 z-[60] flex flex-col bg-bg lg:static lg:z-auto lg:block lg:bg-transparent' : 'hidden lg:block')}>
          {id ? (
            <>
              <div className="safe-top flex shrink-0 items-center justify-between gap-3 border-b border-line bg-surface/95 px-2 py-2 backdrop-blur sm:px-4 lg:bg-transparent lg:py-2.5">
                <div className="flex min-w-0 items-center gap-3">
                  <Link to="/app/messages" replace className="grid h-10 w-10 place-items-center rounded-xl text-ink lg:hidden" aria-label={t.common.back}>
                    <ArrowLeft className="h-5 w-5 flip-rtl" />
                  </Link>
                  {current && (current.type === 'support' ? <LifeBuoy className="h-6 w-6 text-olive" /> : <Avatar name={title(current, t)} src={other?.profile_image} size={36} />)}
                  <p className="truncate font-medium">{current ? title(current, t) : '…'}</p>
                </div>
                <div className="flex items-center gap-1">
                  {other && (
                    <button
                      className="flex items-center gap-1.5 rounded-xl px-2.5 py-2 text-sm text-muted transition hover:bg-sunk hover:text-ink"
                      onClick={async () => {
                        try {
                          await post('/api/contacts', { userId: other.id });
                          toast(t.messages.saved);
                        } catch (e) {
                          toast(err(e), 'error');
                        }
                      }}
                      title={t.messages.saveContact}
                    >
                      <UserPlus className="h-4 w-4" />
                      <span className="hidden sm:inline">{t.messages.saveContact}</span>
                    </button>
                  )}
                  {current?.status === 'active' && current.type === 'support' && (
                    <button
                      className="rounded-xl px-2.5 py-2 text-sm text-muted hover:text-stitch"
                      onClick={async () => {
                        if (!(await confirm({ title: t.ask.closeChatTitle, body: t.ask.closeChatBody, confirmLabel: t.ask.closeChatOk, tone: 'danger' }))) return;
                        await patch(`/api/messages/conversations/${id}/close`);
                        void convs.reload();
                      }}
                    >
                      {t.messages.closeChat}
                    </button>
                  )}
                </div>
              </div>
              {current?.status === 'closed' && <p className="bg-sunk px-4 py-2 text-center text-sm text-muted">{t.messages.closed}</p>}
              <Chat id={id} conv={current} />
            </>
          ) : (
            <div className="grid h-full min-h-[420px] place-items-center p-6 text-center text-muted">
              <div>
                <motion.div animate={{ y: [0, -6, 0] }} transition={{ repeat: Infinity, duration: 3 }} className="mx-auto mb-3 grid h-16 w-16 place-items-center rounded-full bg-sunk">
                  <MessagesSquare className="h-8 w-8" />
                </motion.div>
                {t.messages.pick}
              </div>
            </div>
          )}
        </section>
      </div>
      <NewChat open={newOpen} onClose={() => setNewOpen(false)} />
    </div>
  );
}
