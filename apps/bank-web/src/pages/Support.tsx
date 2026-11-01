import { useEffect, useRef, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { ArrowLeft, LifeBuoy, SendHorizontal } from 'lucide-react';
import { createPortal } from 'react-dom';
import { get, post } from '../lib/api';
import { useI18n } from '../lib/i18n';
import { usePolling } from '../lib/hooks';
import { relative } from '../lib/format';
import { Avatar, Badge, Button, EmptyState, ErrorNote, PageHeader, Skeleton, cx } from '../components/ui';

const W = {
  en: { title: 'Support', lead: 'Write to the TalerBank team. We usually answer within a working day.', hello: 'Hi! How can we help? Tell us what happened and we’ll reply here.', ph: 'Write a message', send: 'Send', team: 'TalerBank support', you: 'You', inbox: 'Support inbox', inboxLead: 'Customer messages. Unanswered ones are on top.', none: 'No messages yet.', waiting: 'waiting', back: 'Back' },
  ar: { title: 'الدعم', lead: 'اكتب لفريق TalerBank. عادةً منرد خلال يوم عمل.', hello: 'أهلين! كيف منقدر نساعدك؟ احكيلنا شو صار ومنرد عليك هون.', ph: 'اكتب رسالة', send: 'إرسال', team: 'دعم TalerBank', you: 'إنت', inbox: 'صندوق الدعم', inboxLead: 'رسائل الزبائن. اللي ما انرد عليها فوق.', none: 'ما في رسائل لسا.', waiting: 'بستنى رد', back: 'رجوع' },
};
const useW = () => {
  const { lang } = useI18n();
  return W[lang === 'ar' ? 'ar' : 'en'];
};

const wideQ = '(min-width: 1024px)';
function useWide() {
  const [wide, setWide] = useState(() => window.matchMedia(wideQ).matches);
  useEffect(() => {
    const m = window.matchMedia(wideQ);
    const on = () => setWide(m.matches);
    m.addEventListener('change', on);
    return () => m.removeEventListener('change', on);
  }, []);
  return wide;
}

/** The chat itself: on phones it fills the screen (lifted out of the animated page so `fixed` really is the screen). */
function ChatFrame({ title, avatar, backTo, messages, onSend, mine, hello }: { title: string; avatar: React.ReactNode; backTo: string; messages: any[] | null; onSend: (text: string) => Promise<void>; mine: (m: any) => boolean; hello?: string }) {
  const { lang, err } = useI18n();
  const w = useW();
  const wide = useWide();
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const end = useRef<HTMLDivElement>(null);
  useEffect(() => {
    end.current?.scrollIntoView({ block: 'end' });
  }, [messages?.length]);
  useEffect(() => {
    if (wide) return;
    document.body.style.overflow = 'hidden';
    return () => {
      document.body.style.overflow = '';
    };
  }, [wide]);
  const ui = (
    <section className={cx('flex flex-col bg-bg', wide ? 'card h-[calc(100dvh-12rem)] min-h-[440px] overflow-hidden' : 'fixed inset-0 z-[70] h-[100dvh]')}>
      <header className="safe-top flex shrink-0 items-center gap-3 border-b border-line bg-surface/95 px-2 py-2 backdrop-blur sm:px-4">
        <Link to={backTo} replace className="grid h-10 w-10 place-items-center rounded-xl text-ink hover:bg-sunk" aria-label={w.back}>
          <ArrowLeft className="h-5 w-5 flip-rtl" />
        </Link>
        {avatar}
        <p className="min-w-0 flex-1 truncate font-medium">{title}</p>
      </header>
      <div className="flex-1 space-y-2 overflow-y-auto p-3 sm:p-4">
        {!messages ? (
          <Skeleton className="h-24 rounded-2xl" />
        ) : (
          <>
            {hello && (
              <div className="max-w-[85%] rounded-2xl rounded-ss-md bg-surface px-4 py-2.5 text-sm shadow-card">{hello}</div>
            )}
            {messages.map((m) => (
              <div key={m.id} className={cx('flex', mine(m) ? 'justify-end' : 'justify-start')}>
                <div className={cx('max-w-[85%] rounded-2xl px-4 py-2.5', mine(m) ? 'rounded-se-md bg-night text-white dark:bg-sky/30' : 'rounded-ss-md bg-surface shadow-card')}>
                  {!mine(m) && m.staff_name && <p className="mb-0.5 text-xs font-semibold text-gold">{m.staff_name}</p>}
                  <p className="whitespace-pre-wrap break-words text-[15px]">{m.body}</p>
                  <p className={cx('mt-1 text-[11px]', mine(m) ? 'text-white/60' : 'text-muted')}>{relative(m.created_at, lang)}</p>
                </div>
              </div>
            ))}
          </>
        )}
        <div ref={end} />
      </div>
      {error && (
        <div className="px-3">
          <ErrorNote>{error}</ErrorNote>
        </div>
      )}
      <form
        className="flex shrink-0 items-end gap-2 border-t border-line bg-surface/95 p-2.5 pb-[max(env(safe-area-inset-bottom),0.625rem)]"
        onSubmit={async (e) => {
          e.preventDefault();
          if (!text.trim() || busy) return;
          setBusy(true);
          setError(null);
          try {
            await onSend(text.trim());
            setText('');
          } catch (e2) {
            setError(err(e2));
          } finally {
            setBusy(false);
          }
        }}
      >
        <textarea
          rows={1}
          value={text}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !e.shiftKey && wide) {
              e.preventDefault();
              (e.currentTarget.form as HTMLFormElement).requestSubmit();
            }
          }}
          placeholder={w.ph}
          maxLength={2000}
          className="field max-h-32 min-h-[46px] flex-1 resize-none rounded-2xl py-2.5"
        />
        <Button aria-label={w.send} loading={busy} disabled={!text.trim()} className="h-[46px] w-[46px] !rounded-2xl !px-0">
          <SendHorizontal className="h-5 w-5 flip-rtl" />
        </Button>
      </form>
    </section>
  );
  return wide ? ui : createPortal(ui, document.body);
}

