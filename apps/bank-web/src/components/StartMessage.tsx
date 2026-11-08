import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Search, SendHorizontal, X } from 'lucide-react';
import { get, post } from '../lib/api';
import { useI18n } from '../lib/i18n';
import { TOPICS } from '../lib/supportTopics';
import { Avatar, Button, ErrorNote, Sheet, cx } from './ui';

interface Who {
  id: string;
  full_name: string;
  email?: string;
  username?: string | null;
}

/**
 * Staff write to any customer: pick them (or arrive with one chosen), pick what it's about,
 * write. It lands in the customer's "TalerBank support" chat, which becomes yours.
 */
export function StartMessage({ open, onClose, who: preset }: { open: boolean; onClose: () => void; who?: Who | null }) {
  const { lang, err } = useI18n();
  const ar = lang === 'ar';
  const nav = useNavigate();
  const [who, setWho] = useState<Who | null>(null);
  const [q, setQ] = useState('');
  const [found, setFound] = useState<Who[]>([]);
  const [topic, setTopic] = useState('account');
  const [body, setBody] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    if (open) {
      setWho(preset ?? null);
      setQ('');
      setBody('');
      setTopic('account');
      setError(null);
    }
    // Reset when it opens or the chosen customer changes (not on every render).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, preset?.id]);
  useEffect(() => {
    if (who || q.trim().length < 2) {
      setFound([]);
      return;
    }
    const h = setTimeout(() => {
      get<{ users: any[] }>(`/api/admin/users?q=${encodeURIComponent(q.trim())}`)
        .then((r) => setFound((r.users ?? []).filter((u) => u.role === 'user').slice(0, 8)))
        .catch(() => setFound([]));
    }, 300);
    return () => clearTimeout(h);
  }, [q, who]);

  return (
    <Sheet open={open} onClose={onClose} title={ar ? 'رسالة لزبون' : 'Message a customer'}>
      <form
        className="space-y-4"
        onSubmit={async (e) => {
          e.preventDefault();
          if (!who) return setError(ar ? 'اختار الزبون' : 'Choose the customer');
          setBusy(true);
          setError(null);
          try {
            await post(`/api/admin/support/${who.id}/start`, { body: body.trim(), topic });
            onClose();
            nav(`/app/admin/support/${who.id}`);
          } catch (e2) {
            setError(err(e2));
          } finally {
            setBusy(false);
          }
        }}
      >
        <p className="text-sm text-muted">{ar ? 'بتوصله كرسالة من TalerBank بمحادثة الدعم تبعته، وبيوصله إشعار. المحادثة بتصير إلك.' : 'It reaches them as a message from TalerBank in their support chat, with a notification. The chat becomes yours.'}</p>
        {who ? (
          <div className="flex items-center gap-3 rounded-2xl bg-sunk p-3">
            <Avatar name={who.full_name} size={40} />
            <div className="min-w-0 flex-1">
              <p className="truncate font-semibold">{who.full_name}</p>
              <p className="truncate text-xs text-muted">{who.email ?? (who.username ? `@${who.username}` : '')}</p>
            </div>
            {!preset && (
              <button type="button" onClick={() => setWho(null)} className="rounded-lg p-1.5 text-muted hover:text-ink" aria-label={ar ? 'غيّر' : 'Change'}>
                <X className="h-4 w-4" />
              </button>
            )}
          </div>
        ) : (
          <div>
            <label className="relative block">
              <Search className="pointer-events-none absolute start-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted" />
              <input value={q} onChange={(e) => setQ(e.target.value)} placeholder={ar ? 'دوّر بالاسم، الإيميل، المستخدم أو رقم الحساب' : 'Search by name, e-mail, username or account'} className="field h-12 ps-10" autoFocus />
            </label>
            {found.length > 0 && (
              <ul className="mt-2 max-h-56 overflow-y-auto rounded-2xl ring-1 ring-line">
                {found.map((u) => (
                  <li key={u.id}>
                    <button type="button" onClick={() => setWho(u)} className="flex w-full items-center gap-3 px-3 py-2.5 text-start hover:bg-sunk">
                      <Avatar name={u.full_name} size={34} />
                      <span className="min-w-0">
                        <span className="block truncate text-sm font-medium">{u.full_name}</span>
                        <span className="block truncate text-xs text-muted">{u.email}</span>
                      </span>
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>
        )}
        <div>
          <p className="mb-1.5 text-sm font-medium text-ink/80">{ar ? 'بخصوص' : 'About'}</p>
          <div className="flex flex-wrap gap-1.5">
            {TOPICS.map((x) => (
              <button
                key={x.k}
                type="button"
                aria-pressed={topic === x.k}
                onClick={() => setTopic(x.k)}
                className={cx('inline-flex items-center gap-1.5 rounded-full px-3 py-1.5 text-sm ring-1 transition', topic === x.k ? 'bg-ink text-surface ring-ink' : 'bg-surface ring-line hover:ring-ink/30')}
              >
                <x.icon className="h-3.5 w-3.5" /> {ar ? x.ar : x.en}
              </button>
            ))}
          </div>
        </div>
        <textarea value={body} onChange={(e) => setBody(e.target.value.slice(0, 2000))} rows={4} required placeholder={ar ? 'اكتب الرسالة' : 'Write the message'} className="field min-h-28 resize-y py-3" />
        <ErrorNote>{error}</ErrorNote>
        <Button block loading={busy} disabled={!who || !body.trim()} icon={<SendHorizontal className="h-4 w-4 flip-rtl" />}>
          {ar ? 'ابعت الرسالة' : 'Send message'}
        </Button>
      </form>
    </Sheet>
  );
}
