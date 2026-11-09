import { useEffect, useState } from 'react';
import { motion } from 'framer-motion';
import { ArrowDown, ArrowUp, Check, Pencil, Search, SlidersHorizontal, X } from 'lucide-react';
import { get, put } from '../lib/api';
import { useI18n } from '../lib/i18n';
import { KINDS, kindOf, type Kind } from '../lib/kinds';
import { money, relative } from '../lib/format';
import { useToast } from '../components/Toast';
import { Avatar, Button, EmptyState, ErrorNote, PageHeader, Sheet, Skeleton, cx } from '../components/ui';

interface Row {
  id: string;
  full_name: string;
  email: string;
  username: string | null;
  customer_type: Kind;
  business_name: string | null;
  status: string;
  custom_limit: string | null;
  note: string | null;
  set_at: string | null;
  set_by: string | null;
  used_today: string;
  effective: string;
}
interface Data {
  global: string;
  types: Record<Kind, string | null>;
  counts: Record<Kind | 'custom', number>;
  customers: Row[];
  total: number;
}

const ok = (v: string) => /^\d{1,9}(\.\d{1,2})?$/.test(v.trim());
const clean = (v: string) => v.replace(/[٠-٩]/g, (d) => String('٠١٢٣٤٥٦٧٨٩'.indexOf(d))).replace(',', '.').replace(/[^\d.]/g, '');

/** A small money box: number + currency, nothing huge. */
function LimitInput({ value, onChange, placeholder, autoFocus }: { value: string; onChange: (v: string) => void; placeholder?: string; autoFocus?: boolean }) {
  return (
    <label className="flex h-10 items-center gap-1.5 rounded-xl border border-line bg-surface px-3 focus-within:border-gold" dir="ltr">
      <input
        value={value}
        onChange={(e) => onChange(clean(e.target.value))}
        inputMode="decimal"
        placeholder={placeholder}
        autoFocus={autoFocus}
        className="num w-full min-w-0 bg-transparent text-sm outline-none"
      />
      <span className="shrink-0 text-xs text-muted">PS</span>
    </label>
  );
}

