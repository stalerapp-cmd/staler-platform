import { motion } from 'framer-motion';
import { Suspense, useEffect, useState, type ReactNode } from 'react';
import { NavLink, Outlet, useLocation, useNavigate } from 'react-router-dom';
import {
  ArrowLeft,
  Crown,
  Activity,
  Bell,
  ClipboardList,
  Cog,
  FileClock,
  Home,
  Landmark,
  LayoutDashboard,
  LogOut,
  Menu,
  MessageCircle,
  Moon,
  Package,
  QrCode,
  ScanLine,
  Send,
  ShieldCheck,
  ShoppingBag,
  Store,
  Sun,
  Ticket,
  UserPlus,
  Users,
  X,
} from 'lucide-react';
import { useAuth } from '../lib/auth';
import { usePerm } from '../lib/perm';
import { RoleBadge } from '../components/RoleBadge';
import { BioOffer } from '../components/AppLock';
import { useI18n } from '../lib/i18n';
import { useTheme } from '../lib/theme';
import { get, post } from '../lib/api';
import { usePolling } from '../lib/hooks';
import { relative } from '../lib/format';
import { localize, type Notice } from '../lib/notifications';
import { Logo } from '../components/Tatreez';
import { Avatar, Sheet, cx } from '../components/ui';
import { ErrorBoundary, PageSpinner } from '../components/Boundary';
import { useConfirm } from '../components/Confirm';

interface NavItem {
  to: string;
  label: string;
  icon: typeof Home;
  end?: boolean;
}

function useNav() {
  const { t } = useI18n();
  const { user } = useAuth();
  const { can } = usePerm();
  const main: NavItem[] = [
    { to: '/app', label: t.nav.home, icon: Home, end: true },
    { to: '/app/send', label: t.nav.send, icon: Send },
    { to: '/app/receive', label: t.nav.receive, icon: QrCode },
    { to: '/app/scan', label: t.nav.scan, icon: ScanLine },
    { to: '/app/bank', label: t.nav.bank, icon: Landmark },
    { to: '/app/activity', label: t.nav.activity, icon: Activity },
    { to: '/app/store', label: t.nav.store, icon: ShoppingBag },
    { to: '/app/orders', label: t.nav.orders, icon: ClipboardList },
    { to: '/app/messages', label: t.nav.messages, icon: MessageCircle },
  ];
  const role: NavItem[] = [];
  if (user?.role === 'merchant') {
    role.push(
      { to: '/app/merchant', label: t.nav.merchant, icon: Store, end: true },
      { to: '/app/merchant/products', label: t.nav.products, icon: Package },
      { to: '/app/merchant/orders', label: t.nav.storeOrders, icon: ClipboardList },
    );
  }
  if (user?.role === 'exchange') role.push({ to: '/app/vouchers', label: t.nav.vouchers, icon: Ticket });
  if (user?.role === 'admin') {
    // Each admin sees only the sections their permissions open.
    const items: (NavItem & { perm?: string })[] = [
      { to: '/app/admin', label: t.nav.overview, icon: LayoutDashboard, end: true },
      { to: '/app/admin/users', label: t.nav.users, icon: Users, perm: 'users.view' },
      { to: '/app/admin/stores', label: t.nav.stores, icon: Store, perm: 'stores.manage' },
      { to: '/app/admin/pending', label: t.nav.pending, icon: UserPlus, perm: 'pending.manage' },
      { to: '/app/admin/bank', label: t.nav.bankOps, icon: Landmark, perm: 'bank.ops' },
      { to: '/app/admin/audit', label: t.nav.audit, icon: FileClock, perm: 'audit.view' },
      { to: '/app/admin/settings', label: t.nav.system, icon: ShieldCheck, perm: 'settings.manage' },
      { to: '/app/admin/admins', label: t.people.admins, icon: Crown, perm: 'admins.manage' },
    ];
    role.push(...items.filter((i) => !i.perm || can(i.perm)));
  }
  return { main, role, settings: { to: '/app/settings', label: t.nav.settings, icon: Cog } as NavItem };
}

