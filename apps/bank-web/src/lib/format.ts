import type { Lang } from './i18n';

/** Latin digits in both languages: amounts must be unambiguous. */
const nf = (lang: Lang) => new Intl.NumberFormat(lang === 'ar' ? 'ar-u-nu-latn' : 'en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

export function money(v: string | number | null | undefined, lang: Lang, currency = 'PS'): string {
  const n = Number(v ?? 0);
  return `${nf(lang).format(Math.abs(n))} ${currency}`;
}
export const signed = (v: string | number, lang: Lang, currency = 'PS') => `${Number(v) < 0 ? '−' : '+'}${money(v, lang, currency)}`;

export function date(v: string | Date, lang: Lang, withTime = true) {
  return new Intl.DateTimeFormat(lang === 'ar' ? 'ar-u-nu-latn' : 'en-GB', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    ...(withTime ? { hour: '2-digit', minute: '2-digit' } : {}),
  }).format(new Date(v));
}

export function relative(v: string | Date, lang: Lang) {
  const diff = (new Date(v).getTime() - Date.now()) / 1000;
  const rtf = new Intl.RelativeTimeFormat(lang === 'ar' ? 'ar' : 'en', { numeric: 'auto' });
  const abs = Math.abs(diff);
  if (abs < 60) return rtf.format(Math.round(diff), 'second');
  if (abs < 3600) return rtf.format(Math.round(diff / 60), 'minute');
  if (abs < 86400) return rtf.format(Math.round(diff / 3600), 'hour');
  if (abs < 86400 * 7) return rtf.format(Math.round(diff / 86400), 'day');
  return date(v, lang, false);
}

export const initials = (name?: string | null) =>
  (name ?? '?')
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((p) => p[0])
    .join('')
    .toUpperCase();

/** Client-side mirror of the server rule — the server is the authority. */
export const AMOUNT_RE = /^(?:0|[1-9]\d{0,9})(?:\.\d{1,2})?$/;
export function normalizeAmountInput(raw: string) {
  // Accept Arabic-Indic digits and the Arabic decimal separator.
  return raw
    .replace(/[٠-٩]/g, (d) => String('٠١٢٣٤٥٦٧٨٩'.indexOf(d)))
    .replace(/[۰-۹]/g, (d) => String('۰۱۲۳۴۵۶۷۸۹'.indexOf(d)))
    .replace(/[٫,]/g, '.')
    .replace(/[^\d.]/g, '')
    .replace(/(\..*)\./g, '$1');
}

export function passwordScore(p: string): number {
  let s = 0;
  if (p.length >= 10) s++;
  if (p.length >= 14) s++;
  if (/[a-z]/.test(p) && /[A-Z]/.test(p)) s++;
  if (/\d/.test(p) && /[^A-Za-z0-9]/.test(p)) s++;
  return Math.min(4, p.length < 8 ? 0 : s);
}

/** Fills {placeholders} in a translated sentence. */
export const fill = (s: string, v: Record<string, string | number>) => s.replace(/\{(\w+)\}/g, (_, k) => String(v[k] ?? ''));
