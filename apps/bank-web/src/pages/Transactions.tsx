import { useEffect, useState } from 'react';
import { BookText, FileSpreadsheet, ListFilter, Search } from 'lucide-react';
import { downloadFile, get } from '../lib/api';
import { useI18n } from '../lib/i18n';
import { useAccounts } from '../lib/accounts';
import { BankTxDetails, BankTxRow, type BankTx } from '../components/Bank';
import { useToast } from '../components/Toast';
import { Button, EmptyState, ErrorNote, PageHeader, Segmented, Select, Sheet, Skeleton } from '../components/ui';

const PAGE = 30;

export default function Transactions() {
  const { t, err } = useI18n();
  const toast = useToast();
  const { primary } = useAccounts();
  const [direction, setDirection] = useState<'all' | 'in' | 'out'>('all');
  const [type, setType] = useState('');
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [q, setQ] = useState('');
  const [items, setItems] = useState<BankTx[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [open, setOpen] = useState<BankTx | null>(null);

  const query = (offset: number) => {
    const p = new URLSearchParams({ limit: String(PAGE), offset: String(offset), direction });
    if (type) p.set('type', type);
    if (from) p.set('from', from);
    if (to) p.set('to', to);
    if (q.trim()) p.set('q', q.trim());
    return p;
  };
  const load = async (offset: number) => {
    if (!primary) return;
    setLoading(true);
    try {
      const d = await get<{ transactions: BankTx[]; total: number }>(`/api/accounts/${primary.id}/transactions?${query(offset)}`);
      setItems((p) => (offset ? [...p, ...d.transactions] : d.transactions));
      setTotal(d.total);
      setError(null);
    } catch (e) {
      setError(err(e));
    } finally {
      setLoading(false);
    }
  };
  useEffect(() => {
    const h = setTimeout(() => void load(0), 250);
    return () => clearTimeout(h);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [primary?.id, direction, type, from, to, q]);

  return (
    <div className="mx-auto max-w-4xl">
      <PageHeader
        title={t.nav.transactions}
        actions={
          <Button
            variant="secondary"
            icon={<FileSpreadsheet className="h-4 w-4" />}
            disabled={!primary}
            onClick={() => {
              const p = query(0);
              p.delete('limit');
              p.delete('offset');
              downloadFile(`/api/accounts/${primary!.id}/statement.csv?${p}`, `statement-${primary!.account_number}.csv`).catch((e) => toast(err(e), 'error'));
            }}
          >
            {t.tx.exportCsv}
          </Button>
        }
      />
      <div className="card mb-4 grid gap-3 p-4 sm:grid-cols-2 lg:grid-cols-4">
        <div className="sm:col-span-2">
          <Segmented
            value={direction}
            onChange={setDirection}
            options={[
              { value: 'all', label: t.common.all },
              { value: 'in', label: t.common.in },
              { value: 'out', label: t.common.out },
            ]}
          />
        </div>
        <Select
          className="sm:col-span-2"
          block
          label={t.tx.typeLabel}
          value={type || 'all'}
          onChange={(v) => setType(v === 'all' ? '' : v)}
          icon={<ListFilter className="h-4 w-4" />}
          options={[{ value: 'all', label: t.common.all }, ...Object.entries(t.tx.types).map(([k, v]) => ({ value: k, label: v }))]}
        />
        <label className="text-sm">
          <span className="mb-1 block text-muted">{t.tx.from}</span>
          <input type="date" value={from} onChange={(e) => setFrom(e.target.value)} className="field" />
        </label>
        <label className="text-sm">
          <span className="mb-1 block text-muted">{t.tx.to}</span>
          <input type="date" value={to} onChange={(e) => setTo(e.target.value)} className="field" />
        </label>
        <label className="relative sm:col-span-2 sm:self-end">
          <span className="sr-only">{t.common.search}</span>
          <Search className="pointer-events-none absolute start-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted" />
          <input value={q} onChange={(e) => setQ(e.target.value)} placeholder={t.tx.searchPh} className="field ps-9" />
        </label>
      </div>
      <ErrorNote>{error}</ErrorNote>
      <div className="card p-2">
        {loading && !items.length ? (
          <div className="space-y-3 p-3">
            {Array.from({ length: 6 }).map((_, i) => (
              <Skeleton key={i} className="h-12" />
            ))}
          </div>
        ) : items.length ? (
          <ul>
            {items.map((tx, i) => (
              <BankTxRow key={tx.id} tx={tx} index={i % PAGE} onClick={() => setOpen(tx)} />
            ))}
          </ul>
        ) : (
          <EmptyState icon={<BookText className="h-6 w-6" />} title={t.common.empty} />
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
        {open && <BankTxDetails tx={open} />}
      </Sheet>
    </div>
  );
}
