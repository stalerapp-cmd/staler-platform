import { AnimatePresence, motion } from 'framer-motion';
import { useEffect, useRef, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { ScanLine, UserCheck } from 'lucide-react';
import { ApiError, get, newIdempotencyKey, post } from '../lib/api';
import { useAuth } from '../lib/auth';
import { useI18n } from '../lib/i18n';
import { AMOUNT_RE, money } from '../lib/format';
import { useSecureAction } from '../components/SecureAction';
import { AmountInput, Avatar, Button, ErrorNote, Field, PageHeader, SuccessMark } from '../components/ui';

export default function Send() {
  const { t, lang, err } = useI18n();
  const { reload } = useAuth();
  const [params] = useSearchParams();
  const isPayment = params.get('kind') === 'payment';
  const [to, setTo] = useState(params.get('to') ?? '');
  const [amount, setAmount] = useState(params.get('amount') ?? '');
  const [note, setNote] = useState(params.get('desc') ?? '');
  const [recipient, setRecipient] = useState<{ walletId: string; name: string } | null>(null);
  const [step, setStep] = useState<'form' | 'review' | 'done'>('form');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<any>(null);
  const key = useRef(newIdempotencyKey());
  const secure = useSecureAction();
  const fixedAmount = isPayment && !!params.get('amount');

  useEffect(() => {
    setRecipient(null);
  }, [to]);

  const review = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    if (!AMOUNT_RE.test(amount) || Number(amount) <= 0) return setError(t.common.amount);
    setBusy(true);
    try {
      const r = await get(`/api/wallet/lookup?to=${encodeURIComponent(to.trim())}`);
      setRecipient(r);
      key.current = newIdempotencyKey();
      setStep('review');
    } catch (e2) {
      setError(err(e2));
    } finally {
      setBusy(false);
    }
  };

  const send = async () => {
    setBusy(true);
    setError(null);
    try {
      const r = await secure.run((totp) =>
        post('/api/wallet/transfer', { to: to.trim(), amount, description: note.trim(), kind: isPayment ? 'payment' : 'transfer', ...(totp ? { totp } : {}) }, key.current),
      );
      setResult(r);
      setStep('done');
      void reload();
    } catch (e2) {
      if (!(e2 instanceof ApiError && e2.code === 'CANCELLED')) setError(err(e2));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="mx-auto max-w-lg">
      {secure.element}
      <AnimatePresence mode="wait">
        {step === 'form' && (
          <motion.div key="form" initial={{ opacity: 0, x: 20 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: -20 }}>
            <PageHeader title={isPayment ? t.scan.payTitle : t.send.title} />
            <form onSubmit={review} className="space-y-5">
              <Field
                label={t.send.to}
                placeholder={t.send.toPh}
                value={to}
                onChange={(e) => setTo(e.target.value)}
                required
                dir="ltr"
                autoComplete="off"
                readOnly={isPayment}
                trailing={
                  !isPayment && (
                    <Link to="/app/scan" className="rounded-lg p-2 text-muted hover:text-stitch" aria-label={t.send.scanInstead}>
                      <ScanLine className="h-5 w-5" />
                    </Link>
                  )
                }
              />
              {fixedAmount ? (
                <div className="rounded-2xl bg-sunk px-5 py-4">
                  <p className="text-sm text-muted">{t.common.amount}</p>
                  <p className="num font-display text-4xl">{money(amount, lang)}</p>
                </div>
              ) : (
                <AmountInput label={t.common.amount} value={amount} onChange={setAmount} autoFocus={!!to} />
              )}
              <Field label={`${t.send.note} (${t.common.optional})`} value={note} onChange={(e) => setNote(e.target.value)} maxLength={140} />
              <ErrorNote>{error}</ErrorNote>
              <Button block size="lg" loading={busy} disabled={!to || !amount}>
                {t.send.review}
              </Button>
            </form>
          </motion.div>
        )}

        {step === 'review' && recipient && (
          <motion.div key="review" initial={{ opacity: 0, x: 20 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: -20 }} className="card p-6">
            <p className="text-sm text-muted">{t.send.found}</p>
            <div className="mt-3 flex items-center gap-3">
              <Avatar name={recipient.name} size={52} />
              <div className="min-w-0">
                <p className="flex items-center gap-2 font-display text-xl">
                  {recipient.name} <UserCheck className="h-5 w-5 text-olive" />
                </p>
                <p className="num truncate text-sm text-muted">{recipient.walletId}</p>
              </div>
            </div>
            <div className="my-6 border-t border-dashed border-line" />
            <p className="text-sm text-muted">{t.common.amount}</p>
            <p className="num font-display text-5xl">{money(amount, lang)}</p>
            {note && <p className="mt-3 rounded-xl bg-sunk px-4 py-2 text-sm">{note}</p>}
            <ErrorNote>{error}</ErrorNote>
            <div className="mt-6 grid grid-cols-2 gap-3">
              <Button variant="secondary" onClick={() => setStep('form')}>
                {t.common.back}
              </Button>
              <Button variant="stitch" loading={busy} onClick={send}>
                {t.send.send}
              </Button>
            </div>
          </motion.div>
        )}

        {step === 'done' && (
          <motion.div key="done" initial={{ opacity: 0, scale: 0.96 }} animate={{ opacity: 1, scale: 1 }} className="card p-8 text-center">
            <SuccessMark />
            <h2 className="mt-6 text-2xl">{isPayment ? t.scan.paid : t.send.sent}</h2>
            <p className="mt-2 text-muted">
              <span className="num font-medium text-ink">{money(result?.amount ?? amount, lang)}</span> {t.send.sentLead} {recipient?.name}
            </p>
            {recipient?.walletId && <SaveContact walletId={recipient.walletId} />}
            <div className="mt-8 grid gap-3 sm:grid-cols-2">
              <Link to="/app">
                <Button variant="secondary" block>
                  {t.common.done}
                </Button>
              </Link>
              <Button
                block
                onClick={() => {
                  setStep('form');
                  setAmount('');
                  setNote('');
                  setTo('');
                }}
              >
                {t.send.another}
              </Button>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

/** After paying someone: one tap to keep them in contacts. */
function SaveContact({ walletId }: { walletId: string }) {
  const { t, err } = useI18n();
  const [state, setState] = useState<'idle' | 'busy' | 'done'>('idle');
  const [error, setError] = useState<string | null>(null);
  return (
    <div className="mt-5">
      <Button
        variant="ghost"
        loading={state === 'busy'}
        disabled={state === 'done'}
        onClick={async () => {
          setState('busy');
          try {
            await post('/api/contacts', { walletId });
            setState('done');
          } catch (e) {
            setError(err(e));
            setState('idle');
          }
        }}
      >
        {state === 'done' ? t.messages.saved : t.messages.saveContact}
      </Button>
      <ErrorNote>{error}</ErrorNote>
    </div>
  );
}
