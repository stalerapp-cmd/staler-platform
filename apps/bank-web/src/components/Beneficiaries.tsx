import { useState } from 'react';
import { Link } from 'react-router-dom';
import { BookmarkPlus, Check, ChevronLeft, ChevronRight, Star } from 'lucide-react';
import { post } from '../lib/api';
import { useI18n } from '../lib/i18n';
import { invalidateData, useData } from '../lib/hooks';
import { Avatar, Button, ErrorNote, cx } from './ui';

export interface Beneficiary {
  id: string;
  userId: string;
  nickname: string | null;
  favourite: boolean;
  holder: string;
  username: string | null;
  iban: string;
  accountNumber: string;
  kind: string;
  business: string | null;
  lastUsed: string | null;
  times: number;
  unavailable: boolean;
}

export const useBeneficiaries = () => useData<{ beneficiaries: Beneficiary[] }>('/api/beneficiaries');
export const benName = (b: Beneficiary) => b.nickname || b.business || b.holder;
const flat = (s: string) => s.replace(/\s+/g, '').toUpperCase();
/** Does what's typed in a "to" box point at this beneficiary? */
export const isBen = (b: Beneficiary, to: string) => {
  const v = flat(to).replace(/^@/, '');
  return !!v && (v === flat(b.iban) || v === b.accountNumber.toUpperCase() || (!!b.username && v === b.username.toUpperCase()));
};

/** A row of saved people at the top of a form; tapping one fills the "to" box. */
export function BeneficiaryPicker({ value, onPick, className }: { value: string; onPick: (to: string) => void; className?: string }) {
  const { lang } = useI18n();
  const ar = lang === 'ar';
  const data = useBeneficiaries();
  const list = (data.data?.beneficiaries ?? []).filter((b) => !b.unavailable).slice(0, 12);
  if (!list.length) return null;
  const Arrow = ar ? ChevronLeft : ChevronRight;
  return (
    <div className={className}>
      <div className="mb-2 flex items-center justify-between">
        <span className="text-sm font-medium text-ink/80">{ar ? 'المستفيدين المحفوظين' : 'Saved beneficiaries'}</span>
        <Link to="/app/beneficiaries" className="inline-flex items-center gap-0.5 text-xs font-semibold text-gold">
          {ar ? 'الكل' : 'All'} <Arrow className="h-3.5 w-3.5" />
        </Link>
      </div>
      <ul className="-mx-1 flex gap-2 overflow-x-auto px-1 pb-1 [scrollbar-width:none]">
        {list.map((b) => {
          const on = isBen(b, value);
          return (
            <li key={b.id} className="shrink-0">
              <button
                type="button"
                onClick={() => onPick(on ? '' : b.iban)}
                aria-pressed={on}
                className={cx('flex w-[84px] flex-col items-center gap-1 rounded-2xl px-1.5 py-2 text-center ring-1 transition', on ? 'bg-gold/12 ring-gold' : 'bg-surface ring-line hover:ring-ink/30')}
              >
                <span className="relative">
                  <Avatar name={benName(b)} size={40} />
                  {on ? (
                    <Check className="absolute -bottom-1 -end-1 h-4 w-4 rounded-full bg-gold p-0.5 text-white" />
                  ) : (
                    b.favourite && <Star className="absolute -bottom-1 -end-1 h-4 w-4 rounded-full bg-surface p-0.5 text-gold" fill="currentColor" />
                  )}
                </span>
                <span className="line-clamp-1 w-full text-xs font-medium">{benName(b)}</span>
              </button>
            </li>
          );
        })}
      </ul>
    </div>
  );
}

/** After a transfer: offer to keep this person for next time (if they aren't saved yet). */
export function SaveBeneficiary({ to, holder }: { to: string; holder?: string | null }) {
  const { lang, err } = useI18n();
  const ar = lang === 'ar';
  const data = useBeneficiaries();
  const [nick, setNick] = useState('');
  const [busy, setBusy] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);
  if (!data.data || (!saved && data.data.beneficiaries.some((b) => isBen(b, to)))) return null;
  if (saved)
    return (
      <p className="mt-6 inline-flex items-center gap-1.5 rounded-full bg-olive/12 px-3 py-1.5 text-sm text-olive">
        <Check className="h-4 w-4" /> {ar ? 'انحفظ بالمستفيدين' : 'Saved to beneficiaries'}
      </p>
    );
  return (
    <form
      className="mt-6 rounded-2xl bg-sunk/60 p-4 text-start"
      onSubmit={async (e) => {
        e.preventDefault();
        setBusy(true);
        setError(null);
        try {
          await post('/api/beneficiaries', { to: to.trim(), nickname: nick.trim() || null });
          invalidateData('/api/beneficiaries');
          setSaved(true);
        } catch (e2) {
          setError(err(e2));
        } finally {
          setBusy(false);
        }
      }}
    >
      <p className="flex items-center gap-2 text-sm font-semibold">
        <BookmarkPlus className="h-4 w-4 text-gold" /> {ar ? `تحفظ ${holder ?? 'هالشخص'} للمرة الجاي؟` : `Save ${holder ?? 'them'} for next time?`}
      </p>
      <div className="mt-3 flex gap-2">
        <input value={nick} onChange={(e) => setNick(e.target.value)} maxLength={40} placeholder={ar ? 'اسم بتعرفه فيه (اختياري)' : 'A name you know them by (optional)'} className="field min-w-0 flex-1" />
        <Button loading={busy}>{ar ? 'احفظ' : 'Save'}</Button>
      </div>
      <ErrorNote>{error}</ErrorNote>
    </form>
  );
}
