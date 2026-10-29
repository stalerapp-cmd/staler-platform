import { Suspense, type ReactNode } from 'react';
import { BrowserRouter, Navigate, Route, Routes, useLocation } from 'react-router-dom';
import { useAuth, type User } from './lib/auth';
import AppShell from './layouts/AppShell';
import { Logo } from './components/Tatreez';
import { Spinner } from './components/ui';
import { ErrorBoundary, lazyRetry } from './components/Boundary';
import { AppLock } from './components/AppLock';
import { PageScrollbar } from './components/Fun';
import Landing from './pages/Landing';
import { isNative } from './lib/api';
import { Forgot, Login, Register, Verify } from './pages/Auth';

const Home = lazyRetry(() => import('./pages/Home'));
const Send = lazyRetry(() => import('./pages/Send'));
const Receive = lazyRetry(() => import('./pages/Receive'));
const Scan = lazyRetry(() => import('./pages/Scan'));
const Claim = lazyRetry(() => import('./pages/Claim'));
const Bank = lazyRetry(() => import('./pages/Bank'));
const BankQr = lazyRetry(() => import('./pages/Bank').then((m) => ({ default: m.BankQr })));
const Activity = lazyRetry(() => import('./pages/Activity'));
const Store = lazyRetry(() => import('./pages/Store'));
const Orders = lazyRetry(() => import('./pages/Store').then((m) => ({ default: m.Orders })));
const Messages = lazyRetry(() => import('./pages/Messages'));
const Settings = lazyRetry(() => import('./pages/Settings'));
const Vouchers = lazyRetry(() => import('./pages/Vouchers'));
const MerchantDashboard = lazyRetry(() => import('./pages/Merchant').then((m) => ({ default: m.MerchantDashboard })));
const MerchantProducts = lazyRetry(() => import('./pages/Merchant').then((m) => ({ default: m.MerchantProducts })));
const MerchantOrders = lazyRetry(() => import('./pages/Merchant').then((m) => ({ default: m.MerchantOrders })));
const AdminOverview = lazyRetry(() => import('./pages/Admin').then((m) => ({ default: m.AdminOverview })));
const AdminUsers = lazyRetry(() => import('./pages/AdminPeople').then((m) => ({ default: m.AdminUsers })));
const AdminUserDetail = lazyRetry(() => import('./pages/AdminPeople').then((m) => ({ default: m.AdminUserDetail })));
const AdminAdmins = lazyRetry(() => import('./pages/AdminPeople').then((m) => ({ default: m.AdminAdmins })));
const AdminStores = lazyRetry(() => import('./pages/Admin').then((m) => ({ default: m.AdminStores })));
const AdminPending = lazyRetry(() => import('./pages/Admin').then((m) => ({ default: m.AdminPending })));
const AdminBankOps = lazyRetry(() => import('./pages/Admin').then((m) => ({ default: m.AdminBankOps })));
const AdminAudit = lazyRetry(() => import('./pages/Admin').then((m) => ({ default: m.AdminAudit })));
const AdminSettings = lazyRetry(() => import('./pages/Admin').then((m) => ({ default: m.AdminSettings })));
const AdminDisputes = lazyRetry(() => import('./pages/Admin').then((m) => ({ default: m.AdminDisputes })));
const StoresPage = lazyRetry(() => import('./pages/Stores'));
const StoresDirectory = lazyRetry(() => import('./pages/Stores').then((m) => ({ default: m.StoresDirectory })));
const StorePage = lazyRetry(() => import('./pages/StorePage'));
const AgentDesk = lazyRetry(() => import('./pages/Agent'));
const AgentsMap = lazyRetry(() => import('./pages/Agent').then((m) => ({ default: m.AgentsMap })));
const CashOutPay = lazyRetry(() => import('./pages/Agent').then((m) => ({ default: m.CashOutPay })));
const Contacts = lazyRetry(() => import('./pages/Contacts'));
const Help = lazyRetry(() => import('./pages/Help'));
const MerchantStores = lazyRetry(() => import('./pages/Merchant').then((m) => ({ default: m.MerchantStores })));
const MerchantPickup = lazyRetry(() => import('./pages/Merchant').then((m) => ({ default: m.MerchantPickup })));
const MerchantAds = lazyRetry(() => import('./pages/Merchant').then((m) => ({ default: m.MerchantAds })));

export function Splash() {
  return (
    <div className="grid min-h-dvh place-items-center bg-bg">
      <Logo className="h-16 w-16" animate />
    </div>
  );
}

/** Client-side guards are UX only — every API route enforces the same rules server-side. */
function Private({ children, roles }: { children: ReactNode; roles?: User['role'][] }) {
  const { user, ready } = useAuth();
  const loc = useLocation();
  if (!ready) return <Splash />;
  if (!user) return <Navigate to="/login" replace state={{ from: loc.pathname + loc.search }} />;
  if (roles && !roles.includes(user.role)) return <Navigate to="/app" replace />;
  return <>{children}</>;
}

