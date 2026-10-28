import { lazy, Suspense, type ReactNode } from 'react';
import { BrowserRouter, Navigate, Route, Routes, useLocation } from 'react-router-dom';
import { useAuth, type User } from './lib/auth';
import Shell from './layouts/Shell';
import { Guilloche } from './components/Guilloche';
import { Spinner } from './components/ui';
import { Forgot, Login, Register, Verify } from './pages/Auth';

const Overview = lazy(() => import('./pages/Overview'));
const Transfer = lazy(() => import('./pages/Transfer'));
const Transactions = lazy(() => import('./pages/Transactions'));
const Requests = lazy(() => import('./pages/Requests'));
const Pay = lazy(() => import('./pages/Requests').then((m) => ({ default: m.Pay })));
const Scan = lazy(() => import('./pages/Scan'));
const WalletWithdraw = lazy(() => import('./pages/WalletWithdraw'));
const Apps = lazy(() => import('./pages/Apps'));
const Settings = lazy(() => import('./pages/Settings'));
const AdminOverview = lazy(() => import('./pages/Admin').then((m) => ({ default: m.AdminOverview })));
const AdminCustomers = lazy(() => import('./pages/Admin').then((m) => ({ default: m.AdminCustomers })));
const AdminCustomer = lazy(() => import('./pages/Admin').then((m) => ({ default: m.AdminCustomer })));
const AdminLedger = lazy(() => import('./pages/Admin').then((m) => ({ default: m.AdminLedger })));
const AdminExchange = lazy(() => import('./pages/Admin').then((m) => ({ default: m.AdminExchange })));
const AdminAudit = lazy(() => import('./pages/Admin').then((m) => ({ default: m.AdminAudit })));
const AdminSettings = lazy(() => import('./pages/Admin').then((m) => ({ default: m.AdminSettings })));

export function Splash() {
  return (
    <div className="grid min-h-dvh place-items-center bg-bg">
      <Guilloche className="h-28 w-28" />
    </div>
  );
}

/** Client-side guards are UX only — the API enforces the same rules on every request. */
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
const admin = (el: ReactNode) => <Private roles={['admin']}>{page(el)}</Private>;

export default function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route path="/" element={<Navigate to="/login" replace />} />
        <Route path="/login" element={<GuestOnly><Login /></GuestOnly>} />
        <Route path="/register" element={<GuestOnly><Register /></GuestOnly>} />
        <Route path="/verify" element={<GuestOnly><Verify /></GuestOnly>} />
        <Route path="/forgot" element={<GuestOnly><Forgot /></GuestOnly>} />
        <Route path="/app" element={<Private><Shell /></Private>}>
          <Route index element={page(<Overview />)} />
          <Route path="transfer" element={page(<Transfer />)} />
          <Route path="transactions" element={page(<Transactions />)} />
          <Route path="requests" element={page(<Requests />)} />
          <Route path="pay/:id" element={page(<Pay />)} />
          <Route path="scan" element={page(<Scan />)} />
          <Route path="wallet" element={page(<WalletWithdraw />)} />
          <Route path="withdraw/:opId" element={page(<WalletWithdraw />)} />
          <Route path="apps" element={page(<Apps />)} />
          <Route path="settings" element={page(<Settings />)} />
          <Route path="admin" element={admin(<AdminOverview />)} />
          <Route path="admin/customers" element={admin(<AdminCustomers />)} />
          <Route path="admin/customers/:id" element={admin(<AdminCustomer />)} />
          <Route path="admin/ledger" element={admin(<AdminLedger />)} />
          <Route path="admin/exchange" element={admin(<AdminExchange />)} />
          <Route path="admin/audit" element={admin(<AdminAudit />)} />
          <Route path="admin/settings" element={admin(<AdminSettings />)} />
        </Route>
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </BrowserRouter>
  );
}
