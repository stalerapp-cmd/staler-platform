import { motion } from 'framer-motion';
import { useState } from 'react';
import { MoreLink } from '../components/Fun';
import { Link } from 'react-router-dom';
import { ArrowRightLeft, BookText, KeyRound, QrCode, Wallet } from 'lucide-react';
import { useAuth } from '../lib/auth';
import { useI18n } from '../lib/i18n';
import { useData } from '../lib/hooks';
import { useAccounts } from '../lib/accounts';
import { money } from '../lib/format';
import { AccountCard, BankTxDetails, BankTxRow, type BankTx } from '../components/Bank';
import { AreaChart } from '../components/Chart';
import { EmptyState, Sheet, Skeleton } from '../components/ui';

export default function Overview() {
  const { user } = useAuth();
  const { t, lang } = useI18n();
  const { primary } = useAccounts();
  const detail = useData<any>(primary ? `/api/accounts/${primary.id}` : null, [primary?.id]);
  const txs = useData<{ transactions: BankTx[] }>(primary ? `/api/accounts/${primary.id}/transactions?limit=8` : null, [primary?.id]);
  const [open, setOpen] = useState<BankTx | null>(null);
  const actions = [
    { to: '/app/transfer', icon: ArrowRightLeft, label: t.nav.transfer },
    { to: '/app/wallet', icon: Wallet, label: t.nav.wallet },
    { to: '/app/requests', icon: QrCode, label: t.nav.requests },
    { to: '/app/apps', icon: KeyRound, label: t.nav.apps },
  ];
  const series = detail.data?.series ?? [];
  return (
    <div className="grid grid-cols-[minmax(0,1fr)] gap-6 xl:grid-cols-[minmax(0,1.25fr)_minmax(0,1fr)]">
      <div className="min-w-0 space-y-6">
        {primary ? <AccountCard account={primary} holder={user?.full_name ?? ''} /> : <Skeleton className="h-64 rounded-3xl" />}
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          {actions.map((a, i) => (
            <motion.div key={a.to} initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.3 + i * 0.06 }}>
              <Link to={a.to} className="group flex h-full items-center gap-3 rounded-2xl border border-line bg-surface p-4 transition hover:border-gold/60">
                <span className="grid h-10 w-10 shrink-0 place-items-center rounded-full bg-gold/15 text-gold transition group-hover:bg-gold group-hover:text-night">
                  <a.icon className="h-5 w-5" />
                </span>
                <span className="text-sm font-medium leading-tight">{a.label}</span>
              </Link>
            </motion.div>
          ))}
        </div>
        <section className="card p-5">
          <div className="mb-4 flex flex-wrap items-end justify-between gap-3">
            <h2 className="text-xl">{t.home.flow}</h2>
            <div className="flex gap-5 text-sm">
              <span>
                <span className="me-2 inline-block h-2 w-2 rounded-full bg-olive" />
                <span className="text-muted">{t.home.income}</span> <span className="num">{money(detail.data?.stats?.income_30d ?? 0, lang)}</span>
              </span>
              <span>
                <span className="me-2 inline-block h-2 w-2 rounded-full bg-gold" />
                <span className="text-muted">{t.home.spending}</span> <span className="num">{money(detail.data?.stats?.spending_30d ?? 0, lang)}</span>
              </span>
            </div>
          </div>
          {series.length ? (
            <AreaChart
              labels={series.map((s: any) => s.day)}
              series={[
                { name: t.home.income, color: 'rgb(var(--sage))', values: series.map((s: any) => Number(s.income)) },
                { name: t.home.spending, color: 'rgb(var(--brass))', values: series.map((s: any) => Number(s.spending)) },
              ]}
              format={(n) => money(n, lang)}
            />
          ) : (
            <Skeleton className="h-48" />
          )}
        </section>
      </div>
      <section className="card h-fit p-3">
        <div className="flex items-center justify-between px-3 pb-1 pt-2">
          <h2 className="text-xl">{t.home.recent}</h2>
          <MoreLink to="/app/transactions" icon={<BookText className="h-4 w-4" />}>
            {t.home.seeAll}
          </MoreLink>
        </div>
        {!txs.data ? (
          <div className="space-y-3 p-3">
            {[0, 1, 2, 3].map((i) => (
              <Skeleton key={i} className="h-12" />
            ))}
          </div>
        ) : txs.data.transactions.length ? (
          <ul>
            {txs.data.transactions.map((tx, i) => (
              <BankTxRow key={tx.id} tx={tx} index={i} onClick={() => setOpen(tx)} />
            ))}
          </ul>
        ) : (
          <EmptyState icon={<BookText className="h-6 w-6" />} title={t.home.noTx} />
        )}
      </section>
      <Sheet open={!!open} onClose={() => setOpen(null)} title={t.common.details}>
        {open && <BankTxDetails tx={open} />}
      </Sheet>
    </div>
  );
}
