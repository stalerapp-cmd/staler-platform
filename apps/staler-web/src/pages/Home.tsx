import { motion } from 'framer-motion';
import { useState } from 'react';
import { Link } from 'react-router-dom';
import { ArrowDownToLine, ArrowUpFromLine, Landmark, QrCode, ScanLine, Send, Sparkles } from 'lucide-react';
import { useAuth } from '../lib/auth';
import { useI18n } from '../lib/i18n';
import { useData } from '../lib/hooks';
import { money } from '../lib/format';
import { BalanceCard, TxDetails, TxRow, type Tx } from '../components/Wallet';
import { AreaChart } from '../components/Chart';
import { Button, EmptyState, Sheet, Skeleton } from '../components/ui';

export default function Home() {
  const { user } = useAuth();
  const { t, lang } = useI18n();
  const wallet = useData<any>('/api/wallet');
  const txs = useData<{ transactions: Tx[] }>('/api/wallet/transactions?limit=8');
  const link = useData<any>('/api/bank/link');
  const [open, setOpen] = useState<Tx | null>(null);

  const actions = [
    { to: '/app/send', icon: Send, label: t.nav.send },
    { to: '/app/receive', icon: QrCode, label: t.nav.receive },
    { to: '/app/scan', icon: ScanLine, label: t.nav.scan },
    { to: '/app/bank?action=topup', icon: ArrowDownToLine, label: t.home.topUp },
    { to: '/app/bank?action=tobank', icon: ArrowUpFromLine, label: t.home.toBank },
  ];
  const w = wallet.data?.wallet;
  const series = wallet.data?.series ?? [];

  return (
    <div className="grid gap-6 lg:grid-cols-[1.15fr_1fr]">
      <div className="space-y-6">
        {w ? (
          <BalanceCard balance={w.balance} walletId={w.walletId} currency={w.currency} name={user?.full_name ?? ''} frozen={w.frozen} />
        ) : (
          <Skeleton className="h-56 rounded-3xl" />
        )}

        <div className="grid grid-cols-5 gap-2 sm:gap-3">
          {actions.map((a, i) => (
            <motion.div key={a.to} initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.25 + i * 0.05 }}>
              <Link to={a.to} className="group flex flex-col items-center gap-2 rounded-2xl p-2 text-center transition hover:bg-surface">
                <span className="grid h-14 w-14 place-items-center rounded-2xl border border-line bg-surface text-ink shadow-lift transition group-hover:-translate-y-0.5 group-hover:border-stitch/40 group-hover:text-stitch sm:h-16 sm:w-16">
                  <a.icon className="h-6 w-6" />
                </span>
                <span className="text-xs font-medium text-muted sm:text-sm">{a.label}</span>
              </Link>
            </motion.div>
          ))}
        </div>

        {link.data && !link.data.linked && (
          <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-dashed border-olive/50 bg-olive/5 p-4">
            <div className="flex items-center gap-3">
              <Landmark className="h-5 w-5 text-olive" />
              <p className="text-sm">{t.home.linkBank}</p>
            </div>
            <Link to="/app/bank">
              <Button size="sm" variant="secondary">
                {t.home.linkNow}
              </Button>
            </Link>
          </motion.div>
        )}

        <section className="card p-5">
          <div className="mb-4 flex flex-wrap items-end justify-between gap-3">
            <h2 className="text-lg">{t.home.flow}</h2>
            <div className="flex gap-5 text-sm">
              <span>
                <span className="me-2 inline-block h-2 w-2 rounded-full bg-olive" />
                <span className="text-muted">{t.home.income}</span>{' '}
                <span className="num font-medium">{money(wallet.data?.stats?.income_30d ?? 0, lang)}</span>
              </span>
              <span>
                <span className="me-2 inline-block h-2 w-2 rounded-full bg-stitch" />
                <span className="text-muted">{t.home.spending}</span>{' '}
                <span className="num font-medium">{money(wallet.data?.stats?.spending_30d ?? 0, lang)}</span>
              </span>
            </div>
          </div>
          {series.length ? (
            <AreaChart
              labels={series.map((s: any) => s.day)}
              series={[
                { name: t.home.income, color: 'rgb(var(--olive))', values: series.map((s: any) => Number(s.income)) },
                { name: t.home.spending, color: 'rgb(var(--stitch))', values: series.map((s: any) => Number(s.spending)) },
              ]}
              format={(n) => money(n, lang)}
            />
          ) : (
            <Skeleton className="h-48" />
          )}
        </section>
      </div>

      <section className="card h-fit p-3 sm:p-4">
        <div className="mb-2 flex items-center justify-between px-3 pt-2">
          <h2 className="text-lg">{t.home.recent}</h2>
          <Link to="/app/activity" className="text-sm text-sky hover:underline">
            {t.home.seeAll}
          </Link>
        </div>
        {txs.loading && !txs.data ? (
          <div className="space-y-3 p-3">
            {[0, 1, 2, 3].map((i) => (
              <Skeleton key={i} className="h-14" />
            ))}
          </div>
        ) : txs.data?.transactions.length ? (
          <ul>
            {txs.data.transactions.map((tx, i) => (
              <TxRow key={tx.id} tx={tx} index={i} onClick={() => setOpen(tx)} />
            ))}
          </ul>
        ) : (
          <EmptyState
            icon={<Sparkles className="h-6 w-6" />}
            title={t.home.noTx}
            action={
              <Link to="/app/receive">
                <Button variant="secondary" size="sm">
                  {t.nav.receive}
                </Button>
              </Link>
            }
          />
        )}
      </section>

      <Sheet open={!!open} onClose={() => setOpen(null)} title={t.common.details}>
        {open && <TxDetails tx={open} />}
      </Sheet>
    </div>
  );
}
