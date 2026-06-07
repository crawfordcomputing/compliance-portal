import { useState, useEffect, useCallback } from 'react';
import api from '../api/client';
import { useAuth } from '../context/AuthContext';
import { ShieldCheckIcon, ShieldExclamationIcon, SparklesIcon } from '@heroicons/react/24/outline';
import clsx from 'clsx';

const STATUS_OPTIONS = [
  { value: 'met',     label: 'Met',     cls: 'bg-green-100 text-green-700' },
  { value: 'not_met', label: 'Not Met', cls: 'bg-red-100 text-red-700' },
  { value: 'na',      label: 'N/A',     cls: 'bg-blue-100 text-blue-600' },
];

const STATUS_BADGE = {
  met:     'bg-green-100 text-green-700',
  not_met: 'bg-red-100 text-red-700',
  na:      'bg-blue-100 text-blue-600',
  pending: 'bg-gray-100 text-gray-500',
};

export default function Compliance() {
  const { user } = useAuth();
  const [year, setYear]         = useState(new Date().getFullYear());
  const [data, setData]         = useState(null);
  const [loading, setLoading]   = useState(true);
  const [saving, setSaving]     = useState(null);
  const [editingNote, setEditingNote] = useState(null);
  const [noteText, setNoteText]       = useState('');

  const canEdit = ['admin', 'ir_lead'].includes(user?.role);
  const years = Array.from({ length: 5 }, (_, i) => new Date().getFullYear() - i);

  const load = useCallback(() => {
    setLoading(true);
    api.get(`/compliance/${year}`)
      .then(({ data }) => setData(data))
      .finally(() => setLoading(false));
  }, [year]);

  useEffect(() => { load(); }, [load]);

  async function handleStatus(ref, status) {
    const item = data?.checklist.find(c => c.ref === ref);
    if (item?.auto_derived && (ref === '12.10.2' || ref === 'TABLETOP')) {
      if (!confirm('This item is auto-derived. Override it manually?')) return;
    }
    setSaving(ref);
    try {
      await api.patch(`/compliance/${year}/${encodeURIComponent(ref)}`, { status, notes: item?.notes || null });
      load();
    } finally { setSaving(null); }
  }

  async function saveNote(ref, currentStatus) {
    setSaving(ref);
    try {
      await api.patch(`/compliance/${year}/${encodeURIComponent(ref)}`, { status: currentStatus, notes: noteText });
      setEditingNote(null);
      load();
    } finally { setSaving(null); }
  }

  const metCount = data?.met_count ?? 0;
  const total    = data?.total ?? 0;
  const pct      = total ? Math.round((metCount / total) * 100) : 0;

  return (
    <div className="p-6 space-y-6 max-w-4xl">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Annual Compliance</h1>
          <p className="text-sm text-gray-500 mt-1">PCI-DSS annual requirement sign-off</p>
        </div>
        <select value={year} onChange={e => setYear(Number(e.target.value))} className="input w-32">
          {years.map(y => <option key={y} value={y}>{y}</option>)}
        </select>
      </div>

      {/* Progress bar */}
      {data && (
        <div className="card p-5">
          <div className="flex items-center justify-between mb-2">
            <span className="text-sm font-medium text-gray-700">{year} Compliance Progress</span>
            <span className="text-sm font-semibold text-gray-900">{metCount}/{total} requirements met</span>
          </div>
          <div className="w-full bg-gray-100 rounded-full h-3">
            <div className="bg-green-500 h-3 rounded-full transition-all duration-500"
              style={{ width: `${pct}%` }} />
          </div>
          <div className="flex items-center gap-6 mt-3 text-xs text-gray-500">
            <span>{data.real_case_count} real incident(s) this year</span>
            <span>{data.tabletop_count} tabletop exercise(s)</span>
            {data.tabletop_required && (
              <span className="text-orange-600 font-medium">Tabletop exercise required this year</span>
            )}
          </div>
        </div>
      )}

      {/* Checklist */}
      {loading ? (
        <div className="text-sm text-gray-400 text-center py-8">Loading…</div>
      ) : (
        <div className="card divide-y divide-gray-50 overflow-hidden">
          {data?.checklist.map(item => (
            <div key={item.ref} className="px-5 py-4 space-y-2">
              <div className="flex items-start gap-3">
                {item.status === 'met' || item.status === 'na' ? (
                  <ShieldCheckIcon className={clsx('h-5 w-5 shrink-0 mt-0.5',
                    item.status === 'met' ? 'text-green-500' : 'text-blue-400')} />
                ) : (
                  <ShieldExclamationIcon className={clsx('h-5 w-5 shrink-0 mt-0.5',
                    item.status === 'not_met' ? 'text-red-400' : 'text-gray-300')} />
                )}
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="font-mono text-sm font-semibold text-gray-700">{item.ref}</span>
                    {item.auto_derived && (
                      <span className="inline-flex items-center gap-1 text-xs text-purple-600 bg-purple-50 px-1.5 py-0.5 rounded">
                        <SparklesIcon className="h-3 w-3" /> Auto
                      </span>
                    )}
                    <span className={clsx('badge', STATUS_BADGE[item.status])}>{item.status}</span>
                  </div>
                  <p className="text-sm text-gray-600 mt-0.5">{item.description}</p>
                  {item.notes && (
                    <p className="text-xs text-gray-400 italic mt-1">{item.notes}</p>
                  )}
                  {item.checked_by && (
                    <p className="text-xs text-gray-400 mt-1">
                      Signed off by {item.checked_by} · {new Date(item.checked_at).toLocaleDateString()}
                    </p>
                  )}
                </div>

                {canEdit && (
                  <div className="flex gap-1 shrink-0 flex-wrap justify-end">
                    {STATUS_OPTIONS
                      .filter(o => item.allows_na || o.value !== 'na')
                      .map(opt => (
                        <button key={opt.value} disabled={saving === item.ref}
                          onClick={() => handleStatus(item.ref, opt.value)}
                          className={clsx('badge cursor-pointer border transition-all',
                            item.status === opt.value
                              ? opt.cls + ' ring-1 ring-offset-1 ring-current'
                              : 'bg-gray-50 text-gray-400 hover:opacity-80')}>
                          {opt.label}
                        </button>
                      ))}
                  </div>
                )}
              </div>

              {/* Note editor */}
              {canEdit && (
                editingNote === item.ref ? (
                  <div className="flex gap-2 ml-8">
                    <input className="input flex-1 text-sm" placeholder="Add note…"
                      value={noteText} onChange={e => setNoteText(e.target.value)}
                      onKeyDown={e => e.key === 'Enter' && saveNote(item.ref, item.status)} autoFocus />
                    <button onClick={() => saveNote(item.ref, item.status)}
                      disabled={saving === item.ref} className="btn-primary text-xs px-3 py-1">Save</button>
                    <button onClick={() => setEditingNote(null)} className="btn-secondary text-xs px-3 py-1">Cancel</button>
                  </div>
                ) : (
                  <button onClick={() => { setEditingNote(item.ref); setNoteText(item.notes || ''); }}
                    className="ml-8 text-xs text-brand-600 hover:underline">
                    {item.notes ? 'Edit note' : '+ Add note'}
                  </button>
                )
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
