import { motion } from 'framer-motion';
import { Suspense, useEffect, useState, type ReactNode } from 'react';
import { NavLink, Outlet, useLocation, useNavigate } from 'react-router-dom';
import {
  ArrowLeft,
  ArrowRightLeft,
  Bell,
  BookText,
  FileClock,
  Home,
  KeyRound,
  Landmark,
  LayoutDashboard,
  LogOut,
  Menu,
  Moon,
  QrCode,
  ScanLine,
  Settings2,
  ShieldCheck,
  Sun,
  Users,
  Vault,
  Wallet,
  X,
} from 'lucide-react';
import { useAuth } from '../lib/auth';
import { useI18n } from '../lib/i18n';
import { useTheme } from '../lib/theme';
import { get, post } from '../lib/api';
import { usePolling } from '../lib/hooks';
import { relative } from '../lib/format';
import { localize, type Notice } from '../lib/notifications';
import { Emblem } from '../components/Guilloche';
import { Avatar, Sheet, cx } from '../components/ui';
import { ErrorBoundary, PageSpinner } from '../components/Boundary';

interface NavItem {
  to: string;
  label: string;
  icon: typeof Home;
  end?: boolean;
}

function useNav() {
  const { t } = useI18n();
  const { user } = useAuth();
  const main: NavItem[] = [
    { to: '/app', label: t.nav.overview, icon: Home, end: true },
    { to: '/app/transfer', label: t.nav.transfer, icon: ArrowRightLeft },
    { to: '/app/transactions', label: t.nav.transactions, icon: BookText },
    { to: '/app/requests', label: t.nav.requests, icon: QrCode },
    { to: '/app/scan', label: t.nav.scan, icon: ScanLine },
    { to: '/app/wallet', label: t.nav.wallet, icon: Wallet },
    { to: '/app/apps', label: t.nav.apps, icon: KeyRound },
  ];
  const role: NavItem[] = [];
  if (user?.role === 'admin') {
    role.push(
      { to: '/app/admin', label: t.nav.admin, icon: LayoutDashboard, end: true },
      { to: '/app/admin/customers', label: t.nav.customers, icon: Users },
      { to: '/app/admin/ledger', label: t.nav.ledger, icon: Landmark },
      { to: '/app/admin/exchange', label: t.nav.exchange, icon: Vault },
      { to: '/app/admin/audit', label: t.nav.audit, icon: FileClock },
      { to: '/app/admin/settings', label: t.nav.system, icon: ShieldCheck },
    );
  }
  return { main, role, settings: { to: '/app/settings', label: t.nav.settings, icon: Settings2 } as NavItem };
}

function SideLink({ item, onClick, animated = true }: { item: NavItem; onClick?: () => void; animated?: boolean }) {
  return (
    <NavLink
      to={item.to}
      end={item.end}
      onClick={onClick}
      className={({ isActive }) =>
        cx('group relative flex items-center gap-3 rounded-xl px-3 py-2.5 text-[15px] transition', isActive ? (animated ? 'text-ink' : 'bg-sunk font-medium text-ink') : 'text-muted hover:bg-sunk hover:text-ink')
      }
    >
      {({ isActive }) => (
        <>
          {isActive && animated && <motion.span layoutId="side-active" className="absolute inset-0 rounded-xl bg-sunk" transition={{ type: 'spring', bounce: 0.15, duration: 0.45 }} />}
          {isActive && animated && <motion.span layoutId="side-thread" className="absolute inset-y-2 start-0 w-1 rounded-full bg-gold" />}
          <item.icon className="relative h-5 w-5" />
          <span className="relative">{item.label}</span>
        </>
      )}
    </NavLink>
  );
}

