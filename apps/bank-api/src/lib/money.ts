import { z } from 'zod';
import { env } from '../config/env.js';

/**
 * Money is NEVER a JS float. Amounts travel as decimal strings with at most
 * two fraction digits and are compared/added inside PostgreSQL NUMERIC.
 */
const AMOUNT_RE = /^(?:0|[1-9]\d{0,11})(?:\.\d{1,2})?$/;

export const amountSchema = z
  .union([z.string(), z.number()])
  .transform((v) => (typeof v === 'number' ? (Number.isFinite(v) ? v.toFixed(2) : 'NaN') : v.trim()))
  .refine((v) => AMOUNT_RE.test(v), 'Amount must be a positive number with at most 2 decimals')
  .transform((v) => normalize(v))
  .refine((v) => v !== '0.00', 'Amount must be greater than zero');

/** "5" -> "5.00", "5.5" -> "5.50" */
export function normalize(v: string): string {
  const [i, f = ''] = v.split('.');
  return `${BigInt(i!).toString()}.${(f + '00').slice(0, 2)}`;
}

/** Integer cents as BigInt — safe for comparisons in JS without floats. */
export const toCents = (v: string) => {
  const [i, f = ''] = normalize(v).split('.');
  return BigInt(i!) * 100n + BigInt(f.padEnd(2, '0'));
};
export const fromCents = (c: bigint) => {
  const neg = c < 0n;
  const a = neg ? -c : c;
  return `${neg ? '-' : ''}${a / 100n}.${(a % 100n).toString().padStart(2, '0')}`;
};

export const cmp = (a: string, b: string) => {
  const d = toCents(a) - toCents(b);
  return d === 0n ? 0 : d > 0n ? 1 : -1;
};

/** Taler wire format: "PS:12.50" */
export const talerAmount = (v: string, currency = env.CURRENCY) => `${currency}:${normalize(String(v).replace(/^-/, ''))}`;

export function parseTalerAmount(s: string): { currency: string; value: string } {
  const m = /^([A-Z]{2,11}):(\d{1,12}(?:\.\d{1,8})?)$/.exec(s.trim());
  if (!m) throw new Error('invalid Taler amount');
  const [whole, frac = ''] = m[2]!.split('.');
  if (frac.replace(/0+$/, '').length > 2) throw new Error('amount has too many decimals');
  return { currency: m[1]!, value: normalize(`${whole}.${frac.slice(0, 2) || '0'}`) };
}
