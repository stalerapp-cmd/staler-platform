import { useState } from 'react';
import { Ticket, XCircle } from 'lucide-react';
import { del, newIdempotencyKey, post } from '../lib/api';
import { useAuth } from '../lib/auth';
import { useI18n } from '../lib/i18n';
import { useData, usePolling } from '../lib/hooks';
import { AMOUNT_RE, money, relative } from '../lib/format';
import { QRImage } from '../components/QR';
import { useToast } from '../components/Toast';
import { AmountInput, Badge, Button, EmptyState, ErrorNote, Field, PageHeader, Sheet } from '../components/ui';
import { useConfirm } from '../components/Confirm';
import { fill } from '../lib/format';

export default function Vouchers() {
  const { t, lang, err } = useI18n();
  const confirm = useConfirm();
  const toast = useToast();
  const { reload: reloadUser } = useAuth();
  const list = useData<{ vouchers: any[] }>('/api/exchange/vouchers');
  const [amount, setAmount] = useState('');
  const [desc, setDesc] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [show, setShow] = useState<any>(null);
  usePolling(() => list.reload(), 5000, !!show);

  const shown = show && list.data?.vouchers.find((v) => v.id === show.id);
  const tone = (s: string) => (s === 'active' ? 'info' : s === 'claimed' ? 'good' : 'neutral');

  return (
    <div className="grid gap-6 lg:grid-cols-[1fr_1.2fr]">
      <div>
        <PageHeader title={t.vouchers.title} lead={t.vouchers.lead} />
        <form
          className="card space-y-4 p-5"
          onSubmit={async (e) => {
            e.preventDefault();
            if (!AMOUNT_RE.test(amount) || Number(amount) <= 0) return;
            setBusy(true);
            setError(null);
            try {
              const r = await post('/api/exchange/vouchers', { amount, description: desc.trim() }, newIdempotencyKey());
              setShow(r.voucher);
              setAmount('');
              setDesc('');
              void list.reload();
              void reloadUser();
            } catch (e2) {
              setError(err(e2));
            } finally {
              setBusy(false);
            }
          }}
        >
          <AmountInput label={t.common.amount} value={amount} onChange={setAmount} />
          <Field label={`${t.common.note} (${t.common.optional})`} value={desc} onChange={(e) => setDesc(e.target.value)} maxLength={140} />
          <ErrorNote>{error}</ErrorNote>
          <Button block size="lg" variant="stitch" loading={busy} icon={<Ticket className="h-5 w-5" />}>
            {t.vouchers.create}
          </Button>
        </form>
      </div>
      <section className="card h-fit p-4">
        {!list.data?.vouchers.length ? (
          <EmptyState icon={<Ticket className="h-6 w-6" />} title={t.common.empty} />
        ) : (
          <ul className="divide-y divide-line">
            {list.data.vouchers.map((v) => (
              <li key={v.id} className="flex items-center justify-between gap-3 py-3">
                <div>
                  <p className="num font-display text-lg">{money(v.amount, lang)}</p>
                  <p className="text-xs text-muted">
                    {v.description || '—'} · {relative(v.created_at, lang)}
                    {v.claimed_by_name ? ` · ${v.claimed_by_name}` : ''}
                  </p>
                </div>
                <div className="flex items-center gap-2">
                  <Badge tone={tone(v.status)}>{t.vouchers.st[v.status] ?? v.status}</Badge>
                  {v.status === 'active' && (
                    <button
                      className="rounded-lg p-2 text-muted hover:bg-stitch/10 hover:text-stitch"
                      aria-label={t.vouchers.cancel}
                      onClick={async () => {
                        const ok = await confirm({
                          title: t.ask.voucherCancelTitle,
                          body: fill(t.ask.voucherCancelBody, { amount: money(v.amount, lang) }),
                          confirmLabel: t.ask.voucherCancelOk,
                          tone: 'danger',
                        });
                        if (!ok) return;
                        try {
                          await del(`/api/exchange/vouchers/${v.id}`);
                          void list.reload();
                          void reloadUser();
                        } catch (e) {
                          toast(err(e), 'error');
                        }
                      }}
                    >
                      <XCircle className="h-5 w-5" />
                    </button>
                  )}
                </div>
              </li>
            ))}
          </ul>
        )}
      </section>
      <Sheet open={!!show} onClose={() => setShow(null)} title={t.vouchers.active}>
        {show && (
          <div className="text-center">
            {shown?.status === 'claimed' ? (
              <Badge tone="good">{t.vouchers.st.claimed}</Badge>
            ) : (
              <>
                <QRImage value={show.uri} size={240} label={t.vouchers.active} />
                <p className="num mt-5 font-display text-3xl">{money(show.amount, lang)}</p>
                <p className="mt-1 text-sm text-muted">
                  {t.vouchers.expires} {relative(show.expires_at, lang)}
                </p>
              </>
            )}
          </div>
        )}
      </Sheet>
    </div>
  );
}
