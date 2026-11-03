import { Fragment, useEffect, useState, type MouseEvent, type ReactNode } from 'react';
import { useNavigate } from 'react-router-dom';
import { Ban, BadgeCheck, Flag, HandCoins, MapPin, MessageCircle, Send, Store, UserPlus, UserRound } from 'lucide-react';
import { get, post } from '../lib/api';
import { useI18n } from '../lib/i18n';
import { useToast } from './Toast';
import { Avatar, Button, Sheet, Skeleton, cx } from './ui';
import { ReportSheet } from './Feedback';
import { BlockPicker } from './PrivacySettings';

/** `@[Name](store:slug)`, `@[Name](agent:id)`, `@[Name](user:id)` — same as the server. */
const MENTION = /@\[([^\]\n]{1,60})\]\((store|agent|user):([A-Za-z0-9_-]{1,80})\)/g;
export type MentionKind = 'store' | 'agent' | 'user';

/** A mention token to put in a message. */
export const mentionOf = (kind: MentionKind, ref: string, name: string) => `@[${name.replace(/[\][\n]/g, ' ').trim().slice(0, 60)}](${kind}:${ref})`;

/** The text as plain words ("@Name"), for toasts and previews that can't link. */
export const plainText = (s: string | null | undefined) => (s ?? '').replace(MENTION, (_m, name: string) => `@${name}`);

const W = {
  ar: { store: 'متجر', agent: 'وكيل صرف', user: 'شخص', openStore: 'افتح المتجر', openAgent: 'شوفه على خريطة الوكلاء', message: 'راسله', send: 'حوّله', save: 'احفظه بجهات الاتصال', saved: 'محفوظ عندك', savedT: 'انحفظ بجهات الاتصال', you: 'هاد إنت', wallet: 'رقم المحفظة', role: { user: 'حساب شخصي', merchant: 'تاجر', exchange: 'وكيل صرف', admin: 'الإدارة' } as Record<string, string> },
  en: { store: 'Store', agent: 'Cash agent', user: 'Person', openStore: 'Open the store', openAgent: 'See them on the agents map', message: 'Message', send: 'Send money', save: 'Save to contacts', saved: 'In your contacts', savedT: 'Saved to contacts', you: 'This is you', wallet: 'Wallet ID', role: { user: 'Personal', merchant: 'Merchant', exchange: 'Cash agent', admin: 'Admin' } as Record<string, string> },
};

const LOOK: Record<MentionKind, { icon: typeof Store; c: string }> = {
  store: { icon: Store, c: 'bg-olive/12 text-olive ring-olive/25 hover:bg-olive/20' },
  agent: { icon: HandCoins, c: 'bg-gold/15 text-[rgb(150_105_10)] ring-gold/35 hover:bg-gold/25 dark:text-gold' },
  user: { icon: UserRound, c: 'bg-sky/10 text-sky ring-sky/25 hover:bg-sky/20' },
};

/** One mention as a small tappable chip. */
export function MentionChip({ kind, name, onClick }: { kind: MentionKind; name: string; onClick?: (e: MouseEvent) => void }) {
  const L = LOOK[kind];
  return (
    <span
      role={onClick ? 'link' : undefined}
      tabIndex={onClick ? 0 : undefined}
      onClick={onClick}
      onKeyDown={(e) => {
        if (onClick && (e.key === 'Enter' || e.key === ' ')) {
          e.preventDefault();
          onClick(e as unknown as MouseEvent);
        }
      }}
      className={cx('mx-0.5 inline-flex max-w-full items-center gap-1 rounded-full px-2 py-px align-baseline text-[0.92em] font-semibold ring-1 transition', L.c, onClick && 'cursor-pointer')}
    >
      <L.icon className="h-3.5 w-3.5 shrink-0" />
      <span className="truncate">{name}</span>
    </span>
  );
}

/**
 * Message text with its mentions turned into chips: a store opens its page, a cash
 * agent opens them on the map, a person opens their card.
 */
export function RichText({ text, className, onNavigate }: { text: string | null | undefined; className?: string; onNavigate?: () => void }) {
  const nav = useNavigate();
  const [person, setPerson] = useState<string | null>(null);
  const s = text ?? '';
  const parts: ReactNode[] = [];
  let last = 0;
  let i = 0;
  for (const m of s.matchAll(MENTION)) {
    const [all, name, kind, ref] = m as unknown as [string, string, MentionKind, string];
    const at = m.index ?? 0;
    if (at > last) parts.push(<Fragment key={`t${i}`}>{s.slice(last, at)}</Fragment>);
    parts.push(
      <MentionChip
        key={`m${i}`}
        kind={kind}
        name={name}
        onClick={(e) => {
          e.stopPropagation();
          e.preventDefault();
          if (kind === 'user') return setPerson(ref);
          onNavigate?.();
          nav(kind === 'store' ? `/s/${ref}` : `/app/agents?agent=${ref}`);
        }}
      />,
    );
    last = at + all.length;
    i++;
  }
  if (last < s.length) parts.push(<Fragment key="end">{s.slice(last)}</Fragment>);
  return (
    <>
      <span className={className}>{parts}</span>
      <PersonSheet id={person} onClose={() => setPerson(null)} onNavigate={onNavigate} />
    </>
  );
}

