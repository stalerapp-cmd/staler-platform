import { Briefcase, HandCoins, UserRound, type LucideIcon } from 'lucide-react';

export type Kind = 'personal' | 'business' | 'agent';
/** What kind of customer someone is — chosen at sign-up, changed by staff. */
export const KINDS: Record<Kind, { icon: LucideIcon; ar: string; en: string; arLead: string; enLead: string; tone: string }> = {
  personal: { icon: UserRound, ar: 'شخصي', en: 'Personal', arLead: 'لمصروفك، حوالاتك وفواتيرك', enLead: 'Your everyday money, transfers and bills', tone: 'bg-sky/12 text-sky' },
  business: { icon: Briefcase, ar: 'تجاري', en: 'Business', arLead: 'لمتجر أو شركة: مبيعات، رواتب وموردين', enLead: 'A shop or company: sales, salaries, suppliers', tone: 'bg-gold/15 text-[rgb(150_105_10)] dark:text-gold' },
  agent: { icon: HandCoins, ar: 'صرّاف', en: 'Cash agent', arLead: 'بتستلم وبتسلّم كاش للناس', enLead: 'You take and hand out cash for people', tone: 'bg-olive/12 text-olive' },
};
export const kindOf = (k?: string | null) => KINDS[(k as Kind) in KINDS ? (k as Kind) : 'personal'];