function SideLink({ item, onClick, animated = true }: { item: NavItem; onClick?: () => void; animated?: boolean }) {
  return (
    <NavLink
      to={item.to}
      end={item.end}
      onClick={onClick}
      className={({ isActive }) =>
        cx('group relative flex items-center gap-3 rounded-xl px-2 py-1.5 text-[15px] transition', isActive ? (animated ? 'text-ink' : 'bg-sunk font-medium text-ink') : 'text-muted hover:bg-sunk hover:text-ink')
      }
    >
      {({ isActive }) => (
        <>
          {isActive && animated && <motion.span layoutId="side-active" className="absolute inset-0 rounded-xl bg-sunk" transition={{ type: 'spring', bounce: 0.15, duration: 0.45 }} />}
          <span
            className={cx(
              'relative grid h-8 w-8 shrink-0 place-items-center rounded-[10px] transition duration-300',
              isActive ? 'bg-stitch text-white shadow-sm shadow-stitch/30' : 'group-hover:-rotate-6 group-hover:scale-110 group-hover:text-stitch',
            )}
          >
            <item.icon className="h-[18px] w-[18px]" strokeWidth={isActive ? 2.2 : 1.8} />
          </span>
          <span className="relative">{item.label}</span>
        </>
      )}
    </NavLink>
  );
}

