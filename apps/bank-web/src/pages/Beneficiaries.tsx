import { useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { CalendarClock, MessageCircle, Pencil, Plus, Search, Send, Star, Trash2, UserRound, Users } from 'lucide-react';
import { del, get, patch, post } from '../lib/api';
import { useI18n } from '../lib/i18n';
import { invalidateData } from '../lib/hooks';
import { kindOf } from '../lib/kinds';
import { relative } from '../lib/format';
import { fmtIban } from '../components/Bank';
import { useConfirm } from '../components/Confirm';
import { useToast } from '../components/Toast';
import { benName, useBeneficiaries, type Beneficiary } from '../components/Beneficiaries';
import { Avatar, Button, EmptyState, ErrorNote, PageHeader, Sheet, Skeleton, cx } from '../components/ui';

/** The people you send to often, under names you choose. */
export default function Beneficiaries() {
  const { lang, err } = useI18n();
  const ar = lang === 'ar';
  const data = useBeneficiaries();
  const confirm = useConfirm();
  const toast = useToast();
  const nav = useNavigate();
  const [q, setQ] = useState('');
  const [adding, setAdding] = useState(false);
  const [renaming, setRenaming] = useState<Beneficiary | null>(null);
  const reload = () => {
    invalidateData('/api/beneficiaries');
    void data.reload();
  };
  const all = data.data?.beneficiaries ?? [];
  const needle = q.trim().toLowerCase();
  const list = needle ? all.filter((b) => [b.nickname, b.holder, b.business, b.iban.replace(/\s/g, ''), b.accountNumber, b.username].some((x) => x && x.toLowerCase().includes(needle.replace(/\s/g, '')))) : all;

  const act = async (fn: () => Promise<unknown>) => {
    try {
      await fn();
      reload();
    } catch (e) {
      toast(err(e), 'error');
    }
  };

  return (
    <div>
      <PageHeader
        title={ar ? 'المستفيدين' : 'Beneficiaries'}
        lead={ar ? 'الناس اللي بتحوّلهم دايمًا، بأسماء انت بتختارها. بتختار واحد وبتحوّل بكبسة.' : 'People you send to often, under names you choose. Pick one and send in a tap.'}
        actions={
          <Button icon={<Plus className="h-4 w-4" />} onClick={() => setAdding(true)}>
            {ar ? 'ضيف مستفيد' : 'Add beneficiary'}
          </Button>
        }
      />
      {!data.data ? (
        <Skeleton className="h-48 rounded-3xl" />
      ) : !all.length ? (
        <EmptyState
          icon={<Users className="h-6 w-6" />}
          title={ar ? 'لسا ما حفظت حدا. بعد أي تحويل بتقدر تحفظ الشخص، أو ضيفه من هون.' : 'Nobody saved yet. Save someone after a transfer, or add them here.'}
          action={<Button onClick={() => setAdding(true)}>{ar ? 'ضيف مستفيد' : 'Add beneficiary'}</Button>}
        />
      ) : (
        <>
          {all.length > 6 && (
            <label className="relative mb-4 block">
              <Search className="pointer-events-none absolute start-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted" />
              <input value={q} onChange={(e) => setQ(e.target.value)} placeholder={ar ? 'دوّر بالاسم أو الحساب' : 'Search by name or account'} className="field ps-9" />
            </label>
          )}
          <ul className="grid gap-3 md:grid-cols-2">
            {list.map((b) => {
              const k = kindOf(b.kind);
              return (
                <li key={b.id} className={cx('card p-4', b.unavailable && 'opacity-60')}>
                  <div className="flex items-start gap-3">
                    <Avatar name={benName(b)} size={44} />
                    <div className="min-w-0 flex-1">
                      <p className="flex flex-wrap items-center gap-1.5 font-semibold">
                        <span className="truncate">{benName(b)}</span>
                        {b.kind !== 'personal' && <span className={`rounded-full px-2 py-0.5 text-[11px] font-medium ${k.tone}`}>{ar ? k.ar : k.en}</span>}
                      </p>
                      {(b.nickname || b.business) && <p className="truncate text-xs text-muted">{b.holder}</p>}
                      <p className="num mt-0.5 truncate text-xs text-muted" dir="ltr">
                        {fmtIban(b.iban)}
                      </p>
                      <p className="mt-1 text-xs text-muted">
                        {b.unavailable
                          ? ar
                            ? 'هالحساب مش متاح هلّأ'
                            : 'This account isn’t available now'
                          : b.lastUsed
                            ? ar
                              ? `آخر تحويل ${relative(b.lastUsed, lang)} · ${b.times} مرة`
                              : `Last sent ${relative(b.lastUsed, lang)} · ${b.times}×`
                            : ar
                              ? 'لسا ما حوّلتله'
                              : 'Not sent to yet'}
                      </p>
                    </div>
                    <button
                      type="button"
                      aria-label={b.favourite ? (ar ? 'شيل من المفضلة' : 'Unfavourite') : ar ? 'مفضّل' : 'Favourite'}
                      aria-pressed={b.favourite}
                      onClick={() => act(() => patch(`/api/beneficiaries/${b.id}`, { favourite: !b.favourite }))}
                      className="rounded-full p-2 text-gold hover:bg-sunk"
                    >
                      <Star className="h-5 w-5" fill={b.favourite ? 'currentColor' : 'none'} />
                    </button>
                  </div>
                  <div className="mt-3 flex flex-wrap gap-2">
                    {!b.unavailable && (
                      <>
                        <Link to={`/app/transfer?to=${encodeURIComponent(b.iban.replace(/\s/g, ''))}`} className="inline-flex items-center gap-1.5 rounded-xl bg-ink px-3 py-2 text-sm font-semibold text-surface">
                          <Send className="h-4 w-4" /> {ar ? 'حوّل' : 'Send'}
                        </Link>
                        <button
                          type="button"
                          onClick={async () => {
                            try {
                              const r = await post<{ conversationId: string }>('/api/messages/conversations', { userId: b.userId });
                              nav(`/app/messages/${r.conversationId}`);
                            } catch (e) {
                              toast(err(e), 'error');
                            }
                          }}
                          className="inline-flex items-center gap-1.5 rounded-xl bg-surface px-3 py-2 text-sm font-semibold text-ink ring-1 ring-line"
                        >
                          <MessageCircle className="h-4 w-4" /> {ar ? 'راسل' : 'Message'}
                        </button>
                        <Link to="/app/scheduled" className="inline-flex items-center gap-1.5 rounded-xl bg-surface px-3 py-2 text-sm font-semibold text-ink ring-1 ring-line">
                          <CalendarClock className="h-4 w-4" /> {ar ? 'جدول' : 'Schedule'}
                        </Link>
                      </>
                    )}
                    <button type="button" onClick={() => setRenaming(b)} className="inline-flex items-center gap-1.5 rounded-xl px-3 py-2 text-sm font-medium text-muted ring-1 ring-line hover:text-ink">
                      <Pencil className="h-4 w-4" /> {ar ? 'الاسم' : 'Name'}
                    </button>
                    <button
                      type="button"
                      onClick={async () => {
                        if (!(await confirm({ title: ar ? `تشيل ${benName(b)}؟` : `Remove ${benName(b)}?`, body: ar ? 'بس بينشال من القائمة، التحويلات القديمة بتضل.' : 'Only removed from this list; past transfers stay.', confirmLabel: ar ? 'شيله' : 'Remove', tone: 'danger' }))) return;
                        await act(() => del(`/api/beneficiaries/${b.id}`));
                      }}
                      className="ms-auto inline-flex items-center gap-1.5 rounded-xl px-3 py-2 text-sm font-medium text-stitch hover:bg-stitch/10"
                    >
                      <Trash2 className="h-4 w-4" /> {ar ? 'شيل' : 'Remove'}
                    </button>
                  </div>
                </li>
              );
            })}
          </ul>
          {!list.length && <p className="py-10 text-center text-sm text-muted">{ar ? 'ما في حدا بهالاسم' : 'Nobody matches'}</p>}
        </>
      )}
      <AddSheet open={adding} onClose={() => setAdding(false)} onDone={() => (setAdding(false), reload())} />
      <RenameSheet b={renaming} onClose={() => setRenaming(null)} onDone={() => (setRenaming(null), reload())} />
    </div>
  );
}

function AddSheet({ open, onClose, onDone }: { open: boolean; onClose: () => void; onDone: () => void }) {
  const { lang, err } = useI18n();
  const ar = lang === 'ar';
  const toast = useToast();
  const [to, setTo] = useState('');
  const [nick, setNick] = useState('');
  const [who, setWho] = useState<{ holder: string; iban: string; kind?: string; business?: string | null } | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    if (open) {
      setTo('');
      setNick('');
      setWho(null);
      setError(null);
    }
  }, [open]);
  return (
    <Sheet open={open} onClose={onClose} title={ar ? 'مستفيد جديد' : 'New beneficiary'}>
      <form
        className="space-y-4"
        onSubmit={async (e) => {
          e.preventDefault();
          setBusy(true);
          setError(null);
          try {
            if (!who) {
              setWho(await get(`/api/accounts/lookup?q=${encodeURIComponent(to.trim())}`));
              return;
            }
            await post('/api/beneficiaries', { to: to.trim(), nickname: nick.trim() || null });
            toast(ar ? 'انحفظ' : 'Saved');
            onDone();
          } catch (e2) {
            setError(err(e2));
          } finally {
            setBusy(false);
          }
        }}
      >
        <label className="block">
          <span className="mb-1.5 block text-sm font-medium text-ink/80">{ar ? 'الحساب' : 'Account'}</span>
          <input
            value={to}
            onChange={(e) => {
              setTo(e.target.value);
              setWho(null);
            }}
            placeholder={ar ? 'IBAN، رقم الحساب أو @اسم المستخدم' : 'IBAN, account number or @username'}
            className="field"
            dir="ltr"
            autoComplete="off"
            required
          />
        </label>
        {who && (
          <div className="flex items-center gap-3 rounded-2xl bg-olive/10 p-3">
            <span className="grid h-10 w-10 place-items-center rounded-full bg-olive/15 text-olive">
              <UserRound className="h-5 w-5" />
            </span>
            <div className="min-w-0">
              <p className="truncate font-semibold">
                {who.holder}
                {who.business ? ` · ${who.business}` : ''}
              </p>
              <p className="num truncate text-xs text-muted" dir="ltr">
                {fmtIban(who.iban)}
              </p>
            </div>
          </div>
        )}
        {who && (
          <label className="block">
            <span className="mb-1.5 block text-sm font-medium text-ink/80">{ar ? 'اسم بتعرفه فيه (اختياري)' : 'A name you know them by (optional)'}</span>
            <input value={nick} onChange={(e) => setNick(e.target.value)} maxLength={40} placeholder={ar ? 'مثلًا: إمي، صاحب البيت' : 'e.g. Mum, landlord'} className="field" autoFocus />
          </label>
        )}
        <ErrorNote>{error}</ErrorNote>
        <Button block loading={busy} disabled={to.trim().length < 3}>
          {who ? (ar ? 'احفظ المستفيد' : 'Save beneficiary') : ar ? 'تأكد من الحساب' : 'Check account'}
        </Button>
      </form>
    </Sheet>
  );
}

