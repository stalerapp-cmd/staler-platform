import { AnimatePresence, motion } from 'framer-motion';
import { Suspense, useEffect, useState, type ReactNode } from 'react';
import { NavLink, Outlet, useLocation, useNavigate } from 'react-router-dom';
import {
  ArrowLeft,
  ArrowRightLeft,
  Bell,
  ChevronDown,
  LifeBuoy,
  Mail,
  MessageCircle,
  PanelLeftClose,
  PanelLeftOpen,
  BookText,
  FileClock,
  Home,
  KeyRound,
  Landmark,
  LayoutDashboard,
  LogOut,
  Menu,
  QrCode,
  ScanLine,
  Settings2,
  ShieldCheck,
  Users,
  Vault,
  Wallet,
  X,
  Crown,
} from 'lucide-react';
import { usePerm } from '../lib/perm';
import { RoleBadge } from '../components/RoleBadge';
import { BioOffer } from '../components/AppLock';
import { useAuth } from '../lib/auth';
import { useI18n } from '../lib/i18n';
import { get, post } from '../lib/api';
import { usePolling } from '../lib/hooks';
import { relative } from '../lib/format';
import { localize, type Notice } from '../lib/notifications';
import { Emblem, Guilloche } from '../components/Guilloche';
import { usePublicConfig } from '../lib/config';
import { Avatar, Sheet, cx } from '../components/ui';
import { ErrorBoundary, PageSpinner } from '../components/Boundary';
import { useConfirm } from '../components/Confirm';
import { PrefsPill } from '../components/Fun';

interface NavItem {
  to: string;
  label: string;
  icon: typeof Home;
  end?: boolean;
  perm?: string;
}
interface NavGroup {
  id: string;
  label: string;
  items: NavItem[];
}
const readLS = (k: string) => {
  try {
    return localStorage.getItem(k);
  } catch {
    return null;
  }
};
const writeLS = (k: string, v: string) => {
  try {
    localStorage.setItem(k, v);
  } catch {
    /* private mode */
  }
};

function useNav() {
  const { t } = useI18n();
  const { user } = useAuth();
  const { can } = usePerm();
  const quick: NavItem[] = [
    { to: '/app/transfer', label: t.nav.transfer, icon: ArrowRightLeft },
    { to: '/app/requests', label: t.nav.requests, icon: QrCode },
    { to: '/app/scan', label: t.nav.scan, icon: ScanLine },
  ];
  const groups: NavGroup[] = [
    {
      id: 'banking',
      label: t.navg.banking,
      items: [
        { to: '/app', label: t.nav.overview, icon: Home, end: true },
        { to: '/app/transactions', label: t.nav.transactions, icon: BookText },
      ],
    },
    {
      id: 'connect',
      label: t.navg.connect,
      items: [
        { to: '/app/wallet', label: t.nav.wallet, icon: Wallet },
        { to: '/app/apps', label: t.nav.apps, icon: KeyRound },
      ],
    },
  ];
  if (user?.role === 'admin') {
    groups.unshift({
      id: 'admin',
      label: t.navg.admin,
      items: [
        { to: '/app/admin', label: t.nav.admin, icon: LayoutDashboard, end: true },
        ...([
          { to: '/app/admin/customers', label: t.nav.customers, icon: Users, perm: 'customers.view' },
          { to: '/app/admin/ledger', label: t.nav.ledger, icon: Landmark, perm: 'ledger.view' },
          { to: '/app/admin/exchange', label: t.nav.exchange, icon: Vault, perm: 'exchange.view' },
          { to: '/app/admin/audit', label: t.nav.audit, icon: FileClock, perm: 'audit.view' },
          { to: '/app/admin/settings', label: t.nav.system, icon: ShieldCheck, perm: 'settings.manage' },
          { to: '/app/admin/admins', label: t.people.admins, icon: Crown, perm: 'admins.manage' },
        ] as NavItem[]).filter((i) => can(i.perm!)),
      ],
    });
  }
  return { quick, groups, settings: { to: '/app/settings', label: t.nav.settings, icon: Settings2 } as NavItem };
}

