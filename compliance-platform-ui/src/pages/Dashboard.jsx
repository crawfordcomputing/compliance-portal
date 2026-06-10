import { useState, useEffect } from 'react';
import { Link } from 'react-router-dom';
import { calendarApi, keyInventoryApi, casesApi, complianceApi } from '../api/client';
import { useAuth } from '../context/AuthContext';
import {
  ShieldCheckIcon, ShieldExclamationIcon, KeyIcon,
  ExclamationTriangleIcon, ClockIcon, CheckCircleIcon,
  FolderOpenIcon, ChevronRightIcon,
} from '@heroicons/react/24/outline';
import clsx from 'clsx';

const INCIDENT_STATUS_COLORS = {
  open:      'bg-red-50 text-red-600',
  contained: 'bg-orange-50 text-orange-600',
  resolved:  'bg-green-50 text-green-700',
  closed:    'bg-gray-100 text-gray-500',
};

const INCIDENT_CLASSIFICATION_COLORS = {
  breach:    'bg-red-100 text-red-700',
  suspected: 'bg-orange-100 text-orange-700',
  near_miss: 'bg-yellow-100 text-yellow-700',
  tabletop:  'bg-blue-100 text-blue-700',
};

function StatCard({ label, value, icon: Icon, color, subtext }) {
  return (
    <div className="card p-4 flex items-center gap-4">
      <div className={clsx('p-2.5 rounded-lg shrink-0', color)}>
        <Icon className="h-5 w-5" />
      </div>
      <div className="min-w-0">
        <p className="text-2xl font-bold text-gray-900 leading-tight">{value}</p>
        <p className="text-xs text-gray-500 truncate">{label}</p>
        {subtext && <p className={clsx('text-xs font-medium mt-0.5', subtext.cls)}>{subtext.text}</p>}
      </div>
    </div>
  );
}

function ProgressBar({ value, max, colorClass = 'bg-green-500' }) {
  const pct = max > 0 ? Math.round((value / max) * 100) : 0;
  return (
    <div className="flex items-center gap-3">
      <div className="flex-1 bg-gray-100 rounded-full h-2">
        <div className={clsx('h-2 rounded-full transition-all duration-500', colorClass)}
          style={{ width: `${pct}%` }} />
      </div>
      <span className="text-xs text-gray-500 shrink-0 w-12 text-right">{pct}%</span>
    </div>
  );
}

