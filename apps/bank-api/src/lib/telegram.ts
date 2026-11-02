import crypto from 'node:crypto';
import { env, isProd, isTest } from '../config/env.js';
import { logger } from './logger.js';

/**
 * Codes by Telegram: free, and needs no phone number on our side. The person
 * opens our bot from a link (t.me/<bot>?start=<token>), presses Start, and the
 * bot sends their 6-digit code. Telegram tells us about the Start through a
 * webhook that only Telegram can call (secret header).
 */
export const telegramEnabled = () => Boolean(env.TELEGRAM_BOT_TOKEN && env.TELEGRAM_BOT_USERNAME);

/** The secret Telegram sends back on every webhook call (derived, so nothing else to configure). */
export const webhookSecret = () => crypto.createHash('sha256').update(`tg-webhook:${env.TELEGRAM_BOT_TOKEN ?? ''}`).digest('hex').slice(0, 48);

/** A one-time start token for the bot link (Telegram allows A-Z a-z 0-9 _ -, up to 64). */
export const startToken = () => crypto.randomBytes(18).toString('base64url');
export const botLink = (token: string) => `https://t.me/${env.TELEGRAM_BOT_USERNAME}?start=${token}`;

/** In tests, messages land here instead of going to Telegram. */
export const telegramOutbox: { chat_id: unknown; text: string }[] = [];

async function call(method: string, body: Record<string, unknown>) {
  if (!telegramEnabled()) return null;
  if (isTest) {
    if (method === 'sendMessage') telegramOutbox.push({ chat_id: body.chat_id, text: String(body.text) });
    return { ok: true };
  }
  const r = await fetch(`https://api.telegram.org/bot${env.TELEGRAM_BOT_TOKEN}/${method}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(10_000),
  });
  const j: any = await r.json().catch(() => ({}));
  if (!j?.ok) logger.warn({ method, status: r.status, description: j?.description }, 'telegram call failed');
  return j;
}

export const sendTelegram = (chatId: number | string, text: string) => call('sendMessage', { chat_id: chatId, text, parse_mode: 'HTML', disable_web_page_preview: true });

/** The message that carries a code, in the person's language. */
export function codeText(code: string, lang: string, site: string) {
  return lang === 'en'
    ? `🔐 Your ${site} code: <b>${code}</b>\n\nType it on the page where you signed up. It expires in 15 minutes. Never share it with anyone — ${site} staff will never ask for it.`
    : `🔐 رمز ${site}: <b>${code}</b>\n\nاكتبه بالصفحة اللي سجّلت منها. صالح لمدة 15 دقيقة. لا تعطيه لحدا أبدًا — فريق ${site} عمره ما رح يطلبه منك.`;
}

/** Point the bot at our webhook (on start-up, in production). */
export async function setupTelegramWebhook(publicUrl: string) {
  if (!telegramEnabled() || !isProd) return;
  const url = `${publicUrl.replace(/\/+$/, '')}/api/telegram/webhook`;
  const j = await call('setWebhook', { url, secret_token: webhookSecret(), allowed_updates: ['message'], drop_pending_updates: true });
  if (j?.ok) logger.info({ url }, 'telegram webhook set');
}
