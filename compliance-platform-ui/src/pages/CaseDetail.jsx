import { useState, useEffect, useCallback } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { casesApi, actionsApi, evidenceApi, exportsApi } from '../api/client';
import { useAuth } from '../context/AuthContext';
import clsx from 'clsx';
import {
  ClockIcon, PaperClipIcon, DocumentTextIcon,
  ShieldCheckIcon, ChevronRightIcon, ArrowLeftIcon,
  ArrowDownTrayIcon,
} from '@heroicons/react/24/outline';

const STATUS_COLORS = {
  open:      'bg-red-50 text-red-600 border-red-200',
  contained: 'bg-orange-50 text-orange-600 border-orange-200',
  resolved:  'bg-green-50 text-green-700 border-green-200',
  closed:    'bg-gray-100 text-gray-500 border-gray-200',
};
const CLASSIFICATION_COLORS = {
  breach:    'bg-red-100 text-red-700',
  suspected: 'bg-orange-100 text-orange-700',
  near_miss: 'bg-yellow-100 text-yellow-700',
  tabletop:  'bg-blue-100 text-blue-700',
};
const TRANSITIONS = { open: ['contained'], contained: ['resolved'], resolved: ['closed'], closed: [] };

function DeadlineCountdown({ ms }) {
  if (ms === null) return null;
  if (ms === 0) return (
    <div className="flex items-center gap-2 text-red-600 font-semibold">
      <ClockIcon className="h-4 w-4" /> OVERDUE — 72hr window elapsed
    </div>
  );
  const h = Math.floor(ms / 3600000);
  const m = Math.floor((ms % 3600000) / 60000);
  const color = ms < 4 * 3600000 ? 'text-red-600' : ms < 24 * 3600000 ? 'text-orange-500' : 'text-gray-700';
  return (
    <div className={clsx('flex items-center gap-2 font-semibold', color)}>
      <ClockIcon className="h-4 w-4" />
      Notification deadline: {h}h {m}m remaining
    </div>
  );
}

const STATUS_OPTIONS = [
  { value: 'pending',  label: 'Pending',  cls: 'bg-gray-100 text-gray-500' },
  { value: 'met',      label: 'Met',      cls: 'bg-green-100 text-green-700' },
  { value: 'not_met',  label: 'Not Met',  cls: 'bg-red-100 text-red-700' },
  { value: 'na',       label: 'N/A',      cls: 'bg-blue-100 text-blue-600' },
];

