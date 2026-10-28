import { AnimatePresence, motion } from 'framer-motion';
import { useEffect, useRef, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { BadgeCheck } from 'lucide-react';
import { ApiError, get, newIdempotencyKey, post } from '../lib/api';
import { useI18n } from '../lib/i18n';
import { useAccounts, useConfig } from '../lib/accounts';
import { AMOUNT_RE, money } from '../lib/format';
import { fmtIban } from '../components/Bank';
import { useSecureAction } from '../components/SecureAction';
import { AmountInput, Button, ErrorNote, Field, PageHeader, Select, SuccessMark } from '../components/ui';

export default function Transfer() {
  const { t, lang, err } = useI18n();
  const [params] = useSearchParams();
  const { accounts, primary, reload } = useAccounts();
  const config = useConfig();
  const [from, setFrom] = useState('');
  const [to, setTo] = useState(params.get('to') ?? '');
  const [amount, setAmount] = useState('');
  const [subject, setSubject] = useState('');
  const [who, setWho] = useState<{ holder: string; iban: string } | null>(null);
  const [step, setStep] = useState<'form' | 'review' | 'done'>('form');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<any>(null);
  const key = useRef(newIdempotencyKey());
  const secure = useSecureAction();
  useEffect(() => {
    if (!from && primary) setFrom(primary.id);
  }, [primary, from]);
  const fromAcc = accounts.find((a) => a.id === from);

  return (
    <div className="mx-auto max-w-xl">
      {secure.element}
      <AnimatePresence mode="wait">
        {step === 'form' && (
          <motion.form
            key="f"
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0 }}
            className="space-y-5"
            onSubmit={async (e) => {
              e.preventDefault();
              if (!AMOUNT_RE.test(amount) || Number(amount) <= 0) return setError(t.common.amount);
              setBusy(true);
              setError(null);
              try {
                setWho(await get(`/api/accounts/lookup?q=${encodeURIComponent(to.trim())}`));
                key.current = newIdempotencyKey();
                setStep('review');
              } catch (e2) {
                setError(err(e2));
              } finally {
                setBusy(false);
              }
            }}
          >
            <PageHeader title={t.transfer.title} />
            {accounts.length > 1 && (
              <Select
                block
                label={t.transfer.fromAcc}
                value={from}
                onChange={setFrom}
                options={accounts.map((a) => ({ value: a.id, label: a.nickname && a.nickname !== 'Main account' ? a.nickname : a.account_number, hint: money(a.balance, lang) }))}
              />
            )}
            {fromAcc && (
              <p className="text-sm text-muted">
                {t.home.available}: <span className="num font-medium text-ink">{money(fromAcc.balance, lang)}</span>
              </p>
            )}
            <Field label={t.transfer.to} placeholder={t.transfer.toPh} value={to} onChange={(e) => setTo(e.target.value)} dir="ltr" required autoComplete="off" />
            <AmountInput label={t.common.amount} value={amount} onChange={setAmount} />
            <Field label={`${t.transfer.subject} (${t.common.optional})`} value={subject} onChange={(e) => setSubject(e.target.value)} maxLength={140} />
            {config.data && (
              <p className="text-xs text-muted">
                {t.transfer.limits}: <span className="num">{money(config.data.maxTransfer, lang)}</span> {t.transfer.perTransfer} ·{' '}
                <span className="num">{money(config.data.dailyLimit, lang)}</span> {t.transfer.perDay}
              </p>
            )}
            <ErrorNote>{error}</ErrorNote>
            <Button block size="lg" loading={busy} disabled={!to || !amount}>
              {t.transfer.review}
            </Button>
          </motion.form>
        )}
        {step === 'review' && who && (
          <motion.div key="r" initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }} className="card overflow-hidden">
            <div className="engraved border-b border-line p-6">
              <p className="text-sm text-muted">{t.transfer.beneficiary}</p>
              <p className="mt-1 flex items-center gap-2 font-display text-2xl">
                {who.holder} <BadgeCheck className="h-5 w-5 text-olive" />
              </p>
              <p className="num mt-1 text-sm text-muted">{fmtIban(who.iban)}</p>
            </div>
            <div className="p-6">
              <p className="text-sm text-muted">{t.common.amount}</p>
              <p className="num font-display text-5xl">{money(amount, lang)}</p>
              {subject && <p className="mt-3 rounded-xl bg-sunk px-4 py-2 text-sm">{subject}</p>}
              <ErrorNote>{error}</ErrorNote>
              <div className="mt-6 grid grid-cols-2 gap-3">
                <Button variant="secondary" onClick={() => setStep('form')}>
                  {t.common.back}
                </Button>
                <Button
                  loading={busy}
                  onClick={async () => {
                    setBusy(true);
                    setError(null);
                    try {
                      const r = await secure.run((totp) => post('/api/transfers', { fromAccountId: from, to: to.trim(), amount, subject: subject.trim(), ...(totp ? { totp } : {}) }, key.current));
                      setResult(r.transaction);
                      setStep('done');
                      void reload();
                    } catch (e2) {
                      if (!(e2 instanceof ApiError && e2.code === 'CANCELLED')) setError(err(e2));
                      key.current = newIdempotencyKey();
                    } finally {
                      setBusy(false);
                    }
                  }}
                >
                  {t.transfer.send}
                </Button>
              </div>
            </div>
          </motion.div>
        )}
        {step === 'done' && (
          <motion.div key="d" initial={{ opacity: 0, scale: 0.97 }} animate={{ opacity: 1, scale: 1 }} className="card p-8 text-center">
            <SuccessMark />
            <h2 className="mt-6 text-3xl">{t.transfer.sent}</h2>
            <p className="num mt-2 font-display text-2xl">{money(result?.amount ?? amount, lang)}</p>
            <p className="mt-1 text-muted">{who?.holder}</p>
            <p className="num mt-3 text-xs text-muted">
              {t.tx.reference}: {result?.reference}
            </p>
            <div className="mt-8 grid gap-3 sm:grid-cols-2">
              <Link to="/app">
                <Button block variant="secondary">
                  {t.common.done}
                </Button>
              </Link>
              <Button
                block
                onClick={() => {
                  setStep('form');
                  setTo('');
                  setAmount('');
                  setSubject('');
                }}
              >
                {t.transfer.newOne}
              </Button>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
