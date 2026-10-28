import { AnimatePresence, motion } from 'framer-motion';
import { useEffect, useRef, useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { ArrowDownToLine, ArrowUpFromLine, ExternalLink, KeyRound, Landmark, Link2, ScanLine, ShieldCheck, Unlink } from 'lucide-react';
import { ApiError, del, get, newIdempotencyKey, post } from '../lib/api';
import { useAuth } from '../lib/auth';
import { useI18n } from '../lib/i18n';
import { useData, usePolling } from '../lib/hooks';
import { AMOUNT_RE, date, money, relative } from '../lib/format';
import { useSecureAction } from '../components/SecureAction';
import { useToast } from '../components/Toast';
import { AmountInput, Badge, Button, CopyButton, ErrorNote, Field, PageHeader, Segmented, Sheet, Skeleton, SuccessMark, cx } from '../components/ui';
import { StitchBand } from '../components/Tatreez';

function LinkPanel({ onLinked }: { onLinked: () => void }) {
  const { t, err } = useI18n();
  const [mode, setMode] = useState<'code' | 'login'>('code');
  const [code, setCode] = useState('');
  const [login, setLogin] = useState('');
  const [password, setPassword] = useState('');
  const [totp, setTotp] = useState('');
  const [needTotp, setNeedTotp] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      if (mode === 'code') await post('/api/bank/link', { code: code.trim().toUpperCase() });
      else await post('/api/bank/link/credentials', { login: login.trim(), password, ...(totp ? { totp } : {}) });
      setPassword('');
      onLinked();
    } catch (e2) {
      if (e2 instanceof ApiError && (e2.code === 'MFA_REQUIRED' || e2.code === 'MFA_INVALID')) setNeedTotp(true);
      setError(err(e2));
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="card overflow-hidden">
      <div className="relative bg-night p-6 text-white">
        <Landmark className="h-8 w-8 text-gold" />
        <h2 className="mt-3 text-2xl">{t.bank.linkTitle}</h2>
        <p className="mt-1 max-w-md text-white/70">{t.bank.linkLead}</p>
        <StitchBand width={60} className="absolute inset-x-0 bottom-0 h-5 w-full opacity-60" colors={['#E2506A', '#E9C060']} />
      </div>
      <form onSubmit={submit} className="space-y-5 p-6">
        <Segmented
          value={mode}
          onChange={(m) => {
            setMode(m);
            setError(null);
          }}
          options={[
            { value: 'code', label: t.bank.viaCode },
            { value: 'login', label: t.bank.viaLogin },
          ]}
        />
        <p className="flex items-start gap-2 text-sm text-muted">
          <ShieldCheck className="mt-0.5 h-4 w-4 shrink-0 text-olive" />
          {mode === 'code' ? t.bank.viaCodeD : t.bank.viaLoginD}
        </p>
        {mode === 'code' ? (
          <Field label={t.bank.code} placeholder={t.bank.codePh} value={code} onChange={(e) => setCode(e.target.value.toUpperCase())} dir="ltr" maxLength={9} autoComplete="off" className="[&_input]:num [&_input]:text-center [&_input]:text-2xl [&_input]:tracking-[0.3em]" />
        ) : (
          <>
            <Field label={t.bank.login} value={login} onChange={(e) => setLogin(e.target.value)} dir="ltr" autoComplete="off" />
            <Field label={t.auth.password} type="password" value={password} onChange={(e) => setPassword(e.target.value)} dir="ltr" autoComplete="off" />
            {needTotp && <Field label={t.auth.mfaCode} value={totp} onChange={(e) => setTotp(e.target.value)} dir="ltr" autoComplete="one-time-code" />}
          </>
        )}
        <ErrorNote>{error}</ErrorNote>
        <Button block size="lg" loading={busy} icon={<Link2 className="h-5 w-5" />}>
          {t.bank.link}
        </Button>
      </form>
    </div>
  );
}

