import { type ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { LogIn } from 'lucide-react';
import { useAuth } from '../lib/auth';
import { useI18n } from '../lib/i18n';
import { Logo } from '../components/Tatreez';
import { Avatar, Button, cx } from '../components/ui';
import { CartButton } from '../components/Commerce';
import { BackButton, TopControls } from './AppShell';

/**
 * Header for the public store pages (directory, store page, market). Works the same
 * signed in or out, so a shared store link always opens on its own — with a way back.
 */
export function PublicShell({ children, onCart, brand, className }: { children: ReactNode; onCart?: () => void; brand?: ReactNode; className?: string }) {
  const { user } = useAuth();
  const { t } = useI18n();
  return (
    <div className="min-h-dvh bg-bg">
      <header className="safe-top sticky top-0 z-30 border-b border-line/70 bg-bg/80 backdrop-blur-md">
        <div className="mx-auto flex h-16 max-w-6xl items-center justify-between gap-2 px-3 sm:px-6">
          <div className="flex min-w-0 items-center gap-1">
            <BackButton />
            {brand ?? (
              <Link to={user ? '/app' : '/'} className="flex items-center gap-2">
                <Logo className="h-8 w-8" />
                <span className="hidden font-display text-lg sm:inline">S-Taler</span>
              </Link>
            )}
          </div>
          <div className="flex shrink-0 items-center gap-0.5 sm:gap-1">
            <div className="hidden sm:block">
              <TopControls />
            </div>
            {onCart && <CartButton onClick={onCart} />}
            {user ? (
              <Link to="/app" className="ms-1 rounded-full" aria-label={t.nav.home}>
                <Avatar name={user.full_name} src={user.profile_image} size={36} />
              </Link>
            ) : (
              <Link to="/login" state={{ from: location.pathname + location.search }}>
                <Button size="sm" icon={<LogIn className="h-4 w-4 flip-rtl" />}>
                  {t.landing.signIn}
                </Button>
              </Link>
            )}
          </div>
        </div>
      </header>
      <main className={cx('safe-bottom mx-auto max-w-6xl px-4 pb-16 pt-5 sm:px-6', className)}>{children}</main>
    </div>
  );
}