/** A person's public card: who they are, and their store or agent listing if they have one. */
export function PersonSheet({ id, onClose, onNavigate }: { id: string | null; onClose: () => void; onNavigate?: () => void }) {
  const { lang, err } = useI18n();
  const w = W[lang === 'ar' ? 'ar' : 'en'];
  const nav = useNavigate();
  const toast = useToast();
  const [p, setP] = useState<any>(null);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [report, setReport] = useState(false);
  const [blocking, setBlocking] = useState(false);
  useEffect(() => {
    if (!id) return;
    setP(null);
    setError(null);
    get<{ person: any }>(`/api/contacts/people/${id}`)
      .then((r) => setP(r.person))
      .catch((e) => setError(err(e)));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id]);
  const go = (to: string) => {
    onClose();
    onNavigate?.();
    nav(to);
  };
  const message = async () => {
    try {
      const r = await post<{ conversationId: string }>('/api/messages/conversations', { type: 'user_to_user', recipientId: id });
      go(`/app/messages/${r.conversationId}`);
    } catch (e) {
      toast(err(e), 'error');
    }
  };
  const save = async () => {
    setSaving(true);
    try {
      await post('/api/contacts', { userId: id });
      setP({ ...p, saved: true });
      toast(w.savedT);
    } catch (e) {
      toast(err(e), 'error');
    } finally {
      setSaving(false);
    }
  };
  return (
    <Sheet open={!!id} onClose={onClose} title={p?.full_name ?? w.user}>
      {error ? (
        <p className="py-6 text-center text-sm text-muted">{error}</p>
      ) : !p ? (
        <Skeleton className="h-48 rounded-3xl" />
      ) : (
        <div className="space-y-4">
          <div className="relative overflow-hidden rounded-3xl bg-night p-5 text-white dark:bg-white/[0.06]">
            <span className="pointer-events-none absolute -end-8 -top-8 h-32 w-32 rounded-full border border-dashed border-gold/30" />
            <div className="relative flex items-center gap-4">
              <Avatar name={p.full_name} src={p.profile_image} size={64} />
              <div className="min-w-0">
                <p className="truncate font-display text-2xl">{p.full_name}</p>
                <span className="mt-1 inline-flex items-center gap-1 rounded-full bg-white/15 px-2.5 py-0.5 text-xs">
                  <BadgeCheck className="h-3.5 w-3.5" /> {w.role[p.role] ?? p.role}
                </span>
              </div>
            </div>
            {p.wallet_id && (
              <p className="relative mt-4 text-xs text-white/60">
                {w.wallet}: <span dir="ltr" className="num font-mono text-white/85">{p.wallet_id}</span>
              </p>
            )}
          </div>
          {p.workplaces?.length > 0 && (
            <ul className="space-y-1.5">
              {p.workplaces.map((x: any, i: number) => {
                const m = x.since ? Math.floor((Date.now() - new Date(x.since).getTime()) / (30.44 * 86400000)) : null;
                const y = m != null ? Math.floor(m / 12) : null;
                return (
                  <li key={i} className="flex items-center gap-2.5 rounded-2xl bg-sunk/70 px-3.5 py-2.5 text-sm">
                    <BadgeCheck className="h-4 w-4 text-olive" />
                    <span>
                      {lang === 'ar' ? 'بيشتغل عند ' : 'Works at '}
                      <b>{x.place}</b>
                      {x.role_title ? ` · ${x.role_title}` : ''}
                      {m != null && <span className="text-muted"> · {lang === 'ar' ? (y ? `من ${y} ${y === 1 ? 'سنة' : y === 2 ? 'سنتين' : 'سنين'}` : `من ${m} شهر`) : y ? `${y}y` : `${m}m`}</span>}
                    </span>
                  </li>
                );
              })}
            </ul>
          )}
          {p.store && (
            <button type="button" onClick={() => go(`/s/${p.store.slug}`)} className="flex w-full items-center gap-3 rounded-2xl bg-olive/[0.07] p-3.5 text-start ring-1 ring-olive/20 transition hover:bg-olive/[0.12]">
              <Avatar name={p.store.name} src={p.store.logo} size={42} />
              <span className="min-w-0 flex-1">
                <span className="block truncate font-semibold">{p.store.name}</span>
                <span className="block text-xs text-muted">{[w.openStore, p.store.city].filter(Boolean).join(' · ')}</span>
              </span>
              <Store className="h-5 w-5 text-olive" />
            </button>
          )}
          {p.agent && (
            <button type="button" onClick={() => go(`/app/agents?agent=${p.id}`)} className="flex w-full items-center gap-3 rounded-2xl bg-gold/[0.08] p-3.5 text-start ring-1 ring-gold/25 transition hover:bg-gold/[0.14]">
              <span className="grid h-[42px] w-[42px] place-items-center rounded-full bg-gold/20 text-[rgb(150_105_10)] dark:text-gold">
                <MapPin className="h-5 w-5" />
              </span>
              <span className="min-w-0 flex-1">
                <span className="block truncate font-semibold">{p.agent.name}</span>
                <span className="block text-xs text-muted">{[w.openAgent, p.agent.city].filter(Boolean).join(' · ')}</span>
              </span>
              <HandCoins className="h-5 w-5 text-[rgb(150_105_10)] dark:text-gold" />
            </button>
          )}
          {p.me ? (
            <p className="rounded-2xl bg-sunk p-3 text-center text-sm text-muted">{w.you}</p>
          ) : (
            <div className="grid grid-cols-2 gap-2.5">
              {p.role !== 'admin' && (
                <Button variant="secondary" icon={<MessageCircle className="h-4 w-4" />} onClick={message}>
                  {w.message}
                </Button>
              )}
              {p.wallet_id && (
                <Button variant="secondary" icon={<Send className="h-4 w-4 flip-rtl" />} onClick={() => go(`/app/send?to=${encodeURIComponent(p.wallet_id)}`)}>
                  {w.send}
                </Button>
              )}
              <Button className="col-span-2" variant={p.saved ? 'secondary' : 'primary'} disabled={p.saved} loading={saving} icon={<UserPlus className="h-4 w-4" />} onClick={save}>
                {p.saved ? w.saved : w.save}
              </Button>
              <div className="col-span-2 flex justify-center gap-4">
                <button type="button" onClick={() => setReport(true)} className="inline-flex items-center gap-1.5 py-1 text-xs text-muted hover:text-stitch">
                  <Flag className="h-3.5 w-3.5" /> {lang === 'ar' ? 'بلّغ عن هالشخص' : 'Report this person'}
                </button>
                {p.role !== 'admin' && (
                  <button type="button" onClick={() => setBlocking(true)} className="inline-flex items-center gap-1.5 py-1 text-xs text-muted hover:text-stitch">
                    <Ban className="h-3.5 w-3.5" /> {lang === 'ar' ? 'بلّكه' : 'Block'}
                  </button>
                )}
              </div>
              <BlockPicker open={blocking} onClose={() => setBlocking(false)} preset={{ id: p.id, full_name: p.full_name, profile_image: p.profile_image }} onDone={() => (setBlocking(false), onClose())} />
              <ReportSheet open={report} onClose={() => setReport(false)} target={{ userId: p.id, name: p.full_name }} />
            </div>
          )}
        </div>
      )}
    </Sheet>
  );
}

