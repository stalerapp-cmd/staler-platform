import { BadgeCheck, Crown, HandCoins, ShieldCheck, Store, User as UserIcon } from 'lucide-react';
import { useAuth } from '../lib/auth';
import { useI18n } from '../lib/i18n';
import { cx } from './ui';

const ICONS: Record<string, typeof UserIcon> = { user: UserIcon, merchant: Store, exchange: HandCoins, admin: ShieldCheck, super: Crown };

/** The account type, always visible: personal, business, admin… */
export function RoleBadge({ className, compact = false, onDark = false }: { className?: string; compact?: boolean; onDark?: boolean }) {
  const { user } = useAuth();
  const { t } = useI18n();
  if (!user) return null;
  const u = user as typeof user & { admin_level?: string | null };
  const key: string = u.role === 'admin' && u.admin_level === 'super_admin' ? 'super' : u.role;
  const Icon = ICONS[key] ?? BadgeCheck;
  const tone = onDark
    ? 'bg-white/20 text-white ring-white/35'
    : key === 'super' || key === 'admin'
      ? 'bg-gold/15 text-gold ring-gold/30'
      : key === 'exchange'
        ? 'bg-gold/15 text-[rgb(150_105_10)] ring-gold/40 dark:text-gold'
        : key === 'merchant'
        ? 'bg-olive/15 text-olive ring-olive/30'
        : 'bg-sky/15 text-sky ring-sky/30';
  return (
    <span className={cx('inline-flex items-center gap-1 whitespace-nowrap rounded-full px-2.5 py-1 text-xs font-semibold ring-1', tone, className)} title={t.account[key] ?? key}>
      <Icon className="h-3.5 w-3.5" />
      {!compact && (t.account[key] ?? key)}
    </span>
  );
}
