import { AnimatePresence, motion } from 'framer-motion';
import { useEffect, useState, type ReactNode } from 'react';
import { NavLink, Outlet, useLocation, useNavigate } from 'react-router-dom';
import {
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
import { useI18n } from '../lib/i18n';
import { useTheme } from '../lib/theme';
import { get, post } from '../lib/api';
import { usePolling } from '../lib/hooks';
import { relative } from '../lib/format';
import { Logo } from '../components/Tatreez';
import { Avatar, Sheet, cx } from '../components/ui';

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
    role.push(
      { to: '/app/admin', label: t.nav.overview, icon: LayoutDashboard, end: true },
      { to: '/app/admin/users', label: t.nav.users, icon: Users },
      { to: '/app/admin/stores', label: t.nav.stores, icon: Store },
      { to: '/app/admin/pending', label: t.nav.pending, icon: UserPlus },
      { to: '/app/admin/bank', label: t.nav.bankOps, icon: Landmark },
      { to: '/app/admin/audit', label: t.nav.audit, icon: FileClock },
      { to: '/app/admin/settings', label: t.nav.system, icon: ShieldCheck },
    );
  }
  return { main, role, settings: { to: '/app/settings', label: t.nav.settings, icon: Cog } as NavItem };
}

function SideLink({ item, onClick }: { item: NavItem; onClick?: () => void }) {
  return (
    <NavLink
      to={item.to}
      end={item.end}
      onClick={onClick}
      className={({ isActive }) =>
        cx('group relative flex items-center gap-3 rounded-xl px-3 py-2.5 text-[15px] transition', isActive ? 'text-ink' : 'text-muted hover:bg-sunk hover:text-ink')
      }
    >
      {({ isActive }) => (
        <>
          {isActive && <motion.span layoutId="side-active" className="absolute inset-0 rounded-xl bg-sunk" transition={{ type: 'spring', bounce: 0.15, duration: 0.45 }} />}
          {isActive && <motion.span layoutId="side-thread" className="absolute inset-y-2 start-0 w-1 rounded-full bg-stitch" />}
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
  const [data, setData] = useState<{ notifications: any[]; unread: number } | null>(null);
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
            {data.notifications.map((n) => (
              <li key={n.id} className="py-3">
                <p className="font-medium">{n.title}</p>
                {n.body && <p className="text-sm text-muted">{n.body}</p>}
                <p className="mt-1 text-xs text-muted">{relative(n.created_at, lang)}</p>
              </li>
            ))}
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
  useEffect(() => setMenu(false), [loc.pathname]);

  const bottom: NavItem[] = [
    { to: '/app', label: t.nav.home, icon: Home, end: true },
    { to: '/app/activity', label: t.nav.activity, icon: Activity },
    { to: '/app/scan', label: t.nav.scan, icon: ScanLine },
    { to: '/app/store', label: t.nav.store, icon: ShoppingBag },
  ];

  const sidebar = (onClick?: () => void) => (
    <nav className="flex h-full flex-col gap-1" aria-label="Main">
      {main.map((i) => (
        <SideLink key={i.to} item={i} onClick={onClick} />
      ))}
      {role.length > 0 && <div className="mx-3 my-3 border-t border-dashed border-line" />}
      {role.map((i) => (
        <SideLink key={i.to} item={i} onClick={onClick} />
      ))}
      <div className="mt-auto pt-4">
        <SideLink item={settings} onClick={onClick} />
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
    <div className="min-h-dvh lg:grid lg:grid-cols-[260px_1fr]">
      <aside className="sticky top-0 hidden h-dvh flex-col border-e border-line bg-surface/60 px-4 py-6 backdrop-blur lg:flex">
        <NavLink to="/app" className="mb-8 flex items-center gap-3 px-2">
          <Logo animate />
          <span className="font-display text-xl">S-Taler</span>
        </NavLink>
        <div className="min-h-0 flex-1 overflow-y-auto">{sidebar()}</div>
      </aside>

      <div className="min-w-0">
        <Announcement />
        <header className="safe-top sticky top-0 z-30 border-b border-line/70 bg-bg/80 backdrop-blur-md">
          <div className="mx-auto flex h-16 max-w-6xl items-center justify-between gap-3 px-4 sm:px-6">
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
            <div className="flex items-center gap-1">
              <TopControls />
              <Notifications />
              <NavLink to="/app/settings" className="ms-1 rounded-full" aria-label={t.nav.settings}>
                <Avatar name={user?.full_name} src={user?.profile_image} size={36} />
              </NavLink>
            </div>
          </div>
        </header>

        <main className="mx-auto max-w-6xl px-4 pb-32 pt-6 sm:px-6 lg:pb-12">
          <AnimatePresence mode="wait">
            <motion.div key={loc.pathname} initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -6 }} transition={{ duration: 0.22 }}>
              {children ?? <Outlet />}
            </motion.div>
          </AnimatePresence>
        </main>
      </div>

      {/* phone tab bar with the scan button raised in the middle */}
      <nav className="safe-bottom fixed inset-x-0 bottom-0 z-40 border-t border-line bg-surface/95 backdrop-blur lg:hidden" aria-label="Tabs">
        <div className="relative mx-auto grid h-16 max-w-md grid-cols-5 items-center">
          {bottom.slice(0, 2).map((i) => (
            <TabLink key={i.to} item={i} />
          ))}
          <div className="grid place-items-center">
            <NavLink to="/app/scan" aria-label={t.nav.scan} className="-mt-8 grid h-16 w-16 place-items-center rounded-2xl bg-stitch text-white shadow-card ring-4 ring-bg transition active:scale-95">
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

      <AnimatePresence>
        {menu && (
          <div className="fixed inset-0 z-50 lg:hidden">
            <motion.div className="absolute inset-0 bg-night/50" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} onClick={() => setMenu(false)} />
            <motion.aside
              initial={{ x: document.documentElement.dir === 'rtl' ? '100%' : '-100%' }}
              animate={{ x: 0 }}
              exit={{ x: document.documentElement.dir === 'rtl' ? '100%' : '-100%' }}
              transition={{ type: 'spring', bounce: 0.1, duration: 0.4 }}
              className="safe-top absolute inset-y-0 start-0 flex w-[82%] max-w-xs flex-col bg-surface px-4 py-5"
            >
              <div className="mb-6 flex items-center justify-between px-2">
                <div className="flex items-center gap-3">
                  <Avatar name={user?.full_name} src={user?.profile_image} />
                  <div className="min-w-0">
                    <p className="truncate font-medium">{user?.full_name}</p>
                    <p className="truncate text-xs text-muted">{user?.email}</p>
                  </div>
                </div>
                <button onClick={() => setMenu(false)} className="rounded-lg p-1.5 text-muted" aria-label={t.common.close}>
                  <X className="h-5 w-5" />
                </button>
              </div>
              <div className="min-h-0 flex-1 overflow-y-auto pb-6">{sidebar(() => setMenu(false))}</div>
            </motion.aside>
          </div>
        )}
      </AnimatePresence>
    </div>
  );
}

function TabLink({ item }: { item: NavItem }) {
  return (
    <NavLink to={item.to} end={item.end} className={({ isActive }) => cx('flex flex-col items-center gap-0.5 text-[11px] transition', isActive ? 'text-stitch' : 'text-muted')}>
      <item.icon className="h-5 w-5" />
      {item.label}
    </NavLink>
  );
}
