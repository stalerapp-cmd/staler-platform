import { env } from '../config/env.js';
import { logger } from './logger.js';
import { badRequest } from './errors.js';

/** SMS one-time codes through Twilio Verify (Twilio generates, sends and checks the code). */
export const smsEnabled = () => Boolean(env.TWILIO_ACCOUNT_SID && env.TWILIO_AUTH_TOKEN && env.TWILIO_VERIFY_SID);

/** Normalises Palestinian / local numbers to E.164 (+970…), passes through numbers already in +format. */
export function toE164(phone: string): string {
  const d = phone.replace(/[^\d+]/g, '');
  if (d.startsWith('+')) return d;
  if (d.startsWith('00')) return `+${d.slice(2)}`;
  if (d.startsWith('05')) return `+970${d.slice(1)}`;
  return `+${d}`;
}

async function twilio(path: string, body: Record<string, string>) {
  const auth = Buffer.from(`${env.TWILIO_ACCOUNT_SID}:${env.TWILIO_AUTH_TOKEN}`).toString('base64');
  const r = await fetch(`https://verify.twilio.com/v2/Services/${env.TWILIO_VERIFY_SID}/${path}`, {
    method: 'POST',
    headers: { Authorization: `Basic ${auth}`, 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams(body),
    signal: AbortSignal.timeout(10_000),
  });
  const j: any = await r.json().catch(() => ({}));
  if (!r.ok) {
    logger.warn({ status: r.status, code: j?.code }, 'sms provider error');
    throw badRequest('SMS_FAILED', 'Could not send the SMS code. Check the number or use e-mail.');
  }
  return j;
}

export async function sendSmsCode(phone: string, lang: 'ar' | 'en' = 'ar') {
  if (!smsEnabled()) throw badRequest('SMS_DISABLED', 'SMS codes are not available yet');
  await twilio('Verifications', { To: toE164(phone), Channel: 'sms', Locale: lang });
}

export async function checkSmsCode(phone: string, code: string): Promise<boolean> {
  if (!smsEnabled()) return false;
  const j = await twilio('VerificationCheck', { To: toE164(phone), Code: code });
  return j?.status === 'approved';
}
