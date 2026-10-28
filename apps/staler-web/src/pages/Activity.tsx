import { useEffect, useState } from 'react';
import { Inbox, Search } from 'lucide-react';
import { get } from '../lib/api';
import { useI18n } from '../lib/i18n';
import { TxDetails, TxRow, type Tx } from '../components/Wallet';
import { Button, EmptyState, ErrorNote, PageHeader, Segmented, Sheet, Skeleton } from '../components/ui';

const PAGE = 25;

export default function Activity() {
  const { t, err } = useI18n();
  const [direction, setDirection] = useState<'all' | 'in' | 'out'>('all');
  const [q, setQ] = useState('');
  const [debounced, setDebounced] = useState('');
  const [items, setItems] = useState<Tx[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [open, setOpen] = useState<Tx | null>(null);

  useEffect(() => {
    const h = setTimeout(() => setDebounced(q.trim()), 300);
    return () => clearTimeout(h);
  }, [q]);

  const load = async (offset: number) => {
    setLoading(true);
    try {
      const p = new URLSearchParams({ limit: String(PAGE), offset: String(offset), direction });
      if (debounced) p.set('q', debounced);
      const d = await get<{ transactions: Tx[]; total: number }>(`/api/wallet/transactions?${p}`);
      setItems((prev) => (offset ? [...prev, ...d.transactions] : d.transactions));
      setTotal(d.total);
      setError(null);
    } catch (e) {
      setError(err(e));
    } finally {
      setLoading(false);
    }
  };
  useEffect(() => {
    void load(0);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [direction, debounced]);

  return (
    <div className="mx-auto max-w-3xl">
      <PageHeader title={t.nav.activity} />
      <div className="mb-4 flex flex-wrap items-center gap-3">
        <Segmented
          value={direction}
          onChange={setDirection}
          options={[
            { value: 'all', label: t.common.all },
            { value: 'in', label: t.common.in },
            { value: 'out', label: t.common.out },
          ]}
        />
        <label className="relative min-w-[220px] flex-1">
          <span className="sr-only">{t.common.search}</span>
          <Search className="pointer-events-none absolute start-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted" />
          <input value={q} onChange={(e) => setQ(e.target.value)} placeholder={t.tx.searchPh} className="field ps-9" />
        </label>
      </div>
      <ErrorNote>{error}</ErrorNote>
      <div className="card p-2 sm:p-3">
        {loading && !items.length ? (
          <div className="space-y-3 p-3">
            {Array.from({ length: 6 }).map((_, i) => (
              <Skeleton key={i} className="h-14" />
            ))}
          </div>
        ) : items.length ? (
          <ul>
            {items.map((tx, i) => (
              <TxRow key={tx.id} tx={tx} index={i % PAGE} onClick={() => setOpen(tx)} />
            ))}
          </ul>
        ) : (
          <EmptyState icon={<Inbox className="h-6 w-6" />} title={t.common.empty} />
        )}
      </div>
      {items.length < total && (
        <div className="mt-4 text-center">
          <Button variant="secondary" loading={loading} onClick={() => load(items.length)}>
            {t.common.more}
          </Button>
        </div>
      )}
      <Sheet open={!!open} onClose={() => setOpen(null)} title={t.common.details}>
        {open && <TxDetails tx={open} />}
      </Sheet>
    </div>
  );
}
