import { useState, useEffect } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { casesApi } from '../api/client';
import { useAuth } from '../context/AuthContext';
import { PlusIcon } from '@heroicons/react/24/outline';
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

const SAQ_TYPES = ['', 'A', 'A-EP', 'B', 'B-IP', 'C', 'D'];
const CLASSIFICATIONS = ['breach', 'suspected', 'near_miss', 'tabletop'];

export default function CaseList() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const [cases, setCases] = useState([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState({ status: '', classification: '' });
  const [showNew, setShowNew] = useState(false);
  const [form, setForm] = useState({ title: '', classification: 'breach', saq_type: '', cde_scope: '' });
  const [submitting, setSubmitting] = useState(false);

  function load() {
    setLoading(true);
    casesApi.list(filter).then(({ data }) => setCases(data)).finally(() => setLoading(false));
  }
  useEffect(() => { load(); }, [filter]);

  async function handleCreate(e) {
    e.preventDefault();
    setSubmitting(true);
    try {
      const { data } = await casesApi.create({
        ...form,
        cde_scope: form.cde_scope ? form.cde_scope.split(',').map(s => s.trim()) : [],
        saq_type: form.saq_type || undefined,
      });
      navigate(`/cases/${data.id}`);
    } catch (err) {
      alert(err.response?.data?.error || 'Failed to create case');
    } finally {
      setSubmitting(false);
    }
  }

  const canCreate = ['admin', 'ir_lead', 'ir_analyst'].includes(user?.role);

  return (
    <div className="p-6 space-y-5">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold text-gray-900">Cases</h1>
        {canCreate && (
          <button onClick={() => setShowNew(true)} className="btn-primary">
            <PlusIcon className="h-4 w-4" /> New Case
          </button>
        )}
      </div>

      {/* Filters */}
      <div className="flex gap-3">
        <select value={filter.status} onChange={e => setFilter(f => ({ ...f, status: e.target.value }))}
          className="input w-40">
          <option value="">All statuses</option>
          {['open','contained','resolved','closed'].map(s => <option key={s}>{s}</option>)}
        </select>
        <select value={filter.classification} onChange={e => setFilter(f => ({ ...f, classification: e.target.value }))}
          className="input w-44">
          <option value="">All types</option>
          {CLASSIFICATIONS.map(c => <option key={c}>{c}</option>)}
        </select>
      </div>

      {/* New case form */}
      {showNew && (
        <div className="card p-5">
          <h2 className="font-semibold text-gray-900 mb-4">New Case</h2>
          <form onSubmit={handleCreate} className="grid grid-cols-2 gap-4">
            <div className="col-span-2">
              <label className="block text-sm font-medium text-gray-700 mb-1">Title *</label>
              <input required className="input" value={form.title}
                onChange={e => setForm(f => ({ ...f, title: e.target.value }))} />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Classification *</label>
              <select required className="input" value={form.classification}
                onChange={e => setForm(f => ({ ...f, classification: e.target.value }))}>
                {CLASSIFICATIONS.map(c => <option key={c}>{c}</option>)}
              </select>
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">SAQ Type</label>
              <select className="input" value={form.saq_type}
                onChange={e => setForm(f => ({ ...f, saq_type: e.target.value }))}>
                {SAQ_TYPES.map(t => <option key={t} value={t}>{t || '— none —'}</option>)}
              </select>
            </div>
            <div className="col-span-2">
              <label className="block text-sm font-medium text-gray-700 mb-1">
                CDE Scope <span className="text-gray-400 font-normal">(comma-separated systems)</span>
              </label>
              <input className="input" placeholder="POS Terminal A, Web Server B"
                value={form.cde_scope} onChange={e => setForm(f => ({ ...f, cde_scope: e.target.value }))} />
            </div>
            <div className="col-span-2 flex gap-3 justify-end">
              <button type="button" onClick={() => setShowNew(false)} className="btn-secondary">Cancel</button>
              <button type="submit" disabled={submitting} className="btn-primary">
                {submitting ? 'Creating…' : 'Create Case'}
              </button>
            </div>
          </form>
        </div>
      )}

      {/* Case table */}
      <div className="card overflow-hidden">
        {loading ? (
          <div className="p-8 text-center text-gray-400 text-sm">Loading…</div>
        ) : cases.length === 0 ? (
          <div className="p-8 text-center text-gray-400 text-sm">No cases found.</div>
        ) : (
          <table className="w-full text-sm">
            <thead className="bg-gray-50 border-b border-gray-100">
              <tr>
                {['Title', 'Classification', 'SAQ', 'Status', 'Deadline', 'Created'].map(h => (
                  <th key={h} className="text-left px-4 py-3 text-xs font-semibold text-gray-500 uppercase tracking-wide">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-50">
              {cases.map(c => (
                <tr key={c.id} onClick={() => navigate(`/cases/${c.id}`)}
                  className="hover:bg-gray-50 cursor-pointer transition-colors">
                  <td className="px-4 py-3 font-medium text-gray-900 max-w-xs truncate">{c.title}</td>
                  <td className="px-4 py-3"><span className={clsx('badge', CLASSIFICATION_COLORS[c.classification])}>{c.classification}</span></td>
                  <td className="px-4 py-3 text-gray-500">{c.saq_type || '—'}</td>
                  <td className="px-4 py-3"><span className={clsx('badge', STATUS_COLORS[c.status])}>{c.status}</span></td>
                  <td className="px-4 py-3">
                    {c.deadline_remaining_ms !== null ? (
                      <span className={clsx('font-medium text-xs',
                        c.deadline_remaining_ms === 0 ? 'text-red-600' :
                        c.deadline_remaining_ms < 4 * 3600000 ? 'text-red-500' :
                        c.deadline_remaining_ms < 24 * 3600000 ? 'text-orange-500' : 'text-gray-500')}>
                        {c.deadline_remaining_ms === 0 ? 'OVERDUE' :
                          `${Math.floor(c.deadline_remaining_ms / 3600000)}h ${Math.floor((c.deadline_remaining_ms % 3600000) / 60000)}m`}
                      </span>
                    ) : '—'}
                  </td>
                  <td className="px-4 py-3 text-gray-400">{new Date(c.created_at).toLocaleDateString()}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}
