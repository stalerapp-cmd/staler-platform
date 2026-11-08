import { BadgeHelp, CalendarClock, KeyRound, Link2, Send, ShieldCheck, type LucideIcon } from 'lucide-react';

/** What a support conversation or call is about — picked by the customer, shown to the team. */
export const TOPICS: { k: string; ar: string; en: string; icon: LucideIcon; c: string }[] = [
  { k: 'account', ar: 'الحساب والدخول', en: 'Account & sign-in', icon: KeyRound, c: 'bg-[#3B2F5E]/10 text-[#3B2F5E] dark:text-[#b9acee]' },
  { k: 'transfers', ar: 'الحوالات', en: 'Transfers', icon: Send, c: 'bg-night/10 text-night dark:bg-white/10 dark:text-white' },
  { k: 'wallet', ar: 'المحفظة والربط', en: 'Wallet & linking', icon: Link2, c: 'bg-olive/12 text-olive' },
  { k: 'scheduled', ar: 'الدفعات المجدولة', en: 'Scheduled payments', icon: CalendarClock, c: 'bg-sky/10 text-sky' },
  { k: 'security', ar: 'الأمان', en: 'Security', icon: ShieldCheck, c: 'bg-stitch/10 text-stitch' },
  { k: 'other', ar: 'غير ذلك', en: 'Something else', icon: BadgeHelp, c: 'bg-sunk text-ink/80' },
];
export const topicOf = (k: string | null | undefined) => TOPICS.find((x) => x.k === k);
export const topicName = (k: string | null | undefined, ar: boolean) => {
  const x = topicOf(k);
  return x ? (ar ? x.ar : x.en) : null;
};