function GuestOnly({ children }: { children: ReactNode }) {
  const { user, ready } = useAuth();
  if (!ready) return <Splash />;
  return user ? <Navigate to="/app" replace /> : <>{children}</>;
}

const page = (el: ReactNode) => (
  <Suspense
    fallback={
      <div className="grid h-64 place-items-center">
        <Spinner />
      </div>
    }
  >
    {el}
  </Suspense>
);

export default function App() {
  return (
    <ErrorBoundary full>
    <AppLock />
    <PageScrollbar />
    <BrowserRouter>
      <Routes>
        <Route path="/" element={isNative ? <Navigate to="/login" replace /> : <GuestOnly><Landing /></GuestOnly>} />
        <Route path="/login" element={<GuestOnly><Login /></GuestOnly>} />
        <Route path="/register" element={<GuestOnly><Register /></GuestOnly>} />
        <Route path="/verify" element={<GuestOnly><Verify /></GuestOnly>} />
        <Route path="/forgot" element={<GuestOnly><Forgot /></GuestOnly>} />
        <Route path="/store" element={page(<Store publicMode />)} />
        <Route path="/stores" element={page(<StoresPage />)} />
        <Route path="/s/:slug" element={page(<StorePage />)} />
        <Route path="/app" element={<Private><AppShell /></Private>}>
          <Route index element={page(<Home />)} />
          <Route path="send" element={page(<Send />)} />
          <Route path="receive" element={page(<Receive />)} />
          <Route path="scan" element={page(<Scan />)} />
          <Route path="claim" element={page(<Claim />)} />
          <Route path="bank" element={page(<Bank />)} />
          <Route path="bank/qr" element={page(<BankQr />)} />
          <Route path="activity" element={page(<Activity />)} />
          <Route path="store" element={page(<Store />)} />
          <Route path="orders" element={page(<Orders />)} />
          <Route path="stores" element={page(<StoresDirectory />)} />
          <Route path="contacts" element={page(<Contacts />)} />
          <Route path="help" element={page(<Help />)} />
          <Route path="messages" element={page(<Messages />)} />
          <Route path="messages/:id" element={page(<Messages />)} />
          <Route path="settings" element={page(<Settings />)} />
          <Route path="vouchers" element={<Private roles={['exchange']}>{page(<Vouchers />)}</Private>} />
          <Route path="agent" element={<Private roles={['exchange']}>{page(<AgentDesk />)}</Private>} />
          <Route path="agents" element={page(<AgentsMap />)} />
          <Route path="cashout" element={page(<CashOutPay />)} />
          <Route path="merchant" element={<Private roles={['merchant']}>{page(<MerchantDashboard />)}</Private>} />
          <Route path="merchant/products" element={<Private roles={['merchant']}>{page(<MerchantProducts />)}</Private>} />
          <Route path="merchant/orders" element={<Private roles={['merchant']}>{page(<MerchantOrders />)}</Private>} />
          <Route path="merchant/stores" element={<Private roles={['merchant']}>{page(<MerchantStores />)}</Private>} />
          <Route path="merchant/ads" element={<Private roles={['merchant']}>{page(<MerchantAds />)}</Private>} />
          <Route path="merchant/pickup" element={<Private roles={['merchant']}>{page(<MerchantPickup />)}</Private>} />
          <Route path="admin" element={<Private roles={['admin']}>{page(<AdminOverview />)}</Private>} />
          <Route path="admin/users" element={<Private roles={['admin']}>{page(<AdminUsers />)}</Private>} />
          <Route path="admin/users/:id" element={<Private roles={['admin']}>{page(<AdminUserDetail />)}</Private>} />
          <Route path="admin/stores" element={<Private roles={['admin']}>{page(<AdminStores />)}</Private>} />
          <Route path="admin/pending" element={<Private roles={['admin']}>{page(<AdminPending />)}</Private>} />
          <Route path="admin/bank" element={<Private roles={['admin']}>{page(<AdminBankOps />)}</Private>} />
          <Route path="admin/audit" element={<Private roles={['admin']}>{page(<AdminAudit />)}</Private>} />
          <Route path="admin/settings" element={<Private roles={['admin']}>{page(<AdminSettings />)}</Private>} />
          <Route path="admin/admins" element={<Private roles={['admin']}>{page(<AdminAdmins />)}</Private>} />
          <Route path="admin/disputes" element={<Private roles={['admin']}>{page(<AdminDisputes />)}</Private>} />
        </Route>
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </BrowserRouter>
    </ErrorBoundary>
  );
}