function SideLink({ item, onClick, animated = true, rail = false }: { item: NavItem; onClick?: () => void; animated?: boolean; rail?: boolean }) {
  return (
    <NavLink
      to={item.to}
      end={item.end}
      onClick={onClick}
      title={rail ? item.label : undefined}
      aria-label={rail ? item.label : undefined}
      className={({ isActive }) =>
        cx(
          'group relative flex items-center gap-3 rounded-xl py-1.5 text-[15px] transition active:scale-[0.97]',
          rail ? 'justify-center' : 'px-2',
          isActive ? (animated ? 'text-ink' : 'bg-sunk font-medium text-ink') : 'text-muted hover:bg-sunk hover:text-ink',
        )
      }
    >
      {({ isActive }) => (
        <>
          {isActive && animated && <motion.span layoutId="side-active" className="absolute inset-0 rounded-xl bg-sunk" transition={{ type: 'spring', bounce: 0.15, duration: 0.45 }} />}
          <span
            className={cx(
              'relative grid h-8 w-8 shrink-0 place-items-center rounded-[10px] transition duration-300',
              isActive ? 'bg-gold text-night shadow-sm shadow-gold/30' : 'group-hover:-rotate-6 group-hover:scale-110 group-hover:text-gold',
            )}
          >
            <item.icon className="h-[18px] w-[18px]" strokeWidth={isActive ? 2.2 : 1.8} />
          </span>
          {!rail && <span className="relative truncate">{item.label}</span>}
        </>
      )}
    </NavLink>
  );
}

function QuickTiles({ items, onClick, rail }: { items: NavItem[]; onClick?: () => void; rail?: boolean }) {
  return (
    <div className={cx('mb-3 grid gap-2', rail ? 'grid-cols-1' : 'grid-cols-3')}>
      {items.map((i, n) => (
        <NavLink
          key={i.to}
          to={i.to}
          onClick={onClick}
          title={rail ? i.label : undefined}
          aria-label={i.label}
          className={({ isActive }) =>
            cx(
              'group relative flex flex-col items-center justify-center gap-1 overflow-hidden rounded-2xl text-xs font-medium transition active:scale-95',
              rail ? 'h-12' : 'h-[70px]',
              isActive ? 'bg-gold text-night shadow-md shadow-gold/30' : n === 0 ? 'bg-night text-[#F3DDA6] dark:bg-white/10' : 'bg-sunk text-ink hover:bg-line/70',
            )
          }
        >
          <span className="pointer-events-none absolute inset-[4px] rounded-[13px] border border-dashed border-current opacity-25" />
          <i.icon className="h-5 w-5 transition duration-300 group-hover:-translate-y-0.5 group-hover:scale-110" strokeWidth={1.9} />
          {!rail && <span>{i.label}</span>}
        </NavLink>
      ))}
    </div>
  );
}

