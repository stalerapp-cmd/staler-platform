import { AnimatePresence, motion } from 'framer-motion';
import { Fragment, useEffect, useRef, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { ArrowLeft, Ban, BookmarkPlus, Check, CheckCheck, Copy, CornerUpLeft, LifeBuoy, MessageCirclePlus, MessagesSquare, Pencil, Search, Send, SendHorizontal, Smile, Trash2, X } from 'lucide-react';
import { del, get, patch, post } from '../lib/api';
import { useI18n } from '../lib/i18n';
import { invalidateData, useData, usePolling } from '../lib/hooks';
import { relative } from '../lib/format';
import { kindOf } from '../lib/kinds';
import { useToast } from '../components/Toast';
import { useConfirm } from '../components/Confirm';
import { benName, isBen, useBeneficiaries } from '../components/Beneficiaries';
import { Avatar, Button, EmptyState, PageHeader, Sheet, Skeleton, cx } from '../components/ui';

const EMOJIS = ['❤️', '😂', '👍', '🙏', '😮', '😢', '🔥', '🎉', '👏', '😍', '🤝', '✅', '💰', '💳', '🏦', '📅', '😊', '😅', '🤔', '👌', '🌙', '☕', '🌹', '💯'];
const QUICK = EMOJIS.slice(0, 6);

interface Person {
  id: string;
  full_name: string;
  username: string | null;
  profile_image: string | null;
  kind: string;
  business: string | null;
  nickname?: string | null;
  active?: boolean;
}
interface Conv {
  id: string;
  unread: number;
  blocked: boolean;
  other: Person;
  lastMessage: { content: string; deleted: boolean; created_at: string; mine: boolean } | null;
}
const nameOf = (p?: Person | null) => (p ? p.nickname || p.full_name : '…');

function useT() {
  const { lang } = useI18n();
  const ar = lang === 'ar';
  return {
    ar,
    lang,
    s: {
      title: ar ? 'الرسائل' : 'Messages',
      lead: ar ? 'احكي مع زباين TalerBank التانيين، وحوّلهم من نفس المحادثة. ومحادثة الدعم دايمًا فوق.' : 'Talk to other TalerBank customers and send them money from the chat. Support is always on top.',
      newChat: ar ? 'محادثة جديدة' : 'New chat',
      support: ar ? 'دعم TalerBank' : 'TalerBank support',
      supportSub: ar ? 'اختار موضوعك والفريق بيرد عليك' : 'Pick a topic and the team answers',
      none: ar ? 'لسا ما في محادثات. ابدأ وحدة مع حدا من المستفيدين أو دوّر عليه.' : 'No chats yet. Start one with a beneficiary or look someone up.',
      pick: ar ? 'اختار محادثة' : 'Pick a chat',
      today: ar ? 'اليوم' : 'Today',
      yesterday: ar ? 'مبارح' : 'Yesterday',
      deleted: ar ? 'انحذفت هالرسالة' : 'This message was deleted',
      edited: ar ? 'معدّلة' : 'edited',
      reply: ar ? 'رد' : 'Reply',
      copy: ar ? 'انسخ' : 'Copy',
      copied: ar ? 'انسخت' : 'Copied',
      edit: ar ? 'عدّل' : 'Edit',
      remove: ar ? 'احذف' : 'Delete',
      editing: ar ? 'عم تعدّل الرسالة' : 'Editing',
      replyingTo: ar ? 'رد على' : 'Replying to',
      placeholder: ar ? 'اكتب رسالة' : 'Write a message',
      send: ar ? 'ابعت' : 'Send',
      emoji: ar ? 'إيموجي' : 'Emoji',
      seen: ar ? 'شافها' : 'Seen',
      sendMoney: ar ? 'حوّل' : 'Send money',
      save: ar ? 'احفظ' : 'Save',
      saved: ar ? 'انحفظ بالمستفيدين' : 'Saved to beneficiaries',
      block: ar ? 'بلّك' : 'Block',
      blocked: ar ? 'في بلوك بينكم — ما بتقدروا تتراسلوا ولا تتحوّلوا.' : 'There’s a block between you — no messages or transfers.',
      gone: ar ? 'هالحساب مش متاح هلّأ.' : 'This account isn’t available now.',
      deleteQ: ar ? 'تحذف الرسالة؟' : 'Delete this message?',
      deleteB: ar ? 'بتنحذف عند الطرفين.' : 'It disappears for both of you.',
      deleteOk: ar ? 'احذفها' : 'Delete',
    },
  };
}

function dayLabel(d: string, s: ReturnType<typeof useT>['s'], ar: boolean) {
  const day = new Date(d);
  const today = new Date();
  const y = new Date();
  y.setDate(today.getDate() - 1);
  if (day.toDateString() === today.toDateString()) return s.today;
  if (day.toDateString() === y.toDateString()) return s.yesterday;
  return new Intl.DateTimeFormat(ar ? 'ar-u-nu-latn' : 'en-GB', { day: 'numeric', month: 'long' }).format(day);
}

/** Links become clickable; nothing is ever rendered as HTML. */
function Rich({ text }: { text: string }) {
  return (
    <>
      {text.split(/(https?:\/\/[^\s]+)/g).map((p, i) =>
        /^https?:\/\//.test(p) ? (
          <a key={i} href={p} target="_blank" rel="noopener noreferrer nofollow" className="break-all underline underline-offset-2">
            {p}
          </a>
        ) : (
          <Fragment key={i}>{p}</Fragment>
        ),
      )}
    </>
  );
}

