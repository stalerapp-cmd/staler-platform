import { AnimatePresence, motion } from 'framer-motion';
import { useEffect, useState } from 'react';
import { useParams } from 'react-router-dom';
import { Smartphone, Wallet } from 'lucide-react';
import { ApiError, get, post } from '../lib/api';
import { useI18n } from '../lib/i18n';
import { useData, usePolling } from '../lib/hooks';
import { useAccounts } from '../lib/accounts';
import { AMOUNT_RE, money, relative } from '../lib/format';
import { QRImage } from '../components/QR';
import { useSecureAction } from '../components/SecureAction';
import { AmountInput, Badge, Button, CopyButton, ErrorNote, PageHeader, SuccessMark } from '../components/ui';
import { Guilloche } from '../components/Guilloche';

/**
 * Bank -> S-Taler withdrawal (Taler integration flow):
 * create operation -> wallet scans & selects -> customer confirms here.
 */
export default function WalletWithdraw() {
  const { t, lang, err } = useI18n();
  const { opId } = useParams();
  const { primary, reload } = useAccounts();
  const list = useData<{ withdrawals: any[] }>('/api/withdrawals');
  const [amount, setAmount] = useState('');
  const [op, setOp] = useState<any>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const secure = useSecureAction();

  useEffect(() => {
    if (opId) get(`/api/withdrawals/${opId}`).then((d) => setOp(d.withdrawal)).catch((e) => setError(err(e)));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [opId]);

  usePolling(
    async () => {
      const d = await get(`/api/withdrawals/${op.operation_id}`).catch(() => null);
      if (d) setOp(d.withdrawal);
    },
    2000,
    !!op && (op.status === 'pending' || op.status === 'selected'),
  );

  const status = op?.status as string | undefined;
  useEffect(() => {
    if (status) void list.reload();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [status]);
  return (
    <div className="grid grid-cols-[minmax(0,1fr)] gap-6 lg:grid-cols-[minmax(0,1.1fr)_minmax(0,1fr)]">
      {secure.element}
      <div>
        <PageHeader title={t.wallet.title} lead={t.wallet.lead} />
        <div className="card relative overflow-hidden p-6">
          <Guilloche className="pointer-events-none absolute -end-24 -top-24 h-72 w-72 opacity-25" />
          <AnimatePresence mode="wait">
            {!op && (
              <motion.form
                key="new"
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                className="relative space-y-4"
                onSubmit={async (e) => {
                  e.preventDefault();
                  if (!primary || !AMOUNT_RE.test(amount) || Number(amount) <= 0) return;
                  setBusy(true);
                  setError(null);
                  try {
                    const r = await post('/api/withdrawals', { accountId: primary.id, amount });
                    setOp(r.withdrawal);
                    void list.reload();
                  } catch (e2) {
                    setError(err(e2));
                  } finally {
                    setBusy(false);
                  }
                }}
              >
                <AmountInput label={t.common.amount} value={amount} onChange={setAmount} />
                {primary && (
                  <p className="text-sm text-muted">
                    {t.home.available}: <span className="num text-ink">{money(primary.balance, lang)}</span>
                  </p>
                )}
                <ErrorNote>{error}</ErrorNote>
                <Button block size="lg" loading={busy} icon={<Wallet className="h-5 w-5" />}>
                  {t.wallet.create}
                </Button>
              </motion.form>
            )}
            {op && status === 'pending' && (
              <motion.div key="qr" initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }} className="relative text-center">
                <p className="mb-4 flex items-center justify-center gap-2 text-muted">
                  <Smartphone className="h-4 w-4" /> {t.wallet.step1}
                </p>
                <QRImage value={op.taler_withdraw_uri} size={230} label={t.wallet.step1} />
                <p className="num mt-5 font-display text-3xl">{money(op.amount_value, lang)}</p>
                <div className="mt-2 flex justify-center">
                  <CopyButton text={op.taler_withdraw_uri} label={t.wallet.copyUri} />
                </div>
                <motion.p className="mt-4 text-sm text-muted" animate={{ opacity: [0.4, 1, 0.4] }} transition={{ duration: 2, repeat: Infinity }}>
                  {t.wallet.waiting}
                </motion.p>
                <Button variant="ghost" className="mt-2" onClick={() => post(`/api/withdrawals/${op.operation_id}/abort`).then((d) => setOp(d.withdrawal))}>
                  {t.wallet.abort}
                </Button>
              </motion.div>
            )}
            {op && status === 'selected' && (
              <motion.div key="sel" initial={{ opacity: 0, scale: 0.97 }} animate={{ opacity: 1, scale: 1 }} className="relative">
                <Badge tone="info">{t.wallet.step2}</Badge>
                <h2 className="mt-3 text-2xl">{t.wallet.selected}</h2>
                <p className="mt-1 text-muted">{t.wallet.selectedLead}</p>
                <div className="mt-5 rounded-2xl bg-sunk p-4">
                  <p className="text-sm text-muted">{t.wallet.wallet}</p>
                  <p className="num font-medium">{op.wallet_ref ?? '—'}</p>
                  <p className="num mt-3 font-display text-4xl">{money(op.amount_value, lang)}</p>
                </div>
                <ErrorNote>{error}</ErrorNote>
                <div className="mt-5 grid grid-cols-2 gap-3">
                  <Button variant="secondary" onClick={() => post(`/api/withdrawals/${op.operation_id}/abort`).then((d) => setOp(d.withdrawal))}>
                    {t.wallet.abort}
                  </Button>
                  <Button
                    loading={busy}
                    onClick={async () => {
                      setBusy(true);
                      setError(null);
                      try {
                        const d = await secure.run((totp) => post(`/api/withdrawals/${op.operation_id}/confirm`, totp ? { totp } : {}));
                        setOp(d.withdrawal);
                        void reload();
                        void list.reload();
                      } catch (e) {
                        if (!(e instanceof ApiError && e.code === 'CANCELLED')) setError(err(e));
                      } finally {
                        setBusy(false);
                      }
                    }}
                  >
                    {t.wallet.confirm}
                  </Button>
                </div>
              </motion.div>
            )}
            {op && status === 'confirmed' && (
              <motion.div key="ok" initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="relative py-4 text-center">
                <SuccessMark />
                <h2 className="mt-5 text-2xl">{t.wallet.done}</h2>
                <p className="num mt-1 font-display text-3xl">{money(op.amount_value, lang)}</p>
                <Button className="mt-6" variant="secondary" onClick={() => (setOp(null), setAmount(''))}>
                  {t.common.done}
                </Button>
              </motion.div>
            )}
            {op && status === 'aborted' && (
              <motion.div key="ab" initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="relative">
                <ErrorNote>{t.wallet.aborted}</ErrorNote>
                <Button className="mt-4" variant="secondary" onClick={() => setOp(null)}>
                  {t.common.back}
                </Button>
              </motion.div>
            )}
          </AnimatePresence>
        </div>
      </div>
      {!!list.data?.withdrawals.length && (
      <section className="card h-fit p-4">
        <h2 className="mb-2 px-1 text-xl">{t.wallet.recent}</h2>
        <ul className="divide-y divide-line">
          {list.data?.withdrawals.map((w) => (
            <li key={w.operation_id}>
              <button onClick={() => setOp(w)} className="flex w-full items-center justify-between gap-3 px-1 py-3 text-start">
                <div>
                  <p className="num font-medium">{money(w.amount_value, lang)}</p>
                  <p className="text-xs text-muted">{relative(w.created_at, lang)}</p>
                </div>
                <Badge tone={w.status === 'confirmed' ? 'good' : w.status === 'aborted' ? 'neutral' : 'info'}>{t.wallet.st[w.status] ?? w.status}</Badge>
              </button>
            </li>
          ))}
        </ul>
      </section>
      )}
    </div>
  );
}
