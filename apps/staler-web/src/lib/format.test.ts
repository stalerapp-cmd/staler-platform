import { describe, expect, it } from 'vitest';
import { AMOUNT_RE, money, normalizeAmountInput, passwordScore } from './format';

describe('amount input', () => {
  it('accepts well-formed amounts only', () => {
    for (const ok of ['0', '1', '10.5', '999.99', '1234567890']) expect(AMOUNT_RE.test(ok)).toBe(true);
    for (const bad of ['', '01', '1.234', '-5', '1e3', '12345678901', ' 1', '1.']) expect(AMOUNT_RE.test(bad)).toBe(false);
  });
  it('normalises Arabic-Indic digits and separators', () => {
    expect(normalizeAmountInput('١٢٣٫٤٥')).toBe('123.45');
    expect(normalizeAmountInput('۱۲,۵')).toBe('12.5');
    expect(normalizeAmountInput('1.2.3')).toBe('1.23');
    expect(normalizeAmountInput('<script>9')).toBe('9');
  });
});

describe('money', () => {
  it('always renders Latin digits with two decimals', () => {
    expect(money('1234.5', 'en')).toBe('1,234.50 PS');
    expect(money('7', 'ar')).toMatch(/^7\.00 PS$/);
  });
});

describe('password strength', () => {
  it('scores short passwords as zero', () => expect(passwordScore('Ab1!')).toBe(0));
  it('rewards length and variety', () => expect(passwordScore('Very-Strong#Pass2026')).toBe(4));
});
