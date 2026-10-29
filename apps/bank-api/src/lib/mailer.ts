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
export type CodeKind = 'verify' | 'reset' | 'security' | 'email-change' | 'email-new' | 'password';
const BRAND = { name: env.BANK_NAME, color: '#9A7425', dark: '#0C1A17', accent: '#C9A45C' };
const site = () => env.PUBLIC_URL.replace(/\/+$/, '');

const TITLE: Record<CodeKind, Record<Lang, string>> = {
  verify: { en: 'Confirm your e-mail', ar: 'تأكيد البريد الإلكتروني' },
  reset: { en: 'Reset your password', ar: 'إعادة تعيين كلمة المرور' },
  security: { en: 'Security code', ar: 'رمز أمان' },
  'email-change': { en: 'Approve the e-mail change', ar: 'وافق على تغيير الإيميل' },
  'email-new': { en: 'Confirm your new e-mail', ar: 'أكّد إيميلك الجديد' },
  password: { en: 'Approve the password change', ar: 'وافق على تغيير كلمة المرور' },
};
const INTRO: Record<CodeKind, Record<Lang, string>> = {
  verify: { en: 'Welcome! Enter this code to finish creating your account.', ar: 'أهلًا فيك! اكتب هالرمز لتكمّل إنشاء حسابك.' },
  reset: { en: 'Enter this code on the “Forgot password” page to choose a new password.', ar: 'اكتب هالرمز بصفحة «نسيت كلمة المرور» لتختار كلمة مرور جديدة.' },
  security: { en: 'Enter this code to continue.', ar: 'اكتب هالرمز لتكمّل.' },
  'email-change': { en: 'A request was made to change the e-mail on your account. Enter this code to approve it — nothing changes without it.', ar: 'في طلب لتغيير إيميل حسابك. اكتب هالرمز لتوافق — ولا إشي بيتغيّر بدونه.' },
  'email-new': { en: 'Enter this code to confirm this is your new e-mail address.', ar: 'اكتب هالرمز لتأكّد إنه هاد إيميلك الجديد.' },
  password: { en: 'A request was made to change your password. Enter this code to approve it — nothing changes without it.', ar: 'في طلب لتغيير كلمة مرورك. اكتب هالرمز لتوافق — ولا إشي بيتغيّر بدونه.' },
};
const L = {
  expires: { en: 'Valid for 15 minutes. Never share it — our team will never ask for it.', ar: 'صالح لمدة 15 دقيقة. لا تعطيه لحدا — فريقنا عمره ما رح يطلبه منك.' },
  ignore: { en: 'Didn’t ask for this? Ignore this e-mail and change your password.', ar: 'ما طلبت هاد؟ تجاهل الرسالة وغيّر كلمة المرور.' },
  open: { en: 'Open', ar: 'افتح' },
};

/**
 * Branded, light e-mail: logo header, a thin pattern stripe, one message, the code
 * as text and a matching plain-text part. No tracking pixels.
 */
function layout(lang: Lang, title: string, body: string): string {
  const dir = lang === 'ar' ? 'rtl' : 'ltr';
  const align = lang === 'ar' ? 'right' : 'left';
  return `<!doctype html><html lang="${lang}" dir="${dir}"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>${esc(title)}</title></head>
<body style="margin:0;padding:24px 10px;background:#f3f1ec;font-family:Tahoma,Arial,sans-serif;color:#1f2330">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr><td align="center">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:520px;background:#ffffff;border-radius:18px;overflow:hidden;border:1px solid #e6e3dc">
<tr><td style="background:${BRAND.dark};padding:20px 26px;text-align:${align}">
<a href="${site()}" style="text-decoration:none"><img src="${site()}/icon-192.png" width="44" height="44" alt="" style="border-radius:12px;vertical-align:middle;border:0">
<span style="color:#ffffff;font-size:20px;font-weight:bold;vertical-align:middle;padding:0 10px">${esc(BRAND.name)}</span></a></td></tr>
<tr><td><table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr><td style="height:6px;background:#C9A45C"></td><td style="height:6px;background:#0C1A17"></td><td style="height:6px;background:#3E6E5A"></td><td style="height:6px;background:#9A7425"></td><td style="height:6px;background:#C9A45C"></td><td style="height:6px;background:#0C1A17"></td><td style="height:6px;background:#3E6E5A"></td><td style="height:6px;background:#9A7425"></td><td style="height:6px;background:#C9A45C"></td><td style="height:6px;background:#0C1A17"></td><td style="height:6px;background:#3E6E5A"></td><td style="height:6px;background:#9A7425"></td><td style="height:6px;background:#C9A45C"></td><td style="height:6px;background:#0C1A17"></td><td style="height:6px;background:#3E6E5A"></td><td style="height:6px;background:#9A7425"></td></tr></table></td></tr>
<tr><td style="padding:28px 26px;text-align:${align}">
<h1 style="margin:0 0 12px;font-size:20px;color:#1f2330">${esc(title)}</h1>
${body}
</td></tr>
<tr><td style="padding:16px 26px;background:#faf8f3;border-top:1px dashed #e6e3dc;text-align:${align};font-size:12px;color:#7a7a80;line-height:1.6">
${esc(L.ignore[lang])}<br><a href="${site()}" style="color:${BRAND.color};text-decoration:none">${esc(site().replace(/^https?:\/\//, ''))}</a>
</td></tr></table></td></tr></table></body></html>`;
}

