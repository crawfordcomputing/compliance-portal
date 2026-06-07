import { useState, useEffect } from 'react';
import { Link } from 'react-router-dom';
import { casesApi } from '../api/client';
import { useAuth } from '../context/AuthContext';
import { formatDistanceToNow } from 'date-fns';
import {
  FolderOpenIcon, ExclamationTriangleIcon,
  ClockIcon, CheckCircleIcon,
} from '@heroicons/react/24/outline';
import clsx from 'clsx';

const CLASSIFICATION_COLORS = {
  breach:    'bg-red-100 text-red-700',
  suspected: 'bg-orange-100 text-orange-700',
  near_miss: 'bg-yellow-100 text-yellow-700',
  tabletop:  'bg-blue-100 text-blue-700',
};

const STATUS_COLORS = {
  open:      'bg-red-50 text-red-600',
  contained: 'bg-orange-50 text-orange-600',
  resolved:  'bg-green-50 text-green-700',
  closed:    'bg-gray-100 text-gray-500',
};

export default function Dashboard() {
  const { user } = useAuth();
  const [cases, setCases] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    casesApi.list().then(({ data }) => setCases(data)).finally(() => setLoading(false));
  }, []);

  const open      = cases.filter(c => c.status === 'open');
  const contained = cases.filter(c => c.status === 'contained');
  const overdue   = cases.filter(c => c.deadline_remaining_ms === 0 && c.status !== 'closed');
  const urgent    = cases.filter(c => c.deadline_remaining_ms > 0 && c.deadline_remaining_ms < 24 * 60 * 60 * 1000);

  const stats = [
    { label: 'Open Cases',      value: open.length,      icon: FolderOpenIcon,         color: 'text-red-600 bg-red-50' },
    { label: 'Contained',       value: contained.length, icon: ClockIcon,              color: 'text-orange-600 bg-orange-50' },
    { label: 'Deadline Urgent', value: urgent.length,    icon: ExclamationTriangleIcon, color: 'text-yellow-600 bg-yellow-50' },
    { label: 'Overdue',         value: overdue.length,   icon: ExclamationTriangleIcon, color: 'text-red-700 bg-red-100' },
  ];

  return (
    <div className="p-6 space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-gray-900">Dashboard</h1>
        <p className="text-sm text-gray-500 mt-1">Welcome back, {user?.full_name}</p>
      </div>

      {/* Stat cards */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        {stats.map(({ label, value, icon: Icon, color }) => (
          <div key={label} className="card p-4 flex items-center gap-4">
            <div className={clsx('p-2 rounded-lg', color)}>
              <Icon className="h-5 w-5" />
            </div>
            <div>
              <p className="text-2xl font-bold text-gray-900">{value}</p>
              <p className="text-xs text-gray-500">{label}</p>
            </div>
          </div>
        ))}
      </div>

      {/* Recent cases */}
      <div className="card">
        <div className="flex items-center justify-between px-5 py-4 border-b border-gray-100">
          <h2 className="font-semibold text-gray-900">Active Cases</h2>
          <Link to="/cases" className="text-sm text-brand-600 hover:underline">View all</Link>
        </div>

        {loading ? (
          <div className="p-8 text-center text-gray-400 text-sm">Loading…</div>
        ) : open.concat(contained).length === 0 ? (
          <div className="p-8 text-center">
            <CheckCircleIcon className="h-10 w-10 text-green-400 mx-auto mb-2" />
            <p className="text-sm text-gray-500">No active cases. All clear.</p>
          </div>
        ) : (
          <ul className="divide-y divide-gray-50">
            {open.concat(contained).slice(0, 8).map(c => (
              <li key={c.id}>
                <Link to={`/cases/${c.id}`}
                  className="flex items-center justify-between px-5 py-3 hover:bg-gray-50 transition-colors">
                  <div className="flex items-center gap-3 min-w-0">
                    <span className={clsx('badge', CLASSIFICATION_COLORS[c.classification])}>
                      {c.classification}
                    </span>
                    <span className="text-sm font-medium text-gray-900 truncate">{c.title}</span>
                  </div>
                  <div className="flex items-center gap-3 shrink-0 ml-4">
                    {c.deadline_remaining_ms !== null && (
                      <span className={clsx('text-xs font-medium',
                        c.deadline_remaining_ms < 4 * 3600000 ? 'text-red-600' :
                        c.deadline_remaining_ms < 24 * 3600000 ? 'text-orange-500' : 'text-gray-400')}>
                        {c.deadline_remaining_ms === 0 ? 'OVERDUE' :
                          `${Math.floor(c.deadline_remaining_ms / 3600000)}h left`}
                      </span>
                    )}
                    <span className={clsx('badge', STATUS_COLORS[c.status])}>{c.status}</span>
                  </div>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
