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
  const f = env.MAIL_FROM ?? `"${env.BANK_NAME}" <${env.SMTP_USER ?? 'no-reply@example.com'}>`;
  // Gmail only delivers reliably (and keeps mail out of Spam) when the sender
  // address is the account that logs in. Keep the display name, fix the address.
  if (/gmail\.com$|googlemail\.com$/i.test(env.SMTP_HOST ?? '') && env.SMTP_USER) {
    return `"${parseFrom(f).name.replace(/"/g, '')}" <${env.SMTP_USER}>`;
  }
  return f;
}
function parseFrom(f: string) {
  const m = /^\s*"?([^"<]*?)"?\s*<([^>]+)>\s*$/.exec(f);
  return m ? { name: m[1]!.trim() || env.BANK_NAME, email: m[2]!.trim() } : { name: env.BANK_NAME, email: f.trim() };
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

/** Startup self-check: confirms the mail route works (logs in to SMTP via the relay, sends nothing). */
export async function checkMailSetup(): Promise<void> {
  if (env.MAIL_MODE !== 'smtp' || !env.MAIL_RELAY_URL || !env.MAIL_RELAY_SECRET) {
    logger.info({ mode: env.MAIL_MODE, relay: Boolean(env.MAIL_RELAY_URL) }, 'mail setup');
    return;
  }
  try {
    await postJson(env.MAIL_RELAY_URL, { 'x-relay-secret': env.MAIL_RELAY_SECRET }, {
      verify: true,
      smtp: { host: env.SMTP_HOST, port: env.SMTP_PORT, user: env.SMTP_USER, pass: env.SMTP_PASS },
    });
    logger.info({ host: env.SMTP_HOST }, 'mail relay ready: SMTP login verified');
  } catch (err) {
    logger.error({ err }, 'mail relay check failed — e-mails will not be delivered until this is fixed');
  }
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

/**
 * Deliberately plain, light e-mails: one short message, the code as text, no images,
 * no tracking, a matching plain-text part. Personal-looking mail like this is what
 * Gmail and Outlook put in the inbox rather than Spam.
 */
function layout(lang: Lang, title: string, body: string): string {
  const dir = lang === 'ar' ? 'rtl' : 'ltr';
  const align = lang === 'ar' ? 'right' : 'left';
  return `<!doctype html><html lang="${lang}" dir="${dir}"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width"></head>
<body style="margin:0;padding:24px 12px;background:#f5f5f7;font-family:Tahoma,Arial,sans-serif;color:#1f2330">
<div style="max-width:520px;margin:0 auto;background:#ffffff;border-radius:14px;padding:28px;text-align:${align};border:1px solid #e6e6ec">
<p style="margin:0 0 18px;font-size:15px;font-weight:bold;color:#9A7425">${esc(env.BANK_NAME)}</p>
<h1 style="margin:0 0 10px;font-size:19px;color:#1f2330">${esc(title)}</h1>
${body}
<p style="margin:24px 0 0;font-size:12px;color:#777">${esc(T.ignore[lang])}</p>
</div></body></html>`;
}

export function codeMail(to: string, kind: 'verify' | 'reset' | 'security', code: string, lang: Lang = 'en'): Mail {
  const title = T[kind][lang];
  const body = `<p style="margin:0;font-size:15px;line-height:1.7">${esc(T.codeIntro[lang])}</p>
<p style="margin:20px 0;font-size:32px;letter-spacing:8px;font-weight:bold;text-align:center;color:#1f2330" dir="ltr">${esc(code)}</p>`;
  const subject = lang === 'ar' ? `${code} هو رمز ${env.BANK_NAME}` : `${code} is your ${env.BANK_NAME} code`;
  const text = `${title}\n\n${T.codeIntro[lang]}\n\n${code}\n\n${T.ignore[lang]}\n— ${env.BANK_NAME}`;
  return { to, subject, html: layout(lang, title, body), text };
}

export function noticeMail(to: string, title: string, message: string, lang: Lang = 'en'): Mail {
  return {
    to,
    subject: `${env.BANK_NAME}: ${title}`,
    html: layout(lang, title, `<p style="margin:0;font-size:15px;line-height:1.7">${esc(message)}</p>`),
    text: `${title}\n\n${message}\n— ${env.BANK_NAME}`,
  };
}

/** Sends right now and reports the outcome (used by the admin "send test e-mail" button). */
export async function sendMailNow(mail: Mail): Promise<{ ok: boolean; error?: string }> {
  if (env.MAIL_MODE === 'memory') {
    outbox.push(mail);
    return { ok: true };
  }
  try {
    await deliver(mail);
    logger.info({ to: mail.to, subject: mail.subject }, 'mail sent (test)');
    return { ok: true };
  } catch (err) {
    return { ok: false, error: (err as Error).message.slice(0, 300) };
  }
}
