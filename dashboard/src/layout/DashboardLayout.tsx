import { NavLink, Outlet, useNavigate } from 'react-router-dom';
import { useAuth } from '@/auth/AuthContext';
import { initialsOf } from '@/lib/format';

const navItems = [
  { to: '/', label: 'Overview', end: true },
  { to: '/customers', label: 'Customers' },
  { to: '/payments', label: 'Payments & Issues' },
  { to: '/fraud', label: 'Fraud Signals' },
  { to: '/system-health', label: 'System Health' },
];

const captainNavItems = [
  { to: '/captain-settlements', label: 'Settlements & daily payouts' },
  { to: '/captain-document-changes', label: 'Document changes' },
];

export function DashboardLayout() {
  const { signOut, phone } = useAuth();
  const navigate = useNavigate();

  return (
    <div className="flex min-h-screen">
      <aside className="fixed inset-y-0 left-0 z-10 flex w-60 flex-col bg-slate-900 text-slate-300">
        <div className="px-5 py-5">
          <div className="text-base font-bold tracking-tight text-white">Nandyal Ride</div>
          <div className="text-xs text-slate-400">Operator Dashboard</div>
        </div>
        <nav className="mt-2 flex-1 space-y-1 px-3">
          {navItems.slice(0, 2).map((item) => (
            <NavLink key={item.to} to={item.to} end={item.end} className={({ isActive }) => `block rounded-lg px-3 py-2 text-sm font-medium transition-colors ${isActive ? 'bg-indigo-600 text-white' : 'hover:bg-slate-800 hover:text-white'}`}>
              {item.label}
            </NavLink>
          ))}
          <div className="space-y-1">
            <NavLink to="/captains" end className={({ isActive }) => `block rounded-lg px-3 py-2 text-sm font-medium transition-colors ${isActive ? 'bg-indigo-600 text-white' : 'hover:bg-slate-800 hover:text-white'}`}>
              Captains
            </NavLink>
            <div className="ml-3 space-y-1 border-l border-slate-700 pl-2">
              {captainNavItems.map((item) => (
                <NavLink key={item.to} to={item.to} className={({ isActive }) => `block rounded-md px-2 py-1.5 text-xs font-medium transition-colors ${isActive ? 'bg-indigo-600 text-white' : 'text-slate-400 hover:bg-slate-800 hover:text-white'}`}>
                  {item.label}
                </NavLink>
              ))}
            </div>
          </div>
          {navItems.slice(2).map((item) => (
            <NavLink key={item.to} to={item.to} end={item.end} className={({ isActive }) => `block rounded-lg px-3 py-2 text-sm font-medium transition-colors ${isActive ? 'bg-indigo-600 text-white' : 'hover:bg-slate-800 hover:text-white'}`}>
              {item.label}
            </NavLink>
          ))}
        </nav>
        <div className="border-t border-slate-700 p-4">
          <div className="flex items-center gap-3">
            <div className="flex h-8 w-8 items-center justify-center rounded-full bg-slate-700 text-xs font-bold text-white">
              {initialsOf(phone ?? undefined, 'OP')}
            </div>
            <div className="min-w-0 flex-1">
              <div className="truncate text-xs text-slate-300">{phone ?? 'Operator'}</div>
              <button
                onClick={() => {
                  void signOut().then(() => navigate('/login'));
                }}
                className="text-xs font-medium text-rose-300 hover:text-rose-200"
              >
                Sign out
              </button>
            </div>
          </div>
        </div>
      </aside>
      <main className="ml-60 flex-1 p-8">
        <Outlet />
      </main>
    </div>
  );
}