/** Messages shortcut with unread badge, always visible in the top bar. */
function MessagesButton() {
  const { t } = useI18n();
  const [unread, setUnread] = useState(0);
  const load = async () => {
    try {
      setUnread((await get<{ unread: number }>('/api/messages/unread-count')).unread);
    } catch {
      /* offline */
    }
  };
  useEffect(() => void load(), []);
  usePolling(load, 30_000);
  return (
    <NavLink
      to="/app/messages"
      onClick={() => setUnread(0)}
      className={({ isActive }) => cx('relative rounded-xl p-2.5 transition hover:bg-sunk hover:text-ink', isActive ? 'text-ink' : 'text-muted')}
      aria-label={t.nav.messages}
    >
      <MessageCircle className="h-5 w-5" />
      {unread > 0 && (
        <span className="absolute end-1.5 top-1.5 grid h-4 min-w-4 place-items-center rounded-full bg-stitch px-1 text-[10px] font-bold text-white">
          {unread > 9 ? '9+' : unread}
        </span>
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
          <motion.span initial={{ scale: 0 }} animate={{ scale: 1 }} className="absolute end-1.5 top-1.5 grid h-4 min-w-4 place-items-center rounded-full bg-stitch px-1 text-[10px] font-bold text-white">
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

export function Announcement() {
  const { t } = useI18n();
  const [text, setText] = useState<string | null>(null);
  useEffect(() => {
    get('/api/config')
      .then((c) => setText(c.maintenance ? t.errors.MAINTENANCE : c.announcement))
      .catch(() => {});
  }, [t]);
  if (!text) return null;
  return <div className="bg-gold/20 px-4 py-2 text-center text-sm text-ink">{text}</div>;
}

export default function AppShell({ children }: { children?: ReactNode }) {
  const { user, logout } = useAuth();
  const { t, lang } = useI18n();
  const { main, role, settings } = useNav();
  const loc = useLocation();
  const navigate = useNavigate();
  const [menu, setMenu] = useState(false);
  const confirm = useConfirm();
  const signOut = async () => {
    if (!(await confirm({ title: t.ask.signOutTitle, body: t.ask.signOutBody, confirmLabel: t.ask.signOutOk }))) return;
    await logout();
    navigate('/login');
  };
  useEffect(() => {
    setMenu(false);
  }, [loc.pathname]);
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
    { to: '/app/activity', label: t.nav.activity, icon: Activity },
    { to: '/app/scan', label: t.nav.scan, icon: ScanLine },
    { to: '/app/store', label: t.nav.store, icon: ShoppingBag },
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
          onClick={signOut}
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
          <Logo animate />
          <span className="font-display text-xl">S-Taler</span>
        </NavLink>
        <div className="min-h-0 flex-1 overflow-y-auto">{sidebar()}</div>
      </aside>

      <div className="min-w-0">
        <Announcement />
        <BioOffer />
        <header className="safe-top sticky top-0 z-30 border-b border-line/70 bg-bg/80 backdrop-blur-md">
          <div className="mx-auto flex h-16 max-w-6xl items-center justify-between gap-2 px-3 sm:gap-3 sm:px-6">
            <div className="flex min-w-0 items-center gap-1">
              {loc.pathname !== '/app' && <BackButton />}
              <div className="flex items-center gap-2 lg:hidden">
                <button onClick={() => setMenu(true)} className="rounded-xl p-2.5 text-muted hover:bg-sunk" aria-label={t.common.menu}>
                  <Menu className="h-5 w-5" />
                </button>
                <Logo className="h-8 w-8" />
              </div>
              <div className="hidden text-sm text-muted lg:block">
                {t.home.hello}
                {lang === 'ar' ? '، ' : ', '}
                <span className="font-medium text-ink">{user?.full_name?.split(' ')[0]}</span>
              </div>
            </div>
            <div className="flex shrink-0 items-center gap-0.5 sm:gap-1">
              {/* Small phones: language and theme live in the side menu to keep the bar uncluttered. */}
              <div className="hidden sm:block">
                <TopControls />
              </div>
              <MessagesButton />
              <Notifications />
              <button
                onClick={signOut}
                className="rounded-xl p-2.5 text-muted transition hover:bg-stitch/10 hover:text-stitch active:scale-95"
                aria-label={t.common.signOut}
                title={t.common.signOut}
              >
                <LogOut className="h-5 w-5 flip-rtl" />
              </button>
              <NavLink to="/app/settings" className="ms-1 flex items-center gap-2 rounded-full" aria-label={t.nav.settings}>
                <RoleBadge className="hidden sm:inline-flex" />
                <span className="relative">
                  <Avatar name={user?.full_name} src={user?.profile_image} size={36} />
                  <RoleBadge compact className="absolute -bottom-1 -end-1 !px-1 !py-0.5 ring-2 ring-bg sm:hidden" />
                </span>
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
      <nav className="pointer-events-none fixed inset-x-0 bottom-0 z-40 px-3 pb-[calc(env(safe-area-inset-bottom)+10px)] lg:hidden" aria-label="Tabs">
        <div className="pointer-events-auto relative mx-auto grid h-[66px] max-w-md grid-cols-5 items-center rounded-[26px] border border-line/80 bg-surface/90 px-1 shadow-[0_14px_40px_-14px_rgba(0,0,0,0.45)] backdrop-blur-xl">
          {bottom.slice(0, 2).map((i) => (
            <TabLink key={i.to} item={i} />
          ))}
          <div className="grid place-items-center">
            <NavLink
              to="/app/scan"
              aria-label={t.nav.scan}
              className="group relative -mt-9 grid h-[62px] w-[62px] place-items-center rounded-full bg-stitch text-white shadow-lg shadow-stitch/40 ring-[5px] ring-bg transition duration-200 active:scale-90"
            >
              <span className="absolute inset-[5px] rounded-full border-2 border-dashed border-current opacity-30 motion-safe:animate-[spin_16s_linear_infinite]" />
              <ScanLine className="relative h-7 w-7 transition duration-300 group-hover:scale-110 group-active:rotate-12" />
            </NavLink>
          </div>
          {bottom.slice(3).map((i) => (
            <TabLink key={i.to} item={i} />
          ))}
          <button onClick={() => setMenu(true)} className="group flex h-full flex-col items-center justify-center gap-1 text-[11px] text-muted transition active:scale-95">
            <Menu className="h-[22px] w-[22px] transition group-hover:scale-110" strokeWidth={1.8} />
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
                  <Avatar name={user?.full_name} src={user?.profile_image} />
                  <div className="min-w-0">
                    <p className="truncate font-medium">{user?.full_name}</p>
                    <p className="truncate text-xs text-muted">{user?.email}</p>
                    <RoleBadge className="mt-1.5" />
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
    <NavLink to={item.to} end={item.end} className="relative flex h-full min-w-0 flex-col items-center justify-center gap-1 px-0.5 text-[11px] leading-tight">
      {({ isActive }) => (
        <>
          {isActive && <motion.span layoutId="tab-pill" className="absolute inset-x-1 inset-y-1.5 rounded-[20px] bg-stitch/15" transition={{ type: 'spring', bounce: 0.3, duration: 0.5 }} />}
          <motion.span
            className={cx('relative', isActive ? 'text-stitch' : 'text-muted')}
            animate={isActive ? { y: -1, scale: 1.12 } : { y: 0, scale: 1 }}
            transition={{ type: 'spring', stiffness: 520, damping: 17 }}
          >
            <item.icon className="h-[22px] w-[22px] shrink-0" strokeWidth={isActive ? 2.3 : 1.8} />
          </motion.span>
          <span className={cx('relative max-w-full truncate transition', isActive ? 'font-semibold text-stitch' : 'text-muted')}>{item.label}</span>
        </>
      )}
    </NavLink>
  );
}
