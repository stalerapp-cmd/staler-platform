import { AnimatePresence, motion } from 'framer-motion';
import { Suspense, useEffect, useRef, useState, type ReactNode } from 'react';
import { NavLink, Outlet, useLocation, useNavigate } from 'react-router-dom';
import {
  Activity,
  ArrowLeft,
  Bell,
  Mail,
  ChevronDown,
  HandCoins,
  LifeBuoy,
  MapPin,
  PanelLeftClose,
  PanelLeftOpen,
  ClipboardList,
  Cog,
  Contact,
  Crown,
  FileClock,
  GitBranch,
  HelpCircle,
  Home,
  Landmark,
  LayoutDashboard,
  LogOut,
  Megaphone,
  Menu,
  MessageCircle,
  Package,
  QrCode,
  Scale,
  ScanLine,
  Send,
  ShieldCheck,
  ShoppingBag,
  Store,
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
import { get, post } from '../lib/api';
import { usePolling } from '../lib/hooks';
import { relative } from '../lib/format';
import { localize, targetOf, type Notice } from '../lib/notifications';
import { useToast } from '../components/Toast';
import { Logo, StitchBand } from '../components/Tatreez';
import { Avatar, Sheet, cx } from '../components/ui';
import { ErrorBoundary, PageSpinner } from '../components/Boundary';
import { useConfirm } from '../components/Confirm';
import { usePublicConfig } from '../lib/config';
import { PrefsPill } from '../components/Fun';

interface NavItem {
  to: string;
  label: string;
  icon: typeof Home;
  end?: boolean;
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
  const role = user?.role;
  const quick: NavItem[] = [
    { to: '/app/send', label: t.nav.send, icon: Send },
    { to: '/app/receive', label: t.nav.receive, icon: QrCode },
    { to: '/app/scan', label: t.nav.scan, icon: ScanLine },
  ];
  const groups: NavGroup[] = [
    {
      id: 'money',
      label: t.navg.money,
      items: [
        { to: '/app', label: t.nav.home, icon: Home, end: true },
        { to: '/app/activity', label: t.nav.activity, icon: Activity },
        { to: '/app/bank', label: t.nav.bank, icon: Landmark },
        ...(role === 'user' || role === 'merchant' ? [{ to: '/app/agents', label: t.nav.agents, icon: MapPin }] : []),
      ],
    },
    {
      id: 'shop',
      label: t.navg.shop,
      items: [
        { to: '/app/store', label: t.nav.store, icon: ShoppingBag },
        { to: '/app/stores', label: t.nav.stores, icon: Store },
        { to: '/app/orders', label: t.nav.orders, icon: ClipboardList },
      ],
    },
    {
      id: 'people',
      label: t.navg.people,
      items: [
        { to: '/app/messages', label: t.nav.messages, icon: MessageCircle },
        { to: '/app/contacts', label: t.nav.contacts, icon: Contact },
      ],
    },
  ];
  if (role === 'merchant') {
    groups.unshift({
      id: 'work',
      label: t.navg.work,
      items: [
        { to: '/app/merchant', label: t.nav.merchant, icon: LayoutDashboard, end: true },
        { to: '/app/merchant/products', label: t.nav.products, icon: Package },
        { to: '/app/merchant/orders', label: t.nav.storeOrders, icon: ClipboardList },
        { to: '/app/merchant/stores', label: t.nav.myStores, icon: GitBranch },
        { to: '/app/merchant/ads', label: t.nav.ads, icon: Megaphone },
        { to: '/app/merchant/pickup', label: t.nav.pickup, icon: MapPin },
      ],
    });
  }
  if (role === 'exchange') {
    groups.unshift({
      id: 'work',
      label: t.navg.work,
      items: [
        { to: '/app/agent', label: t.nav.agentDesk, icon: HandCoins },
        { to: '/app/vouchers', label: t.nav.vouchers, icon: Ticket },
        { to: '/app/agents', label: t.nav.agents, icon: MapPin },
      ],
    });
  }
  if (role === 'admin') {
    // Each admin sees only the sections their permissions open.
    const items: (NavItem & { perm?: string })[] = [
      { to: '/app/admin', label: t.nav.overview, icon: LayoutDashboard, end: true },
      { to: '/app/admin/users', label: t.nav.users, icon: Users, perm: 'users.view' },
      { to: '/app/admin/stores', label: t.nav.stores, icon: Store, perm: 'stores.manage' },
      { to: '/app/admin/disputes', label: t.nav.disputes, icon: Scale, perm: 'orders.disputes' },
      { to: '/app/admin/pending', label: t.nav.pending, icon: UserPlus, perm: 'pending.manage' },
      { to: '/app/admin/bank', label: t.nav.bankOps, icon: Landmark, perm: 'bank.ops' },
      { to: '/app/admin/audit', label: t.nav.audit, icon: FileClock, perm: 'audit.view' },
      { to: '/app/admin/settings', label: t.nav.system, icon: ShieldCheck, perm: 'settings.manage' },
      { to: '/app/admin/admins', label: t.people.admins, icon: Crown, perm: 'admins.manage' },
    ];
    groups.unshift({ id: 'admin', label: t.navg.admin, items: items.filter((i) => !i.perm || can(i.perm)) });
  }
  const footer: NavItem[] = [
    { to: '/app/help', label: t.nav.help, icon: HelpCircle },
    { to: '/app/settings', label: t.nav.settings, icon: Cog },
  ];
  return { quick, groups, footer };
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
          rail ? 'justify-center px-0' : 'px-2',
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
              isActive ? 'bg-stitch text-white shadow-sm shadow-stitch/30' : 'group-hover:-rotate-6 group-hover:scale-110 group-hover:text-stitch',
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

/** Send / Receive / Scan as three stitched tiles at the top of the menu. */
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
              isActive ? 'bg-stitch text-white shadow-md shadow-stitch/30' : n === 0 ? 'bg-night text-white dark:bg-white/10' : 'bg-sunk text-ink hover:bg-line/70',
            )
          }
        >
          <span className="pointer-events-none absolute inset-[4px] rounded-[13px] border border-dashed border-current opacity-20" />
          <i.icon className="h-5 w-5 transition duration-300 group-hover:-translate-y-0.5 group-hover:scale-110" strokeWidth={1.9} />
          {!rail && <span>{i.label}</span>}
        </NavLink>
      ))}
    </div>
  );
}