function RenameSheet({ b, onClose, onDone }: { b: Beneficiary | null; onClose: () => void; onDone: () => void }) {
  const { lang, err } = useI18n();
  const ar = lang === 'ar';
  const [nick, setNick] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    setNick(b?.nickname ?? '');
    setError(null);
  }, [b]);
  return (
    <Sheet open={!!b} onClose={onClose} title={ar ? 'غيّر الاسم' : 'Rename'}>
      <form
        className="space-y-4"
        onSubmit={async (e) => {
          e.preventDefault();
          if (!b) return;
          setBusy(true);
          setError(null);
          try {
            await patch(`/api/beneficiaries/${b.id}`, { nickname: nick.trim() || null });
            onDone();
          } catch (e2) {
            setError(err(e2));
          } finally {
            setBusy(false);
          }
        }}
      >
        <p className="text-sm text-muted">{b?.holder}</p>
        <input value={nick} onChange={(e) => setNick(e.target.value)} maxLength={40} placeholder={ar ? 'فاضي = اسمه الأصلي' : 'Empty = their own name'} className="field" autoFocus />
        <ErrorNote>{error}</ErrorNote>
        <Button block loading={busy}>
          {ar ? 'احفظ' : 'Save'}
        </Button>
      </form>
    </Sheet>
  );
}