function MoveSheet({ kind, open, onClose, onDone }: { kind: 'topup' | 'tobank'; open: boolean; onClose: () => void; onDone: () => void }) {
  const { t, lang, err } = useI18n();
  const [amount, setAmount] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<any>(null);
  const key = useRef(newIdempotencyKey());
  const secure = useSecureAction();
  useEffect(() => {
    if (open) {
      setAmount('');
      setResult(null);
      setError(null);
      key.current = newIdempotencyKey();
    }
  }, [open]);
  const go = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!AMOUNT_RE.test(amount) || Number(amount) <= 0) return;
    setBusy(true);
    setError(null);
    try {
      const r =
        kind === 'topup'
          ? await post('/api/bank/withdraw', { amount }, key.current)
          : await secure.run((totp) => post('/api/bank/deposit', { amount, ...(totp ? { totp } : {}) }, key.current));
      setResult(r);
      onDone();
    } catch (e2) {
      if (!(e2 instanceof ApiError && e2.code === 'CANCELLED')) setError(err(e2));
      key.current = newIdempotencyKey();
    } finally {
      setBusy(false);
    }
  };
  return (
    <Sheet open={open} onClose={onClose} title={kind === 'topup' ? t.bank.topUp : t.bank.toBank}>
      {secure.element}
      {result ? (
        <div className="py-4 text-center">
          <SuccessMark />
          <p className="num mt-5 font-display text-3xl">{money(amount, lang)}</p>
          <p className="mt-2 text-muted">{result.status === 'processing' ? t.bank.processing : t.bank.done}</p>
          <Button block className="mt-6" onClick={onClose}>
            {t.common.done}
          </Button>
        </div>
      ) : (
        <form onSubmit={go} className="space-y-5">
          <p className="text-muted">{kind === 'topup' ? t.bank.topUpLead : t.bank.toBankLead}</p>
          <AmountInput label={t.common.amount} value={amount} onChange={setAmount} autoFocus />
          <ErrorNote>{error}</ErrorNote>
          <Button block size="lg" variant={kind === 'topup' ? 'primary' : 'stitch'} loading={busy} disabled={!amount}>
            {kind === 'topup' ? t.bank.topUp : t.bank.toBank}
          </Button>
        </form>
      )}
    </Sheet>
  );
}