/** Customer side: one conversation with the bank. */
export function SupportChat() {
  const w = useW();
  const [msgs, setMsgs] = useState<any[] | null>(null);
  const load = async () => {
    try {
      setMsgs((await get<{ messages: any[] }>('/api/support')).messages);
    } catch {
      setMsgs((m) => m ?? []);
    }
  };
  useEffect(() => void load(), []);
  usePolling(load, 8000);
  return (
    <div>
      <div className="hidden lg:block">
        <PageHeader title={w.title} lead={w.lead} />
      </div>
      <ChatFrame
        title={w.team}
        avatar={
          <span className="grid h-9 w-9 place-items-center rounded-full bg-olive/15 text-olive">
            <LifeBuoy className="h-5 w-5" />
          </span>
        }
        backTo="/app"
        hello={w.hello}
        messages={msgs}
        mine={(m) => !m.from_staff}
        onSend={async (body) => {
          await post('/api/support', { body });
          await load();
        }}
      />
    </div>
  );
}

/** Staff side: every customer thread, unanswered first. */
export function AdminSupport() {
  const w = useW();
  const { lang, err } = useI18n();
  const [data, setData] = useState<any[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const load = async () => {
    try {
      setData((await get<{ threads: any[] }>('/api/admin/support')).threads);
    } catch (e) {
      setError(err(e));
    }
  };
  useEffect(() => void load(), []);
  usePolling(load, 15000);
  return (
    <div>
      <PageHeader title={w.inbox} lead={w.inboxLead} />
      {error && <ErrorNote>{error}</ErrorNote>}
      {!data ? (
        <Skeleton className="h-40 rounded-2xl" />
      ) : !data.length ? (
        <EmptyState icon={<LifeBuoy className="h-6 w-6" />} title={w.none} />
      ) : (
        <ul className="card divide-y divide-line overflow-hidden">
          {data.map((th) => (
            <li key={th.user_id}>
              <Link to={`/app/admin/support/${th.user_id}`} className="flex items-center gap-3 p-4 hover:bg-sunk/60">
                <Avatar name={th.full_name} src={th.profile_image} />
                <span className="min-w-0 flex-1">
                  <span className="flex items-center justify-between gap-2">
                    <span className={cx('truncate', th.unread ? 'font-semibold' : 'font-medium')}>{th.full_name}</span>
                    <span className="shrink-0 text-[11px] text-muted">{relative(th.last_at, lang)}</span>
                  </span>
                  <span className="flex items-center justify-between gap-2">
                    <span className="truncate text-sm text-muted">{th.last_body}</span>
                    {th.unread > 0 && <Badge tone="warn">{`${th.unread} · ${w.waiting}`}</Badge>}
                  </span>
                </span>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

export function AdminSupportThread() {
  const { userId } = useParams();
  const [d, setD] = useState<any>(null);
  const load = async () => {
    try {
      setD(await get(`/api/admin/support/${userId}`));
    } catch {
      setD((x: any) => x ?? { customer: null, messages: [] });
    }
  };
  useEffect(() => void load(), [userId]);
  usePolling(load, 8000);
  return (
    <ChatFrame
      title={d?.customer ? `${d.customer.full_name} · ${d.customer.email}` : '…'}
      avatar={<Avatar name={d?.customer?.full_name} src={d?.customer?.profile_image} size={36} />}
      backTo="/app/admin/support"
      messages={d?.messages ?? null}
      mine={(m) => m.from_staff}
      onSend={async (body) => {
        await post(`/api/admin/support/${userId}`, { body });
        await load();
      }}
    />
  );
}
