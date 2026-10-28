import { lazy, Suspense, type ReactNode } from 'react';
import { BrowserRouter, Navigate, Route, Routes, useLocation } from 'react-router-dom';
import { useAuth, type User } from './lib/auth';
import AppShell from './layouts/AppShell';
import { Logo } from './components/Tatreez';
import { Spinner } from './components/ui';
import Landing from './pages/Landing';
import { Forgot, Login, Register, Verify } from './pages/Auth';

const Home = lazy(() => import('./pages/Home'));
const Send = lazy(() => import('./pages/Send'));
const Receive = lazy(() => import('./pages/Receive'));
const Scan = lazy(() => import('./pages/Scan'));
const Claim = lazy(() => import('./pages/Claim'));
const Bank = lazy(() => import('./pages/Bank'));
const BankQr = lazy(() => import('./pages/Bank').then((m) => ({ default: m.BankQr })));
const Activity = lazy(() => import('./pages/Activity'));
const Store = lazy(() => import('./pages/Store'));
const Orders = lazy(() => import('./pages/Store').then((m) => ({ default: m.Orders })));
const Messages = lazy(() => import('./pages/Messages'));
const Settings = lazy(() => import('./pages/Settings'));
const Vouchers = lazy(() => import('./pages/Vouchers'));
const MerchantDashboard = lazy(() => import('./pages/Merchant').then((m) => ({ default: m.MerchantDashboard })));
const MerchantProducts = lazy(() => import('./pages/Merchant').then((m) => ({ default: m.MerchantProducts })));
const MerchantOrders = lazy(() => import('./pages/Merchant').then((m) => ({ default: m.MerchantOrders })));
const AdminOverview = lazy(() => import('./pages/Admin').then((m) => ({ default: m.AdminOverview })));
const AdminUsers = lazy(() => import('./pages/Admin').then((m) => ({ default: m.AdminUsers })));
const AdminUserDetail = lazy(() => import('./pages/Admin').then((m) => ({ default: m.AdminUserDetail })));
const AdminStores = lazy(() => import('./pages/Admin').then((m) => ({ default: m.AdminStores })));
const AdminPending = lazy(() => import('./pages/Admin').then((m) => ({ default: m.AdminPending })));
const AdminBankOps = lazy(() => import('./pages/Admin').then((m) => ({ default: m.AdminBankOps })));
const AdminAudit = lazy(() => import('./pages/Admin').then((m) => ({ default: m.AdminAudit })));
const AdminSettings = lazy(() => import('./pages/Admin').then((m) => ({ default: m.AdminSettings })));

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
    <BrowserRouter>
      <Routes>
        <Route path="/" element={<GuestOnly><Landing /></GuestOnly>} />
        <Route path="/login" element={<GuestOnly><Login /></GuestOnly>} />
        <Route path="/register" element={<GuestOnly><Register /></GuestOnly>} />
        <Route path="/verify" element={<GuestOnly><Verify /></GuestOnly>} />
        <Route path="/forgot" element={<GuestOnly><Forgot /></GuestOnly>} />
        <Route path="/store" element={page(<Store publicMode />)} />
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
          <Route path="messages" element={page(<Messages />)} />
          <Route path="messages/:id" element={page(<Messages />)} />
          <Route path="settings" element={page(<Settings />)} />
          <Route path="vouchers" element={<Private roles={['exchange']}>{page(<Vouchers />)}</Private>} />
          <Route path="merchant" element={<Private roles={['merchant']}>{page(<MerchantDashboard />)}</Private>} />
          <Route path="merchant/products" element={<Private roles={['merchant']}>{page(<MerchantProducts />)}</Private>} />
          <Route path="merchant/orders" element={<Private roles={['merchant']}>{page(<MerchantOrders />)}</Private>} />
          <Route path="admin" element={<Private roles={['admin']}>{page(<AdminOverview />)}</Private>} />
          <Route path="admin/users" element={<Private roles={['admin']}>{page(<AdminUsers />)}</Private>} />
          <Route path="admin/users/:id" element={<Private roles={['admin']}>{page(<AdminUserDetail />)}</Private>} />
          <Route path="admin/stores" element={<Private roles={['admin']}>{page(<AdminStores />)}</Private>} />
          <Route path="admin/pending" element={<Private roles={['admin']}>{page(<AdminPending />)}</Private>} />
          <Route path="admin/bank" element={<Private roles={['admin']}>{page(<AdminBankOps />)}</Private>} />
          <Route path="admin/audit" element={<Private roles={['admin']}>{page(<AdminAudit />)}</Private>} />
          <Route path="admin/settings" element={<Private roles={['admin']}>{page(<AdminSettings />)}</Private>} />
        </Route>
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </BrowserRouter>
  );
}
