import { useState } from 'react';
import { MoreLink } from '../components/Fun';
import { ActionDock, type DockAction } from '../components/ActionDock';
import { ArrowRightLeft, BookText, QrCode, Repeat, Wallet } from 'lucide-react';
import { useAuth } from '../lib/auth';
import { useI18n } from '../lib/i18n';
import { useData } from '../lib/hooks';
import { useAccounts } from '../lib/accounts';
import { money } from '../lib/format';
import { AccountCard, BankTxDetails, BankTxRow, type BankTx } from '../components/Bank';
import { AreaChart } from '../components/Chart';
import { ScheduledInvite } from '../components/ScheduledInvite';
import { EmptyState, Sheet, Skeleton } from '../components/ui';

export default function Overview() {
  const { user } = useAuth();
  const { t, lang } = useI18n();
  const { primary } = useAccounts();
  const detail = useData<any>(primary ? `/api/accounts/${primary.id}` : null, [primary?.id]);
  const txs = useData<{ transactions: BankTx[] }>(primary ? `/api/accounts/${primary.id}/transactions?limit=8` : null, [primary?.id]);
  const [open, setOpen] = useState<BankTx | null>(null);
  const sched = useData<{ incoming: any[] }>(user?.role === 'admin' ? null : '/api/scheduled');
  const actions: DockAction[] = [
    { to: '/app/transfer', icon: ArrowRightLeft, label: t.dock.transfer, tone: 'gold', motion: 'send', primary: true },
    { to: '/app/wallet', icon: Wallet, label: t.dock.wallet, tone: 'olive', motion: 'in' },
    { to: '/app/requests', icon: QrCode, label: t.dock.requests, tone: 'sky', motion: 'pulse' },
    { to: '/app/scheduled', icon: Repeat, label: lang === 'ar' ? 'مجدولة' : 'Scheduled', tone: 'night', motion: 'pulse' },
  ];
  const series = detail.data?.series ?? [];
  return (
    <div className="grid grid-cols-[minmax(0,1fr)] gap-6 xl:grid-cols-[minmax(0,1.25fr)_minmax(0,1fr)]">
      <div className="min-w-0 space-y-6">
        <div>
          {primary ? <AccountCard docked account={primary} holder={user?.full_name ?? ''} /> : <Skeleton className="h-64 rounded-3xl" />}
          <ActionDock actions={actions} />
        </div>
        {(sched.data?.incoming ?? []).filter((o) => o.consent === 'pending').map((o) => (
          <div key={o.id} className="rounded-3xl bg-gold/[0.08] p-4 ring-1 ring-gold/40">
            <p className="font-semibold">{lang === 'ar' ? `${o.owner_name} بدّه يبعتلك دفعات مجدولة` : `${o.owner_name} wants to send you scheduled payments`}</p>
            <p className="text-sm text-muted">
              {money(o.amount, lang)} {o.title ? `· ${o.title}` : ''}
            </p>
            <ScheduledInvite orderId={o.id} />
          </div>
        ))}
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
