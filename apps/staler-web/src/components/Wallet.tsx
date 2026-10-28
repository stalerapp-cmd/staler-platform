import { motion, useMotionValue, useReducedMotion, useSpring, useTransform } from 'framer-motion';
import {
  ArrowDownLeft,
  ArrowUpRight,
  Building2,
  Gift,
  Landmark,
  RotateCcw,
  ShoppingBag,
  Store,
  Ticket,
  type LucideIcon,
} from 'lucide-react';
import { useI18n } from '../lib/i18n';
import { date, money, relative } from '../lib/format';
import { AnimatedNumber, Badge, CopyButton, cx } from './ui';
import { StarMotif } from './Tatreez';

/** The wallet card: night indigo cloth with a stitched star, tilting under the pointer. */
export function BalanceCard({ balance, walletId, currency, name, frozen }: { balance: string; walletId: string; currency: string; name: string; frozen?: boolean }) {
  const { t, lang } = useI18n();
  const reduce = useReducedMotion();
  const mx = useMotionValue(0.5);
  const my = useMotionValue(0.5);
  const rx = useSpring(useTransform(my, [0, 1], [7, -7]), { stiffness: 140, damping: 16 });
  const ry = useSpring(useTransform(mx, [0, 1], [-9, 9]), { stiffness: 140, damping: 16 });
  const glare = useTransform([mx, my] as any, ([x, y]: number[]) => `radial-gradient(circle at ${x! * 100}% ${y! * 100}%, rgba(255,255,255,0.18), transparent 45%)`);
  return (
    <motion.div
      style={reduce ? undefined : { rotateX: rx, rotateY: ry, transformPerspective: 1100 }}
      onPointerMove={(e) => {
        const r = e.currentTarget.getBoundingClientRect();
        mx.set((e.clientX - r.left) / r.width);
        my.set((e.clientY - r.top) / r.height);
      }}
      onPointerLeave={() => {
        mx.set(0.5);
        my.set(0.5);
      }}
      initial={{ opacity: 0, y: 18 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ type: 'spring', bounce: 0.25, duration: 0.8 }}
      className="relative isolate overflow-hidden rounded-3xl bg-night p-6 text-white shadow-card sm:p-8"
    >
      <div className="absolute -end-20 -top-20 -z-10 h-72 w-72 opacity-80 [mask-image:radial-gradient(circle_at_70%_30%,black_35%,transparent_72%)] sm:h-80 sm:w-80">
        <StarMotif size={21} cell={14} className="h-full w-full" colors={['#E2506A', '#E9C060']} delay={0.3} strokeWidth={2} />
      </div>
      <div className="absolute inset-0 -z-10 bg-[radial-gradient(120%_80%_at_0%_100%,rgba(94,122,46,0.45),transparent_60%)]" />
      {!reduce && <motion.div className="pointer-events-none absolute inset-0" style={{ background: glare }} />}
      <div className="flex items-start justify-between gap-4">
        <div className="min-w-0">
          <p className="truncate text-sm font-medium text-white/85">{name}</p>
          <p className="mt-3 text-xs text-white/60">{t.home.balance}</p>
          <p className="mt-1 font-display text-4xl tracking-tight sm:text-5xl">
            <AnimatedNumber value={Number(balance)} format={(n) => money(n, lang, currency)} />
          </p>
        </div>
        {frozen && <Badge tone="bad">{t.home.frozen}</Badge>}
      </div>
      <div className="mt-9">
        <p className="text-xs text-white/60">{t.home.walletId}</p>
        <div className="flex items-center gap-1">
          <span className="num truncate font-medium tracking-wide">{walletId}</span>
          <span className="[&_button]:text-white/70 [&_button:hover]:bg-white/10 [&_button:hover]:text-white">
            <CopyButton text={walletId} />
          </span>
        </div>
      </div>
    </motion.div>
  );
}

const typeIcons: Record<string, LucideIcon> = {
  transfer_in: ArrowDownLeft,
  payment_received: ArrowDownLeft,
  transfer_out: ArrowUpRight,
  payment: ArrowUpRight,
  withdraw: Landmark,
  deposit: Building2,
  deposit_refund: RotateCcw,
  purchase: ShoppingBag,
  sale: Store,
  refund: RotateCcw,
  exchange_deposit: Gift,
  voucher_issued: Ticket,
  voucher_refund: Ticket,
};

export interface Tx {
  id: string;
  type: string;
  amount: string;
  status: string;
  description: string | null;
  counterparty_name: string | null;
  from_account: string | null;
  to_account: string | null;
  balance_after: string | null;
  reference: string | null;
  created_at: string;
  currency?: string;
}

export function TxRow({ tx, onClick, index = 0 }: { tx: Tx; onClick?: () => void; index?: number }) {
  const { t, lang } = useI18n();
  const Icon = typeIcons[tx.type] ?? (Number(tx.amount) < 0 ? ArrowUpRight : ArrowDownLeft);
  const incoming = Number(tx.amount) > 0;
  return (
    <motion.li initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: Math.min(index, 10) * 0.035 }}>
      <button onClick={onClick} className="flex w-full items-center gap-3 rounded-2xl px-3 py-3 text-start transition hover:bg-sunk">
        <span className={cx('grid h-11 w-11 shrink-0 place-items-center rounded-2xl', incoming ? 'bg-olive/15 text-olive' : 'bg-stitch/10 text-stitch')}>
          <Icon className="h-5 w-5 flip-rtl" />
        </span>
        <span className="min-w-0 flex-1">
          <span className="block truncate font-medium">{tx.counterparty_name || t.tx.types[tx.type] || tx.type}</span>
          <span className="block truncate text-sm text-muted">
            {t.tx.types[tx.type] ?? tx.type} · {relative(tx.created_at, lang)}
          </span>
        </span>
        <span className="text-end">
          <span className={cx('num block font-semibold', incoming ? 'text-olive' : 'text-ink')}>
            {incoming ? '+' : '−'}
            {money(tx.amount, lang, tx.currency ?? 'PS')}
          </span>
          {tx.status !== 'completed' && <Badge tone={tx.status === 'failed' ? 'bad' : 'warn'}>{t.tx.statuses[tx.status] ?? tx.status}</Badge>}
        </span>
      </button>
    </motion.li>
  );
}

export function TxDetails({ tx }: { tx: Tx }) {
  const { t, lang } = useI18n();
  const rows: [string, string | null][] = [
    [t.common.status, t.tx.statuses[tx.status] ?? tx.status],
    [t.common.date, date(tx.created_at, lang)],
    [t.tx.from, tx.from_account],
    [t.tx.to, tx.to_account],
    [t.common.note, tx.description],
    [t.tx.balanceAfter, tx.balance_after ? money(tx.balance_after, lang) : null],
    [t.tx.reference, tx.reference],
  ];
  return (
    <div>
      <p className={cx('num text-center font-display text-4xl', Number(tx.amount) > 0 ? 'text-olive' : 'text-ink')}>
        {Number(tx.amount) > 0 ? '+' : '−'}
        {money(tx.amount, lang)}
      </p>
      <p className="mt-1 text-center text-muted">{t.tx.types[tx.type] ?? tx.type}</p>
      <dl className="mt-6 divide-y divide-line rounded-2xl border border-line">
        {rows
          .filter(([, v]) => v)
          .map(([k, v]) => (
            <div key={k} className="flex items-center justify-between gap-4 px-4 py-3 text-sm">
              <dt className="text-muted">{k}</dt>
              <dd className="num max-w-[65%] truncate text-end" title={v!}>
                {v}
              </dd>
            </div>
          ))}
      </dl>
    </div>
  );
}