function Chat({ id, conv }: { id: string; conv: Conv | undefined }) {
  const { s, ar, lang } = useT();
  const { err } = useI18n();
  const toast = useToast();
  const confirm = useConfirm();
  const [msgs, setMsgs] = useState<any[] | null>(null);
  const [seenAt, setSeenAt] = useState<string | null>(null);
  const [text, setText] = useState('');
  const [sending, setSending] = useState(false);
  const [reply, setReply] = useState<any>(null);
  const [editing, setEditing] = useState<any>(null);
  const [menu, setMenu] = useState<string | null>(null);
  const [menuDown, setMenuDown] = useState(false);
  const [emoji, setEmoji] = useState(false);
  const scroller = useRef<HTMLDivElement>(null);
  const end = useRef<HTMLDivElement>(null);
  const input = useRef<HTMLTextAreaElement>(null);
  const load = async () => {
    try {
      const d = await get<{ messages: any[]; seenAt: string | null }>(`/api/messages/conversations/${id}/messages?limit=100`);
      setMsgs(d.messages);
      setSeenAt(d.seenAt);
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
    if (!(await confirm({ title: s.deleteQ, body: s.deleteB, confirmLabel: s.deleteOk, tone: 'danger' }))) return;
    try {
      await del(`/api/messages/messages/${m.id}`);
      setMsgs((ms) => (ms ?? []).map((x) => (x.id === m.id ? { ...x, is_deleted: true, content: '', reactions: {} } : x)));
    } catch (e) {
      toast(err(e), 'error');
    }
  };
  const canWrite = !!conv && !conv.blocked && conv.other.active !== false;
  const lastMine = [...(msgs ?? [])].reverse().find((m) => m.mine && !m.is_deleted);

  return (
    <div className="flex min-h-0 flex-1 flex-col lg:h-[calc(100dvh-13rem)] lg:min-h-[440px] lg:flex-none" onClick={() => setMenu(null)}>
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
              const openMenu = (el: HTMLElement) => {
                const top = el.getBoundingClientRect().top - (scroller.current?.getBoundingClientRect().top ?? 0);
                setMenuDown(top < 240);
              };
              return (
                <Fragment key={m.id}>
                  {newDay && (
                    <div className="flex justify-center py-2">
                      <span className="rounded-full bg-surface/90 px-3 py-1 text-xs text-muted shadow-sm ring-1 ring-line backdrop-blur">{dayLabel(m.created_at, s, ar)}</span>
                    </div>
                  )}
                  <motion.div layout initial={{ opacity: 0, y: 10, scale: 0.96 }} animate={{ opacity: 1, y: 0, scale: 1 }} className={cx('group flex items-end gap-2', m.mine && 'flex-row-reverse', grouped ? 'mt-0.5' : 'mt-3')}>
                    {!m.mine && (grouped ? <span className="w-[30px]" /> : <Avatar name={m.sender_name} size={30} />)}
                    <div className={cx('relative max-w-[80%]', reacts.length > 0 && 'mb-3')}>
                      <button
                        type="button"
                        onClick={(e) => {
                          e.stopPropagation();
                          if (m.is_deleted) return;
                          openMenu(e.currentTarget);
                          setMenu(menu === m.id ? null : m.id);
                        }}
                        onContextMenu={(e) => {
                          e.preventDefault();
                          if (m.is_deleted) return;
                          openMenu(e.currentTarget);
                          setMenu(m.id);
                        }}
                        className={cx(
                          'block rounded-[1.3rem] px-4 py-2.5 text-start shadow-sm transition active:scale-[0.99]',
                          m.mine ? 'rounded-ee-md bg-night text-white dark:bg-olive/40' : 'rounded-es-md bg-surface ring-1 ring-line',
                          m.is_deleted && 'italic opacity-70',
                        )}
                      >
                        {m.reply && (
                          <span className={cx('mb-1.5 block rounded-lg border-s-4 px-2 py-1 text-xs', m.mine ? 'border-white/50 bg-white/10' : 'border-gold/70 bg-sunk')}>
                            <span className="block font-medium">{m.reply.name}</span>
                            <span className="line-clamp-2 opacity-80">{m.reply.deleted ? s.deleted : m.reply.content}</span>
                          </span>
                        )}
                        {m.is_deleted ? (
                          <span>{s.deleted}</span>
                        ) : (
                          <span className={cx('whitespace-pre-wrap break-words', /^(?:\p{Extended_Pictographic}[️‍\p{Emoji_Modifier}]*){1,3}$/u.test(m.content.trim()) && 'text-4xl leading-tight')}>
                            <Rich text={m.content} />
                          </span>
                        )}
                        <span className={cx('mt-1 flex items-center gap-1 text-[11px]', m.mine ? 'text-white/60' : 'text-muted')}>
                          {relative(m.created_at, lang)}
                          {m.is_edited && !m.is_deleted ? ` · ${s.edited}` : ''}
                          {m.mine && m.id === lastMine?.id && (seenAt && new Date(seenAt) >= new Date(m.created_at) ? <CheckCheck className="h-3.5 w-3.5" aria-label={s.seen} /> : <Check className="h-3.5 w-3.5" />)}
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
                            className={cx('absolute z-20 w-max min-w-[13rem] rounded-2xl bg-surface p-1.5 shadow-lift ring-1 ring-line', menuDown ? 'top-full mt-2' : 'bottom-full mb-2', m.mine ? 'end-0' : 'start-0')}
                          >
                            {canWrite && (
                              <div className="flex justify-between gap-0.5 border-b border-line px-1 pb-1.5">
                                {QUICK.map((e) => (
                                  <motion.button key={e} whileHover={{ scale: 1.3 }} whileTap={{ scale: 0.9 }} onClick={() => react(m, e)} className="rounded-lg p-1 text-xl">
                                    {e}
                                  </motion.button>
                                ))}
                              </div>
                            )}
                            <div className="pt-1 text-sm">
                              {canWrite && (
                                <button
                                  className="flex w-full items-center gap-2 rounded-xl px-3 py-2 hover:bg-sunk"
                                  onClick={() => {
                                    setReply(m);
                                    setEditing(null);
                                    setMenu(null);
                                    input.current?.focus();
                                  }}
                                >
                                  <CornerUpLeft className="h-4 w-4" /> {s.reply}
                                </button>
                              )}
                              <button
                                className="flex w-full items-center gap-2 rounded-xl px-3 py-2 hover:bg-sunk"
                                onClick={() => {
                                  void navigator.clipboard?.writeText(m.content);
                                  setMenu(null);
                                  toast(s.copied);
                                }}
                              >
                                <Copy className="h-4 w-4" /> {s.copy}
                              </button>
                              {canEdit && canWrite && (
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
                                  <Pencil className="h-4 w-4" /> {s.edit}
                                </button>
                              )}
                              {m.mine && (
                                <button className="flex w-full items-center gap-2 rounded-xl px-3 py-2 text-stitch hover:bg-stitch/10" onClick={() => remove(m)}>
                                  <Trash2 className="h-4 w-4" /> {s.remove}
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
      {conv && !canWrite ? (
        <p className="border-t border-line bg-sunk px-4 py-3 text-center text-sm text-muted">{conv.blocked ? s.blocked : s.gone}</p>
      ) : (
        <form onSubmit={send} className="border-t border-line bg-surface/95 p-2.5 pb-[max(env(safe-area-inset-bottom),0.625rem)] backdrop-blur lg:pb-2.5">
          <AnimatePresence>
            {(reply || editing) && (
              <motion.div initial={{ height: 0, opacity: 0 }} animate={{ height: 'auto', opacity: 1 }} exit={{ height: 0, opacity: 0 }} className="overflow-hidden">
                <div className="mb-2 flex items-center gap-2 rounded-xl border-s-4 border-gold bg-sunk px-3 py-2 text-sm">
                  {editing ? <Pencil className="h-4 w-4 shrink-0" /> : <CornerUpLeft className="h-4 w-4 shrink-0" />}
                  <span className="min-w-0 flex-1 truncate">
                    <span className="font-medium">{editing ? s.editing : `${s.replyingTo} ${reply.sender_name ?? ''}`}</span>
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
                    aria-label="✕"
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
            <button type="button" onClick={() => setEmoji((v) => !v)} className={cx('grid h-[46px] w-[46px] shrink-0 place-items-center rounded-xl transition', emoji ? 'bg-gold/20 text-gold' : 'text-muted hover:bg-sunk')} aria-label={s.emoji}>
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
              placeholder={s.placeholder}
              className="field max-h-32 min-h-[46px] flex-1 resize-none rounded-2xl py-2.5"
            />
            <motion.div whileTap={{ scale: 0.88 }}>
              <Button aria-label={s.send} loading={sending} disabled={!text.trim()} className="h-[46px] w-[46px] !rounded-2xl !px-0">
                <SendHorizontal className="h-5 w-5 flip-rtl" />
              </Button>
            </motion.div>
          </div>
        </form>
      )}
    </div>
  );
}

/** Start a chat: with a saved beneficiary, or someone found by @username, e-mail, IBAN or account number. */
function NewChat({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { s, ar } = useT();
  const { err } = useI18n();
  const nav = useNavigate();
  const toast = useToast();
  const [q, setQ] = useState('');
  const [found, setFound] = useState<Person[] | null>(null);
  const bens = useBeneficiaries();
  useEffect(() => {
    if (!open) setQ('');
  }, [open]);
  useEffect(() => {
    if (q.trim().length < 3) {
      setFound(null);
      return;
    }
    const h = setTimeout(() => {
      get<{ users: Person[] }>(`/api/messages/search?q=${encodeURIComponent(q.trim())}`)
        .then((d) => setFound(d.users))
        .catch(() => setFound([]));
    }, 300);
    return () => clearTimeout(h);
  }, [q]);
  const start = async (userId: string) => {
    try {
      const r = await post('/api/messages/conversations', { userId });
      onClose();
      nav(`/app/messages/${r.conversationId}`);
    } catch (e) {
      toast(err(e), 'error');
    }
  };
  const needle = q.trim().toLowerCase();
  const seen = new Set<string>();
  const people = (bens.data?.beneficiaries ?? []).filter((b) => {
    if (b.unavailable || seen.has(b.userId)) return false;
    seen.add(b.userId);
    return !needle || `${b.nickname ?? ''} ${b.holder} ${b.business ?? ''} ${b.username ?? ''}`.toLowerCase().includes(needle) || isBen(b, q);
  });
  return (
    <Sheet open={open} onClose={onClose} title={s.newChat}>
      <Link to="/app/support" onClick={onClose} className="mb-4 flex items-center gap-3 rounded-2xl bg-olive/10 p-3 text-olive">
        <LifeBuoy className="h-6 w-6 shrink-0" />
        <span className="min-w-0">
          <span className="block font-semibold">{s.support}</span>
          <span className="block text-xs opacity-80">{s.supportSub}</span>
        </span>
      </Link>
      <label className="relative block">
        <Search className="pointer-events-none absolute start-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted" />
        <input value={q} onChange={(e) => setQ(e.target.value)} placeholder={ar ? '@اسم المستخدم، الإيميل، IBAN أو رقم الحساب' : '@username, e-mail, IBAN or account number'} className="field h-12 ps-10" autoFocus dir="auto" />
      </label>
      <p className="mt-1.5 text-xs text-muted">{ar ? 'للخصوصية ما في بحث بالاسم — اكتب معرّف الشخص كامل.' : 'For privacy there’s no search by name — type the person’s exact identifier.'}</p>
      <div className="mt-3 max-h-80 overflow-y-auto">
        {found && found.length > 0 && (
          <>
            <p className="px-2 pb-1 text-xs font-medium text-muted">{ar ? 'لقيناه' : 'Found'}</p>
            {found.map((u) => (
              <button key={u.id} onClick={() => start(u.id)} className="flex w-full items-center gap-3 rounded-xl px-2 py-2.5 text-start hover:bg-sunk">
                <Avatar name={u.full_name} size={36} />
                <span className="min-w-0 flex-1">
                  <span className="block truncate font-medium">{u.full_name}</span>
                  <span className="block truncate text-xs text-muted">{[u.username && `\u2066@${u.username}\u2069`, u.business].filter(Boolean).join(' · ')}</span>
                </span>
              </button>
            ))}
          </>
        )}
        {found && !found.length && q.trim().length >= 3 && <p className="px-2 py-3 text-sm text-muted">{ar ? 'ما لقينا زبون بهالمعرّف.' : 'No customer with that identifier.'}</p>}
        {people.length > 0 && <p className="px-2 pb-1 pt-3 text-xs font-medium text-muted">{ar ? 'المستفيدين' : 'Beneficiaries'}</p>}
        {people.map((b) => (
          <button key={b.id} onClick={() => start(b.userId)} className="flex w-full items-center gap-3 rounded-xl px-2 py-2.5 text-start hover:bg-sunk">
            <Avatar name={benName(b)} size={36} />
            <span className="min-w-0 flex-1">
              <span className="block truncate">{benName(b)}</span>
              {(b.nickname || b.business) && <span className="block truncate text-xs text-muted">{b.holder}</span>}
            </span>
          </button>
        ))}
      </div>
    </Sheet>
  );
}

export default function Messages() {
  const { s, ar, lang } = useT();
  const { err } = useI18n();
  const { id } = useParams();
  const toast = useToast();
  const confirm = useConfirm();
  const convs = useData<{ conversations: Conv[] }>('/api/messages/conversations');
  const sup = useData<{ unread: number }>('/api/support/unread');
  usePolling(() => {
    void convs.reload();
    void sup.reload();
  }, 10_000);
  const bens = useBeneficiaries();
  const [newOpen, setNewOpen] = useState(false);
  const wide = useWide();
  const current = convs.data?.conversations.find((c) => String(c.id) === id);
  const other = current?.other;
  const saved = !!other && (bens.data?.beneficiaries ?? []).some((b) => b.userId === other.id);
  const k = other ? kindOf(other.kind) : null;

  const save = async () => {
    if (!other) return;
    if (!(await confirm({ title: ar ? `تحفظ ${other.full_name} بالمستفيدين؟` : `Save ${other.full_name} to beneficiaries?`, body: ar ? 'بيطلع عندك بالحوالات والرسائل، وبتقدر تحطله اسم بتعرفه فيه.' : 'They show in transfers and messages, and you can give them a name you know.', confirmLabel: s.save }))) return;
    try {
      await post('/api/beneficiaries', { userId: other.id });
      invalidateData('/api/beneficiaries');
      void bens.reload();
      toast(s.saved);
    } catch (e) {
      toast(err(e), 'error');
    }
  };
  const block = async () => {
    if (!other) return;
    if (
      !(await confirm({
        title: ar ? `تبلّك ${other.full_name}؟` : `Block ${other.full_name}?`,
        body: ar ? 'ما بتقدروا تتراسلوا ولا تتحوّلوا ولا تجدولوا دفعات، وبتنوقف الدفعات المجدولة بينكم. بتشيله من الإعدادات أو الدفعات المجدولة ← البلوكات.' : 'No messages, transfers or scheduled payments between you; scheduled payments between you stop. Lift it from Scheduled payments → Blocked.',
        confirmLabel: s.block,
        tone: 'danger',
      }))
    )
      return;
    try {
      await post('/api/blocks', { userId: other.id });
      toast(ar ? 'انعمل بلوك' : 'Blocked');
      void convs.reload();
    } catch (e) {
      toast(err(e), 'error');
    }
  };

  return (
    <div>
      <PageHeader
        title={s.title}
        lead={s.lead}
        actions={
          <Button icon={<MessageCirclePlus className="h-4 w-4" />} onClick={() => setNewOpen(true)}>
            {s.newChat}
          </Button>
        }
      />
      <div className="card grid overflow-hidden lg:grid-cols-[320px_1fr]">
        <aside className={cx('border-line lg:border-e', id && 'hidden lg:block')}>
          <div className="p-2 pb-0">
            <Link to="/app/support" className="flex items-center gap-3 rounded-2xl bg-olive/[0.08] p-3 transition hover:bg-olive/15">
              <span className="relative grid h-10 w-10 place-items-center rounded-full bg-olive/15 text-olive">
                <LifeBuoy className="h-5 w-5" />
                {(sup.data?.unread ?? 0) > 0 && <span className="absolute -end-0.5 -top-0.5 h-3 w-3 rounded-full bg-stitch ring-2 ring-surface" />}
              </span>
              <span className="min-w-0 flex-1">
                <span className="block font-semibold">{s.support}</span>
                <span className="block truncate text-xs text-muted">{s.supportSub}</span>
              </span>
              {(sup.data?.unread ?? 0) > 0 && <span className="num grid h-5 min-w-5 place-items-center rounded-full bg-stitch px-1.5 text-[11px] text-white">{sup.data!.unread}</span>}
            </Link>
          </div>
          {!convs.data ? (
            <div className="space-y-3 p-4">
              {[0, 1, 2].map((i) => (
                <Skeleton key={i} className="h-14" />
              ))}
            </div>
          ) : !convs.data.conversations.length ? (
            <div className="p-4">
              <EmptyState icon={<MessagesSquare className="h-6 w-6" />} title={s.none} action={<Button onClick={() => setNewOpen(true)}>{s.newChat}</Button>} />
            </div>
          ) : (
            <ul className="max-h-[70dvh] overflow-y-auto p-2">
              {convs.data.conversations.map((c, i) => (
                <motion.li key={c.id} initial={{ opacity: 0, x: -8 }} animate={{ opacity: 1, x: 0 }} transition={{ delay: Math.min(i, 10) * 0.03 }}>
                  <Link to={`/app/messages/${c.id}`} className={cx('flex items-center gap-3 rounded-2xl p-3 transition hover:bg-sunk', String(c.id) === id && 'bg-sunk', c.blocked && 'opacity-60')}>
                    <span className="relative">
                      <Avatar name={nameOf(c.other)} />
                      {c.unread > 0 && <span className="absolute -end-0.5 -top-0.5 h-3 w-3 rounded-full bg-stitch ring-2 ring-surface" />}
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="flex items-center justify-between gap-2">
                        <span className={cx('truncate', c.unread > 0 ? 'font-semibold' : 'font-medium')}>
                          {nameOf(c.other)}
                          {c.blocked && <Ban className="ms-1 inline h-3.5 w-3.5 text-stitch" />}
                        </span>
                        {c.lastMessage && <span className="shrink-0 text-[11px] text-muted">{relative(c.lastMessage.created_at, lang)}</span>}
                      </span>
                      <span className="flex items-center justify-between gap-2">
                        <span className={cx('truncate text-sm', c.unread > 0 ? 'text-ink' : 'text-muted')}>
                          {c.lastMessage ? `${c.lastMessage.mine ? (ar ? 'انت: ' : 'You: ') : ''}${c.lastMessage.deleted ? s.deleted : c.lastMessage.content}` : '—'}
                        </span>
                        {c.unread > 0 && <span className="num grid h-5 min-w-5 place-items-center rounded-full bg-stitch px-1.5 text-[11px] text-white">{c.unread}</span>}
                      </span>
                    </span>
                  </Link>
                </motion.li>
              ))}
            </ul>
          )}
        </aside>
        {/* Phones: an open chat fills the screen like a messaging app. */}
        <PhoneLayer active={!!id && !wide}>
          <section className={cx(id ? 'fixed inset-0 z-[70] flex h-[100dvh] flex-col bg-bg lg:static lg:z-auto lg:block lg:h-auto lg:bg-transparent' : 'hidden lg:block')}>
            {id ? (
              <>
                <div className="safe-top flex shrink-0 items-center justify-between gap-2 border-b border-line bg-surface/95 px-2 py-2 backdrop-blur sm:px-4 lg:bg-transparent lg:py-2.5">
                  <div className="flex min-w-0 items-center gap-2.5">
                    <Link to="/app/messages" replace className="grid h-10 w-10 shrink-0 place-items-center rounded-xl text-ink lg:hidden" aria-label={ar ? 'رجوع' : 'Back'}>
                      <ArrowLeft className="h-5 w-5 flip-rtl" />
                    </Link>
                    <Avatar name={nameOf(other)} size={36} />
                    <div className="min-w-0">
                      <p className="truncate font-medium">{nameOf(other)}</p>
                      <p className="truncate text-xs text-muted">
                        {[other?.nickname ? other.full_name : null, other?.username ? `\u2066@${other.username}\u2069` : null, other?.business].filter(Boolean).join(' · ')}
                        {k && other?.kind !== 'personal' && <span className={cx('ms-1.5 rounded-full px-1.5 py-0.5 text-[10px] font-medium', k.tone)}>{ar ? k.ar : k.en}</span>}
                      </p>
                    </div>
                  </div>
                  {other && !current?.blocked && other.active !== false && (
                    <div className="flex shrink-0 items-center gap-1">
                      {other.username && (
                        <Link to={`/app/transfer?to=${encodeURIComponent(`@${other.username}`)}`} className="inline-flex h-9 items-center gap-1.5 rounded-xl bg-gold/15 px-2.5 text-sm font-semibold text-[rgb(140_100_20)] dark:text-gold" title={s.sendMoney}>
                          <Send className="h-4 w-4" />
                          <span className="hidden sm:inline">{s.sendMoney}</span>
                        </Link>
                      )}
                      {!saved && (
                        <button className="grid h-9 w-9 place-items-center rounded-xl text-muted transition hover:bg-sunk hover:text-ink" onClick={save} title={s.save} aria-label={s.save}>
                          <BookmarkPlus className="h-4 w-4" />
                        </button>
                      )}
                      <button className="grid h-9 w-9 place-items-center rounded-xl text-muted transition hover:bg-stitch/10 hover:text-stitch" onClick={block} title={s.block} aria-label={s.block}>
                        <Ban className="h-4 w-4" />
                      </button>
                    </div>
                  )}
                </div>
                <Chat id={id} conv={current} />
              </>
            ) : (
              <div className="grid h-full min-h-[440px] place-items-center p-6 text-center text-muted">
                <div>
                  <motion.div animate={{ y: [0, -6, 0] }} transition={{ repeat: Infinity, duration: 3 }} className="mx-auto mb-3 grid h-16 w-16 place-items-center rounded-full bg-sunk">
                    <MessagesSquare className="h-8 w-8" />
                  </motion.div>
                  {s.pick}
                </div>
              </div>
            )}
          </section>
        </PhoneLayer>
      </div>
      <NewChat open={newOpen} onClose={() => setNewOpen(false)} />
    </div>
  );
}

/** True on screens wide enough for the side-by-side layout. */
function useWide() {
  const q = '(min-width: 1024px)';
  const [wide, setWide] = useState(() => typeof window !== 'undefined' && window.matchMedia(q).matches);
  useEffect(() => {
    const m = window.matchMedia(q);
    const on = () => setWide(m.matches);
    m.addEventListener('change', on);
    return () => m.removeEventListener('change', on);
  }, []);
  return wide;
}

/** On phones the open chat is lifted to the body so it truly fills the screen (the page wrapper is transformed). */
function PhoneLayer({ active, children }: { active: boolean; children: ReactNode }) {
  useEffect(() => {
    if (!active) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.body.style.overflow = prev;
    };
  }, [active]);
  return active ? createPortal(children, document.body) : <>{children}</>;
}
