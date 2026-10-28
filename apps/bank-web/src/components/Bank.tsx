import { motion, useReducedMotion } from 'framer-motion';
import { ArrowDownLeft, ArrowUpRight, Banknote, Wallet } from 'lucide-react';
import { useI18n } from '../lib/i18n';
import { date, money, relative } from '../lib/format';
import { AnimatedNumber, Badge, CopyButton, cx } from './ui';
import { Guilloche } from './Guilloche';

export const fmtIban = (iban?: string | null) => (iban ?? '').replace(/(.{4})/g, '$1 ').trim();

export interface Account {
  id: string;
  account_number: string;
  iban: string;
  currency: string;
  balance: string;
  is_locked: boolean;
  nickname: string | null;
}

/** The account plate: vault green, engraved brass rosette, figures set like a banknote. */
export function AccountCard({ account, holder }: { account: Account; holder: string }) {
  const { t, lang } = useI18n();
  const reduce = useReducedMotion();
  return (
    <motion.div
      initial={reduce ? false : { opacity: 0, y: 16 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.7, ease: [0.16, 1, 0.3, 1] }}
      className="engraved relative isolate overflow-hidden rounded-3xl border border-gold/25 bg-night p-6 text-[#ECE6D8] shadow-card sm:p-8"
    >
      <Guilloche className="absolute -end-28 -top-28 -z-10 h-[420px] w-[420px]" />
      <div className="absolute inset-x-6 bottom-0 -z-10 h-px bg-gradient-to-r from-transparent via-gold/60 to-transparent" />
      <div className="flex items-start justify-between gap-4">
        <div>
          <p className="font-display text-xl">{account.nickname ?? t.home.account}</p>
          <p className="num text-sm text-[#9DAEA5]">{account.account_number}</p>
        </div>
        {account.is_locked && <Badge tone="bad">{t.home.frozen}</Badge>}
      </div>
      <p className="mt-8 text-sm text-[#9DAEA5]">{t.home.available}</p>
      <p className="mt-1 font-display text-5xl tracking-tight sm:text-6xl">
        <AnimatedNumber value={Number(account.balance)} format={(n) => money(n, lang, account.currency)} />
      </p>
      <div className="mt-8 flex flex-wrap items-end justify-between gap-3">
        <div className="min-w-0">
          <p className="text-xs text-[#9DAEA5]">{t.home.iban}</p>
          <div className="flex min-w-0 items-center gap-1">
            <span className="num truncate text-[13px] sm:text-base sm:tracking-wider">{fmtIban(account.iban)}</span>
            <span className="[&_button]:text-[#C8D3CC] [&_button:hover]:bg-white/10">
              <CopyButton text={account.iban} />
            </span>
          </div>
        </div>
        <p className="font-display text-lg text-gold">{holder}</p>
      </div>
    </motion.div>
  );
}

export interface BankTx {
  id: string;
  reference: string;
  amount: string;
  currency: string;
  type: string;
  status: string;
  subject: string | null;
  created_at: string;
  direction: 'in' | 'out';
  balance_after: string | null;
  counterparty: string | null;
  counterparty_iban: string | null;
}

const icon = (tx: BankTx) => (tx.type.startsWith('taler') ? Wallet : tx.type === 'deposit' || tx.type === 'withdrawal' ? Banknote : tx.direction === 'in' ? ArrowDownLeft : ArrowUpRight);

export function BankTxRow({ tx, onClick, index = 0 }: { tx: BankTx; onClick?: () => void; index?: number }) {
  const { t, lang } = useI18n();
  const Icon = icon(tx);
  const incoming = tx.direction === 'in';
  return (
    <motion.li initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ delay: Math.min(index, 10) * 0.03 }}>
      <button onClick={onClick} className="grid w-full grid-cols-[auto_1fr_auto] items-center gap-3 rounded-xl px-3 py-3 text-start transition hover:bg-sunk">
        <span className={cx('grid h-10 w-10 place-items-center rounded-full border', incoming ? 'border-olive/40 text-olive' : 'border-line text-muted')}>
          <Icon className="h-[18px] w-[18px] flip-rtl" />
        </span>
        <span className="min-w-0">
          <span className="block truncate font-medium">{tx.counterparty ?? t.tx.types[tx.type] ?? tx.type}</span>
          <span className="block truncate text-sm text-muted">{tx.subject || t.tx.types[tx.type]}</span>
        </span>
        <span className="text-end">
          <span className={cx('num block font-semibold', incoming ? 'text-olive' : 'text-ink')}>
            {incoming ? '+' : '−'}
            {money(tx.amount, lang, tx.currency)}
          </span>
          <span className="block text-xs text-muted">{relative(tx.created_at, lang)}</span>
        </span>
      </button>
    </motion.li>
  );
}

export function BankTxDetails({ tx }: { tx: BankTx }) {
  const { t, lang } = useI18n();
  const rows: [string, string | null][] = [
    [t.tx.counterparty, tx.counterparty],
    ['IBAN', tx.counterparty_iban ? fmtIban(tx.counterparty_iban) : null],
    [t.common.note, tx.subject],
    [t.common.date, date(tx.created_at, lang)],
    [t.tx.balanceAfter, tx.balance_after ? money(tx.balance_after, lang, tx.currency) : null],
    [t.tx.reference, tx.reference],
  ];
  return (
    <div>
      <p className={cx('num text-center font-display text-5xl', tx.direction === 'in' ? 'text-olive' : 'text-ink')}>
        {tx.direction === 'in' ? '+' : '−'}
        {money(tx.amount, lang, tx.currency)}
      </p>
      <p className="mt-1 text-center text-muted">
        {t.tx.types[tx.type] ?? tx.type} · {t.tx.direction[tx.direction]}
      </p>
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
