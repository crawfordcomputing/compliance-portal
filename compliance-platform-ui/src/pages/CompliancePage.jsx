import { useState, useEffect, useCallback } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import { calendarApi } from '../api/client';
import {
  ShieldCheckIcon, ShieldExclamationIcon, ClockIcon,
  ExclamationTriangleIcon, ChevronRightIcon,
} from '@heroicons/react/24/outline';
import clsx from 'clsx';

const CADENCE_LABELS = {
  quarterly:       'Quarterly',
  semi_annual:     'Semi-Annual',
  annual:          'Annual',
  event_triggered: 'Event-Triggered',
};
const CADENCE_ORDER = ['quarterly', 'semi_annual', 'annual', 'event_triggered'];

const STATUS_STYLE = {
  pending:     'bg-gray-100 text-gray-500',
  in_progress: 'bg-blue-100 text-blue-700',
  complete:    'bg-green-100 text-green-700',
  overdue:     'bg-red-100 text-red-700',
  na:          'bg-purple-100 text-purple-600',
  waived:      'bg-yellow-100 text-yellow-700',
};

function daysFromNow(date) {
  return Math.ceil((new Date(date) - new Date()) / (1000 * 60 * 60 * 24));
}

function StatusIcon({ status }) {
  if (status === 'complete')              return <ShieldCheckIcon    className="h-5 w-5 text-green-500 shrink-0" />;
  if (status === 'overdue')               return <ExclamationTriangleIcon className="h-5 w-5 text-red-500 shrink-0" />;
  if (status === 'in_progress')           return <ClockIcon          className="h-5 w-5 text-blue-500 shrink-0" />;
  if (status === 'na' || status === 'waived') return <ShieldCheckIcon className="h-5 w-5 text-purple-400 shrink-0" />;
  return <ShieldExclamationIcon className="h-5 w-5 text-gray-300 shrink-0" />;
}

function CheckRow({ inst, onClick }) {
  const days = daysFromNow(inst.due_date);
  return (
    <button
      onClick={() => onClick(inst.id)}
      className="w-full flex items-center gap-4 px-5 py-3.5 hover:bg-gray-50 transition-colors text-left"
    >
      <StatusIcon status={inst.status} />
      <div className="flex-1 min-w-0">
        <p className="text-sm font-medium text-gray-900 truncate">{inst.name}</p>
        <p className="text-xs text-gray-400 mt-0.5">
          {inst.period_label} · Due {new Date(inst.due_date).toLocaleDateString()}
          {inst.pci_req_refs?.length > 0 && ` · ${inst.pci_req_refs.join(', ')}`}
        </p>
      </div>
      <div className="flex items-center gap-3 shrink-0">
        {days > 0 && days <= 14 && inst.status !== 'complete' && (
          <span className="text-xs text-orange-600 font-medium">{days}d left</span>
        )}
        {inst.status === 'overdue' && (
          <span className="text-xs text-red-600 font-semibold">{Math.abs(days)}d overdue</span>
        )}
        <span className={clsx('badge', STATUS_STYLE[inst.status])}>
          {inst.status.replace('_', ' ')}
        </span>
        {inst.evidence?.length > 0 && (
          <span className="text-xs text-gray-400">
            {inst.evidence.length} file{inst.evidence.length !== 1 ? 's' : ''}
          </span>
        )}
        <ChevronRightIcon className="h-4 w-4 text-gray-300" />
      </div>
    </button>
  );
}

// ── This Period Tab ──────────────────────────────────────────────────────────

function ThisPeriodTab({ onNavigate }) {
  const [data, setData]       = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    calendarApi.current()
      .then(({ data }) => setData(data))
      .finally(() => setLoading(false));
  }, []);

  if (loading) return <div className="text-center text-sm text-gray-400 py-12">Loading…</div>;

  const { overdue = [], this_period = [], upcoming = [], progress } = data || {};
  const isEmpty = overdue.length === 0 && this_period.length === 0 && upcoming.length === 0;

  return (
    <div className="space-y-6">
      {/* Progress bar */}
      {progress && (
        <div className="card p-4">
          <div className="flex items-center justify-between mb-2">
            <span className="text-sm font-medium text-gray-700">This period</span>
            <span className="text-sm text-gray-500">
              {progress.complete}/{progress.total} complete
              {overdue.length > 0 && (
                <span className="ml-3 text-red-600 font-semibold">{overdue.length} overdue</span>
              )}
            </span>
          </div>
          <div className="w-full bg-gray-100 rounded-full h-2">
            <div
              className="bg-green-500 h-2 rounded-full transition-all duration-500"
              style={{ width: `${progress.pct}%` }}
            />
          </div>
        </div>
      )}

      {/* Overdue */}
      {overdue.length > 0 && (
        <section>
          <h2 className="text-sm font-semibold text-red-600 uppercase tracking-wide mb-3">
            Overdue ({overdue.length})
          </h2>
          <div className="card divide-y divide-gray-50 overflow-hidden ring-1 ring-red-200">
            {overdue.map(inst => <CheckRow key={inst.id} inst={inst} onClick={onNavigate} />)}
          </div>
        </section>
      )}

      {/* Due this period */}
      <section>
        <h2 className="text-sm font-semibold text-gray-500 uppercase tracking-wide mb-3">
          Due This Period{this_period.length > 0 && ` (${this_period.length})`}
        </h2>
        {this_period.length === 0 ? (
          <div className="card p-6 text-sm text-gray-400 text-center">
            {isEmpty ? 'Nothing due right now.' : 'All current-period checks are overdue or complete.'}
          </div>
        ) : (
          <div className="card divide-y divide-gray-50 overflow-hidden">
            {this_period.map(inst => <CheckRow key={inst.id} inst={inst} onClick={onNavigate} />)}
          </div>
        )}
      </section>

      {/* Upcoming */}
      {upcoming.length > 0 && (
        <section>
          <h2 className="text-sm font-semibold text-gray-500 uppercase tracking-wide mb-3">
            Coming Up — Next 30 Days ({upcoming.length})
          </h2>
          <div className="card divide-y divide-gray-50 overflow-hidden opacity-75">
            {upcoming.map(inst => <CheckRow key={inst.id} inst={inst} onClick={onNavigate} />)}
          </div>
        </section>
      )}

      {isEmpty && (
        <div className="card p-8 text-center text-sm text-gray-400">
          Nothing due right now. Switch to All Checks for the full picture.
        </div>
      )}
    </div>
  );
}

