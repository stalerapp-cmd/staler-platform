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

/** Security-relevant account events the customer should always hear about. */
const ALERTS: Record<string, (d: Record<string, any>, dev: string) => { en: [string, string]; ar: [string, string] } | null> = {
  'auth.login': (_d, dev) => ({ en: ['New sign-in', `Signed in${dev ? ` on ${dev}` : ''}. Not you? Change your password now.`], ar: ['تسجيل دخول جديد', `تم الدخول لحسابك${dev ? ` من ${dev}` : ''}. مش إنت؟ غيّر كلمة المرور فورًا.`] }),
  'auth.login_google': (_d, dev) => ({ en: ['New sign-in with Google', `Signed in${dev ? ` on ${dev}` : ''}.`], ar: ['دخول جديد عبر جوجل', `تم الدخول${dev ? ` من ${dev}` : ''}.`] }),
  'auth.logout_all': () => ({ en: ['Signed out everywhere', 'All other devices were signed out.'], ar: ['تم الخروج من كل الأجهزة', 'انطلعت من كل الأجهزة التانية.'] }),
  'auth.password_reset': () => ({ en: ['Password reset', 'Your password was reset and all devices were signed out.'], ar: ['تمت إعادة تعيين كلمة المرور', 'انتغيّرت كلمة المرور وانطلعت من كل الأجهزة.'] }),
  'auth.password_changed': () => ({ en: ['Password changed', 'Your password was changed.'], ar: ['انتغيّرت كلمة المرور', 'تم تغيير كلمة المرور بنجاح.'] }),
  'auth.totp_enabled': () => ({ en: ['Two-step verification on', 'Your account now asks for a code at sign-in.'], ar: ['تفعّل التحقق بخطوتين', 'حسابك صار يطلب رمز عند الدخول.'] }),
  'auth.totp_disabled': () => ({ en: ['Two-step verification off', 'Turn it back on in Settings to stay protected.'], ar: ['انطفى التحقق بخطوتين', 'شغّله من الإعدادات لتضل محمي.'] }),
  'link.code_created': () => ({ en: ['Link code created', 'A one-time code to link an app was created. Never share it with anyone who calls you.'], ar: ['انعمل كود ربط', 'انعمل كود لمرة وحدة لربط تطبيق. لا تعطيه لحدا بيتصل فيك.'] }),
  'link.revoked': () => ({ en: ['App unlinked', 'A linked app can no longer move money from your account.'], ar: ['انفكّ ربط تطبيق', 'التطبيق ما عاد بيقدر ينقل مصاري من حسابك.'] }),
  'transfer.created': (d) => ({ en: ['Transfer sent', d.amount ? `${d.amount} left your account.` : 'Your transfer was sent.'], ar: ['انبعتت الحوالة', d.amount ? `طلع ${d.amount} من حسابك.` : 'انبعتت حوالتك.'] }),
  'admin.password_set': () => ({ en: ['Password set by the bank', 'An administrator set a new password for your account.'], ar: ['البنك عيّن كلمة مرور', 'المدير عيّن كلمة مرور جديدة لحسابك.'] }),
  'admin.sessions_revoked': () => ({ en: ['Signed out by the bank', 'All your devices were signed out by an administrator.'], ar: ['البنك طلّعك من الأجهزة', 'المدير طلّعك من كل الأجهزة.'] }),
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
    // Admin actions are logged against the admin; tell the affected customer instead.
    const target = entry.action.startsWith('admin.') ? (entry.entityType === 'user' ? entry.entityId : null) : entry.userId;
    const alert = target ? ALERTS[entry.action]?.(entry.details ?? {}, device(req ? userAgent(req) : null)) : null;
    if (alert) {
      await client.query(`INSERT INTO ${S}.notifications (user_id, type, title, body, metadata) VALUES ($1, $2, $3, $4, $5)`, [
        target,
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
