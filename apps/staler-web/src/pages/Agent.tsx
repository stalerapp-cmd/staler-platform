import { AnimatePresence, motion } from 'framer-motion';
import { useEffect, useMemo, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { ArrowDownToLine, ArrowUpFromLine, Banknote, Clock, MapPin, Navigation, Phone, Search, Ticket, XCircle } from 'lucide-react';
import { del, newIdempotencyKey, post, put } from '../lib/api';
import { useAuth } from '../lib/auth';
import { useI18n } from '../lib/i18n';
import { useData, usePolling } from '../lib/hooks';
import { AMOUNT_RE, fill, money, relative } from '../lib/format';
import { QRImage } from '../components/QR';
import { MapView } from '../components/MapView';
import { useToast } from '../components/Toast';
import { useConfirm } from '../components/Confirm';
import { AmountInput, AnimatedNumber, Avatar, Badge, Button, EmptyState, ErrorNote, Field, PageHeader, Sheet, Skeleton, SuccessMark, Toggle, cx } from '../components/ui';

interface Stats {
  balance: string;
  cash_in_today: string;
  cash_out_today: string;
  in_escrow: string;
  issued_today: number;
}

// ------------------------------------------------------------------ desk
export default function AgentDesk() {
  const { t, lang, err } = useI18n();
  const toast = useToast();
  const confirm = useConfirm();
  const { reload: reloadUser } = useAuth();
  const stats = useData<Stats>('/api/exchange/stats');
  const list = useData<{ cashouts: any[] }>('/api/exchange/cashouts');
  const [amount, setAmount] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [show, setShow] = useState<any>(null);
  usePolling(
    async () => {
      await list.reload();
      void stats.reload();
    },
    3000,
    !!show,
  );
  const shown = show && list.data?.cashouts.find((c) => c.id === show.id);
  const paid = shown?.status === 'paid';
  useEffect(() => {
    if (paid) void reloadUser();
  }, [paid, reloadUser]);

  const tiles = [
    { label: t.agent.balance, v: stats.data?.balance, icon: Banknote, cls: 'bg-night text-white' },
    { label: t.agent.inToday, v: stats.data?.cash_in_today, icon: ArrowDownToLine, cls: 'bg-olive/12 text-olive' },
    { label: t.agent.outToday, v: stats.data?.cash_out_today, icon: ArrowUpFromLine, cls: 'bg-stitch/10 text-stitch' },
    { label: t.agent.escrow, v: stats.data?.in_escrow, icon: Ticket, cls: 'bg-gold/15 text-[rgb(150_105_10)] dark:text-gold' },
  ];
  const tone = (s: string) => (s === 'paid' ? 'good' : s === 'open' ? 'info' : 'neutral');

  return (
    <div>
      <PageHeader title={t.agent.desk} lead={t.agent.deskLead} />
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        {tiles.map((x, i) => (
          <motion.div
            key={x.label}
            initial={{ opacity: 0, y: 14 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.08 * i, type: 'spring', bounce: 0.3 }}
            className={cx('relative overflow-hidden rounded-3xl p-4', x.cls)}
          >
            <x.icon className="h-5 w-5 opacity-80" />
            <p className="mt-3 text-xs opacity-80">{x.label}</p>
            {x.v === undefined ? (
              <Skeleton className="mt-1 h-7 w-24" />
            ) : (
              <p className="num font-display text-2xl">
                <AnimatedNumber value={Number(x.v)} format={(n) => money(n, lang)} />
              </p>
            )}
          </motion.div>
        ))}
      </div>

      <div className="mt-6 grid gap-5 lg:grid-cols-2">
        <Link to="/app/vouchers" className="sewn card group block overflow-hidden p-6 transition hover:-translate-y-0.5">
          <div className="flex items-start gap-4">
            <span className="grid h-14 w-14 shrink-0 place-items-center rounded-2xl bg-olive text-white transition duration-300 group-hover:-rotate-6">
              <ArrowDownToLine className="h-7 w-7" />
            </span>
            <div>
              <h2 className="text-xl">{t.agent.cashIn}</h2>
              <p className="mt-1 text-sm text-muted">{t.agent.cashInD}</p>
              <span className="mt-4 inline-flex items-center gap-2 rounded-full bg-olive/12 px-3 py-1.5 text-sm font-medium text-olive">
                <Ticket className="h-4 w-4" /> {t.vouchers.create}
              </span>
            </div>
          </div>
        </Link>

        <form
          className="sewn card p-6"
          onSubmit={async (e) => {
            e.preventDefault();
            if (!AMOUNT_RE.test(amount) || Number(amount) <= 0) return;
            setBusy(true);
            setError(null);
            try {
              const r = await post('/api/exchange/cashouts', { amount }, newIdempotencyKey());
              setShow(r.cashout);
              setAmount('');
              void list.reload();
            } catch (e2) {
              setError(err(e2));
            } finally {
              setBusy(false);
            }
          }}
        >
          <div className="flex items-start gap-4">
            <span className="grid h-14 w-14 shrink-0 place-items-center rounded-2xl bg-stitch text-white">
              <ArrowUpFromLine className="h-7 w-7" />
            </span>
            <div className="min-w-0 flex-1">
              <h2 className="text-xl">{t.agent.cashOut}</h2>
              <p className="mt-1 text-sm text-muted">{t.agent.cashOutD}</p>
            </div>
          </div>
          <div className="mt-5 space-y-3">
            <AmountInput label={t.common.amount} value={amount} onChange={setAmount} />
            <ErrorNote>{error}</ErrorNote>
            <Button block size="lg" variant="stitch" loading={busy}>
              {t.agent.newCashOut}
            </Button>
          </div>
        </form>
      </div>

      <section className="card mt-6 p-4 sm:p-5">
        <h2 className="mb-2 px-1 text-lg">{t.agent.cashouts}</h2>
        {!list.data ? (
          <Skeleton className="h-24" />
        ) : !list.data.cashouts.length ? (
          <EmptyState icon={<Banknote className="h-6 w-6" />} title={t.common.empty} />
        ) : (
          <ul className="divide-y divide-line">
            {list.data.cashouts.map((c) => (
              <li key={c.id} className="flex items-center justify-between gap-3 py-3">
                <div className="min-w-0">
                  <p className="num font-display text-lg">{money(c.amount, lang)}</p>
                  <p className="truncate text-xs text-muted">
                    {relative(c.created_at, lang)}
                    {c.paid_by_name ? ` · ${c.paid_by_name}` : ''}
                  </p>
                </div>
                <div className="flex items-center gap-2">
                  <Badge tone={tone(c.status)}>{t.agent.st[c.status] ?? c.status}</Badge>
                  {c.status === 'open' && (
                    <button
                      className="rounded-lg p-2 text-muted hover:bg-stitch/10 hover:text-stitch"
                      aria-label={t.common.cancel}
                      onClick={async () => {
                        if (!(await confirm({ title: t.agent.cancelQ, body: money(c.amount, lang), confirmLabel: t.common.cancel, tone: 'danger' }))) return;
                        try {
                          await del(`/api/exchange/cashouts/${c.id}`);
                          void list.reload();
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

      <AgentProfile />

      <Sheet open={!!show} onClose={() => setShow(null)} title={t.agent.cashOut}>
        {show && (
          <div className="text-center">
            <AnimatePresence mode="wait">
              {paid ? (
                <motion.div key="paid" initial={{ opacity: 0, scale: 0.9 }} animate={{ opacity: 1, scale: 1 }}>
                  <SuccessMark />
                  <p className="mt-5 text-xl">{fill(t.agent.paidHand, { amount: money(show.amount, lang) })}</p>
                  {shown?.paid_by_name && <p className="mt-1 text-muted">{shown.paid_by_name}</p>}
                  <Button block className="mt-6" onClick={() => setShow(null)}>
                    {t.common.done}
                  </Button>
                </motion.div>
              ) : (
                <motion.div key="qr" exit={{ opacity: 0, scale: 0.95 }}>
                  <QRImage value={show.uri} size={240} label={t.agent.cashOut} />
                  <p className="num mt-5 font-display text-3xl">{money(show.amount, lang)}</p>
                  <p className="mt-2 flex items-center justify-center gap-2 text-sm text-muted">
                    <span className="h-2 w-2 animate-pulse rounded-full bg-stitch" /> {t.agent.waitingPay}
                  </p>
                </motion.div>
              )}
            </AnimatePresence>
          </div>
        )}
      </Sheet>
    </div>
  );
}

function AgentProfile() {
  const { t, err } = useI18n();
  const toast = useToast();
  const data = useData<{ profile: any }>('/api/exchange/profile');
  const [f, setF] = useState<any>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    if (data.data && !f) {
      const p = data.data.profile;
      setF({ displayName: p.display_name ?? '', city: p.city ?? '', address: p.address ?? '', phone: p.phone ?? '', hours: p.hours ?? '', lat: p.lat, lng: p.lng, cashIn: p.cash_in, cashOut: p.cash_out });
    }
  }, [data.data, f]);
  if (!f) return <Skeleton className="mt-6 h-64 rounded-3xl" />;
  const status: string = data.data?.profile.status ?? 'pending';
  const set = (k: string) => (e: React.ChangeEvent<HTMLInputElement>) => setF({ ...f, [k]: e.target.value });
  return (
    <section className="card mt-6 overflow-hidden">
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-line px-5 py-4">
        <div>
          <h2 className="text-lg">{t.agent.profile}</h2>
          <p className="text-sm text-muted">{data.data?.profile.missing ? t.agent.setupFirst : t.agent.profileLead}</p>
        </div>
        <Badge tone={status === 'active' ? 'good' : status === 'suspended' ? 'bad' : 'warn'}>
          {status === 'active' ? t.agent.listed : status === 'suspended' ? t.agent.suspended : t.agent.pending}
        </Badge>
      </div>
      <form
        className="grid gap-5 p-5 lg:grid-cols-2"
        onSubmit={async (e) => {
          e.preventDefault();
          setBusy(true);
          setError(null);
          try {
            await put('/api/exchange/profile', {
              displayName: f.displayName.trim(),
              city: f.city.trim() || null,
              address: f.address.trim() || null,
              phone: f.phone.trim() || null,
              hours: f.hours.trim() || null,
              lat: f.lat ?? null,
              lng: f.lng ?? null,
              cashIn: f.cashIn,
              cashOut: f.cashOut,
            });
            toast(t.common.saved);
            void data.reload();
          } catch (e2) {
            setError(err(e2));
          } finally {
            setBusy(false);
          }
        }}
      >
        <div className="space-y-4">
          <Field label={t.agent.displayName} value={f.displayName} onChange={set('displayName')} required minLength={2} maxLength={60} />
          <div className="grid grid-cols-2 gap-3">
            <Field label={t.mstore.city} value={f.city} onChange={set('city')} maxLength={60} />
            <Field label={t.auth.phone} value={f.phone} onChange={set('phone')} dir="ltr" type="tel" />
          </div>
          <Field label={t.mstore.address} value={f.address} onChange={set('address')} maxLength={160} />
          <Field label={t.agent.hours} value={f.hours} onChange={set('hours')} placeholder={t.agent.hoursPh} maxLength={120} />
          <div className="space-y-2 rounded-2xl bg-sunk/60 p-3">
            <p className="px-1 text-sm font-medium">{t.agent.services}</p>
            <Toggle checked={f.cashIn} onChange={(v) => setF({ ...f, cashIn: v })} label={t.agent.cashIn} />
            <Toggle checked={f.cashOut} onChange={(v) => setF({ ...f, cashOut: v })} label={t.agent.cashOut} />
          </div>
        </div>
        <div>
          <p className="mb-2 text-sm font-medium text-ink/80">{t.agent.pin}</p>
          <MapView
            className="h-72 rounded-2xl"
            pins={f.lat != null && f.lng != null ? [{ lat: f.lat, lng: f.lng, kind: 'store', label: f.displayName }] : []}
            onPick={(p) => setF({ ...f, lat: p.lat, lng: p.lng })}
          />
          <p className="mt-2 text-xs text-muted">{t.agent.pinHint}</p>
        </div>
        <div className="lg:col-span-2">
          <ErrorNote>{error}</ErrorNote>
          <Button size="lg" loading={busy} className="mt-2">
            {t.agent.saveProfile}
          </Button>
        </div>
      </form>
    </section>
  );
}

// ------------------------------------------------------------- directory
export function AgentsMap() {
  const { t } = useI18n();
  const data = useData<{ agents: any[] }>('/api/exchange/agents');
  const [q, setQ] = useState('');
  const [focus, setFocus] = useState<string | null>(null);
  const agents = useMemo(
    () => (data.data?.agents ?? []).filter((a) => !q.trim() || `${a.display_name} ${a.city ?? ''} ${a.address ?? ''}`.toLowerCase().includes(q.trim().toLowerCase())),
    [data.data, q],
  );
  const pins = agents.filter((a) => a.lat != null && a.lng != null && (!focus || a.id === focus)).map((a) => ({ lat: a.lat, lng: a.lng, kind: 'store' as const, label: a.display_name }));
  return (
    <div>
      <PageHeader title={t.agent.find} lead={t.agent.findLead} />
      <div className="grid gap-5 lg:grid-cols-[1fr_1.1fr]">
        <div className="order-2 lg:order-1">
          <label className="relative mb-4 block">
            <Search className="pointer-events-none absolute start-4 top-1/2 h-5 w-5 -translate-y-1/2 text-muted" />
            <input value={q} onChange={(e) => setQ(e.target.value)} placeholder={t.agent.searchPh} className="field ps-12" />
          </label>
          {!data.data ? (
            <div className="space-y-3">
              {[0, 1, 2].map((i) => (
                <Skeleton key={i} className="h-28 rounded-3xl" />
              ))}
            </div>
          ) : !agents.length ? (
            <EmptyState icon={<MapPin className="h-6 w-6" />} title={t.agent.none} />
          ) : (
            <ul className="space-y-3">
              {agents.map((a, i) => (
                <motion.li
                  key={a.id}
                  initial={{ opacity: 0, x: 16 }}
                  animate={{ opacity: 1, x: 0 }}
                  transition={{ delay: i * 0.05 }}
                  className={cx('card cursor-pointer p-4 transition', focus === a.id && 'ring-2 ring-gold')}
                  onClick={() => setFocus(focus === a.id ? null : a.id)}
                >
                  <div className="flex items-start gap-3">
                    <Avatar name={a.display_name} src={a.logo_url} size={52} />
                    <div className="min-w-0 flex-1">
                      <p className="truncate font-semibold">{a.display_name}</p>
                      <p className="truncate text-sm text-muted">{[a.city, a.address].filter(Boolean).join(' · ') || '—'}</p>
                      {a.hours && (
                        <p className="mt-1 flex items-center gap-1.5 text-xs text-muted">
                          <Clock className="h-3.5 w-3.5" /> {a.hours}
                        </p>
                      )}
                      <div className="mt-2 flex flex-wrap gap-1.5">
                        {a.cash_in && <Badge tone="good">{t.agent.cashIn}</Badge>}
                        {a.cash_out && <Badge tone="info">{t.agent.cashOut}</Badge>}
                      </div>
                    </div>
                  </div>
                  <div className="mt-3 flex gap-2">
                    {a.lat != null && (
                      <a
                        href={`https://www.google.com/maps/dir/?api=1&destination=${a.lat},${a.lng}`}
                        target="_blank"
                        rel="noreferrer"
                        onClick={(e) => e.stopPropagation()}
                        className="inline-flex items-center gap-1.5 rounded-full bg-night px-3 py-1.5 text-sm text-white dark:bg-white/10"
                      >
                        <Navigation className="h-4 w-4" /> {t.agent.directions}
                      </a>
                    )}
                    {a.phone && (
                      <a href={`tel:${a.phone}`} onClick={(e) => e.stopPropagation()} className="inline-flex items-center gap-1.5 rounded-full bg-sunk px-3 py-1.5 text-sm">
                        <Phone className="h-4 w-4" /> {t.shop.call}
                      </a>
                    )}
                  </div>
                </motion.li>
              ))}
            </ul>
          )}
        </div>
        <div className="order-1 lg:order-2">
          <div className="lg:sticky lg:top-24">
            <MapView className="h-[300px] rounded-3xl shadow-lift sm:h-[420px]" pins={pins} zoom={pins.length === 1 ? 15 : 9} />
          </div>
        </div>
      </div>
    </div>
  );
}

// ------------------------------------------------------- customer pays
export function CashOutPay() {
  const { t, lang, err } = useI18n();
  const { reload } = useAuth();
  const [params] = useSearchParams();
  const code = params.get('c') ?? '';
  const [preview, setPreview] = useState<any>(null);
  const [loadErr, setLoadErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState<any>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    post('/api/exchange/cashouts/preview', { code })
      .then(setPreview)
      .catch((e) => setLoadErr(err(e)));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [code]);
  if (done)
    return (
      <div className="card mx-auto max-w-md p-8 text-center">
        <SuccessMark />
        <h2 className="mt-6 text-2xl">{t.agent.paid}</h2>
        <p className="num mt-2 font-display text-3xl">{money(done.amount, lang)}</p>
        <Link to="/app" className="mt-8 block">
          <Button block>{t.common.done}</Button>
        </Link>
      </div>
    );
  return (
    <div className="mx-auto max-w-md">
      <PageHeader title={t.agent.payTitle} />
      {loadErr ? (
        <ErrorNote>{loadErr}</ErrorNote>
      ) : !preview ? (
        <Skeleton className="h-48 rounded-3xl" />
      ) : (
        <div className="sewn card p-6">
          <p className="text-sm text-muted">{t.agent.payFrom}</p>
          <p className="font-medium">{preview.agent}</p>
          <p className="num mt-6 font-display text-5xl">{money(preview.amount, lang)}</p>
          <p className="mt-3 text-sm text-muted">{t.agent.payLead}</p>
          <ErrorNote>{error}</ErrorNote>
          <Button
            block
            size="lg"
            variant="stitch"
            className="mt-6"
            loading={busy}
            disabled={preview.status !== 'open'}
            onClick={async () => {
              setBusy(true);
              setError(null);
              try {
                setDone(await post('/api/exchange/cashouts/pay', { code }, newIdempotencyKey()));
                void reload();
              } catch (e) {
                setError(err(e));
              } finally {
                setBusy(false);
              }
            }}
          >
            {preview.status === 'open' ? t.agent.pay : t.agent.st[preview.status]}
          </Button>
        </div>
      )}
    </div>
  );
}