export default function Bank() {
  const { t, lang, err } = useI18n();
  const { reload } = useAuth();
  const toast = useToast();
  const [params, setParams] = useSearchParams();
  const link = useData<any>('/api/bank/link');
  const ops = useData<{ operations: any[] }>('/api/bank/operations');
  const [bal, setBal] = useState<{ balance: string } | null>(null);
  const [balErr, setBalErr] = useState<string | null>(null);
  const [sheet, setSheet] = useState<'topup' | 'tobank' | null>(null);
  const [unlinkOpen, setUnlinkOpen] = useState(false);

  const loadBalance = async () => {
    try {
      setBal(await get('/api/bank/link/balance'));
      setBalErr(null);
    } catch (e) {
      setBalErr(err(e));
      if (e instanceof ApiError && e.code === 'BANK_LINK_REVOKED') void link.reload();
    }
  };
  useEffect(() => {
    if (link.data?.linked) void loadBalance();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [link.data?.linked]);
  useEffect(() => {
    const a = params.get('action');
    if ((a === 'topup' || a === 'tobank') && link.data?.linked) setSheet(a);
  }, [params, link.data?.linked]);

  const refreshAll = () => {
    void loadBalance();
    void ops.reload();
    void reload();
  };

  return (
    <div>
      <PageHeader title={t.bank.title} />
      {link.loading && !link.data ? (
        <Skeleton className="h-64 rounded-3xl" />
      ) : !link.data?.linked ? (
        <div className="mx-auto max-w-xl">
          <LinkPanel
            onLinked={() => {
              toast(t.bank.linked);
              void link.reload();
            }}
          />
        </div>
      ) : (
        <div className="grid gap-6 lg:grid-cols-[1.2fr_1fr]">
          <div className="space-y-6">
            <div className="card relative overflow-hidden p-6">
              <div className="absolute inset-y-0 end-0 w-1.5 bg-[repeating-linear-gradient(180deg,rgb(var(--stitch))_0_6px,transparent_6px_12px)]" />
              <div className="flex flex-wrap items-start justify-between gap-4">
                <div>
                  <p className="text-sm text-muted">{t.bank.linked}</p>
                  <p className="mt-1 font-display text-2xl">{link.data.holder}</p>
                </div>
                <Badge tone="good">
                  <ShieldCheck className="h-3.5 w-3.5" /> {link.data.via === 'code' ? t.bank.viaCode : t.bank.viaLogin}
                </Badge>
              </div>
              <div className="mt-5 flex items-center gap-2">
                <span className="num text-muted">{t.bank.iban}</span>
                <span className="num font-medium">{link.data.iban?.replace(/(.{4})/g, '$1 ')}</span>
                <CopyButton text={link.data.iban} />
              </div>
              <div className="mt-6 rounded-2xl bg-sunk p-4">
                <p className="text-sm text-muted">{t.bank.bankBalance}</p>
                {balErr ? <p className="text-sm text-stitch">{balErr}</p> : bal ? <p className="num font-display text-3xl">{money(bal.balance, lang)}</p> : <Skeleton className="mt-2 h-8 w-40" />}
              </div>
              <div className="mt-6 grid grid-cols-2 gap-3">
                <Button size="lg" icon={<ArrowDownToLine className="h-5 w-5" />} onClick={() => setSheet('topup')}>
                  {t.bank.topUp}
                </Button>
                <Button size="lg" variant="secondary" icon={<ArrowUpFromLine className="h-5 w-5" />} onClick={() => setSheet('tobank')}>
                  {t.bank.toBank}
                </Button>
              </div>
              <div className="mt-5 flex flex-wrap items-center justify-between gap-3 text-sm text-muted">
                <span>
                  {t.bank.expires} {link.data.expiresAt ? date(link.data.expiresAt, lang, false) : '—'}
                </span>
                <button onClick={() => setUnlinkOpen(true)} className="inline-flex items-center gap-1.5 rounded-lg px-2 py-1 text-stitch hover:bg-stitch/10">
                  <Unlink className="h-4 w-4" /> {t.bank.unlink}
                </button>
              </div>
            </div>

            <div className="card flex flex-wrap items-center gap-4 p-5">
              <span className="grid h-12 w-12 place-items-center rounded-2xl bg-gold/20 text-[rgb(150_105_10)] dark:text-gold">
                <ScanLine className="h-6 w-6" />
              </span>
              <div className="min-w-0 flex-1">
                <p className="font-medium">{t.bank.qrTitle}</p>
                <p className="text-sm text-muted">{t.bank.qrLead}</p>
              </div>
              <Link to="/app/scan">
                <Button variant="secondary" size="sm">
                  {t.nav.scan}
                </Button>
              </Link>
            </div>
          </div>

          <section className="card h-fit p-5">
            <h2 className="mb-3 text-lg">{t.bank.operations}</h2>
            {!ops.data?.operations.length ? (
              <p className="py-6 text-center text-muted">{t.common.empty}</p>
            ) : (
              <ul className="divide-y divide-line">
                {ops.data.operations.map((o) => (
                  <li key={o.id} className="flex items-center justify-between gap-3 py-3">
                    <div>
                      <p className="font-medium">{t.bank.kinds[o.kind] ?? o.kind}</p>
                      <p className="text-xs text-muted">{relative(o.created_at, lang)}</p>
                    </div>
                    <div className="text-end">
                      <p className={cx('num font-medium', o.kind === 'deposit' ? '' : 'text-olive')}>{money(o.amount, lang)}</p>
                      <Badge tone={o.status === 'completed' ? 'good' : o.status === 'pending' ? 'warn' : 'bad'}>{t.bank.opStatus[o.status] ?? o.status}</Badge>
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </section>
        </div>
      )}

      <MoveSheet
        kind={sheet ?? 'topup'}
        open={!!sheet}
        onClose={() => {
          setSheet(null);
          if (params.get('action')) setParams({}, { replace: true });
        }}
        onDone={refreshAll}
      />
      <Sheet open={unlinkOpen} onClose={() => setUnlinkOpen(false)} title={t.bank.unlink}>
        <p className="text-muted">{t.bank.unlinkConfirm}</p>
        <div className="mt-6 grid grid-cols-2 gap-3">
          <Button variant="secondary" onClick={() => setUnlinkOpen(false)}>
            {t.common.cancel}
          </Button>
          <Button
            variant="danger"
            onClick={async () => {
              await del('/api/bank/link');
              setUnlinkOpen(false);
              void link.reload();
            }}
          >
            {t.bank.unlink}
          </Button>
        </div>
      </Sheet>
    </div>
  );
}

/** Bank-QR withdrawal: select with this wallet, then wait for the customer to confirm in TalerBank. */
export function BankQr() {
  const { t, lang, err } = useI18n();
  const { reload } = useAuth();
  const nav = useNavigate();
  const [params] = useSearchParams();
  const uri = params.get('uri') ?? '';
  const [info, setInfo] = useState<any>(null);
  const [phase, setPhase] = useState<'inspect' | 'waiting' | 'done' | 'aborted'>('inspect');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [confirmUrl, setConfirmUrl] = useState<string | null>(null);

  useEffect(() => {
    post('/api/bank/qr/inspect', { uri })
      .then(setInfo)
      .catch((e) => setError(err(e)));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [uri]);

  usePolling(
    async () => {
      try {
        const s = await get(`/api/bank/qr/${info.operationId}`);
        if (s.status === 'completed') {
          setPhase('done');
          void reload();
        } else if (s.status === 'aborted' || s.status === 'failed') setPhase('aborted');
      } catch {
        /* keep polling */
      }
    },
    2000,
    phase === 'waiting' && !!info,
  );

  const accept = async () => {
    setBusy(true);
    setError(null);
    try {
      const r = await post('/api/bank/qr/accept', { uri });
      setConfirmUrl(r.confirmUrl);
      setPhase(r.status === 'confirmed' ? 'done' : 'waiting');
    } catch (e) {
      setError(err(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="mx-auto max-w-md">
      <PageHeader title={t.bank.qrTitle} />
      <AnimatePresence mode="wait">
        {phase === 'inspect' && (
          <motion.div key="i" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="card p-6">
            {!info && !error && <Skeleton className="h-32" />}
            {info && (
              <>
                <p className="text-sm text-muted">{t.bank.holder}</p>
                <p className="font-medium">{info.holder}</p>
                <p className="num mt-5 font-display text-5xl">{money(info.amount, lang)}</p>
                <Button block size="lg" className="mt-6" loading={busy} onClick={accept} disabled={info.status !== 'pending'}>
                  {t.common.continue}
                </Button>
              </>
            )}
            <ErrorNote>{error}</ErrorNote>
          </motion.div>
        )}
        {phase === 'waiting' && (
          <motion.div key="w" initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }} className="card p-8 text-center">
            <div className="relative mx-auto h-24 w-24">
              <motion.span className="absolute inset-0 rounded-full border-4 border-dashed border-stitch/60" animate={{ rotate: 360 }} transition={{ duration: 6, repeat: Infinity, ease: 'linear' }} />
              <span className="absolute inset-3 grid place-items-center rounded-full bg-night text-gold">
                <KeyRound className="h-8 w-8" />
              </span>
            </div>
            <h2 className="mt-6 text-xl">{t.bank.waiting}</h2>
            <p className="mt-2 text-muted">{t.bank.waitingLead}</p>
            {confirmUrl && (
              <a href={confirmUrl} target="_blank" rel="noopener noreferrer" className="mt-6 inline-block">
                <Button variant="secondary" icon={<ExternalLink className="h-4 w-4" />}>
                  {t.bank.openBank}
                </Button>
              </a>
            )}
          </motion.div>
        )}
        {phase === 'done' && (
          <motion.div key="d" initial={{ opacity: 0, scale: 0.96 }} animate={{ opacity: 1, scale: 1 }} className="card p-8 text-center">
            <SuccessMark />
            <p className="num mt-6 font-display text-4xl text-olive">+{money(info?.amount, lang)}</p>
            <p className="mt-2 text-muted">{t.bank.credited}</p>
            <Button block className="mt-8" onClick={() => nav('/app')}>
              {t.common.done}
            </Button>
          </motion.div>
        )}
        {phase === 'aborted' && (
          <motion.div key="a" initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="card p-8 text-center">
            <ErrorNote>{t.bank.aborted}</ErrorNote>
            <Button block className="mt-6" variant="secondary" onClick={() => nav('/app/bank')}>
              {t.common.back}
            </Button>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
