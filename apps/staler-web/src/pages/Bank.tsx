import { AnimatePresence, motion } from 'framer-motion';
import { useEffect, useRef, useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { ArrowDownToLine, ArrowUpFromLine, ExternalLink, KeyRound, Landmark, Link2, ScanLine, ShieldCheck, Unlink, Wallet } from 'lucide-react';
import { ApiError, del, get, newIdempotencyKey, post } from '../lib/api';
import { useAuth } from '../lib/auth';
import { useI18n } from '../lib/i18n';
import { useData, usePolling } from '../lib/hooks';
import { AMOUNT_RE, date, money, relative } from '../lib/format';
import { useSecureAction } from '../components/SecureAction';
import { useToast } from '../components/Toast';
import { AmountInput, Badge, Button, CopyButton, ErrorNote, Field, PageHeader, Segmented, Sheet, Skeleton, SuccessMark, cx } from '../components/ui';
import { StitchBand } from '../components/Tatreez';
import { useConfirm } from '../components/Confirm';
import { fill } from '../lib/format';

function LinkPanel({ onLinked, bare = false }: { onLinked: () => void; bare?: boolean }) {
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
    <motion.div initial={bare ? { opacity: 0, y: 16 } : false} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.08, type: 'spring', bounce: 0.3 }} className={cx('card overflow-hidden', bare && 'flex flex-col [&>form]:flex-1 [&>form]:lg:p-8')}>
      {bare ? (
        <div className="relative bg-night px-6 pb-9 pt-6 text-white lg:px-8 lg:pt-8">
          <h2 className="text-2xl lg:text-3xl">{t.bank.linkTitle}</h2>
          <StitchBand width={60} className="absolute inset-x-0 bottom-0 h-5 w-full opacity-60" colors={['#E2506A', '#E9C060']} />
        </div>
      ) : (
        <div className="relative bg-night p-6 text-white">
          <Landmark className="h-8 w-8 text-gold" />
          <h2 className="mt-3 text-2xl">{t.bank.linkTitle}</h2>
          <p className="mt-1 max-w-md text-white/70">{t.bank.linkLead}</p>
          <StitchBand width={60} className="absolute inset-x-0 bottom-0 h-5 w-full opacity-60" colors={['#E2506A', '#E9C060']} />
        </div>
      )}
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
    </motion.div>
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
  const confirm = useConfirm();
  const go = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!AMOUNT_RE.test(amount) || Number(amount) <= 0) return;
    const m = money(amount, lang);
    const ok = await confirm(
      kind === 'topup'
        ? { title: t.ask.topupTitle, body: fill(t.ask.topupBody, { amount: m }), confirmLabel: fill(t.ask.topupOk, { amount: m }) }
        : { title: t.ask.toBankTitle, body: fill(t.ask.toBankBody, { amount: m }), confirmLabel: fill(t.ask.toBankOk, { amount: m }) },
    );
    if (!ok) return;
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
  const { reload, user } = useAuth();
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

  const done = (ops.data?.operations ?? []).filter((o) => o.status === 'completed');
  const opsIn = done.filter((o) => o.kind !== 'deposit').reduce((a, o) => a + Number(o.amount), 0);
  const opsOut = done.filter((o) => o.kind === 'deposit').reduce((a, o) => a + Number(o.amount), 0);

  const refreshAll = () => {
    void loadBalance();
    void ops.reload();
    void reload();
  };

  return (
    <div>
      {/* --------------------------------------------- TalerBank hero card */}
      {link.data?.linked && (
      <section className="relative mb-6 overflow-hidden rounded-[2rem] bg-[#0C1A17] text-[#F3E9D2] shadow-card">
        <Guilloche className="pointer-events-none absolute -end-24 -top-28 h-[420px] w-[420px] opacity-35 sm:opacity-70" />
        <Guilloche className="pointer-events-none absolute -bottom-40 -start-32 h-[360px] w-[360px] opacity-35" />
        <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(70%_80%_at_100%_0%,rgba(201,164,92,0.22),transparent_60%)]" />
        <div className="absolute inset-x-8 bottom-0 h-px bg-gradient-to-r from-transparent via-[#C9A45C]/70 to-transparent" />

        <div className="relative p-5 sm:p-8">
          <div className="flex items-start justify-between gap-4">
            <div className="flex items-center gap-3.5">
              <motion.span initial={{ rotate: -20, scale: 0.6, opacity: 0 }} animate={{ rotate: 0, scale: 1, opacity: 1 }} transition={{ type: 'spring', bounce: 0.45 }} className="grid h-14 w-14 place-items-center rounded-2xl bg-gradient-to-br from-[#E2C27A] to-[#9C7A30] text-[#0C1A17] shadow-lg">
                <Landmark className="h-7 w-7" strokeWidth={2.2} />
              </motion.span>
              <a href={BANK_SITE} target="_blank" rel="noopener noreferrer" className="group inline-flex items-center gap-2" title={t.bank.openBank}>
                <h1 className="font-display text-3xl leading-none sm:text-4xl">TalerBank</h1>
                <ExternalLink className="h-4 w-4 text-[#E2C27A] opacity-60 transition group-hover:-translate-y-0.5 group-hover:opacity-100" />
              </a>
            </div>
            {link.data?.linked && (
              <span className="hidden shrink-0 items-center gap-1.5 rounded-full bg-[#C9A45C]/15 px-3 py-1.5 text-xs font-semibold text-[#E2C27A] ring-1 ring-[#C9A45C]/40 sm:inline-flex">
                <ShieldCheck className="h-3.5 w-3.5" /> {link.data.via === 'code' ? t.bank.viaCode : t.bank.viaLogin}
              </span>
            )}
          </div>

          {link.data?.linked && (
            <>
              <div className="mt-7 grid gap-5 sm:grid-cols-[1fr_auto] sm:items-end">
                <div className="min-w-0">
                  <p className="text-xs text-[#F3E9D2]/60">{t.bank.bankBalance}</p>
                  {balErr ? (
                    <p className="mt-1 text-sm text-[#F4A3A3]">{balErr}</p>
                  ) : bal ? (
                    <p className="num mt-1 font-display text-4xl tracking-tight text-white sm:text-5xl">{money(bal.balance, lang)}</p>
                  ) : (
                    <Skeleton className="mt-2 h-10 w-48 bg-white/10" />
                  )}
                  <div className="mt-3 flex min-w-0 flex-wrap items-center gap-x-4 gap-y-1 text-sm text-[#F3E9D2]/80">
                    <span className="font-medium text-white">{link.data.holder}</span>
                    <span className="inline-flex min-w-0 items-center gap-1">
                      <span className="text-[#F3E9D2]/55">{t.bank.iban}</span>
                      <span className="num truncate" dir="ltr">
                        {link.data.iban?.replace(/(.{4})/g, '$1 ')}
                      </span>
                      <span className="[&_button]:text-[#F3E9D2]/70 [&_button:hover]:bg-white/10 [&_button:hover]:text-white">
                        <CopyButton text={link.data.iban} />
                      </span>
                    </span>
                  </div>
                </div>
                <div className="grid grid-cols-2 gap-2.5 sm:w-[320px]">
                  <button type="button" onClick={() => setSheet('topup')} className="flex h-12 items-center justify-center gap-2 rounded-2xl bg-gradient-to-br from-[#E2C27A] to-[#B8913F] font-bold text-[#0C1A17] shadow-lg transition hover:-translate-y-0.5 active:scale-95">
                    <ArrowDownToLine className="h-5 w-5" /> {t.bank.topUp}
                  </button>
                  <button type="button" onClick={() => setSheet('tobank')} className="flex h-12 items-center justify-center gap-2 rounded-2xl bg-white/10 font-semibold text-white ring-1 ring-white/25 backdrop-blur transition hover:-translate-y-0.5 hover:bg-white/15 active:scale-95">
                    <ArrowUpFromLine className="h-5 w-5" /> {t.bank.toBank}
                  </button>
                </div>
              </div>
            </>
          )}
        </div>
      </section>
      )}

      {link.loading && !link.data ? (
        <Skeleton className="h-64 rounded-3xl" />
      ) : !link.data?.linked ? (
        <div className="relative mx-auto flex w-full max-w-6xl items-center py-2 lg:min-h-[calc(100dvh-9rem)]">
          <BankDecor />
          <div className="relative grid w-full items-stretch gap-6 lg:grid-cols-[minmax(0,0.9fr)_minmax(0,1.1fr)]">
            {/* The bank itself: tap to open TalerBank */}
            <motion.a
              href={BANK_SITE}
              target="_blank"
              rel="noopener noreferrer"
              initial={{ opacity: 0, y: 16 }}
              animate={{ opacity: 1, y: 0 }}
              whileHover={{ y: -4 }}
              transition={{ type: 'spring', bounce: 0.3 }}
              className="group relative flex min-h-[300px] flex-col justify-between overflow-hidden rounded-[2rem] bg-[#0C1A17] p-6 lg:min-h-[480px] lg:p-8 text-[#F3E9D2] shadow-card"
            >
              <Guilloche className="pointer-events-none absolute -end-24 -top-24 h-[340px] w-[340px] lg:h-[460px] lg:w-[460px] opacity-60 transition duration-700 group-hover:rotate-12" />
              <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(80%_70%_at_100%_0%,rgba(201,164,92,0.22),transparent_60%)]" />
              <div className="relative flex items-center justify-between">
                <span className="grid h-12 w-12 place-items-center rounded-2xl bg-gradient-to-br from-[#E2C27A] to-[#9C7A30] text-[#0C1A17] shadow-lg">
                  <Landmark className="h-6 w-6" strokeWidth={2.2} />
                </span>
                <span className="inline-flex items-center gap-1.5 rounded-full bg-white/10 px-3 py-1.5 text-xs font-semibold ring-1 ring-white/20 transition group-hover:bg-[#C9A45C] group-hover:text-[#0C1A17]">
                  {t.bank.openBank} <ExternalLink className="h-3.5 w-3.5" />
                </span>
              </div>
              <div className="relative">
                <p className="font-display text-4xl leading-none text-white lg:text-5xl">TalerBank</p>
                <ul className="mt-5 space-y-2.5 text-sm text-[#F3E9D2]/85 lg:space-y-3.5 lg:text-base">
                  {[t.bank.why1, t.bank.why2, t.bank.why3].map((w) => (
                    <li key={w} className="flex items-start gap-2.5">
                      <span className="mt-1.5 h-2 w-2 shrink-0 rotate-45 bg-[#C9A45C]" />
                      {w}
                    </li>
                  ))}
                </ul>
              </div>
            </motion.a>
            <LinkPanel
              bare
              onLinked={() => {
                toast(t.bank.linked);
                void link.reload();
              }}
            />
          </div>
        </div>
      ) : (
        <div className="grid gap-6 lg:grid-cols-[1.15fr_1fr]">
          <div className="min-w-0 space-y-6">
            {/* Money flowing between the wallet and the bank */}
            <section className="card relative overflow-hidden p-5">
              <h2 className="mb-4 text-lg">{t.bank.flowTitle}</h2>
              <div className="flex items-center gap-3">
                <div className="flex min-w-0 flex-1 flex-col items-center gap-2 text-center">
                  <span className="grid h-14 w-14 place-items-center rounded-2xl bg-night text-white shadow-lift">
                    <Wallet className="h-6 w-6" />
                  </span>
                  <p className="text-xs text-muted">S-Taler</p>
                  <p className="num truncate text-sm font-semibold">{user?.balance != null ? money(user.balance, lang) : '—'}</p>
                </div>
                <div className="relative h-14 flex-[1.4]">
                  <div className="absolute inset-x-0 top-[38%] h-0.5 bg-[repeating-linear-gradient(90deg,rgb(var(--line))_0_8px,transparent_8px_14px)]" />
                  <div className="absolute inset-x-0 top-[62%] h-0.5 bg-[repeating-linear-gradient(90deg,rgb(var(--line))_0_8px,transparent_8px_14px)]" />
                  {[0, 1, 2].map((i) => (
                    <motion.span key={`a${i}`} className="absolute top-[38%] h-2.5 w-2.5 -translate-y-1/2 rotate-45 rounded-[2px] bg-[#C9A45C]" initial={{ insetInlineStart: '100%', opacity: 0 }} animate={{ insetInlineStart: ['100%', '0%'], opacity: [0, 1, 1, 0] }} transition={{ duration: 2.6, repeat: Infinity, delay: i * 0.85, ease: 'easeInOut' }} />
                  ))}
                  {[0, 1, 2].map((i) => (
                    <motion.span key={`b${i}`} className="absolute top-[62%] h-2.5 w-2.5 -translate-y-1/2 rotate-45 rounded-[2px] bg-stitch" initial={{ insetInlineStart: '0%', opacity: 0 }} animate={{ insetInlineStart: ['0%', '100%'], opacity: [0, 1, 1, 0] }} transition={{ duration: 2.6, repeat: Infinity, delay: 0.4 + i * 0.85, ease: 'easeInOut' }} />
                  ))}
                </div>
                <div className="flex min-w-0 flex-1 flex-col items-center gap-2 text-center">
                  <span className="grid h-14 w-14 place-items-center rounded-2xl bg-[#0C1A17] text-[#E2C27A] shadow-lift">
                    <Landmark className="h-6 w-6" />
                  </span>
                  <p className="text-xs text-muted">TalerBank</p>
                  <p className="num truncate text-sm font-semibold">{bal ? money(bal.balance, lang) : '—'}</p>
                </div>
              </div>
              <div className="mt-5 grid grid-cols-2 gap-2.5">
                <div className="rounded-2xl bg-[#C9A45C]/12 p-3">
                  <p className="flex items-center gap-1.5 text-xs text-muted">
                    <ArrowDownToLine className="h-3.5 w-3.5 text-[#9C7A30] dark:text-[#E2C27A]" /> {t.bank.totalIn}
                  </p>
                  <p className="num mt-0.5 font-display text-lg">{money(opsIn, lang)}</p>
                </div>
                <div className="rounded-2xl bg-stitch/10 p-3">
                  <p className="flex items-center gap-1.5 text-xs text-muted">
                    <ArrowUpFromLine className="h-3.5 w-3.5 text-stitch" /> {t.bank.totalOut}
                  </p>
                  <p className="num mt-0.5 font-display text-lg">{money(opsOut, lang)}</p>
                </div>
              </div>
            </section>

            <div className="grid gap-4 sm:grid-cols-2">
              <Link to="/app/scan" className="card group flex items-center gap-4 p-5 transition hover:-translate-y-0.5">
                <span className="grid h-12 w-12 shrink-0 place-items-center rounded-2xl bg-gold/20 text-[rgb(150_105_10)] transition group-hover:rotate-6 dark:text-gold">
                  <ScanLine className="h-6 w-6" />
                </span>
                <span className="min-w-0">
                  <span className="block font-semibold">{t.bank.qrTitle}</span>
                  <span className="block text-sm text-muted">{t.bank.qrLead}</span>
                </span>
              </Link>
              <div className="card flex flex-col justify-between gap-3 p-5">
                <div className="flex items-center gap-3">
                  <span className="grid h-12 w-12 shrink-0 place-items-center rounded-2xl bg-olive/15 text-olive">
                    <Link2 className="h-6 w-6" />
                  </span>
                  <div className="min-w-0">
                    <p className="font-semibold">{t.bank.linkValid}</p>
                    <p className="text-sm text-muted">{link.data.expiresAt ? date(link.data.expiresAt, lang, false) : '—'}</p>
                  </div>
                </div>
                <button onClick={() => setUnlinkOpen(true)} className="inline-flex w-fit items-center gap-1.5 rounded-lg px-2 py-1 text-sm text-stitch hover:bg-stitch/10">
                  <Unlink className="h-4 w-4" /> {t.bank.unlink}
                </button>
              </div>
            </div>
          </div>

          <section className="card h-fit overflow-hidden">
            <h2 className="flex items-center justify-between gap-3 border-b border-line px-5 py-4 text-lg">
              {t.bank.operations}
              {ops.data?.operations.length ? <span className="num rounded-full bg-sunk px-2.5 py-0.5 text-xs text-muted">{ops.data.operations.length}</span> : null}
            </h2>
            {!ops.data?.operations.length ? (
              <p className="py-10 text-center text-muted">{t.common.empty}</p>
            ) : (
              <ul className="divide-y divide-line">
                {ops.data.operations.map((o) => {
                  const toBank = o.kind === 'deposit';
                  return (
                    <li key={o.id} className="flex items-center gap-3 px-5 py-3">
                      <span className={cx('grid h-10 w-10 shrink-0 place-items-center rounded-xl', toBank ? 'bg-stitch/10 text-stitch' : 'bg-[#C9A45C]/15 text-[#9C7A30] dark:text-[#E2C27A]')}>
                        {toBank ? <ArrowUpFromLine className="h-[18px] w-[18px]" /> : o.kind === 'qr_withdraw' ? <ScanLine className="h-[18px] w-[18px]" /> : <ArrowDownToLine className="h-[18px] w-[18px]" />}
                      </span>
                      <div className="min-w-0 flex-1">
                        <p className="truncate font-medium">{t.bank.kinds[o.kind] ?? o.kind}</p>
                        <p className="text-xs text-muted">{relative(o.created_at, lang)}</p>
                      </div>
                      <div className="text-end">
                        <p className={cx('num font-semibold', toBank ? 'text-stitch' : 'text-olive')}>
                          {toBank ? '−' : '+'}
                          {money(o.amount, lang)}
                        </p>
                        <Badge tone={o.status === 'completed' ? 'good' : o.status === 'pending' ? 'warn' : 'bad'}>{t.bank.opStatus[o.status] ?? o.status}</Badge>
                      </div>
                    </li>
                  );
                })}
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

const BANK_SITE = 'https://talerbank.onrender.com';

/** Brass shapes drifting slowly at the edges of the page. */
function BankDecor() {
  const items = [
    { c: 'top-2 -start-10', s: 'h-16 w-16', d: 0, k: 'ring' },
    { c: 'top-24 -end-8', s: 'h-6 w-6', d: 0.6, k: 'gem' },
    { c: 'bottom-16 -start-6', s: 'h-5 w-5', d: 1.1, k: 'gem' },
    { c: 'bottom-0 -end-10', s: 'h-24 w-24', d: 0.3, k: 'ring' },
    { c: 'top-1/2 -start-16', s: 'h-3 w-3', d: 1.6, k: 'dot' },
    { c: 'top-8 end-1/3', s: 'h-3 w-3', d: 0.9, k: 'dot' },
  ];
  return (
    <div aria-hidden="true" className="pointer-events-none absolute -inset-y-6 inset-x-0 hidden overflow-hidden sm:block">
      {items.map((x, i) => (
        <motion.span
          key={i}
          className={cx('absolute', x.c, x.s, x.k === 'ring' ? 'rounded-full border-2 border-dashed border-[#C9A45C]/40' : x.k === 'gem' ? 'rotate-45 rounded-[3px] bg-[#C9A45C]/50' : 'rounded-full bg-stitch/40')}
          animate={{ y: [0, -10, 0], rotate: x.k === 'ring' ? [0, 90, 0] : x.k === 'gem' ? [45, 90, 45] : 0 }}
          transition={{ duration: 7 + i, repeat: Infinity, ease: 'easeInOut', delay: x.d }}
        />
      ))}
    </div>
  );
}

/** Engraved banknote rings in brass — TalerBank's own pattern. */
function Guilloche({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 200 200" className={className} aria-hidden="true">
      <g fill="none" stroke="#C9A45C" strokeWidth="0.45">
        {Array.from({ length: 18 }).map((_, i) => (
          <ellipse key={i} cx="100" cy="100" rx="92" ry="34" transform={`rotate(${i * 10} 100 100)`} opacity={0.55} />
        ))}
        {[22, 40, 58].map((r) => (
          <circle key={r} cx="100" cy="100" r={r} strokeDasharray="2 3" opacity={0.7} />
        ))}
      </g>
    </svg>
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
      <PageHeader title={t.bank.qrTitle} lead={t.bank.qrLead} />
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
