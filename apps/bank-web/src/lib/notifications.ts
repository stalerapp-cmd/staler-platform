import type { Lang } from './i18n';
import { money } from './format';

export interface Notice {
  id: string;
  type: string;
  title: string;
  body: string | null;
  is_read: boolean;
  created_at: string;
  metadata?: { ar?: { title: string; body: string }; [k: string]: unknown } | null;
}

/**
 * Notifications are stored by the server in English; show them in the reader's
 * language. Unknown or older notifications fall back to the stored text.
 */
export function localize(n: Notice, lang: Lang): { title: string; body: string | null } {
  if (lang !== 'ar') return { title: n.title, body: n.body };
  if (n.metadata?.ar?.title) return { title: n.metadata.ar.title, body: n.metadata.ar.body ?? null };
  const body = n.body ?? '';
  const m = /(\d+(?:\.\d+)?)\s+([A-Z]{2,11})/.exec(body);
  const amt = m ? money(m[1]!, lang, m[2]!) : '';
  const order = /#([0-9a-f]{8})/i.exec(body)?.[1] ?? '';
  const t: Record<string, [string, string | null]> = {
    // S-Taler
    bank_topup: ['تم شحن المحفظة', `وصل ${amt} من TalerBank`],
    bank_deposit: ['تم التحويل لبنكك', `وصل ${amt} لحسابك في TalerBank`],
    bank_deposit_failed: ['فشل التحويل للبنك', `رجع ${amt} لمحفظتك`],
    order_paid: ['تم تحرير الدفعة', `${amt} للطلب #${order}`],
    order_refunded: ['تم استرجاع مبلغ الطلب', `رجع ${amt} لمحفظتك`],
    new_order: ['طلب جديد', `الطلب #${order} — ${amt}`],
    order_shipped: ['تم شحن طلبك', `الطلب #${order} بالطريق. أكّد الاستلام لما يوصلك.`],
    money_received: ['وصلتك مصاري', `${body.split(' sent you ')[0] ?? ''} بعتلك ${amt}`],
    voucher_claimed: ['تم صرف القسيمة', `تم صرف قسيمة بقيمة ${amt}`],
    // TalerBank
    transfer_in: ['وصلتك حوالة', `استلمت ${amt}`],
    request_paid: ['تم دفع طلبك', `انْدفع طلب الدفع: ${amt}`],
    cash_in: ['إيداع نقدي', `${amt}${body.includes(' — ') ? ' — ' + body.split(' — ').slice(1).join(' — ') : ''}`],
    cash_out: ['سحب نقدي', `${amt}${body.includes(' — ') ? ' — ' + body.split(' — ').slice(1).join(' — ') : ''}`],
    wallet_deposit: ['وصلت مصاري من محفظتك', `وصل ${amt} من S‑Taler`],
    app_linked: ['تم ربط تطبيق جديد', `${body.split(' can now')[0] ?? ''} صار يقدر ينقل مصاري من حسابك لمحفظتك.`],
    withdrawal_confirmed: ['تم الإرسال للمحفظة', `انتقل ${amt} لمحفظة S‑Taler تبعتك`],
    welcome: ['أهلًا فيك في TalerBank', `انضافت لحسابك مكافأة ترحيب بقيمة ${amt}.`],
  };
  if (n.type === 'account_status') {
    return /unfrozen/i.test(n.title)
      ? { title: 'تم فك تجميد الحساب', body: 'حسابك رجع فعّال.' }
      : { title: 'تم تجميد الحساب', body: 'تواصل مع البنك للتفاصيل.' };
  }
  const hit = t[n.type];
  // Only use the translation when the amount (if any) could be read back.
  if (!hit || (/\d/.test(body) && !amt && n.type !== 'app_linked')) return { title: n.title, body: n.body };
  return { title: hit[0], body: hit[1] };
}