const para = (t: string) => `<p style="margin:0 0 6px;font-size:15px;line-height:1.75">${esc(t)}</p>`;
const codeBox = (code: string) =>
  `<div dir="ltr" style="margin:20px 0 8px;padding:16px;border:2px dashed ${BRAND.accent};border-radius:16px;background:#fbf8ef;text-align:center;font-size:34px;letter-spacing:10px;font-weight:bold;color:${BRAND.dark};font-family:Consolas,Menlo,monospace">${esc(code)}</div>`;
const button = (label: string, url: string) =>
  `<p style="margin:20px 0 4px"><a href="${esc(url)}" style="display:inline-block;background:${BRAND.color};color:#ffffff;padding:12px 24px;border-radius:12px;text-decoration:none;font-weight:bold;font-size:15px">${esc(label)}</a></p>`;

export function codeMail(to: string, kind: CodeKind, code: string, lang: Lang = 'en', cta?: { label: string; url: string }): Mail {
  const title = TITLE[kind][lang];
  const body = para(INTRO[kind][lang]) + codeBox(code) + `<p style="margin:0;font-size:12px;color:#7a7a80;text-align:center">${esc(L.expires[lang])}</p>` + (cta ? button(cta.label, cta.url) : '');
  const subject = lang === 'ar' ? `${code} هو رمز ${BRAND.name}` : `${code} is your ${BRAND.name} code`;
  const text = `${title}\n\n${INTRO[kind][lang]}\n\n${code}\n\n${L.expires[lang]}${cta ? `\n\n${cta.label}: ${cta.url}` : ''}\n\n${L.ignore[lang]}\n— ${BRAND.name}`;
  return { to, subject, html: layout(lang, title, body), text };
}

export function noticeMail(to: string, title: string, message: string, lang: Lang = 'en', cta?: { label: string; url: string }): Mail {
  return {
    to,
    subject: `${BRAND.name}: ${title}`,
    html: layout(lang, title, para(message) + (cta ? button(cta.label, cta.url) : '')),
    text: `${title}\n\n${message}${cta ? `\n\n${cta.url}` : ''}\n— ${BRAND.name}`,
  };
}

/** Bilingual security notices (sent after something important changed). */
export function securityNotice(
  to: string,
  event: 'password' | 'password-reset' | 'email-old' | 'email-new',
  lang: Lang = 'en',
  vars: Record<string, string> = {},
): Mail {
  const when = new Date().toLocaleString(lang === 'ar' ? 'ar' : 'en-GB', { timeZone: 'Asia/Hebron', dateStyle: 'medium', timeStyle: 'short' });
  const M = {
    password: { en: ['Your password was changed', `Your password was changed on ${when} and other devices were signed out. If this wasn’t you, reset your password now.`], ar: ['انتغيّرت كلمة المرور', `انتغيّرت كلمة مرورك بتاريخ ${when} وانطلعت باقي الأجهزة. إذا مش إنت، غيّرها فورًا.`] },
    'password-reset': { en: ['Your password was reset', `Your password was reset on ${when} and all devices were signed out. If this wasn’t you, reset it again now.`], ar: ['انعادت كلمة المرور', `انعمل تعيين جديد لكلمة مرورك بتاريخ ${when} وانطلعت كل الأجهزة. إذا مش إنت، غيّرها فورًا.`] },
    'email-old': { en: ['Your e-mail was changed', `The e-mail on your account was changed to ${vars.email ?? ''} on ${when}. If this wasn’t you, contact support immediately.`], ar: ['انتغيّر الإيميل', `انتغيّر إيميل حسابك لـ ${vars.email ?? ''} بتاريخ ${when}. إذا مش إنت، تواصل مع الدعم فورًا.`] },
    'email-new': { en: ['This is now your sign-in e-mail', `From now on, sign in to ${BRAND.name} with this e-mail.`], ar: ['صار هاد إيميل الدخول تبعك', `من هلّأ وطالع، ادخل على ${BRAND.name} بهالإيميل.`] },
  }[event][lang];
  return noticeMail(to, M[0]!, M[1]!, lang, { label: lang === 'ar' ? `افتح ${BRAND.name}` : `Open ${BRAND.name}`, url: `${site()}/login` });
}

/** Someone tried to sign up with an e-mail that already has an account: give them a way in. */
export function existingAccountMail(to: string, code: string, lang: Lang = 'en'): Mail {
  const title = lang === 'ar' ? `عندك حساب ${BRAND.name} بهالإيميل` : `You already have a ${BRAND.name} account`;
  const intro =
    lang === 'ar'
      ? 'حدا (غالبًا إنت) حاول يفتح حساب جديد بهالإيميل، بس الحساب موجود. سجّل دخول عادي، أو إذا نسيت كلمة المرور استخدم هالرمز بصفحة «نسيت كلمة المرور».'
      : 'Someone (probably you) tried to open a new account with this e-mail, but it already has one. Just sign in — or if you forgot your password, use this code on the “Forgot password” page.';
  const url = `${site()}/forgot?email=${encodeURIComponent(to)}&step=code`;
  const label = lang === 'ar' ? 'اختار كلمة مرور جديدة' : 'Choose a new password';
  const body = para(intro) + codeBox(code) + `<p style="margin:0;font-size:12px;color:#7a7a80;text-align:center">${esc(L.expires[lang])}</p>` + button(label, url);
  return {
    to,
    subject: lang === 'ar' ? `${code} — رمز الدخول لحسابك بـ ${BRAND.name}` : `${code} — your ${BRAND.name} account code`,
    html: layout(lang, title, body),
    text: `${title}\n\n${intro}\n\n${code}\n\n${url}\n— ${BRAND.name}`,
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