function Group({ g, onClick, animated, rail }: { g: NavGroup; onClick?: () => void; animated: boolean; rail: boolean }) {
  const loc = useLocation();
  const holdsActive = g.items.some((i) => (i.end ? loc.pathname === i.to : loc.pathname.startsWith(i.to)));
  const [open, setOpen] = useState(() => readLS(`tb.nav.${g.id}`) !== '0');
  const shown = rail || open || holdsActive;
  if (!g.items.length) return null;
  return (
    <div className="mb-1.5">
      {rail ? (
        <div className="mx-3 my-2 border-t border-dashed border-line" />
      ) : (
        <button
          type="button"
          onClick={() => {
            writeLS(`tb.nav.${g.id}`, open ? '0' : '1');
            setOpen(!open);
          }}
          aria-expanded={shown}
          className="flex w-full items-center justify-between rounded-lg px-2 pb-1 pt-2.5 text-[12px] font-semibold text-muted/90 transition hover:text-ink"
        >
          <span className="flex items-center gap-2">
            <span className="h-1.5 w-1.5 rounded-full bg-gold" />
            {g.label}
          </span>
          <ChevronDown className={cx('h-4 w-4 transition-transform duration-300', shown ? 'rotate-0' : 'ltr:-rotate-90 rtl:rotate-90')} />
        </button>
      )}
      <AnimatePresence initial={false}>
        {shown && (
          <motion.div initial={{ height: 0, opacity: 0 }} animate={{ height: 'auto', opacity: 1 }} exit={{ height: 0, opacity: 0 }} transition={{ duration: 0.25 }} className="flex flex-col gap-0.5 overflow-hidden">
            {g.items.map((i) => (
              <SideLink key={i.to} item={i} onClick={onClick} animated={animated} rail={rail} />
            ))}
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

/** Support: e-mail, or the support chat in the S-Taler wallet. */
function SupportSheet({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { t } = useI18n();
  const cfg = usePublicConfig();
  const mail = (cfg?.supportEmail as string | null) ?? null;
  const items = [
    ...(mail ? [{ href: `mailto:${mail}?subject=TalerBank`, icon: Mail, title: t.navg.emailUs, d: `${t.navg.emailD} ${mail}`, c: 'bg-night text-[#F3DDA6]' }] : []),
    { href: 'https://s-taler.onrender.com/app/messages?support=1', icon: MessageCircle, title: t.navg.chatStaler, d: t.navg.chatStalerD, c: 'bg-olive text-white' },
  ];
  return (
    <Sheet open={open} onClose={onClose} title={t.navg.support}>
      <p className="mb-4 text-muted">{t.navg.supportLead}</p>
      <div className="space-y-3">
        {items.map((i, n) => (
          <motion.a
            key={i.href}
            href={i.href}
            target="_blank"
            rel="noopener noreferrer"
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: n * 0.06 }}
            className="framed flex items-center gap-4 rounded-2xl bg-sunk/60 p-4 transition hover:bg-sunk"
          >
            <span className={cx('grid h-12 w-12 shrink-0 place-items-center rounded-2xl', i.c)}>
              <i.icon className="h-6 w-6" />
            </span>
            <span className="min-w-0">
              <span className="block font-semibold">{i.title}</span>
              <span className="block break-words text-sm text-muted">{i.d}</span>
            </span>
          </motion.a>
        ))}
      </div>
    </Sheet>
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
        className="hbtn relative text-muted hover:bg-sunk hover:text-ink"
        aria-label={t.nav.notifications}
      >
        <Bell className="h-[19px] w-[19px]" />
        {!!data?.unread && (
          <motion.span initial={{ scale: 0 }} animate={{ scale: 1 }} className="absolute -end-0.5 -top-0.5 grid h-4 min-w-4 place-items-center rounded-full bg-gold px-1 text-[10px] font-bold text-night">
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

export function TopControls({ onDark = false }: { onDark?: boolean }) {
  return (
    <PrefsPill onDark={onDark} />
  );
}

export default function AppShell({ children }: { children?: ReactNode }) {
  const { user, logout } = useAuth();
  const { t } = useI18n();
  const { quick, groups, settings } = useNav();
  const loc = useLocation();
  const navigate = useNavigate();
  const [menu, setMenu] = useState(false);
  const [support, setSupport] = useState(false);
  const [rail, setRail] = useState(() => readLS('tb.rail') === '1');
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
    { to: '/app/transfer', label: t.nav.transfer, icon: ArrowRightLeft },
    { to: '/app/scan', label: t.nav.scan, icon: ScanLine },
    { to: '/app/transactions', label: t.nav.statementsTab, icon: BookText },
  ];

  const sidebar = (onClick?: () => void, animated = true, isRail = false) => (
    <nav className="flex h-full flex-col" aria-label="Main">
      <QuickTiles items={quick} onClick={onClick} rail={isRail} />
      {groups.map((g) => (
        <Group key={g.id} g={g} onClick={onClick} animated={animated} rail={isRail} />
      ))}
      <div className="mt-auto flex flex-col gap-0.5 border-t border-dashed border-line pt-3">
        <button
          onClick={() => {
            onClick?.();
            setSupport(true);
          }}
          title={isRail ? t.navg.support : undefined}
          className={cx('group flex items-center gap-3 rounded-xl py-1.5 text-[15px] text-olive transition hover:bg-olive/10', isRail ? 'justify-center' : 'px-2')}
        >
          <span className="grid h-8 w-8 place-items-center rounded-[10px] bg-olive/12 transition group-hover:rotate-12">
            <LifeBuoy className="h-[18px] w-[18px]" />
          </span>
          {!isRail && t.navg.support}
        </button>
        <SideLink item={settings} onClick={onClick} animated={animated} rail={isRail} />
        <button
          onClick={signOut}
          title={isRail ? t.common.signOut : undefined}
          className={cx('flex items-center gap-3 rounded-xl py-1.5 text-[15px] text-muted transition hover:bg-stitch/10 hover:text-stitch', isRail ? 'justify-center' : 'px-2')}
        >
          <span className="grid h-8 w-8 place-items-center">
            <LogOut className="h-[18px] w-[18px] flip-rtl" />
          </span>
          {!isRail && t.common.signOut}
        </button>
      </div>
    </nav>
  );

  return (
    <div className={cx('app-ground safe-x min-h-dvh lg:grid lg:transition-[grid-template-columns] lg:duration-300', rail ? 'lg:grid-cols-[84px_1fr]' : 'lg:grid-cols-[272px_1fr]')}>
      <aside className="sticky top-0 hidden h-dvh flex-col border-e border-line bg-surface/80 py-5 backdrop-blur lg:flex">
        <div className={cx('mb-5 flex items-center', rail ? 'flex-col gap-3 px-2' : 'justify-between px-5')}>
          <NavLink to="/app" className="flex items-center gap-3">
            <Emblem />
            {!rail && <span className="font-display text-2xl">TalerBank</span>}
          </NavLink>
          <button
            onClick={() => {
              writeLS('tb.rail', rail ? '0' : '1');
              setRail(!rail);
            }}
            className="grid h-9 w-9 place-items-center rounded-xl text-muted transition hover:bg-sunk hover:text-ink"
            aria-label={rail ? t.navg.expand : t.navg.collapse}
            title={rail ? t.navg.expand : t.navg.collapse}
          >
            {rail ? <PanelLeftOpen className="h-5 w-5 flip-rtl" /> : <PanelLeftClose className="h-5 w-5 flip-rtl" />}
          </button>
        </div>
        {!rail && <div className="mx-5 mb-3 h-px bg-[repeating-linear-gradient(90deg,rgb(var(--brass)/0.6)_0_6px,transparent_6px_10px)]" />}
        <div className={cx('no-scrollbar min-h-0 flex-1 overflow-y-auto overflow-x-hidden', rail ? 'px-3' : 'px-4')}>{sidebar(undefined, true, rail)}</div>
      </aside>

      <div className="min-w-0">
        <BioOffer />
        <header className="safe-top sticky top-0 z-30 bg-bg/85 backdrop-blur-md">
          <div className="mx-auto flex h-16 max-w-6xl items-center justify-between gap-2 px-3 sm:gap-3 sm:px-6">
            <div className="flex min-w-0 items-center gap-1.5">
              {loc.pathname !== '/app' && <BackButton />}
              <NavLink to="/app/settings" className="flex min-w-0 items-center gap-2.5 rounded-full bg-surface/80 py-1 pe-3 ps-1 shadow-sm ring-1 ring-line transition hover:ring-ink/25 active:scale-[0.98]" aria-label={t.nav.settings}>
                <span className="relative shrink-0 rounded-full ring-2 ring-gold/50">
                  <Avatar name={user?.full_name} size={38} />
                </span>
                <span className="min-w-0 leading-tight">
                  <span className="block text-[11px] text-muted">{t.navg.hello}</span>
                  <span className="block max-w-[34vw] truncate text-sm font-semibold sm:max-w-[220px]">{user?.full_name?.split(' ')[0]}</span>
                </span>
                <RoleBadge className="hidden md:inline-flex" />
              </NavLink>
            </div>
            <div className="flex shrink-0 items-center gap-2">
              <div className="hidden sm:block">
                <TopControls />
              </div>
              <div className="flex items-center gap-0.5 rounded-full bg-surface/80 p-0.5 shadow-sm ring-1 ring-line">
                <button onClick={() => setSupport(true)} className="hbtn text-olive hover:bg-olive/10" aria-label={t.navg.support} title={t.navg.support}>
                  <LifeBuoy className="h-[19px] w-[19px]" />
                </button>
                <Notifications />
                <button onClick={signOut} className="hbtn hidden text-muted hover:bg-stitch/10 hover:text-stitch sm:grid" aria-label={t.common.signOut} title={t.common.signOut}>
                  <LogOut className="h-[19px] w-[19px] flip-rtl" />
                </button>
              </div>
            </div>
          </div>
          {/* Engraved double rule along the bar's lower edge, like the border of a banknote. */}
          <div className="pointer-events-none absolute inset-x-0 bottom-0 h-[5px] border-y border-gold/25 bg-[repeating-linear-gradient(115deg,rgb(var(--brass)/0.35)_0_1px,transparent_1px_5px)]" aria-hidden="true" />
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
          <span className="pointer-events-none absolute inset-[4px] rounded-[22px] border border-dashed border-gold/30" aria-hidden="true" />
          {bottom.slice(0, 2).map((i) => (
            <TabLink key={i.to} item={i} />
          ))}
          <div className="grid place-items-center">
            <NavLink
              to="/app/scan"
              aria-label={t.nav.scan}
              className="group relative -mt-9 grid h-[62px] w-[62px] place-items-center rounded-full bg-gold text-night shadow-lg shadow-gold/40 ring-[5px] ring-bg transition duration-200 active:scale-90"
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

      <div className={cx('fixed inset-0 z-50 lg:hidden', !menu && 'pointer-events-none')} aria-hidden={!menu} {...((!menu ? { inert: '' } : {}) as any)}>
        <div className={cx('absolute inset-0 bg-night/55 backdrop-blur-[2px] transition-opacity duration-300', menu ? 'opacity-100' : 'opacity-0')} onClick={() => setMenu(false)} />
        <aside
          role="dialog"
          aria-modal="true"
          aria-label={t.common.menu}
          className={cx(
            'safe-bottom absolute inset-y-0 start-0 flex w-[86%] max-w-[340px] flex-col overflow-hidden bg-surface shadow-card transition-transform duration-300 ease-out will-change-transform ltr:rounded-r-[28px] rtl:rounded-l-[28px]',
            menu ? 'translate-x-0' : 'ltr:-translate-x-full rtl:translate-x-full',
          )}
        >
          <div className="note note-vault safe-top overflow-hidden px-5 pb-5 pt-4">
            <div className="pointer-events-none absolute -end-14 -top-10 h-44 w-44 opacity-60">
              <Guilloche className="h-full w-full" color="#E2C27A" draw={false} />
            </div>
            <div className="relative flex items-start justify-between">
              <NavLink to="/app/settings" onClick={() => setMenu(false)} className="flex min-w-0 items-center gap-3">
                <span className="rounded-full ring-2 ring-[#E2C27A]/60">
                  <Avatar name={user?.full_name} size={48} />
                </span>
                <div className="min-w-0">
                  <p className="truncate font-semibold text-[#FBF6EA]">{user?.full_name}</p>
                  <p className="truncate text-xs text-[#FBF6EA]/70">{user?.email}</p>
                  <RoleBadge onDark className="mt-1.5" />
                </div>
              </NavLink>
              <button onClick={() => setMenu(false)} className="rounded-xl p-2 text-[#FBF6EA]/80 hover:bg-white/10" aria-label={t.common.close}>
                <X className="h-5 w-5" />
              </button>
            </div>
            <div className="relative mt-3 flex justify-end sm:hidden">
              <TopControls onDark />
            </div>
          </div>
          <div className="min-h-0 flex-1 overflow-y-auto px-4 pb-6 pt-4">{sidebar(() => setMenu(false), false)}</div>
        </aside>
      </div>
      <SupportSheet open={support} onClose={() => setSupport(false)} />
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
    <NavLink to={item.to} end={item.end} className="relative flex h-full min-w-0 flex-col items-center justify-center gap-1 px-0.5 text-[11px] leading-tight transition active:scale-90">
      {({ isActive }) => (
        <>
          {isActive && <motion.span layoutId="tab-pill" className="absolute inset-x-1 inset-y-1.5 rounded-[20px] bg-gold/15" transition={{ type: 'spring', bounce: 0.3, duration: 0.5 }} />}
          <motion.span
            className={cx('relative', isActive ? 'text-gold' : 'text-muted')}
            animate={isActive ? { y: -1, scale: 1.12 } : { y: 0, scale: 1 }}
            transition={{ type: 'spring', stiffness: 520, damping: 17 }}
          >
            <item.icon className="h-[22px] w-[22px] shrink-0" strokeWidth={isActive ? 2.3 : 1.8} />
          </motion.span>
          <span className={cx('relative max-w-full truncate transition', isActive ? 'font-semibold text-gold' : 'text-muted')}>{item.label}</span>
        </>
      )}
    </NavLink>
  );
}