// ── All Checks Tab ───────────────────────────────────────────────────────────

function AllChecksTab({ onNavigate }) {
  const [instances, setInstances]       = useState([]);
  const [loading, setLoading]           = useState(true);
  const [filterCadence, setFilterCadence] = useState('');
  const [filterStatus, setFilterStatus]   = useState('');
  const [filterYear, setFilterYear]       = useState(String(new Date().getFullYear()));

  const years = Array.from({ length: 3 }, (_, i) => String(new Date().getFullYear() - 1 + i));

  const load = useCallback(() => {
    setLoading(true);
    calendarApi.instances({
      cadence: filterCadence || undefined,
      status:  filterStatus  || undefined,
      year:    filterYear,
    })
      .then(({ data }) => setInstances(data))
      .finally(() => setLoading(false));
  }, [filterCadence, filterStatus, filterYear]);

  useEffect(() => { load(); }, [load]);

  const grouped = CADENCE_ORDER.reduce((acc, c) => {
    acc[c] = instances.filter(i => i.cadence === c);
    return acc;
  }, {});

  const complete  = instances.filter(i => i.status === 'complete').length;
  const overdue   = instances.filter(i => i.status === 'overdue').length;
  const naCount   = instances.filter(i => ['na','waived'].includes(i.status)).length;
  const denom     = instances.length - naCount;
  const pct       = denom ? Math.round((complete / denom) * 100) : 0;

  return (
    <div className="space-y-6">
      {/* Filters */}
      <div className="flex gap-3 flex-wrap">
        <select value={filterCadence} onChange={e => setFilterCadence(e.target.value)} className="input w-40">
          <option value="">All cadences</option>
          {CADENCE_ORDER.map(c => <option key={c} value={c}>{CADENCE_LABELS[c]}</option>)}
        </select>
        <select value={filterYear} onChange={e => setFilterYear(e.target.value)} className="input w-28">
          {years.map(y => <option key={y}>{y}</option>)}
        </select>
        <select value={filterStatus} onChange={e => setFilterStatus(e.target.value)} className="input w-36">
          <option value="">All statuses</option>
          {['pending','in_progress','complete','overdue','na','waived'].map(s => (
            <option key={s} value={s}>{s.replace('_', ' ')}</option>
          ))}
        </select>
      </div>

      {/* Progress */}
      {instances.length > 0 && (
        <div className="flex items-center gap-4">
          <div className="flex-1 bg-gray-100 rounded-full h-2">
            <div className="bg-green-500 h-2 rounded-full transition-all" style={{ width: `${pct}%` }} />
          </div>
          <div className="flex gap-3 text-xs text-gray-500 shrink-0">
            {overdue > 0 && <span className="text-red-600 font-semibold">{overdue} overdue</span>}
            <span className="text-green-600 font-medium">{complete}/{denom} complete</span>
          </div>
        </div>
      )}

      {/* Check list */}
      {loading ? (
        <div className="text-center text-sm text-gray-400 py-12">Loading…</div>
      ) : (
        CADENCE_ORDER.map(cadence => {
          const items = grouped[cadence];
          if (!items?.length) return null;
          return (
            <div key={cadence}>
              <h2 className="text-sm font-semibold text-gray-500 uppercase tracking-wide mb-3">
                {CADENCE_LABELS[cadence]}
              </h2>
              <div className="card divide-y divide-gray-50 overflow-hidden">
                {items.map(inst => (
                  <CheckRow key={inst.id} inst={inst} onClick={onNavigate} />
                ))}
              </div>
            </div>
          );
        })
      )}
    </div>
  );
}

// ── Main Page ────────────────────────────────────────────────────────────────

const TABS = [
  { id: 'period', label: 'This Period' },
  { id: 'all',    label: 'All Checks'  },
];

export default function CompliancePage() {
  const navigate = useNavigate();
  const location = useLocation();
  const [tab, setTab] = useState(location.state?.tab || 'period');

  function goToInstance(id) {
    navigate(`/compliance/instances/${id}`, { state: { tab } });
  }

  return (
    <div className="p-6 space-y-6 max-w-5xl">
      <div>
        <h1 className="text-2xl font-bold text-gray-900">Compliance</h1>
        <p className="text-sm text-gray-500 mt-1">PCI-DSS recurring checks and sign-offs</p>
      </div>

      {/* Tab bar */}
      <div className="border-b border-gray-200">
        <nav className="-mb-px flex gap-6">
          {TABS.map(t => (
            <button
              key={t.id}
              onClick={() => setTab(t.id)}
              className={clsx(
                'pb-3 text-sm font-medium border-b-2 transition-colors',
                tab === t.id
                  ? 'border-brand-600 text-brand-700'
                  : 'border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300'
              )}
            >
              {t.label}
            </button>
          ))}
        </nav>
      </div>

      {tab === 'period'
        ? <ThisPeriodTab onNavigate={goToInstance} />
        : <AllChecksTab  onNavigate={goToInstance} />
      }
    </div>
  );
}
