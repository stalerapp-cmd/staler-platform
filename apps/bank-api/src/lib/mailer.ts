import nodemailer from 'nodemailer';
import { env, isProd } from '../config/env.js';
import { logger } from './logger.js';

export interface Mail {
  to: string;
  subject: string;
  html: string;
  text: string;
}

/** Captured mails (MAIL_MODE=memory, used by the test-suite). */
export const outbox: Mail[] = [];

const transporter =
  env.MAIL_MODE === 'smtp'
    ? nodemailer.createTransport({
        host: env.SMTP_HOST,
        port: env.SMTP_PORT,
        secure: env.SMTP_SECURE,
        auth: env.SMTP_USER ? { user: env.SMTP_USER, pass: env.SMTP_PASS } : undefined,
        requireTLS: true,
        tls: { minVersion: 'TLSv1.2' },
      })
    : null;

if (isProd && env.MAIL_MODE === 'log') {
  logger.warn('MAIL_MODE=log in production: verification codes are written to the server log. Configure SMTP.');
}

const esc = (s: string) =>
  s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);

export async function sendMail(mail: Mail): Promise<void> {
  if (env.MAIL_MODE === 'memory') {
    outbox.push(mail);
    return;
  }
  if (env.MAIL_MODE === 'log' || !transporter) {
    logger.info({ to: mail.to, subject: mail.subject, preview: mail.text }, 'mail (log mode)');
    return;
  }
  try {
    await transporter.sendMail({ from: env.MAIL_FROM ?? `"${env.BANK_NAME}" <${env.SMTP_USER}>`, ...mail });
  } catch (err) {
    logger.error({ err, to: mail.to }, 'mail delivery failed');
  }
}

type Lang = 'en' | 'ar';
const T = {
  verify: { en: 'Verify your e-mail', ar: 'تأكيد البريد الإلكتروني' },
  reset: { en: 'Reset your password', ar: 'إعادة تعيين كلمة المرور' },
  security: { en: 'Security alert', ar: 'تنبيه أمني' },
  codeIntro: {
    en: 'Use this code to continue. It expires in 15 minutes.',
    ar: 'استخدم هذا الرمز للمتابعة. صالح لمدة 15 دقيقة.',
  },
  ignore: {
    en: 'If you did not request this, ignore this e-mail and consider changing your password.',
    ar: 'إذا لم تطلب ذلك، تجاهل هذه الرسالة وفكّر في تغيير كلمة المرور.',
  },
} as const;

function layout(lang: Lang, title: string, body: string): string {
  const dir = lang === 'ar' ? 'rtl' : 'ltr';
  return `<!doctype html><html lang="${lang}" dir="${dir}"><body style="margin:0;background:#0b0f19;font-family:Segoe UI,Tahoma,Arial,sans-serif">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr><td align="center" style="padding:32px 12px">
<table role="presentation" width="560" style="max-width:560px;background:#111827;border-radius:20px;overflow:hidden;border:1px solid #1f2937">
<tr><td style="padding:28px 32px;background:linear-gradient(135deg,#b8892b,#f5d48a);color:#0b0f19;font-size:22px;font-weight:700">${esc(env.BANK_NAME)}</td></tr>
<tr><td style="padding:32px;color:#e5e7eb;font-size:15px;line-height:1.7"><h1 style="margin:0 0 12px;font-size:20px;color:#fff">${esc(title)}</h1>${body}</td></tr>
<tr><td style="padding:18px 32px;color:#6b7280;font-size:12px;border-top:1px solid #1f2937">${esc(T.ignore[lang])}</td></tr>
</table></td></tr></table></body></html>`;
}

export function codeMail(to: string, kind: 'verify' | 'reset' | 'security', code: string, lang: Lang = 'en'): Mail {
  const title = T[kind][lang];
  const body = `<p>${esc(T.codeIntro[lang])}</p>
<p style="font-size:34px;letter-spacing:10px;font-weight:700;color:#f5d48a;text-align:center;margin:24px 0">${esc(code)}</p>`;
  return { to, subject: `${env.BANK_NAME} — ${title}`, html: layout(lang, title, body), text: `${title}: ${code}` };
}

export function noticeMail(to: string, title: string, message: string, lang: Lang = 'en'): Mail {
  return { to, subject: `${env.BANK_NAME} — ${title}`, html: layout(lang, title, `<p>${esc(message)}</p>`), text: `${title}\n${message}` };
}
