import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { calendarApi } from '../api/client';
import { ShieldCheckIcon, ShieldExclamationIcon, ClockIcon, ExclamationTriangleIcon } from '@heroicons/react/24/outline';
import clsx from 'clsx';

const CADENCE_LABELS = { quarterly: 'Quarterly', semi_annual: 'Semi-Annual', annual: 'Annual', event_triggered: 'Event-Triggered' };
const CADENCE_ORDER  = ['quarterly', 'semi_annual', 'annual', 'event_triggered'];

const STATUS_STYLE = {
  pending:     'bg-gray-100 text-gray-500',
  in_progress: 'bg-blue-100 text-blue-700',
  complete:    'bg-green-100 text-green-700',
  overdue:     'bg-red-100 text-red-700',
  na:          'bg-purple-100 text-purple-600',
  waived:      'bg-yellow-100 text-yellow-700',
};

function StatusIcon({ status }) {
  if (status === 'complete') return <ShieldCheckIcon className="h-5 w-5 text-green-500" />;
  if (status === 'overdue')  return <ExclamationTriangleIcon className="h-5 w-5 text-red-500" />;
  if (status === 'in_progress') return <ClockIcon className="h-5 w-5 text-blue-500" />;
  return <ShieldExclamationIcon className="h-5 w-5 text-gray-300" />;
}

function daysUntilDue(dueDate) {
  const diff = new Date(dueDate) - new Date();
  return Math.ceil(diff / (1000 * 60 * 60 * 24));
}

export default function ComplianceCalendar() {
  const navigate = useNavigate();
  const [instances, setInstances] = useState([]);
  const [loading, setLoading]     = useState(true);
  const [filterYear, setFilterYear] = useState(String(new Date().getFullYear()));
  const [filterStatus, setFilterStatus] = useState('');

  const years = Array.from({ length: 3 }, (_, i) => String(new Date().getFullYear() - 1 + i));

  useEffect(() => {
    setLoading(true);
    calendarApi.instances({ year: filterYear, status: filterStatus || undefined })
      .then(({ data }) => setInstances(data))
      .finally(() => setLoading(false));
  }, [filterYear, filterStatus]);

  // Group by cadence
  const grouped = CADENCE_ORDER.reduce((acc, c) => {
    acc[c] = instances.filter(i => i.cadence === c);
    return acc;
  }, {});

  const overdue   = instances.filter(i => i.status === 'overdue').length;
  const complete  = instances.filter(i => i.status === 'complete').length;
  const inProg    = instances.filter(i => i.status === 'in_progress').length;
  const pct = instances.length ? Math.round((complete / instances.length) * 100) : 0;

  return (
    <div className="p-6 space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Compliance Calendar</h1>
          <p className="text-sm text-gray-500 mt-1">PCI-DSS recurring check tracking — all cadences</p>
        </div>
        <div className="flex gap-3">
          <select value={filterYear} onChange={e => setFilterYear(e.target.value)} className="input w-28">
            {years.map(y => <option key={y}>{y}</option>)}
          </select>
          <select value={filterStatus} onChange={e => setFilterStatus(e.target.value)} className="input w-36">
            <option value="">All statuses</option>
            {['pending','in_progress','complete','overdue','na','waived'].map(s =>
              <option key={s} value={s}>{s.replace('_',' ')}</option>)}
          </select>
        </div>
      </div>

      {/* Summary bar */}
      <div className="card p-5 space-y-3">
        <div className="flex items-center justify-between">
          <span className="text-sm font-medium text-gray-700">{filterYear} Progress</span>
          <div className="flex gap-4 text-xs text-gray-500">
            {overdue > 0 && <span className="text-red-600 font-semibold">{overdue} overdue</span>}
            <span>{inProg} in progress</span>
            <span className="text-green-600 font-medium">{complete}/{instances.length} complete</span>
          </div>
        </div>
        <div className="w-full bg-gray-100 rounded-full h-2.5">
          <div className="bg-green-500 h-2.5 rounded-full transition-all" style={{ width: `${pct}%` }} />
        </div>
      </div>

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
                {items.map(inst => {
                  const days = daysUntilDue(inst.due_date);
                  const urgent = days <= 14 && days >= 0 && inst.status !== 'complete';
                  return (
                    <button key={inst.id} onClick={() => navigate(`/compliance-calendar/${inst.id}`)}
                      className="w-full flex items-center gap-4 px-5 py-3.5 hover:bg-gray-50 transition-colors text-left">
                      <StatusIcon status={inst.status} />
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-medium text-gray-900 truncate">{inst.name}</p>
                        <p className="text-xs text-gray-400 mt-0.5">
                          {inst.period_label} · Due {new Date(inst.due_date).toLocaleDateString()}
                          {inst.pci_req_refs?.length > 0 && ` · ${inst.pci_req_refs.join(', ')}`}
                        </p>
                      </div>
                      <div className="flex items-center gap-3 shrink-0">
                        {urgent && (
                          <span className="text-xs text-orange-600 font-medium">{days}d left</span>
                        )}
                        {inst.status === 'overdue' && (
                          <span className="text-xs text-red-600 font-semibold">
                            {Math.abs(days)}d overdue
                          </span>
                        )}
                        <span className={clsx('badge', STATUS_STYLE[inst.status])}>
                          {inst.status.replace('_', ' ')}
                        </span>
                        {inst.evidence?.length > 0 && (
                          <span className="text-xs text-gray-400">{inst.evidence.length} file{inst.evidence.length > 1 ? 's' : ''}</span>
                        )}
                      </div>
                    </button>
                  );
                })}
              </div>
            </div>
          );
        })
      )}
    </div>
  );
}
