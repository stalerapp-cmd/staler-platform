import type { Request } from 'express';
import { S, type Db, pool } from './db.js';
import { clientIp, userAgent } from './http.js';
import { logger } from './logger.js';

export interface AuditEntry {
  userId?: string | null;
  action: string;
  entityType?: string;
  entityId?: string;
  details?: Record<string, unknown>;
}

/** Device label from a user agent, for "new sign-in" style alerts. */
function device(ua: string | null) {
  if (!ua) return '';
  const os = /Android/i.test(ua) ? 'Android' : /iPhone|iPad/i.test(ua) ? 'iPhone' : /Windows/i.test(ua) ? 'Windows' : /Mac OS/i.test(ua) ? 'Mac' : /Linux/i.test(ua) ? 'Linux' : '';
  const app = /S-Taler|Capacitor|wv\)/i.test(ua) ? 'app' : /Edg\//.test(ua) ? 'Edge' : /Chrome\//.test(ua) ? 'Chrome' : /Firefox\//.test(ua) ? 'Firefox' : /Safari\//.test(ua) ? 'Safari' : '';
  return [app, os].filter(Boolean).join(' · ');
}

/**
 * Everything worth telling the account owner about, keyed by audit action.
 * One place, so every audited action that matters also lands in their notifications.
 */
const ALERTS: Record<string, (d: Record<string, any>, dev: string) => { en: [string, string]; ar: [string, string] } | null> = {
  'auth.registered': () => ({ en: ['Welcome to S-Taler', 'Your wallet is ready. Top it up from TalerBank or share your QR to get paid.'], ar: ['أهلًا فيك في S-Taler', 'محفظتك جاهزة. اشحنها من TalerBank أو شارك الـ QR تبعك لتستلم.'] }),
  'auth.login': (_d, dev) => ({ en: ['New sign-in', `Signed in${dev ? ` on ${dev}` : ''}. Not you? Change your password.`], ar: ['تسجيل دخول جديد', `تم الدخول${dev ? ` من ${dev}` : ''}. مش إنت؟ غيّر كلمة المرور.`] }),
  'auth.login_google': (_d, dev) => ({ en: ['New sign-in with Google', `Signed in${dev ? ` on ${dev}` : ''}.`], ar: ['دخول جديد عبر جوجل', `تم الدخول${dev ? ` من ${dev}` : ''}.`] }),
  'auth.logout_all': () => ({ en: ['Signed out everywhere', 'All other devices were signed out.'], ar: ['تم الخروج من كل الأجهزة', 'انطلعت من كل الأجهزة التانية.'] }),
  'auth.password_reset': () => ({ en: ['Password reset', 'Your password was reset and all devices were signed out.'], ar: ['تمت إعادة تعيين كلمة المرور', 'انتغيّرت كلمة المرور وانطلعت من كل الأجهزة.'] }),
  'auth.password_changed': () => ({ en: ['Password changed', 'Your password was changed.'], ar: ['انتغيّرت كلمة المرور', 'تم تغيير كلمة المرور بنجاح.'] }),
  'auth.email_changed': () => ({ en: ['E-mail changed', 'Your sign-in e-mail was updated.'], ar: ['انتغيّر الإيميل', 'تحدّث إيميل تسجيل الدخول.'] }),
  'auth.totp_enabled': () => ({ en: ['Two-step verification on', 'Your account now asks for a code at sign-in.'], ar: ['تفعّل التحقق بخطوتين', 'حسابك صار يطلب رمز عند الدخول.'] }),
  'auth.totp_disabled': () => ({ en: ['Two-step verification off', 'Turn it back on in Settings to stay protected.'], ar: ['انطفى التحقق بخطوتين', 'شغّله من الإعدادات لتضل محمي.'] }),
  'bank.linked': (d) => ({ en: ['Bank linked', `TalerBank account ${String(d.iban ?? '').slice(-4)} is linked.`], ar: ['انربط البنك', `انربط حساب TalerBank المنتهي بـ ${String(d.iban ?? '').slice(-4)}.`] }),
  'bank.unlinked': () => ({ en: ['Bank unlinked', 'Your TalerBank account is no longer linked.'], ar: ['انفكّ ربط البنك', 'حساب TalerBank ما عاد مربوط بمحفظتك.'] }),
  'bank.withdraw': (d) => ({ en: ['Top-up started', `${d.amount} is on its way from your bank.`], ar: ['بلّش الشحن', `${d.amount} بالطريق من بنكك.`] }),
  'bank.deposit': (d) => ({ en: ['Transfer to bank started', `${d.amount} is on its way to your bank.`], ar: ['بلّش التحويل للبنك', `${d.amount} بالطريق لبنكك.`] }),
  'exchange.voucher_created': (d) => ({ en: ['Voucher created', `Cash voucher for ${d.amount} is ready to hand out.`], ar: ['انعملت قسيمة', `قسيمة نقدية بقيمة ${d.amount} جاهزة للتسليم.`] }),
  'exchange.voucher_claimed': () => ({ en: ['Voucher redeemed', 'The cash voucher value is now in your wallet.'], ar: ['تم صرف القسيمة', 'قيمة القسيمة صارت بمحفظتك.'] }),
  'exchange.cashout_paid': () => ({ en: ['Cash withdrawn', 'You paid the agent from your wallet — collect your cash.'], ar: ['تم السحب النقدي', 'دفعت للوكيل من محفظتك — استلم مبلغك نقدًا.'] }),
  'merchant.store_created': () => ({ en: ['Store created', 'Add products and share your store link.'], ar: ['انعمل متجرك', 'أضف منتجات وشارك رابط متجرك.'] }),
  'store.file_download': () => ({ en: ['File downloaded', 'A personalised copy of your purchase was downloaded.'], ar: ['تم تنزيل ملف', 'انْنزّلت نسخة مخصّصة من مشترياتك.'] }),
};

/** Append-only security/audit trail. Never throws — auditing must not break business flows. */
export async function audit(entry: AuditEntry, req?: Request, client: Db = pool): Promise<void> {
  try {
    await client.query(
      `INSERT INTO ${S}.audit_log (user_id, action, entity_type, entity_id, details, ip_address, user_agent)
       VALUES ($1, $2, $3, $4, $5, $6, $7)`,
      [
        entry.userId ?? null,
        entry.action,
        entry.entityType ?? null,
        entry.entityId ?? null,
        JSON.stringify(entry.details ?? {}),
        req ? clientIp(req) : null,
        req ? userAgent(req) : null,
      ],
    );
    const alert = entry.userId ? ALERTS[entry.action]?.(entry.details ?? {}, device(req ? userAgent(req) : null)) : null;
    if (alert) {
      await client.query(`INSERT INTO ${S}.notifications (user_id, type, title, body, metadata) VALUES ($1, $2, $3, $4, $5)`, [
        entry.userId,
        `activity:${entry.action}`,
        alert.en[0],
        alert.en[1],
        JSON.stringify({ ar: { title: alert.ar[0], body: alert.ar[1] }, action: entry.action }),
      ]);
    }
  } catch (err) {
    logger.error({ err, action: entry.action }, 'audit write failed');
  }
}