function RequirementsChecklist({ coverage, caseId, canWrite, onUpdate }) {
  const [editing, setEditing] = useState(null); // ref being edited
  const [notes, setNotes]     = useState('');
  const [saving, setSaving]   = useState(false);

  async function handleStatus(ref, status, currentNotes) {
    setSaving(true);
    try {
      await casesApi.updateRequirement(caseId, ref, status, currentNotes);
      onUpdate();
    } finally {
      setSaving(false);
    }
  }

  async function saveNotes(ref, status) {
    setSaving(true);
    try {
      await casesApi.updateRequirement(caseId, ref, status, notes);
      setEditing(null);
      onUpdate();
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="space-y-3">
      <p className="text-sm text-gray-600">
        <span className="font-semibold text-gray-900">{coverage.met_count}</span> of{' '}
        <span className="font-semibold text-gray-900">{coverage.total}</span> requirements met or marked N/A.
      </p>
      <div className="card divide-y divide-gray-50 overflow-hidden">
        {coverage.coverage.map(({ ref, description, status, notes: existingNotes, allows_na }) => {
          const statusOpt = STATUS_OPTIONS.find(s => s.value === status) || STATUS_OPTIONS[0];
          return (
            <div key={ref} className="px-4 py-3 space-y-2">
              <div className="flex items-center gap-3">
                <ShieldCheckIcon className={clsx('h-5 w-5 shrink-0',
                  status === 'met' ? 'text-green-500' : status === 'not_met' ? 'text-red-400' :
                  status === 'na' ? 'text-blue-400' : 'text-gray-300')} />
                <span className="font-mono text-sm font-semibold text-gray-700 w-16 shrink-0">{ref}</span>
                <span className="text-sm text-gray-600 flex-1">{description}</span>
                {canWrite ? (
                  <div className="flex gap-1 shrink-0 flex-wrap justify-end">
                    {STATUS_OPTIONS.filter(o => o.value !== 'pending' && (allows_na || o.value !== 'na')).map(opt => (
                      <button key={opt.value} disabled={saving}
                        onClick={() => handleStatus(ref, opt.value, existingNotes)}
                        className={clsx('badge cursor-pointer border transition-opacity',
                          status === opt.value ? opt.cls + ' opacity-100 ring-1 ring-offset-1 ring-current' : 'bg-gray-50 text-gray-400 hover:opacity-80')}>
                        {opt.label}
                      </button>
                    ))}
                  </div>
                ) : (
                  <span className={clsx('badge shrink-0', statusOpt.cls)}>{statusOpt.label}</span>
                )}
              </div>
              {/* Notes */}
              {editing === ref ? (
                <div className="flex gap-2 ml-24">
                  <input className="input flex-1 text-sm" placeholder="Add notes…"
                    value={notes} onChange={e => setNotes(e.target.value)}
                    onKeyDown={e => e.key === 'Enter' && saveNotes(ref, status)} autoFocus />
                  <button onClick={() => saveNotes(ref, status)} disabled={saving} className="btn-primary text-xs px-3 py-1">Save</button>
                  <button onClick={() => setEditing(null)} className="btn-secondary text-xs px-3 py-1">Cancel</button>
                </div>
              ) : (
                <div className="ml-24 flex items-center gap-2">
                  {existingNotes && <span className="text-xs text-gray-500 italic">{existingNotes}</span>}
                  {canWrite && (
                    <button onClick={() => { setEditing(ref); setNotes(existingNotes || ''); }}
                      className="text-xs text-brand-600 hover:underline">
                      {existingNotes ? 'Edit note' : '+ Add note'}
                    </button>
                  )}
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

export default function CaseDetail() {
  const { id } = useParams();
  const { user } = useAuth();
  const navigate = useNavigate();
  const [caseData, setCaseData]   = useState(null);
  const [actions, setActions]     = useState([]);
  const [evidence, setEvidence]   = useState([]);
  const [coverage, setCoverage]   = useState(null);
  const [tab, setTab]             = useState('actions');
  const [actionText, setActionText]   = useState('');
  const [actionRefs, setActionRefs]   = useState('');
  const [submittingAction, setSubmittingAction] = useState(false);
  const [uploadFile, setUploadFile]   = useState(null);
  const [uploading, setUploading]     = useState(false);
  const [loading, setLoading]         = useState(true);
  const [exporting, setExporting]     = useState(false);
  const [exportUrl, setExportUrl]     = useState(null);

  const canWrite = ['admin', 'ir_lead', 'ir_analyst'].includes(user?.role);
  const canTransition = ['admin', 'ir_lead'].includes(user?.role);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [{ data: c }, { data: a }, { data: e }, { data: cov }] = await Promise.all([
        casesApi.get(id),
        actionsApi.list(id),
        evidenceApi.list(id),
        casesApi.requirements(id),
      ]);
      setCaseData(c); setActions(a); setEvidence(e.chain_of_custody); setCoverage(cov);
    } finally { setLoading(false); }
  }, [id]);

  useEffect(() => { load(); }, [load]);

  async function handleStatusChange(status) {
    await casesApi.status(id, status);
    load();
  }

  async function handleAddAction(e) {
    e.preventDefault();
    if (!actionText.trim()) return;
    setSubmittingAction(true);
    try {
      const refs = actionRefs.split(',').map(s => s.trim()).filter(Boolean);
      await actionsApi.create(id, { description: actionText, requirement_refs: refs });
      setActionText(''); setActionRefs('');
      load();
    } finally { setSubmittingAction(false); }
  }

  async function handleUpload(e) {
    e.preventDefault();
    if (!uploadFile) return;
    setUploading(true);
    try {
      const fd = new FormData();
      fd.append('file', uploadFile);
      await evidenceApi.upload(id, fd);
      setUploadFile(null);
      e.target.reset();
      load();
    } finally { setUploading(false); }
  }

  async function handleExport() {
    setExporting(true);
    setExportUrl(null);
    try {
      const { data } = await exportsApi.generate(id);
      setExportUrl(data.download_url);
    } catch (err) {
      alert(err.response?.data?.error || 'Export failed');
    } finally {
      setExporting(false);
    }
  }

  if (loading) return (
    <div className="p-6 text-center text-gray-400 text-sm">Loading case…</div>
  );
  if (!caseData) return (
    <div className="p-6 text-center text-gray-500">Case not found.</div>
  );

  const nextStatuses = TRANSITIONS[caseData.status] || [];

  return (
    <div className="p-6 space-y-5 max-w-5xl">
      {/* Header */}
      <div>
        <button onClick={() => navigate('/cases')}
          className="flex items-center gap-1 text-sm text-gray-500 hover:text-gray-700 mb-3">
          <ArrowLeftIcon className="h-3 w-3" /> All cases
        </button>
        <div className="flex items-start justify-between gap-4">
          <div>
            <div className="flex items-center gap-2 mb-1">
              <span className={clsx('badge', CLASSIFICATION_COLORS[caseData.classification])}>
                {caseData.classification}
              </span>
              {caseData.saq_type && (
                <span className="badge bg-gray-100 text-gray-600">SAQ {caseData.saq_type}</span>
              )}
              <span className={clsx('badge border', STATUS_COLORS[caseData.status])}>
                {caseData.status}
              </span>
            </div>
            <h1 className="text-xl font-bold text-gray-900">{caseData.title}</h1>
            <DeadlineCountdown ms={caseData.deadline_remaining_ms} />
          </div>
          <div className="flex gap-2 shrink-0 flex-wrap justify-end">
            {canTransition && nextStatuses.map(s => (
              <button key={s} onClick={() => handleStatusChange(s)} className="btn-secondary capitalize">
                Mark {s} <ChevronRightIcon className="h-3 w-3" />
              </button>
            ))}
            {['admin','ir_lead'].includes(user?.role) && (
              exportUrl ? (
                <a href={exportUrl} target="_blank" rel="noreferrer" className="btn-primary">
                  <ArrowDownTrayIcon className="h-4 w-4" /> Download Export
                </a>
              ) : (
                <button onClick={handleExport} disabled={exporting} className="btn-secondary">
                  <ArrowDownTrayIcon className="h-4 w-4" />
                  {exporting ? 'Generating…' : 'QSA Export'}
                </button>
              )
            )}
          </div>
        </div>
      </div>

      {/* Tabs */}
      <div className="border-b border-gray-200">
        {[
          { key: 'actions',  label: `Actions (${actions.length})`,   icon: DocumentTextIcon },
          { key: 'evidence', label: `Evidence (${evidence.length})`, icon: PaperClipIcon },
          { key: 'coverage', label: `Requirements (${coverage ? `${coverage.met_count}/${coverage.total}` : '…'})`, icon: ShieldCheckIcon },
        ].map(({ key, label, icon: Icon }) => (
          <button key={key} onClick={() => setTab(key)}
            className={clsx('inline-flex items-center gap-2 px-4 py-2.5 text-sm font-medium border-b-2 -mb-px transition-colors',
              tab === key
                ? 'border-brand-600 text-brand-600'
                : 'border-transparent text-gray-500 hover:text-gray-700')}>
            <Icon className="h-4 w-4" />{label}
          </button>
        ))}
      </div>

      {/* Actions tab */}
      {tab === 'actions' && (
        <div className="space-y-4">
          {canWrite && caseData.status !== 'closed' && (
            <form onSubmit={handleAddAction} className="card p-4 space-y-3">
              <h3 className="font-medium text-gray-900 text-sm">Log Action</h3>
              <textarea required rows={3} className="input resize-none" placeholder="Describe what was done…"
                value={actionText} onChange={e => setActionText(e.target.value)} />
              <div className="flex gap-3">
                <input className="input flex-1" placeholder="PCI-DSS refs: 12.10.1, 10.7 (optional)"
                  value={actionRefs} onChange={e => setActionRefs(e.target.value)} />
                <button type="submit" disabled={submittingAction} className="btn-primary shrink-0">
                  {submittingAction ? 'Logging…' : 'Log Action'}
                </button>
              </div>
            </form>
          )}
          <div className="space-y-2">
            {actions.length === 0 && <p className="text-sm text-gray-400 text-center py-8">No actions logged yet.</p>}
            {actions.map(a => (
              <div key={a.id} className="card p-4">
                <div className="flex items-start justify-between gap-4">
                  <p className="text-sm text-gray-800 whitespace-pre-wrap flex-1">{a.description}</p>
                  <time className="text-xs text-gray-400 shrink-0">
                    {new Date(a.created_at).toLocaleString()}
                  </time>
                </div>
                <div className="mt-2 flex items-center gap-3">
                  <span className="text-xs text-gray-500">{a.actor_name}</span>
                  {a.requirement_refs?.length > 0 && (
                    <div className="flex gap-1 flex-wrap">
                      {a.requirement_refs.map(ref => (
                        <span key={ref} className="badge bg-brand-50 text-brand-700">{ref}</span>
                      ))}
                    </div>
                  )}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Evidence tab */}
      {tab === 'evidence' && (
        <div className="space-y-4">
          {canWrite && caseData.status !== 'closed' && (
            <form onSubmit={handleUpload} className="card p-4 space-y-3">
              <h3 className="font-medium text-gray-900 text-sm">Upload Evidence</h3>
              <input type="file" className="text-sm text-gray-600" required
                onChange={e => setUploadFile(e.target.files[0])} />
              <button type="submit" disabled={uploading} className="btn-primary">
                {uploading ? 'Uploading…' : 'Upload'}
              </button>
            </form>
          )}
          <div className="card overflow-hidden">
            {evidence.length === 0 ? (
              <p className="text-sm text-gray-400 text-center py-8">No evidence uploaded.</p>
            ) : (
              <table className="w-full text-sm">
                <thead className="bg-gray-50 border-b border-gray-100">
                  <tr>
                    {['Filename', 'SHA-256', 'Size', 'Uploaded By', 'Time'].map(h => (
                      <th key={h} className="text-left px-4 py-2.5 text-xs font-semibold text-gray-500 uppercase">{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-50">
                  {evidence.map(ev => (
                    <tr key={ev.id}>
                      <td className="px-4 py-3 font-medium text-gray-900 max-w-xs truncate">{ev.filename}</td>
                      <td className="px-4 py-3 font-mono text-xs text-gray-400 max-w-xs truncate" title={ev.sha256_hash}>{ev.sha256_hash.slice(0, 16)}…</td>
                      <td className="px-4 py-3 text-gray-500">{(ev.file_size / 1024).toFixed(1)} KB</td>
                      <td className="px-4 py-3 text-gray-500">{ev.uploaded_by_name}</td>
                      <td className="px-4 py-3 text-gray-400">{new Date(ev.uploaded_at).toLocaleString()}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        </div>
      )}

      {/* Requirements checklist tab */}
      {tab === 'coverage' && coverage && (
        <RequirementsChecklist
          coverage={coverage}
          caseId={id}
          canWrite={canWrite && caseData.status !== 'closed'}
          onUpdate={load}
        />
      )}
    </div>
  );
}
