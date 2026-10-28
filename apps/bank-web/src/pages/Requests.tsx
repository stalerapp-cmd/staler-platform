import { useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { QrCode } from 'lucide-react';
import { ApiError, newIdempotencyKey, post } from '../lib/api';
import { useI18n } from '../lib/i18n';
import { useData, usePolling } from '../lib/hooks';
import { useAccounts } from '../lib/accounts';
import { AMOUNT_RE, money, relative } from '../lib/format';
import { fmtIban } from '../components/Bank';
import { QRImage } from '../components/QR';
import { useSecureAction } from '../components/SecureAction';
import { AmountInput, Badge, Button, CopyButton, EmptyState, ErrorNote, Field, PageHeader, Sheet, Skeleton, SuccessMark, Toggle } from '../components/ui';

export default function Requests() {
  const { t, lang, err } = useI18n();
  const { primary } = useAccounts();
  const list = useData<{ requests: any[] }>('/api/payment-requests');
  const [fixed, setFixed] = useState(true);
  const [amount, setAmount] = useState('');
  const [desc, setDesc] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [show, setShow] = useState<any>(null);
  usePolling(() => list.reload(), 4000, !!show);
  const live = show && list.data?.requests.find((r) => r.id === show.id);
  const tone = (s: string) => (s === 'paid' ? 'good' : s === 'expired' ? 'neutral' : 'info');
  return (
    <div className="grid grid-cols-[minmax(0,1fr)] gap-6 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.2fr)]">
      <div>
        <PageHeader title={t.requests.title} lead={t.requests.lead} />
        <form
          className="card space-y-4 p-5"
          onSubmit={async (e) => {
            e.preventDefault();
            if (!primary) return;
            if (fixed && (!AMOUNT_RE.test(amount) || Number(amount) <= 0)) return setError(t.common.amount);
            setBusy(true);
            setError(null);
            try {
              const r = await post('/api/payment-requests', { accountId: primary.id, ...(fixed ? { amount } : {}), description: desc.trim() });
              setShow(r.request);
              setAmount('');
              setDesc('');
              void list.reload();
            } catch (e2) {
              setError(err(e2));
            } finally {
              setBusy(false);
            }
          }}
        >
          <Toggle checked={fixed} onChange={setFixed} label={t.requests.fixed} />
          {fixed && <AmountInput label={t.common.amount} value={amount} onChange={setAmount} />}
          <Field label={`${t.requests.description} (${t.common.optional})`} value={desc} onChange={(e) => setDesc(e.target.value)} maxLength={140} />
          <ErrorNote>{error}</ErrorNote>
          <Button block size="lg" loading={busy} icon={<QrCode className="h-5 w-5" />}>
            {t.requests.create}
          </Button>
        </form>
      </div>
      <section className="card h-fit p-4">
        {!list.data?.requests.length ? (
          <EmptyState icon={<QrCode className="h-6 w-6" />} title={t.common.empty} />
        ) : (
          <ul className="divide-y divide-line">
            {list.data.requests.map((r) => (
              <li key={r.id} className="flex items-center justify-between gap-3 py-3">
                <div className="min-w-0">
                  <p className="num font-display text-xl">{r.amount ? money(r.amount, lang) : '—'}</p>
                  <p className="truncate text-xs text-muted">
                    {r.description || '—'} · {relative(r.created_at, lang)}
                  </p>
                </div>
                <div className="flex items-center gap-2">
                  <Badge tone={tone(r.status)}>{t.requests.st[r.status] ?? r.status}</Badge>
                  {r.status === 'pending' && (
                    <Button size="sm" variant="secondary" onClick={() => setShow(r)}>
                      {t.requests.show}
                    </Button>
                  )}
                </div>
              </li>
            ))}
          </ul>
        )}
      </section>
      <Sheet open={!!show} onClose={() => setShow(null)} title={t.requests.show}>
        {show &&
          (live?.status === 'paid' ? (
            <div className="py-4 text-center">
              <SuccessMark />
              <p className="mt-4 text-xl">{t.requests.st.paid}</p>
            </div>
          ) : (
            <div className="text-center">
              <QRImage value={show.qr_data} size={240} label={t.requests.show} />
              {show.amount && <p className="num mt-5 font-display text-3xl">{money(show.amount, lang)}</p>}
              <div className="mt-3 flex justify-center">
                <CopyButton text={show.qr_data} label={show.qr_data.slice(0, 24) + '…'} />
              </div>
            </div>
          ))}
      </Sheet>
    </div>
  );
}

export function Pay() {
  const { id } = useParams();
  const { t, lang, err } = useI18n();
  const nav = useNavigate();
  const { primary, reload } = useAccounts();
  const { data, error: loadError } = useData<{ request: any }>(`/api/payment-requests/${id}`, [id]);
  const [amount, setAmount] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);
  const secure = useSecureAction();
  const r = data?.request;
  const [key] = useState(newIdempotencyKey);
  if (done)
    return (
      <div className="card mx-auto max-w-md p-8 text-center">
        <SuccessMark />
        <h2 className="mt-6 text-2xl">{t.requests.paid}</h2>
        <Button block className="mt-8" onClick={() => nav('/app')}>
          {t.common.done}
        </Button>
      </div>
    );
  return (
    <div className="mx-auto max-w-md">
      {secure.element}
      <PageHeader title={t.requests.payTitle} />
      {loadError ? (
        <ErrorNote>{err(loadError)}</ErrorNote>
      ) : !r ? (
        <Skeleton className="h-48 rounded-2xl" />
      ) : (
        <div className="card p-6">
          <p className="text-sm text-muted">{t.requests.payee}</p>
          <p className="font-display text-2xl">{r.payee}</p>
          <p className="num text-sm text-muted">{fmtIban(r.iban)}</p>
          {r.description && <p className="mt-3 rounded-xl bg-sunk px-4 py-2 text-sm">{r.description}</p>}
          {r.amount ? <p className="num mt-6 font-display text-5xl">{money(r.amount, lang)}</p> : <div className="mt-6"><AmountInput label={t.common.amount} value={amount} onChange={setAmount} /></div>}
          {r.status !== 'pending' && <ErrorNote>{t.requests.notPayable}</ErrorNote>}
          <ErrorNote>{error}</ErrorNote>
          <Button
            block
            size="lg"
            className="mt-6"
            loading={busy}
            disabled={r.status !== 'pending' || !primary || (!r.amount && !AMOUNT_RE.test(amount))}
            onClick={async () => {
              setBusy(true);
              setError(null);
              try {
                await secure.run((totp) => post(`/api/payment-requests/${id}/pay`, { fromAccountId: primary!.id, ...(r.amount ? {} : { amount }), ...(totp ? { totp } : {}) }, key));
                setDone(true);
                void reload();
              } catch (e) {
                if (!(e instanceof ApiError && e.code === 'CANCELLED')) setError(err(e));
              } finally {
                setBusy(false);
              }
            }}
          >
            {t.requests.pay}
          </Button>
        </div>
      )}
    </div>
  );
}