export default function Dashboard() {
  const { user } = useAuth();

  const [periodData,   setPeriodData]   = useState(null);
  const [expiringKeys, setExpiringKeys] = useState([]);
  const [incidents,    setIncidents]    = useState([]);
  const [annualData,   setAnnualData]   = useState(null);
  const [loading,      setLoading]      = useState(true);

  useEffect(() => {
    const year = new Date().getFullYear();
    Promise.all([
      calendarApi.current(),
      keyInventoryApi.expiring(90),
      casesApi.list({ status: 'open' }),
      casesApi.list({ status: 'contained' }),
      complianceApi.annual(year).catch(() => ({ data: null })),
    ]).then(([{ data: period }, { data: keys }, { data: open }, { data: contained }, { data: annual }]) => {
      setPeriodData(period);
      setExpiringKeys(Array.isArray(keys) ? keys : []);
      setIncidents([...open, ...contained]);
      setAnnualData(annual);
    }).finally(() => setLoading(false));
  }, []);

  const overdue      = periodData?.overdue     || [];
  const thisPeriod   = periodData?.this_period || [];
  const progress     = periodData?.progress;
  const criticalKeys = expiringKeys.filter(k => {
    if (!k.expires_on) return false;
    const d = Math.ceil((new Date(k.expires_on) - new Date()) / 86400000);
    return d <= 30;
  });

  const activeIncidents = incidents.filter(i => ['open', 'contained'].includes(i.status));

  const periodComplete = progress?.complete ?? 0;
  const periodTotal    = progress?.total    ?? 0;
  const annualMet      = annualData?.met_count ?? null;
  const annualTotal    = annualData?.total     ?? null;

  const stats = [
    {
      label:   'Checks This Period',
      value:   loading ? '—' : `${periodComplete}/${periodTotal}`,
      icon:    ShieldCheckIcon,
      color:   overdue.length > 0 ? 'text-red-600 bg-red-50' : 'text-green-600 bg-green-50',
      subtext: overdue.length > 0
        ? { text: `${overdue.length} overdue`, cls: 'text-red-600' }
        : periodTotal > 0 ? { text: 'On track', cls: 'text-green-600' } : null,
    },
    {
      label:   'Annual Requirements',
      value:   loading || annualMet === null ? '—' : `${annualMet}/${annualTotal}`,
      icon:    ClockIcon,
      color:   'text-brand-600 bg-brand-50',
      subtext: annualMet !== null && annualTotal > 0
        ? { text: `${Math.round((annualMet / annualTotal) * 100)}% met`, cls: 'text-brand-600' }
        : null,
    },
    {
      label:   'Keys Expiring Soon',
      value:   loading ? '—' : criticalKeys.length,
      icon:    KeyIcon,
      color:   criticalKeys.length > 0 ? 'text-orange-600 bg-orange-50' : 'text-gray-400 bg-gray-100',
      subtext: criticalKeys.length > 0
        ? { text: 'Within 30 days', cls: 'text-orange-600' }
        : { text: 'None critical', cls: 'text-gray-400' },
    },
    {
      label:   'Active Incidents',
      value:   loading ? '—' : activeIncidents.length,
      icon:    FolderOpenIcon,
      color:   activeIncidents.length > 0 ? 'text-red-600 bg-red-50' : 'text-gray-400 bg-gray-100',
      subtext: activeIncidents.length > 0
        ? { text: 'Require attention', cls: 'text-red-500' }
        : { text: 'All clear', cls: 'text-gray-400' },
    },
  ];

  return (
    <div className="p-6 space-y-6 max-w-6xl">
      <div>
        <h1 className="text-2xl font-bold text-gray-900">Compliance Dashboard</h1>
        <p className="text-sm text-gray-500 mt-1">Welcome back, {user?.full_name}</p>
      </div>

      {/* Stat cards */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        {stats.map(s => <StatCard key={s.label} {...s} />)}
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">

        {/* ── Left / main column ───────────────────────────── */}
        <div className="lg:col-span-2 space-y-5">

          {/* Overdue checks */}
          {!loading && overdue.length > 0 && (
            <div className="card overflow-hidden ring-1 ring-red-200">
              <div className="flex items-center justify-between px-5 py-3.5 border-b border-red-100 bg-red-50">
                <div className="flex items-center gap-2">
                  <ExclamationTriangleIcon className="h-4 w-4 text-red-500" />
                  <h2 className="text-sm font-semibold text-red-700">Overdue ({overdue.length})</h2>
                </div>
                <Link to="/compliance" className="text-xs text-red-600 hover:underline">View all</Link>
              </div>
              <ul className="divide-y divide-gray-50">
                {overdue.slice(0, 5).map(inst => (
                  <li key={inst.id}>
                    <Link to={`/compliance/instances/${inst.id}`}
                      className="flex items-center justify-between px-5 py-3 hover:bg-gray-50 transition-colors">
                      <div className="flex items-center gap-3 min-w-0">
                        <ShieldExclamationIcon className="h-4 w-4 text-red-400 shrink-0" />
                        <span className="text-sm font-medium text-gray-900 truncate">{inst.name}</span>
                      </div>
                      <span className="text-xs text-red-600 font-semibold shrink-0 ml-3">
                        {Math.abs(Math.ceil((new Date(inst.due_date) - new Date()) / 86400000))}d overdue
                      </span>
                    </Link>
                  </li>
                ))}
              </ul>
            </div>
          )}

          {/* This period progress */}
          <div className="card overflow-hidden">
            <div className="flex items-center justify-between px-5 py-3.5 border-b border-gray-100">
              <div className="flex items-center gap-2">
                <ShieldCheckIcon className="h-4 w-4 text-brand-500" />
                <h2 className="text-sm font-semibold text-gray-900">This Period</h2>
              </div>
              <Link to="/compliance" className="text-xs text-brand-600 hover:underline">Manage</Link>
            </div>

            {loading ? (
              <div className="p-6 text-center text-sm text-gray-400">Loading…</div>
            ) : periodTotal === 0 ? (
              <div className="p-6 text-center text-sm text-gray-400">No checks scheduled this period.</div>
            ) : (
              <div className="p-5 space-y-4">
                <ProgressBar value={periodComplete} max={periodTotal} />
                <p className="text-sm text-gray-600">
                  <span className="font-semibold text-gray-900">{periodComplete}</span> of{' '}
                  <span className="font-semibold text-gray-900">{periodTotal}</span> checks complete
                  {overdue.length > 0 && (
                    <span className="ml-2 text-red-600 font-medium">· {overdue.length} overdue</span>
                  )}
                </p>
                {thisPeriod.length > 0 && (
                  <ul className="divide-y divide-gray-50 -mx-5 border-t border-gray-100 mt-4">
                    {thisPeriod.slice(0, 6).map(inst => (
                      <li key={inst.id}>
                        <Link to={`/compliance/instances/${inst.id}`}
                          className="flex items-center gap-3 px-5 py-2.5 hover:bg-gray-50 transition-colors">
                          <ShieldCheckIcon className={clsx('h-4 w-4 shrink-0',
                            inst.status === 'complete'    ? 'text-green-500'
                            : inst.status === 'in_progress' ? 'text-blue-500'
                            : 'text-gray-300')} />
                          <span className="text-sm text-gray-700 flex-1 truncate">{inst.name}</span>
                          <span className={clsx('text-xs font-medium shrink-0',
                            inst.status === 'complete'    ? 'text-green-600'
                            : inst.status === 'in_progress' ? 'text-blue-600'
                            : 'text-gray-400')}>
                            {inst.status.replace('_', ' ')}
                          </span>
                          <ChevronRightIcon className="h-3 w-3 text-gray-300 shrink-0" />
                        </Link>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            )}
          </div>

          {/* Annual requirements */}
          {annualData && (
            <div className="card overflow-hidden">
              <div className="flex items-center justify-between px-5 py-3.5 border-b border-gray-100">
                <div className="flex items-center gap-2">
                  <ClockIcon className="h-4 w-4 text-brand-500" />
                  <h2 className="text-sm font-semibold text-gray-900">
                    Annual Requirements — {new Date().getFullYear()}
                  </h2>
                </div>
              </div>
              <div className="p-5 space-y-3">
                <ProgressBar value={annualData.met_count} max={annualData.total} />
                <ul className="space-y-1.5 mt-2">
                  {annualData.checklist?.map(item => (
                    <li key={item.ref} className="flex items-center gap-3 text-sm">
                      <ShieldCheckIcon className={clsx('h-4 w-4 shrink-0',
                        item.status === 'met' || item.status === 'na' ? 'text-green-500'
                        : item.status === 'not_met' ? 'text-red-400'
                        : 'text-gray-300')} />
                      <span className="font-mono text-xs text-gray-500 w-16 shrink-0">{item.ref}</span>
                      <span className="text-gray-600 flex-1 truncate text-xs">{item.description}</span>
                      <span className={clsx('text-xs font-medium shrink-0',
                        item.status === 'met'     ? 'text-green-600'
                        : item.status === 'na'    ? 'text-purple-500'
                        : item.status === 'not_met' ? 'text-red-500'
                        : 'text-gray-400')}>
                        {item.status}
                      </span>
                    </li>
                  ))}
                </ul>
              </div>
            </div>
          )}
        </div>

        {/* ── Right column ─────────────────────────────────── */}
        <div className="space-y-5">

          {/* Key expiry */}
          <div className="card overflow-hidden">
            <div className="flex items-center justify-between px-5 py-3.5 border-b border-gray-100">
              <div className="flex items-center gap-2">
                <KeyIcon className="h-4 w-4 text-brand-500" />
                <h2 className="text-sm font-semibold text-gray-900">Key Expiry</h2>
              </div>
              <Link to="/key-inventory" className="text-xs text-brand-600 hover:underline">View all</Link>
            </div>

            {loading ? (
              <div className="p-5 text-center text-sm text-gray-400">Loading…</div>
            ) : expiringKeys.length === 0 ? (
              <div className="p-5 text-center">
                <CheckCircleIcon className="h-8 w-8 text-green-400 mx-auto mb-1.5" />
                <p className="text-xs text-gray-500">No keys expiring in 90 days</p>
              </div>
            ) : (
              <ul className="divide-y divide-gray-50">
                {expiringKeys.slice(0, 6).map(k => {
                  const days = k.expires_on
                    ? Math.ceil((new Date(k.expires_on) - new Date()) / 86400000)
                    : null;
                  return (
                    <li key={k.id} className="px-5 py-3 flex items-center justify-between gap-3">
                      <span className="text-sm text-gray-800 truncate flex-1">{k.name}</span>
                      {days !== null && (
                        <span className={clsx('text-xs font-semibold shrink-0',
                          days < 0   ? 'text-red-600'
                          : days <= 30 ? 'text-orange-600'
                          : 'text-yellow-600')}>
                          {days < 0 ? `${Math.abs(days)}d overdue` : `${days}d`}
                        </span>
                      )}
                    </li>
                  );
                })}
              </ul>
            )}
          </div>

          {/* Active incidents */}
          <div className="card overflow-hidden">
            <div className="flex items-center justify-between px-5 py-3.5 border-b border-gray-100">
              <div className="flex items-center gap-2">
                <FolderOpenIcon className="h-4 w-4 text-gray-400" />
                <h2 className="text-sm font-semibold text-gray-900">Active Incidents</h2>
              </div>
              <Link to="/incidents" className="text-xs text-brand-600 hover:underline">View all</Link>
            </div>

            {loading ? (
              <div className="p-5 text-center text-sm text-gray-400">Loading…</div>
            ) : activeIncidents.length === 0 ? (
              <div className="p-5 text-center">
                <CheckCircleIcon className="h-8 w-8 text-green-400 mx-auto mb-1.5" />
                <p className="text-xs text-gray-500">No active incidents</p>
              </div>
            ) : (
              <ul className="divide-y divide-gray-50">
                {activeIncidents.slice(0, 6).map(c => (
                  <li key={c.id}>
                    <Link to={`/incidents/${c.id}`}
                      className="flex items-center gap-3 px-5 py-3 hover:bg-gray-50 transition-colors">
                      <span className={clsx('badge text-xs shrink-0',
                        INCIDENT_CLASSIFICATION_COLORS[c.classification])}>
                        {c.classification}
                      </span>
                      <span className="text-sm text-gray-800 truncate flex-1">{c.title}</span>
                      <span className={clsx('badge text-xs shrink-0',
                        INCIDENT_STATUS_COLORS[c.status])}>
                        {c.status}
                      </span>
                    </Link>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>

      </div>
    </div>
  );
}