/** A titled, collapsible section. The section holding the current page always stays open. */
function Group({ g, onClick, animated, rail }: { g: NavGroup; onClick?: () => void; animated: boolean; rail: boolean }) {
  const loc = useLocation();
  const holdsActive = g.items.some((i) => (i.end ? loc.pathname === i.to : loc.pathname.startsWith(i.to)));
  const [open, setOpen] = useState(() => readLS(`st.nav.${g.id}`) !== '0');
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
            writeLS(`st.nav.${g.id}`, open ? '0' : '1');
            setOpen(!open);
          }}
          aria-expanded={shown}
          className="group flex w-full items-center justify-between rounded-lg px-2 pb-1 pt-2.5 text-[12px] font-semibold text-muted/90 transition hover:text-ink"
        >
          <span className="flex items-center gap-2">
            <span className="h-1.5 w-1.5 rotate-45 bg-stitch/70" />
            {g.label}
          </span>
          <ChevronDown className={cx('h-4 w-4 transition-transform duration-300', shown ? 'rotate-0' : 'ltr:-rotate-90 rtl:rotate-90')} />
        </button>
      )}
      <AnimatePresence initial={false}>
        {shown && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: 'auto', opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.25, ease: 'easeOut' }}
            className="flex flex-col gap-0.5 overflow-hidden"
          >
            {g.items.map((i) => (
              <SideLink key={i.to} item={i} onClick={onClick} animated={animated} rail={rail} />
            ))}
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

