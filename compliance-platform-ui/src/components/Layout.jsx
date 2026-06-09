import { Outlet, NavLink, useNavigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import {
  HomeIcon, FolderOpenIcon, ShieldCheckIcon,
  ArrowRightOnRectangleIcon, TableCellsIcon,
  ClipboardDocumentCheckIcon, Cog6ToothIcon, KeyIcon,
} from '@heroicons/react/24/outline';
import clsx from 'clsx';

const nav = [
  { label: 'Dashboard',    to: '/',                    icon: HomeIcon,                   exact: true },
  { label: 'Cases',        to: '/cases',               icon: FolderOpenIcon,             exact: false },
  { label: 'Tabletop',     to: '/tabletop',            icon: TableCellsIcon,             exact: false },
  { label: 'Compliance',   to: '/compliance',          icon: ClipboardDocumentCheckIcon, exact: false },
  { label: 'Key Inventory',to: '/key-inventory',       icon: KeyIcon,                    exact: false },
  { label: 'Org Settings', to: '/org-settings',        icon: Cog6ToothIcon,              exact: false },
];

export default function Layout() {
  const { user, logout } = useAuth();
  const navigate = useNavigate();

  async function handleLogout() {
    await logout();
    navigate('/login');
  }

  return (
    <div className="flex h-screen bg-gray-50">
      <aside className="w-56 flex flex-col bg-brand-900 text-white shrink-0">
        <div className="flex items-center gap-2 px-5 py-4 border-b border-brand-700">
          <ShieldCheckIcon className="h-6 w-6 text-brand-300" />
          <span className="font-semibold text-sm tracking-wide">Compliance Platform</span>
        </div>

        <nav className="flex-1 px-3 py-4 space-y-1 overflow-y-auto">
          {nav.map(({ label, to, icon: Icon, exact }) => (
            <NavLink key={to} to={to} end={exact}
              className={({ isActive }) => clsx(
                'flex items-center gap-3 px-3 py-2 rounded-md text-sm font-medium transition-colors',
                isActive
                  ? 'bg-brand-700 text-white'
                  : 'text-brand-200 hover:bg-brand-800 hover:text-white'
              )}>
              <Icon className="h-4 w-4" />
              {label}
            </NavLink>
          ))}
        </nav>

        <div className="px-3 py-4 border-t border-brand-700">
          <div className="px-3 mb-3">
            <p className="text-xs text-brand-300 truncate">{user?.email}</p>
            <p className="text-xs text-brand-400 capitalize">{user?.role?.replace('_', ' ')}</p>
          </div>
          <button onClick={handleLogout}
            className="flex w-full items-center gap-3 px-3 py-2 rounded-md text-sm
                       text-brand-200 hover:bg-brand-800 hover:text-white transition-colors">
            <ArrowRightOnRectangleIcon className="h-4 w-4" />
            Sign out
          </button>
        </div>
      </aside>

      <main className="flex-1 overflow-auto">
        <Outlet />
      </main>
    </div>
  );
}