/** Admin → daily transfer limits: by account type, and per customer. */
export default function AdminLimits() {
  const { lang, err } = useI18n();
  const ar = lang === 'ar';
  const toast = useToast();
  const [q, setQ] = useState('');
  const [type, setType] = useState<'' | Kind>('');
  const [only, setOnly] = useState(false);
  const [d, setD] = useState<Data | null>(null);
  const [rows, setRows] = useState<Row[]>([]);
  const [error, setError] = useState<unknown>(null);
  const [more, setMore] = useState(false);
  const [editType, setEditType] = useState<Kind | null>(null);
  const [typeVal, setTypeVal] = useState('');
  const [editing, setEditing] = useState<Row | null>(null);

  const url = (offset: number) => {
    const p = new URLSearchParams({ limit: '30', offset: String(offset) });
    if (q.trim()) p.set('q', q.trim());
    if (type) p.set('type', type);
    if (only) p.set('only', 'custom');
    return `/api/admin/limits?${p}`;
  };
  const load = async () => {
    try {
      const r = await get<Data>(url(0));
      setD(r);
      setRows(r.customers);
      setError(null);
    } catch (e) {
      setError(e);
    }
  };
  useEffect(() => {
    const h = setTimeout(() => void load(), q ? 300 : 0);
    return () => clearTimeout(h);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [q, type, only]);

  const typeLimit = (k: Kind) => (d ? (d.types[k] ?? d.global) : '0');
  const saveType = async (k: Kind, v: string | null) => {
    try {
      await put('/api/admin/limits/types', { type: k, limit: v });
      toast(ar ? 'انحفظ' : 'Saved');
      setEditType(null);
      void load();
    } catch (e) {
      toast(err(e), 'error');
    }
  };

  return (
    <div>
      <PageHeader
        title={ar ? 'سقوف التحويل اليومية' : 'Daily transfer limits'}
        lead={ar ? 'قديش بيقدر كل حساب يحوّل باليوم. لكل نوع حساب سقف، وبتقدر تعطي أي زبون سقف خاص — أعلى أو أقل.' : 'How much each account can send per day. Each account type has a limit, and any customer can get their own — higher or lower.'}
      />
      {error && !d ? (
        <div className="card mx-auto max-w-md p-6 text-center">
          <p className="font-semibold">{ar ? 'ما قدرنا نحمّل السقوف' : 'Couldn’t load the limits'}</p>
          <p className="mt-1 text-sm text-muted">{err(error)}</p>
          <Button className="mt-4" variant="secondary" onClick={() => void load()}>
            {ar ? 'جرّب كمان مرة' : 'Try again'}
          </Button>
        </div>
      ) : !d ? (
        <div className="grid gap-3 sm:grid-cols-3">
          {[0, 1, 2].map((i) => (
            <Skeleton key={i} className="h-16 rounded-2xl" />
          ))}
        </div>
      ) : (
        <>
          <h2 className="mb-2 text-sm font-semibold text-muted">{ar ? 'حسب نوع الحساب' : 'By account type'}</h2>
          <div className="card grid divide-y divide-line overflow-hidden sm:grid-cols-3 sm:divide-x sm:divide-y-0 sm:rtl:divide-x-reverse">
            {(Object.keys(KINDS) as Kind[]).map((k) => {
              const K = KINDS[k];
              const own = d.types[k];
              const open = editType === k;
              return (
                <motion.div key={k} layout className="px-4 py-3 sm:p-4">
                  <div className="flex items-center gap-2.5">
                    <span className={cx('grid h-9 w-9 place-items-center rounded-xl', K.tone)}>
                      <K.icon className="h-4 w-4" />
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="block text-sm font-semibold">{ar ? K.ar : K.en}</span>
                      <span className="block text-[11px] text-muted">{ar ? `${d.counts[k]} حساب` : `${d.counts[k]} accounts`}</span>
                    </span>
                    {!open && (
                      <span className="shrink-0 text-end">
                        <span className="num block text-[15px] font-semibold">{money(typeLimit(k), lang)}</span>
                        <span className="block text-[10px] text-muted">{own ? (ar ? 'باليوم' : 'per day') : ar ? 'باليوم · العام' : 'per day · bank-wide'}</span>
                      </span>
                    )}
                    {!open && (
                      <button
                        type="button"
                        onClick={() => {
                          setEditType(k);
                          setTypeVal(own ?? '');
                        }}
                        className="grid h-8 w-8 place-items-center rounded-lg text-muted hover:bg-sunk hover:text-ink"
                        aria-label={ar ? 'عدّل' : 'Edit'}
                      >
                        <Pencil className="h-3.5 w-3.5" />
                      </button>
                    )}
                  </div>
                  {open && (
                    <form
                      className="mt-3 space-y-2"
                      onSubmit={(e) => {
                        e.preventDefault();
                        if (typeVal.trim() && !ok(typeVal)) return toast(ar ? 'اكتب سقف زي 5000 أو 7500.50' : 'Enter a limit like 5000 or 7500.50', 'error');
                        void saveType(k, typeVal.trim() || null);
                      }}
                    >
                      <LimitInput value={typeVal} onChange={setTypeVal} placeholder={d.global} autoFocus />
                      <p className="text-[11px] text-muted">{ar ? `فاضي = السقف العام (${money(d.global, lang)})` : `Empty = bank-wide (${money(d.global, lang)})`}</p>
                      <div className="flex gap-2">
                        <Button size="sm" icon={<Check className="h-3.5 w-3.5" />}>
                          {ar ? 'احفظ' : 'Save'}
                        </Button>
                        <Button size="sm" variant="ghost" type="button" onClick={() => setEditType(null)}>
                          {ar ? 'إلغاء' : 'Cancel'}
                        </Button>
                      </div>
                    </form>
                  )}
                </motion.div>
              );
            })}
          </div>

          <div className="mb-3 mt-8 flex flex-wrap items-end justify-between gap-3">
            <h2 className="text-sm font-semibold text-muted">{ar ? 'كل الحسابات' : 'All accounts'}</h2>
            <p className="text-xs text-muted">{ar ? `${d.counts.custom} بسقف خاص` : `${d.counts.custom} with their own limit`}</p>
          </div>
          <div className="mb-3 flex flex-col gap-2 sm:flex-row sm:items-center">
            <label className="relative block flex-1">
              <Search className="pointer-events-none absolute start-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted" />
              <input value={q} onChange={(e) => setQ(e.target.value)} placeholder={ar ? 'دوّر بالاسم، الإيميل أو المحل' : 'Search name, e-mail or business'} className="field h-10 ps-9 text-sm" />
            </label>
            <div className="flex flex-wrap gap-1.5">
              {(['', ...Object.keys(KINDS)] as ('' | Kind)[]).map((k) => (
                <button
                  key={k || 'all'}
                  type="button"
                  aria-pressed={type === k}
                  onClick={() => setType(k)}
                  className={cx('h-9 rounded-full px-3 text-xs font-medium ring-1 transition', type === k ? 'bg-ink text-surface ring-ink' : 'bg-surface ring-line hover:ring-ink/30')}
                >
                  {k ? (ar ? KINDS[k].ar : KINDS[k].en) : ar ? 'الكل' : 'All'}
                </button>
              ))}
              <button
                type="button"
                aria-pressed={only}
                onClick={() => setOnly((v) => !v)}
                className={cx('inline-flex h-9 items-center gap-1 rounded-full px-3 text-xs font-medium ring-1 transition', only ? 'bg-gold text-night ring-gold' : 'bg-surface ring-line hover:ring-ink/30')}
              >
                <SlidersHorizontal className="h-3.5 w-3.5" /> {ar ? 'سقف خاص' : 'Own limit'}
              </button>
            </div>
          </div>

          {!rows.length ? (
            <EmptyState icon={<Search className="h-6 w-6" />} title={ar ? 'ما في حسابات هون' : 'No accounts here'} />
          ) : (
            <ul className="card divide-y divide-line overflow-hidden">
              {rows.map((r) => {
                const K = kindOf(r.customer_type);
                const base = typeLimit(r.customer_type ?? 'personal');
                const own = r.custom_limit != null;
                const up = own && Number(r.custom_limit) > Number(base);
                const pct = Math.min(100, (Number(r.used_today) / Math.max(1, Number(r.effective))) * 100);
                return (
                  <li key={r.id}>
                    <button type="button" onClick={() => setEditing(r)} className="flex w-full items-center gap-3 px-4 py-3 text-start transition hover:bg-sunk/50">
                      <Avatar name={r.full_name} size={36} />
                      <span className="min-w-0 flex-1">
                        <span className="flex items-center gap-1.5">
                          <span className="truncate text-sm font-medium">{r.full_name}</span>
                          <span className={cx('shrink-0 rounded-full px-1.5 py-0.5 text-[10px] font-medium', K.tone)}>{ar ? K.ar : K.en}</span>
                        </span>
                        <span className="mt-1 flex items-center gap-2">
                          <span className="h-1.5 w-full max-w-40 overflow-hidden rounded-full bg-sunk">
                            <span className={cx('block h-full rounded-full', pct >= 90 ? 'bg-stitch' : pct >= 60 ? 'bg-gold' : 'bg-olive')} style={{ width: `${pct}%` }} />
                          </span>
                          <span className="num shrink-0 text-[11px] text-muted">
                            {ar ? 'اليوم' : 'today'} {money(r.used_today, lang)}
                          </span>
                        </span>
                      </span>
                      <span className="shrink-0 text-end">
                        <span className="num block text-sm font-semibold">{money(r.effective, lang)}</span>
                        {own ? (
                          <span className={cx('mt-0.5 inline-flex items-center gap-0.5 rounded-full px-1.5 py-0.5 text-[10px] font-medium', up ? 'bg-gold/15 text-[rgb(140_100_20)] dark:text-gold' : 'bg-stitch/10 text-stitch')}>
                            {up ? <ArrowUp className="h-3 w-3" /> : <ArrowDown className="h-3 w-3" />} {ar ? 'خاص' : 'own'}
                          </span>
                        ) : (
                          <span className="mt-0.5 block text-[10px] text-muted">{ar ? 'حسب النوع' : 'by type'}</span>
                        )}
                      </span>
                    </button>
                  </li>
                );
              })}
            </ul>
          )}
          {rows.length < d.total && (
            <div className="mt-3 text-center">
              <Button
                variant="secondary"
                size="sm"
                loading={more}
                onClick={async () => {
                  setMore(true);
                  try {
                    const r = await get<Data>(url(rows.length));
                    setRows((x) => [...x, ...r.customers]);
                  } finally {
                    setMore(false);
                  }
                }}
              >
                {ar ? 'أكثر' : 'More'}
              </Button>
            </div>
          )}
        </>
      )}
      <EditLimit row={editing} base={editing ? typeLimit(editing.customer_type ?? 'personal') : '0'} onClose={() => setEditing(null)} onDone={() => (setEditing(null), void load())} />
    </div>
  );
}

function EditLimit({ row, base, onClose, onDone }: { row: Row | null; base: string; onClose: () => void; onDone: () => void }) {
  const { lang, err } = useI18n();
  const ar = lang === 'ar';
  const toast = useToast();
  const [v, setV] = useState('');
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    setV(row?.custom_limit ? String(Number(row.custom_limit)) : '');
    setNote(row?.note ?? '');
    setError(null);
  }, [row]);
  const b = Number(base);
  const quick = [0.5, 2, 5, 10].map((m) => String(Math.round(b * m)));
  const save = async (limit: string | null) => {
    if (!row) return;
    if (limit !== null && !ok(limit)) return setError(ar ? 'اكتب سقف زي 5000 أو 7500.50' : 'Enter a limit like 5000 or 7500.50');
    setBusy(true);
    setError(null);
    try {
      await put(`/api/admin/users/${row.id}/limit`, { limit, note: note.trim() || null });
      toast(limit === null ? (ar ? 'رجع حسب نوع الحساب' : 'Back to the type’s limit') : ar ? 'انحفظ السقف، وانبعتله إشعار' : 'Saved — they were notified');
      onDone();
    } catch (e) {
      setError(err(e));
    } finally {
      setBusy(false);
    }
  };
  return (
    <Sheet open={!!row} onClose={onClose} title={ar ? 'سقف خاص' : 'Own limit'}>
      {row && (
        <div className="space-y-4">
          <div className="flex items-center gap-3 rounded-2xl bg-sunk/60 p-3">
            <Avatar name={row.full_name} size={40} />
            <div className="min-w-0 flex-1">
              <p className="truncate font-semibold">{row.full_name}</p>
              <p className="truncate text-xs text-muted">{row.business_name ?? row.email}</p>
            </div>
            <div className="text-end text-xs text-muted">
              <p>{ar ? 'حسب النوع' : 'Type limit'}</p>
              <p className="num font-semibold text-ink">{money(base, lang)}</p>
            </div>
          </div>
          <div>
            <p className="mb-1.5 text-sm font-medium text-ink/80">{ar ? 'سقفه اليومي' : 'Their daily limit'}</p>
            <LimitInput value={v} onChange={setV} placeholder={String(b)} autoFocus />
            <div className="mt-2 flex flex-wrap gap-1.5">
              {quick.map((x, i) => (
                <button key={x} type="button" onClick={() => setV(x)} className={cx('num rounded-full px-2.5 py-1 text-xs ring-1', v === x ? 'bg-ink text-surface ring-ink' : 'bg-surface ring-line hover:ring-ink/30')}>
                  {['½×', '2×', '5×', '10×'][i]} · {money(x, lang)}
                </button>
              ))}
            </div>
          </div>
          <label className="block">
            <span className="mb-1.5 block text-sm font-medium text-ink/80">{ar ? 'ليش؟ (للفريق بس)' : 'Why? (staff only)'}</span>
            <input value={note} onChange={(e) => setNote(e.target.value)} maxLength={200} placeholder={ar ? 'مثلًا: تاجر جملة موثّق' : 'e.g. verified wholesaler'} className="field h-10 text-sm" />
          </label>
          {row.set_at && row.custom_limit && (
            <p className="text-xs text-muted">
              {ar ? `آخر تعديل ${relative(row.set_at, lang)}${row.set_by ? ` — ${row.set_by}` : ''}` : `Last changed ${relative(row.set_at, lang)}${row.set_by ? ` — ${row.set_by}` : ''}`}
            </p>
          )}
          <ErrorNote>{error}</ErrorNote>
          <div className="flex flex-wrap gap-2">
            <Button className="flex-1" loading={busy} disabled={!v.trim()} onClick={() => void save(v.trim())}>
              {ar ? 'احفظ السقف' : 'Save limit'}
            </Button>
            {row.custom_limit && (
              <Button variant="secondary" icon={<X className="h-4 w-4" />} disabled={busy} onClick={() => void save(null)}>
                {ar ? 'رجّعه حسب النوع' : 'Back to type'}
              </Button>
            )}
          </div>
          <p className="text-[11px] text-muted">{ar ? 'الزبون بيوصله إشعار بسقفه الجديد (بدون السبب).' : 'The customer is notified of the new limit (not the reason).'}</p>
        </div>
      )}
    </Sheet>
  );
}