/** Opens (or reopens) the support chat in one tap. */
export function useOpenSupport() {
  const nav = useNavigate();
  const toast = useToast();
  const { err } = useI18n();
  return async () => {
    try {
      const r = await post('/api/messages/conversations', { type: 'support' });
      nav(`/app/messages/${r.conversationId}`);
    } catch (e) {
      toast(err(e), 'error');
    }
  };
}

/** Support: chat in the app, e-mail, or the how-it-works guide. */
function SupportSheet({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { t } = useI18n();
  const cfg = usePublicConfig();
  const openChat = useOpenSupport();
  const nav = useNavigate();
  const mail = (cfg?.supportEmail as string | null) ?? null;
  const items: { key: string; icon: typeof Home; title: string; d: string; c: string; run: () => void }[] = [
    { key: 'chat', icon: MessageCircle, title: t.navg.chat, d: t.navg.chatD, c: 'bg-olive text-white', run: () => (onClose(), void openChat()) },
    ...(mail ? [{ key: 'mail', icon: Mail, title: t.navg.emailUs, d: `${t.navg.emailD} ${mail}`, c: 'bg-night text-white dark:bg-white/15', run: () => window.open(`mailto:${mail}?subject=S-Taler`, '_blank') }] : []),
    { key: 'help', icon: HelpCircle, title: t.nav.help, d: t.navg.helpD, c: 'bg-gold text-night', run: () => (onClose(), nav('/app/help')) },
  ];
  return (
    <Sheet open={open} onClose={onClose} title={t.navg.support}>
      <p className="mb-4 text-muted">{t.navg.supportLead}</p>
      <div className="space-y-3">
        {items.map((i, n) => (
          <motion.button
            key={i.key}
            onClick={i.run}
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: n * 0.06 }}
            whileTap={{ scale: 0.97 }}
            className="sewn flex w-full items-center gap-4 rounded-2xl bg-sunk/60 p-4 text-start transition hover:bg-sunk"
          >
            <span className={cx('grid h-12 w-12 shrink-0 place-items-center rounded-2xl', i.c)}>
              <i.icon className="h-6 w-6" />
            </span>
            <span className="min-w-0">
              <span className="block font-semibold">{i.title}</span>
              <span className="block break-words text-sm text-muted">{i.d}</span>
            </span>
          </motion.button>
        ))}
      </div>
    </Sheet>
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
      className={({ isActive }) => cx('hbtn relative hover:bg-sunk hover:text-ink', isActive ? 'text-ink' : 'text-muted')}
      aria-label={t.nav.messages}
    >
      <MessageCircle className="h-[19px] w-[19px]" />
      {unread > 0 && (
        <span className="absolute -end-0.5 -top-0.5 grid h-4 min-w-4 place-items-center rounded-full bg-stitch px-1 text-[10px] font-bold text-white">
          {unread > 9 ? '9+' : unread}
        </span>
      )}
    </NavLink>
  );
}

