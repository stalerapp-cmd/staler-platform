import crypto from 'node:crypto';

/**
 * Palestinian IBAN layout: PS kk BBBB + 21 alphanumerics (29 chars total).
 * Check digits are real ISO 13616 mod-97 digits, so the IBANs validate.
 */
const BANK_CODE = 'TLRB';

function mod97(numeric: string): number {
  let rem = 0;
  for (let i = 0; i < numeric.length; i += 7) rem = Number(String(rem) + numeric.slice(i, i + 7)) % 97;
  return rem;
}
const toDigits = (s: string) => s.replace(/[A-Z]/g, (c) => String(c.charCodeAt(0) - 55));

export function ibanCheckDigits(country: string, bban: string): string {
  const rem = mod97(toDigits(bban + country + '00'));
  return String(98 - rem).padStart(2, '0');
}

export function generateIban(): string {
  let account = '';
  for (let i = 0; i < 21; i++) account += crypto.randomInt(0, 10).toString();
  const bban = BANK_CODE + account;
  return `PS${ibanCheckDigits('PS', bban)}${bban}`;
}

export function isValidIban(raw: string): boolean {
  const iban = raw.replace(/\s+/g, '').toUpperCase();
  if (!/^[A-Z]{2}\d{2}[A-Z0-9]{10,30}$/.test(iban)) return false;
  return mod97(toDigits(iban.slice(4) + iban.slice(0, 4))) === 1;
}

export const normalizeIban = (raw: string) => raw.replace(/\s+/g, '').toUpperCase();

export const formatIban = (iban: string) => iban.replace(/(.{4})/g, '$1 ').trim();

export function generateAccountNumber(): string {
  let n = '';
  for (let i = 0; i < 10; i++) n += crypto.randomInt(0, 10).toString();
  return `TB${n}`;
}
