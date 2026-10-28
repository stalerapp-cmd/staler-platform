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
        connectionTimeout: 10_000,
        greetingTimeout: 10_000,
        tls: { minVersion: 'TLSv1.2' },
      })
    : null;

if (isProd && env.MAIL_MODE === 'log') {
  logger.warn('MAIL_MODE=log in production: verification codes are written to the server log. Configure SMTP.');
}

const esc = (s: string) =>
  s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);

function fromAddress() {
  return env.MAIL_FROM ?? `"${env.SITE_NAME}" <${env.SMTP_USER ?? 'no-reply@example.com'}>`;
}
function parseFrom(f: string) {
  const m = /^\s*"?([^"<]*?)"?\s*<([^>]+)>\s*$/.exec(f);
  return m ? { name: m[1]!.trim() || env.SITE_NAME, email: m[2]!.trim() } : { name: env.SITE_NAME, email: f.trim() };
}

async function postJson(url: string, headers: Record<string, string>, body: unknown) {
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), 20_000);
  try {
    const r = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json', ...headers }, body: JSON.stringify(body), signal: ctl.signal });
    if (!r.ok) throw new Error(`HTTP ${r.status}: ${(await r.text()).slice(0, 300)}`);
  } finally {
    clearTimeout(timer);
  }
}

async function deliver(mail: Mail) {
  const from = fromAddress();
  if (env.MAIL_MODE === 'brevo') {
    const f = parseFrom(from);
    return postJson('https://api.brevo.com/v3/smtp/email', { 'api-key': env.MAIL_API_KEY ?? '' }, {
      sender: f,
      to: [{ email: mail.to }],
      subject: mail.subject,
      htmlContent: mail.html,
      textContent: mail.text,
    });
  }
  if (env.MAIL_MODE === 'resend') {
    return postJson('https://api.resend.com/emails', { Authorization: `Bearer ${env.MAIL_API_KEY ?? ''}` }, {
      from,
      to: [mail.to],
      subject: mail.subject,
      html: mail.html,
      text: mail.text,
    });
  }
  if (env.MAIL_RELAY_URL && env.MAIL_RELAY_SECRET) {
    return postJson(env.MAIL_RELAY_URL, { 'x-relay-secret': env.MAIL_RELAY_SECRET }, {
      smtp: { host: env.SMTP_HOST, port: env.SMTP_PORT, user: env.SMTP_USER, pass: env.SMTP_PASS },
      mail: { from, ...mail },
    });
  }
  await transporter!.sendMail({ from, ...mail });
}

/**
 * Sends in the background: the HTTP request that triggered the mail (sign-up,
 * password reset…) answers immediately instead of waiting for the mail server.
 */
export async function sendMail(mail: Mail): Promise<void> {
  if (env.MAIL_MODE === 'memory') {
    outbox.push(mail);
    return;
  }
  if (env.MAIL_MODE === 'log' || (env.MAIL_MODE === 'smtp' && !transporter)) {
    logger.info({ to: mail.to, subject: mail.subject, preview: mail.text }, 'mail (log mode)');
    return;
  }
  const attempt = async (n: number): Promise<void> => {
    try {
      await deliver(mail);
      logger.info({ to: mail.to, subject: mail.subject }, 'mail sent');
    } catch (err) {
      if (n < 2) return void setTimeout(() => void attempt(n + 1), 3_000 * (n + 1));
      logger.error({ err, to: mail.to }, 'mail delivery failed');
    }
  };
  void attempt(0);
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
  return `<!doctype html><html lang="${lang}" dir="${dir}"><body style="margin:0;background:#06120f;font-family:Segoe UI,Tahoma,Arial,sans-serif">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr><td align="center" style="padding:32px 12px">
<table role="presentation" width="560" style="max-width:560px;background:#0b1f1a;border-radius:20px;overflow:hidden;border:1px solid #123029">
<tr><td style="padding:28px 32px;background:linear-gradient(135deg,#059669,#34d399);color:#0b0f19;font-size:22px;font-weight:700">${esc(env.SITE_NAME)}</td></tr>
<tr><td style="padding:32px;color:#e5e7eb;font-size:15px;line-height:1.7"><h1 style="margin:0 0 12px;font-size:20px;color:#fff">${esc(title)}</h1>${body}</td></tr>
<tr><td style="padding:18px 32px;color:#6b7280;font-size:12px;border-top:1px solid #123029">${esc(T.ignore[lang])}</td></tr>
</table></td></tr></table></body></html>`;
}

export function codeMail(to: string, kind: 'verify' | 'reset' | 'security', code: string, lang: Lang = 'en'): Mail {
  const title = T[kind][lang];
  const body = `<p>${esc(T.codeIntro[lang])}</p>
<p style="font-size:34px;letter-spacing:10px;font-weight:700;color:#34d399;text-align:center;margin:24px 0">${esc(code)}</p>`;
  return { to, subject: `${env.SITE_NAME} — ${title}`, html: layout(lang, title, body), text: `${title}: ${code}` };
}

export function noticeMail(to: string, title: string, message: string, lang: Lang = 'en'): Mail {
  return { to, subject: `${env.SITE_NAME} — ${title}`, html: layout(lang, title, `<p>${esc(message)}</p>`), text: `${title}\n${message}` };
}