function Notifications() {
  const { t, lang } = useI18n();
  const toast = useToast();
  const nav = useNavigate();
  const [open, setOpen] = useState(false);
  const [data, setData] = useState<{ notifications: Notice[]; unread: number } | null>(null);
  const seen = useRef<string | null>(null);
  const load = async () => {
    try {
      const d = await get<{ notifications: Notice[]; unread: number }>('/api/notifications');
      // Something new arrived while the app is open: show it right away.
      const newest = d.notifications[0];
      if (seen.current && newest && newest.id !== seen.current && !newest.is_read) toast(localize(newest, lang).title);
      seen.current = newest?.id ?? '';
      setData(d);
    } catch {
      /* offline */
    }
  };
  useEffect(() => void load(), []);
  usePolling(load, 15_000);
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
          <motion.span initial={{ scale: 0 }} animate={{ scale: 1 }} className="absolute -end-0.5 -top-0.5 grid h-4 min-w-4 place-items-center rounded-full bg-stitch px-1 text-[10px] font-bold text-white">
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
                <li key={n.id}>
                  <button
                    onClick={() => {
                      const to = targetOf(n);
                      if (to) {
                        setOpen(false);
                        nav(to);
                      }
                    }}
                    className="flex w-full gap-3 rounded-xl px-1 py-3 text-start transition hover:bg-sunk"
                  >
                    <span className={cx('mt-2 h-2 w-2 shrink-0 rounded-full', n.is_read ? 'bg-transparent' : 'bg-stitch')} aria-hidden="true" />
                    <div className="min-w-0 flex-1">
                      <p className="font-medium">{l.title}</p>
                      {l.body && <p className="break-words text-sm text-muted">{l.body}</p>}
                      <p className="mt-1 text-xs text-muted">{relative(n.created_at, lang)}</p>
                    </div>
                  </button>
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
  const { quick, groups, footer } = useNav();
  const loc = useLocation();
  const navigate = useNavigate();
  const [menu, setMenu] = useState(false);
  // Desktop: the side menu can fold into a slim icon rail; the choice is remembered.
  const [rail, setRail] = useState(() => readLS('st.rail') === '1');
  const toggleRail = () => {
    writeLS('st.rail', rail ? '0' : '1');
    setRail(!rail);
  };
  const confirm = useConfirm();
  const [support, setSupport] = useState(false);
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
    user?.role === 'exchange' ? { to: '/app/agent', label: t.nav.agentDesk, icon: HandCoins } : { to: '/app/store', label: t.nav.store, icon: ShoppingBag },
  ];

  const sidebar = (onClick?: () => void, animated = true, isRail = false) => (
    <nav className="flex h-full flex-col" aria-label="Main">
      {user?.role !== 'admin' && <QuickTiles items={quick} onClick={onClick} rail={isRail} />}
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
        {footer.map((i) => (
          <SideLink key={i.to} item={i} onClick={onClick} animated={animated} rail={isRail} />
        ))}
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
    <div
      className={cx('app-ground safe-x min-h-dvh lg:grid lg:transition-[grid-template-columns] lg:duration-300', rail ? 'lg:grid-cols-[84px_1fr]' : 'lg:grid-cols-[272px_1fr]')}
    >
      <aside className="sticky top-0 hidden h-dvh flex-col border-e border-line bg-surface/80 py-5 backdrop-blur lg:flex">
        <div className={cx('mb-5 flex items-center', rail ? 'flex-col gap-3 px-2' : 'justify-between px-5')}>
          <NavLink to="/app" className="flex items-center gap-3">
            <Logo animate />
            {!rail && <span className="font-display text-xl">S-Taler</span>}
          </NavLink>
          <button
            onClick={toggleRail}
            className="grid h-9 w-9 place-items-center rounded-xl text-muted transition hover:bg-sunk hover:text-ink"
            aria-label={rail ? t.navg.expand : t.navg.collapse}
            title={rail ? t.navg.expand : t.navg.collapse}
          >
            {rail ? <PanelLeftOpen className="h-5 w-5 flip-rtl" /> : <PanelLeftClose className="h-5 w-5 flip-rtl" />}
          </button>
        </div>
        {!rail && <StitchBand width={44} className="mx-5 mb-3 h-3.5 opacity-70" colors={['rgb(var(--stitch))', 'rgb(var(--gold))']} />}
        <div className={cx('no-scrollbar min-h-0 flex-1 overflow-y-auto overflow-x-hidden', rail ? 'px-3' : 'px-4')}>{sidebar(undefined, true, rail)}</div>
      </aside>

      <div className="min-w-0">
        <Announcement />
        <BioOffer />
        <header className="safe-top sticky top-0 z-30 bg-bg/85 backdrop-blur-md">
          <div className="mx-auto flex h-16 max-w-6xl items-center justify-between gap-2 px-3 sm:gap-3 sm:px-6">
            <div className="flex min-w-0 items-center gap-1.5">
              {loc.pathname !== '/app' && <BackButton />}
              <NavLink to="/app/settings" className="flex min-w-0 items-center gap-2.5 rounded-full bg-surface/80 py-1 pe-3 ps-1 shadow-sm ring-1 ring-line transition hover:ring-ink/25 active:scale-[0.98]" aria-label={t.nav.settings}>
                <span className="relative shrink-0">
                  <Avatar name={user?.full_name} src={user?.profile_image} size={38} />
                  <span className="absolute -bottom-0.5 -end-0.5 h-3 w-3 rounded-full bg-olive ring-2 ring-bg" />
                </span>
                <span className="min-w-0 leading-tight">
                  <span className="block truncate text-[11px] text-muted">
                    {t.home.hello}
                    {lang === 'ar' ? '' : ','}
                  </span>
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
                <button onClick={() => setSupport(true)} className="hbtn hidden text-olive hover:bg-olive/10 sm:grid" aria-label={t.navg.support} title={t.navg.support}>
                  <LifeBuoy className="h-[19px] w-[19px]" />
                </button>
                <MessagesButton />
                <Notifications />
                <button onClick={signOut} className="hbtn hidden text-muted hover:bg-stitch/10 hover:text-stitch sm:grid" aria-label={t.common.signOut} title={t.common.signOut}>
                  <LogOut className="h-[19px] w-[19px] flip-rtl" />
                </button>
              </div>
            </div>
          </div>
          {/* A row of cross-stitch along the bar's lower edge, sewn in once when the app opens. */}
          <StitchBand width={160} cell={4} className="pointer-events-none absolute inset-x-0 -bottom-[5px] h-[10px] w-full opacity-60" colors={['rgb(var(--stitch))', 'rgb(var(--gold))']} />
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
          <span className="pointer-events-none absolute inset-[4px] rounded-[22px] border border-dashed border-stitch/20" aria-hidden="true" />
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

      {/* Side menu (phones/tablets): always mounted and driven by CSS, so it can always be opened again
          and never leaves an invisible layer over the app. */}
      <div className={cx('fixed inset-0 z-50 lg:hidden', !menu && 'pointer-events-none')} aria-hidden={!menu} {...((!menu ? { inert: '' } : {}) as any)}>
        <div className={cx('absolute inset-0 bg-night/50 backdrop-blur-[2px] transition-opacity duration-300', menu ? 'opacity-100' : 'opacity-0')} onClick={() => setMenu(false)} />
        <aside
          role="dialog"
          aria-modal="true"
          aria-label={t.common.menu}
          className={cx(
            'safe-bottom absolute inset-y-0 start-0 flex w-[86%] max-w-[340px] flex-col overflow-hidden bg-surface shadow-card transition-transform duration-300 ease-out will-change-transform ltr:rounded-r-[28px] rtl:rounded-l-[28px]',
            menu ? 'translate-x-0' : 'ltr:-translate-x-full rtl:translate-x-full',
          )}
        >
          <div className="cloth cloth-night safe-top px-5 pb-5 pt-4">
            <div className="flex items-start justify-between">
              <NavLink to="/app/settings" onClick={() => setMenu(false)} className="flex min-w-0 items-center gap-3">
                <span className="rounded-full ring-2 ring-white/40">
                  <Avatar name={user?.full_name} src={user?.profile_image} size={48} />
                </span>
                <div className="min-w-0">
                  <p className="truncate font-semibold text-white">{user?.full_name}</p>
                  <p className="truncate text-xs text-white/70">{user?.email}</p>
                  <RoleBadge onDark className="mt-1.5" />
                </div>
              </NavLink>
              <button onClick={() => setMenu(false)} className="rounded-xl p-2 text-white/80 hover:bg-white/10" aria-label={t.common.close}>
                <X className="h-5 w-5" />
              </button>
            </div>
            <div className="mt-3 flex justify-end sm:hidden">
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
export function BackButton() {
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
