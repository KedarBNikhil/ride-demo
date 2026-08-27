import { Navigate, Route, Routes } from 'react-router-dom';
import { useAuth } from '@/auth/AuthContext';
import { DashboardLayout } from '@/layout/DashboardLayout';
import { LoginPage } from '@/pages/LoginPage';
import { OverviewPage } from '@/pages/OverviewPage';
import { CustomersPage } from '@/pages/customers/CustomersPage';
import { CustomerDetailPage } from '@/pages/customers/CustomerDetailPage';
import { CaptainsPage } from '@/pages/captains/CaptainsPage';
import { CaptainDetailPage } from '@/pages/captains/CaptainDetailPage';
import { PaymentsPage } from '@/pages/PaymentsPage';
import { FraudPage } from '@/pages/FraudPage';
import { CaptainSettlementsPage } from '@/pages/CaptainSettlementsPage';
import { Card } from '@/components/ui';
import { isSupabaseConfigured } from '@/lib/supabase';

function ConfigMissing() {
  return (
    <div className="flex min-h-screen items-center justify-center px-4">
      <Card className="max-w-md p-6 text-sm text-slate-600">
        <h1 className="mb-2 text-base font-bold text-slate-900">Supabase not configured</h1>
        <p>
          Copy <code className="rounded bg-slate-100 px-1">dashboard/.env.example</code> to{' '}
          <code className="rounded bg-slate-100 px-1">dashboard/.env.local</code> and set{' '}
          <code className="rounded bg-slate-100 px-1">VITE_SUPABASE_URL</code> and{' '}
          <code className="rounded bg-slate-100 px-1">VITE_SUPABASE_PUBLISHABLE_KEY</code> (same values the mobile apps
          use in the root <code className="rounded bg-slate-100 px-1">.env.local</code>), then restart the dev server.
        </p>
      </Card>
    </div>
  );
}

function NotAuthorized() {
  const { signOut } = useAuth();
  return (
    <div className="flex min-h-screen items-center justify-center px-4">
      <Card className="max-w-md p-6 text-center">
        <div className="mx-auto mb-3 flex h-10 w-10 items-center justify-center rounded-full bg-rose-100 text-lg">⛔</div>
        <h1 className="text-base font-bold text-slate-900">Not an operator account</h1>
        <p className="mt-2 text-sm text-slate-500">
          This dashboard is limited to settlement operators. Ask an administrator to add your profile id to{' '}
          <code className="rounded bg-slate-100 px-1">settlement_operators</code>.
        </p>
        <button
          onClick={() => void signOut()}
          className="mt-4 rounded-lg bg-indigo-600 px-4 py-2 text-sm font-semibold text-white hover:bg-indigo-500"
        >
          Sign out
        </button>
      </Card>
    </div>
  );
}

export default function App() {
  const { status } = useAuth();

  if (!isSupabaseConfigured) return <ConfigMissing />;

  if (status === 'loading') {
    return (
      <div className="flex min-h-screen items-center justify-center text-sm text-slate-500">
        Checking session…
      </div>
    );
  }

  if (status !== 'authorized') {
    return status === 'unauthorized' ? <NotAuthorized /> : <LoginPage />;
  }

  return (
    <Routes>
      <Route element={<DashboardLayout />} path="/">
        <Route index element={<OverviewPage />} />
        <Route path="customers" element={<CustomersPage />} />
        <Route path="customers/:customerId" element={<CustomerDetailPage />} />
        <Route path="captains" element={<CaptainsPage />} />
        <Route path="captains/:captainId" element={<CaptainDetailPage />} />
        <Route path="payments" element={<PaymentsPage />} />
        <Route path="captain-settlements" element={<CaptainSettlementsPage />} />
        <Route path="fraud" element={<FraudPage />} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Route>
    </Routes>
  );
}