function Notifications() {
  const { t, lang } = useI18n();
  const [open, setOpen] = useState(false);
  const [data, setData] = useState<{ notifications: Notice[]; unread: number } | null>(null);
  const load = async () => {
    try {
      setData(await get('/api/notifications'));
    } catch {
      /* offline */
    }
  };
  useEffect(() => void load(), []);
  usePolling(load, 30_000);
  return (
    <>
      <button
        onClick={() => {
          setOpen(true);
          if (data?.unread) void post('/api/notifications/read-all').then(load);
        }}
        className="relative rounded-xl p-2.5 text-muted transition hover:bg-sunk hover:text-ink"
        aria-label={t.nav.notifications}
      >
        <Bell className="h-5 w-5" />
        {!!data?.unread && (
          <motion.span initial={{ scale: 0 }} animate={{ scale: 1 }} className="absolute end-1.5 top-1.5 grid h-4 min-w-4 place-items-center rounded-full bg-gold px-1 text-[10px] font-bold text-night">
            {data.unread > 9 ? '9+' : data.unread}
          </motion.span>
        )}
      </button>
      <Sheet open={open} onClose={() => setOpen(false)} title={t.nav.notifications}>
        {!data?.notifications.length ? (
          <p className="py-8 text-center text-muted">{t.common.empty}</p>
        ) : (
          <ul className="divide-y divide-line">
            {data.notifications.map((n) => {
              const l = localize(n, lang);
              return (
                <li key={n.id} className="flex gap-3 py-3">
                  <span className={cx('mt-2 h-2 w-2 shrink-0 rounded-full', n.is_read ? 'bg-transparent' : 'bg-stitch')} aria-hidden="true" />
                  <div className="min-w-0 flex-1">
                    <p className="font-medium">{l.title}</p>
                    {l.body && <p className="break-words text-sm text-muted">{l.body}</p>}
                    <p className="mt-1 text-xs text-muted">{relative(n.created_at, lang)}</p>
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </Sheet>
    </>
  );
}

export function TopControls() {
  const { t, toggle } = useI18n();
  const { theme, setTheme } = useTheme();
  return (
    <div className="flex items-center gap-1">
      <button onClick={toggle} className="rounded-xl px-2.5 py-2 text-sm font-medium text-muted transition hover:bg-sunk hover:text-ink">
        {t.common.language}
      </button>
      <button onClick={() => setTheme(theme === 'dark' ? 'light' : 'dark')} className="rounded-xl p-2.5 text-muted transition hover:bg-sunk hover:text-ink" aria-label={t.common.theme}>
        {theme === 'dark' ? <Sun className="h-5 w-5" /> : <Moon className="h-5 w-5" />}
      </button>
    </div>
  );
}

export default function AppShell({ children }: { children?: ReactNode }) {
  const { user, logout } = useAuth();
  const { t, lang } = useI18n();
  const { main, role, settings } = useNav();
  const loc = useLocation();
  const navigate = useNavigate();
  const [menu, setMenu] = useState(false);
  useEffect(() => setMenu(false), [loc.pathname]);
  useEffect(() => {
    if (!menu) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && setMenu(false);
    window.addEventListener('keydown', onKey);
    return () => {
      document.body.style.overflow = prev;
      window.removeEventListener('keydown', onKey);
    };
  }, [menu]);

  const bottom: NavItem[] = [
    { to: '/app', label: t.nav.home, icon: Home, end: true },
    { to: '/app/transfer', label: t.nav.transfer, icon: ArrowRightLeft },
    { to: '/app/scan', label: t.nav.scan, icon: ScanLine },
    { to: '/app/transactions', label: t.nav.statementsTab, icon: BookText },
  ];

  const sidebar = (onClick?: () => void, animated = true) => (
    <nav className="flex h-full flex-col gap-1" aria-label="Main">
      {main.map((i) => (
        <SideLink key={i.to} item={i} onClick={onClick} animated={animated} />
      ))}
      {role.length > 0 && <div className="mx-3 my-3 border-t border-dashed border-line" />}
      {role.map((i) => (
        <SideLink key={i.to} item={i} onClick={onClick} animated={animated} />
      ))}
      <div className="mt-auto pt-4">
        <SideLink item={settings} onClick={onClick} animated={animated} />
        <button
          onClick={async () => {
            await logout();
            navigate('/login');
          }}
          className="flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-[15px] text-muted transition hover:bg-stitch/10 hover:text-stitch"
        >
          <LogOut className="h-5 w-5 flip-rtl" />
          {t.common.signOut}
        </button>
      </div>
    </nav>
  );

  return (
    <div className="safe-x min-h-dvh lg:grid lg:grid-cols-[260px_1fr]">
      <aside className="sticky top-0 hidden h-dvh flex-col border-e border-line bg-surface/60 px-4 py-6 backdrop-blur lg:flex">
        <NavLink to="/app" className="mb-8 flex items-center gap-3 px-2">
          <Emblem />
          <span className="font-display text-2xl">TalerBank</span>
        </NavLink>
        <div className="min-h-0 flex-1 overflow-y-auto">{sidebar()}</div>
      </aside>

      <div className="min-w-0">
        <header className="safe-top sticky top-0 z-30 border-b border-line/70 bg-bg/80 backdrop-blur-md">
          <div className="mx-auto flex h-16 max-w-6xl items-center justify-between gap-2 px-3 sm:gap-3 sm:px-6">
            <div className="flex min-w-0 items-center gap-1">
              {loc.pathname !== '/app' && <BackButton />}
              <div className="flex items-center gap-2 lg:hidden">
                <button onClick={() => setMenu(true)} className="rounded-xl p-2.5 text-muted hover:bg-sunk" aria-label={t.common.menu}>
                  <Menu className="h-5 w-5" />
                </button>
                <Emblem className="h-8 w-8" />
              </div>
              <div className="hidden text-sm text-muted lg:block">
                {t.home.greeting}
                {lang === 'ar' ? '، ' : ', '}
                <span className="font-medium text-ink">{user?.full_name?.split(' ')[0]}</span>
              </div>
            </div>
            <div className="flex shrink-0 items-center gap-0.5 sm:gap-1">
              {/* Small phones: language and theme live in the side menu to keep the bar uncluttered. */}
              <div className="hidden sm:block">
                <TopControls />
              </div>
              <Notifications />
              <NavLink to="/app/settings" className="ms-1 rounded-full" aria-label={t.nav.settings}>
                <Avatar name={user?.full_name} size={36} />
              </NavLink>
            </div>
          </div>
        </header>

        <main className="mx-auto max-w-6xl px-4 pb-[calc(8rem+env(safe-area-inset-bottom))] pt-5 sm:px-6 sm:pt-6 lg:pb-12">
          <ErrorBoundary key={loc.pathname}>
            <Suspense fallback={<PageSpinner />}>
              <div key={loc.pathname} className="page-in">
                {children ?? <Outlet />}
              </div>
            </Suspense>
          </ErrorBoundary>
        </main>
      </div>

      {/* phone tab bar with the scan button raised in the middle */}
      <nav className="safe-bottom fixed inset-x-0 bottom-0 z-40 border-t border-line bg-surface/95 backdrop-blur lg:hidden" aria-label="Tabs">
        <div className="relative mx-auto grid h-16 max-w-md grid-cols-5 items-center">
          {bottom.slice(0, 2).map((i) => (
            <TabLink key={i.to} item={i} />
          ))}
          <div className="grid place-items-center">
            <NavLink to="/app/scan" aria-label={t.nav.scan} className="-mt-8 grid h-16 w-16 place-items-center rounded-full bg-gold text-night shadow-card ring-4 ring-bg transition active:scale-95">
              <ScanLine className="h-7 w-7" />
            </NavLink>
          </div>
          {bottom.slice(3).map((i) => (
            <TabLink key={i.to} item={i} />
          ))}
          <button onClick={() => setMenu(true)} className="flex flex-col items-center gap-0.5 text-[11px] text-muted">
            <Menu className="h-5 w-5" />
            {t.nav.more}
          </button>
        </div>
      </nav>

      {/* Side menu: always mounted and driven by CSS, so it can always be opened again
          and never leaves an invisible layer over the app. */}
      <div
        className={cx('fixed inset-0 z-50 lg:hidden', !menu && 'pointer-events-none')}
        aria-hidden={!menu}
        {...((!menu ? { inert: '' } : {}) as any)}
      >
        <div
          className={cx('absolute inset-0 bg-night/50 transition-opacity duration-300', menu ? 'opacity-100' : 'opacity-0')}
          onClick={() => setMenu(false)}
        />
        <aside
          role="dialog"
          aria-modal="true"
          aria-label={t.common.menu}
          className={cx(
            'safe-top safe-bottom absolute inset-y-0 start-0 flex w-[84%] max-w-xs flex-col bg-surface px-4 py-5 shadow-card transition-transform duration-300 ease-out will-change-transform',
            menu ? 'translate-x-0' : 'ltr:-translate-x-full rtl:translate-x-full',
          )}
        >
              <div className="mb-6 flex items-center justify-between px-2">
                <div className="flex items-center gap-3">
                  <Avatar name={user?.full_name} />
                  <div className="min-w-0">
                    <p className="truncate font-medium">{user?.full_name}</p>
                    <p className="truncate text-xs text-muted">{user?.email}</p>
                  </div>
                </div>
                <button onClick={() => setMenu(false)} className="rounded-lg p-1.5 text-muted" aria-label={t.common.close}>
                  <X className="h-5 w-5" />
                </button>
              </div>
              <div className="mb-3 flex justify-end border-b border-line pb-3 sm:hidden">
                <TopControls />
              </div>
              <div className="min-h-0 flex-1 overflow-y-auto pb-6">{sidebar(() => setMenu(false), false)}</div>
        </aside>
      </div>
    </div>
  );
}

/** Back: previous screen if there is one in this tab's history, otherwise the parent screen. */
function BackButton() {
  const navigate = useNavigate();
  const loc = useLocation();
  const { t } = useI18n();
  return (
    <button
      onClick={() => {
        if ((window.history.state?.idx ?? 0) > 0) navigate(-1);
        else navigate(loc.pathname.split('/').slice(0, -1).join('/') || '/app', { replace: true });
      }}
      className="grid h-10 w-10 shrink-0 place-items-center rounded-xl text-ink transition hover:bg-sunk active:scale-95"
      aria-label={t.common.back}
    >
      <ArrowLeft className="h-5 w-5 flip-rtl" />
    </button>
  );
}

function TabLink({ item }: { item: NavItem }) {
  return (
    <NavLink to={item.to} end={item.end} className={({ isActive }) => cx('flex min-w-0 flex-col items-center gap-0.5 px-0.5 text-[11px] leading-tight transition', isActive ? 'text-gold' : 'text-muted')}>
      <item.icon className="h-5 w-5 shrink-0" />
      <span className="max-w-full truncate">{item.label}</span>
    </NavLink>
  );
}