/**
 * Typing "@" in a message opens this: search stores, cash agents and people, and the
 * chosen one goes into the text as a mention.
 */
export function MentionPicker({ query, onPick, onClose }: { query: string; onPick: (kind: MentionKind, ref: string, name: string) => void; onClose: () => void }) {
  const { lang } = useI18n();
  const w = W[lang === 'ar' ? 'ar' : 'en'];
  const [items, setItems] = useState<any[] | null>(null);
  useEffect(() => {
    const q = query.trim();
    if (!q) {
      setItems(null);
      return;
    }
    let alive = true;
    const h = setTimeout(async () => {
      try {
        const r = await get<{ items: any[] }>(`/api/admin/mentionables?q=${encodeURIComponent(q)}`);
        if (alive) setItems(r.items);
      } catch {
        if (alive) setItems([]);
      }
    }, 180);
    return () => {
      alive = false;
      clearTimeout(h);
    };
  }, [query]);
  const hint = lang === 'ar' ? 'اكتب اسم متجر أو وكيل أو شخص…' : 'Type a store, agent or person…';
  const none = lang === 'ar' ? 'ما لقينا حدا بهالاسم' : 'Nobody matches that';
  return (
    <div className="mt-2 overflow-hidden rounded-2xl bg-surface shadow-lift ring-1 ring-line">
      <div className="flex items-center justify-between border-b border-line px-3.5 py-2 text-xs text-muted">
        <span>{query.trim() ? `@${query}` : hint}</span>
        <button type="button" onClick={onClose} className="grid h-6 w-6 place-items-center rounded-full hover:bg-sunk" aria-label="✕">
          ✕
        </button>
      </div>
      {items == null ? null : !items.length ? (
        <p className="px-4 py-3 text-center text-sm text-muted">{none}</p>
      ) : (
        <ul className="max-h-72 overflow-y-auto">
          {items.map((x) => {
            const L = LOOK[x.kind as MentionKind];
            return (
              <li key={`${x.kind}:${x.ref}`}>
                <button
                  type="button"
                  onMouseDown={(e) => e.preventDefault()}
                  onClick={() => onPick(x.kind, x.ref, x.name)}
                  className="flex w-full items-center gap-3 px-3.5 py-2.5 text-start transition hover:bg-sunk/70"
                >
                  <Avatar name={x.name} src={x.image} size={34} />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-sm font-medium">{x.name}</span>
                    {x.sub && (
                      <span className="block truncate text-xs text-muted" dir={x.kind === 'user' ? 'ltr' : undefined}>
                        {x.sub}
                      </span>
                    )}
                  </span>
                  <span className={cx('inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-semibold ring-1', L.c)}>
                    <L.icon className="h-3 w-3" /> {w[x.kind as MentionKind]}
                  </span>
                </button>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
