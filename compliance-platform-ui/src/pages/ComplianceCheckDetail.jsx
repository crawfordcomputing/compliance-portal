import { useState, useEffect, useCallback } from 'react';
import { useParams, useNavigate, useLocation } from 'react-router-dom';
import { calendarApi } from '../api/client';
import { useAuth } from '../context/AuthContext';
import { ArrowLeftIcon, PaperClipIcon, CheckBadgeIcon, InformationCircleIcon } from '@heroicons/react/24/outline';
import clsx from 'clsx';

const STATUS_OPTIONS = ['pending','in_progress','complete','na','waived'];
const STATUS_STYLE = {
  pending:     'bg-gray-100 text-gray-500',
  in_progress: 'bg-blue-100 text-blue-700',
  complete:    'bg-green-100 text-green-700',
  overdue:     'bg-red-100 text-red-700',
  na:          'bg-purple-100 text-purple-600',
  waived:      'bg-yellow-100 text-yellow-700',
};

export default function ComplianceCheckDetail() {
  const { id } = useParams();
  const { user } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const [inst, setInst]           = useState(null);
  const [loading, setLoading]     = useState(true);
  const [uploading, setUploading] = useState(false);
  const [saving, setSaving]       = useState(false);
  const [label, setLabel]         = useState('');
  const [notes, setNotes]         = useState('');
  const [naReason, setNaReason]   = useState('');
  const [showInstructions, setShowInstructions] = useState(false);

  const canEdit = ['admin', 'ir_lead', 'ir_analyst'].includes(user?.role);
  const canSignoff = ['admin', 'ir_lead'].includes(user?.role);

  const load = useCallback(() => {
    calendarApi.getInstance(id).then(({ data }) => {
      setInst(data);
      setNotes(data.notes || '');
      setNaReason(data.na_reason || '');
    }).finally(() => setLoading(false));
  }, [id]);

  useEffect(() => { load(); }, [load]);

  async function handleStatus(status) {
    setSaving(true);
    try {
      await calendarApi.updateInstance(id, { status, notes: notes || null, na_reason: naReason || null });
      load();
    } finally { setSaving(false); }
  }

  async function handleSaveNotes() {
    setSaving(true);
    try {
      await calendarApi.updateInstance(id, { notes: notes || null });
      load();
    } finally { setSaving(false); }
  }

  async function handleUpload(e) {
    e.preventDefault();
    const file = e.target.file.files[0];
    if (!file) return;
    setUploading(true);
    try {
      const fd = new FormData();
      fd.append('file', file);
      fd.append('label', label || file.name);
      await calendarApi.uploadEvidence(id, fd);
      setLabel('');
      e.target.reset();
      load();
    } finally { setUploading(false); }
  }

  async function handleSignoff() {
    if (!confirm('Sign off on this compliance check as Approver?')) return;
    setSaving(true);
    try {
      await calendarApi.signoff(id, { role: 'approver', notes: notes || null });
      load();
    } finally { setSaving(false); }
  }

  if (loading) return <div className="p-6 text-sm text-gray-400">Loading…</div>;
  if (!inst)   return <div className="p-6 text-sm text-red-500">Check not found.</div>;

  const hasSignoff = inst.signoffs?.some(s => s.role === 'approver');

  return (
    <div className="p-6 space-y-5 max-w-3xl">
      <button
        onClick={() => navigate(location.state?.tab === 'all' ? '/compliance/all' : '/compliance')}
        className="flex items-center gap-1 text-sm text-gray-500 hover:text-gray-700"
      >
        <ArrowLeftIcon className="h-3 w-3" /> Compliance
      </button>

      {/* Header */}
      <div className="card p-5 space-y-3">
        <div className="flex items-start justify-between gap-4">
          <div>
            <div className="flex items-center gap-2 mb-1 flex-wrap">
              <span className="badge bg-gray-100 text-gray-600">{inst.period_label}</span>
              <span className={clsx('badge', STATUS_STYLE[inst.status])}>{inst.status.replace('_',' ')}</span>
              {inst.pci_req_refs?.map(r => (
                <span key={r} className="badge bg-brand-50 text-brand-700">{r}</span>
              ))}
            </div>
            <h1 className="text-xl font-bold text-gray-900">{inst.name}</h1>
            <p className="text-sm text-gray-600 mt-1">{inst.description}</p>
            <p className="text-xs text-gray-400 mt-1">
              Due: {new Date(inst.due_date).toLocaleDateString()}
              {inst.sp_cadence_note && (
                <span className="ml-3 text-orange-600">{inst.sp_cadence_note}</span>
              )}
            </p>
          </div>
        </div>

        {/* Status controls */}
        {canEdit && inst.status !== 'complete' && (
          <div className="flex gap-2 flex-wrap pt-1">
            {STATUS_OPTIONS.filter(s => s !== inst.status).map(s => (
              <button key={s} onClick={() => handleStatus(s)} disabled={saving}
                className="btn-secondary text-xs px-3 py-1.5 capitalize">
                Mark {s.replace('_',' ')}
              </button>
            ))}
            {canSignoff && !hasSignoff && (() => {
              const required = inst.required_evidence_labels || [];
              const uploaded = new Set((inst.evidence || []).map(e => e.label));
              const missing  = required.filter(l => !uploaded.has(l));
              const blocked  = missing.length > 0;
              return (
                <div className="flex flex-col gap-1">
                  <button
                    onClick={handleSignoff}
                    disabled={saving || blocked}
                    title={blocked ? `Missing: ${missing.join(', ')}` : undefined}
                    className={clsx(
                      'btn-primary text-xs px-3 py-1.5 flex items-center gap-1',
                      blocked && 'opacity-40 cursor-not-allowed'
                    )}
                  >
                    <CheckBadgeIcon className="h-4 w-4" /> Approve & Complete
                  </button>
                  {blocked && (
                    <p className="text-xs text-red-500">
                      Still needed: {missing.join(', ')}
                    </p>
                  )}
                </div>
              );
            })()}
          </div>
        )}

        {/* N/A reason */}
        {(inst.status === 'na' || inst.status === 'waived') && (
          <div>
            <label className="block text-xs font-medium text-gray-600 mb-1">Reason</label>
            <input className="input text-sm" value={naReason}
              onChange={e => setNaReason(e.target.value)}
              onBlur={() => calendarApi.updateInstance(id, { na_reason: naReason || null })}
              placeholder="Document why this check is N/A or waived…" disabled={!canEdit} />
          </div>
        )}
      </div>

      {/* Instructions */}
      {inst.instructions && (
        <div className="card overflow-hidden">
          <button onClick={() => setShowInstructions(!showInstructions)}
            className="w-full flex items-center gap-2 px-5 py-3 text-sm font-medium text-gray-700 hover:bg-gray-50">
            <InformationCircleIcon className="h-4 w-4 text-brand-500" />
            How to complete this check
            <span className="ml-auto text-gray-400">{showInstructions ? '▲' : '▼'}</span>
          </button>
          {showInstructions && (
            <div className="px-5 pb-4 border-t border-gray-50">
              <pre className="text-sm text-gray-700 whitespace-pre-wrap font-sans leading-relaxed mt-3">
                {inst.instructions}
              </pre>
              {inst.required_evidence_labels?.length > 0 && (
                <div className="mt-3">
                  <p className="text-xs font-semibold text-gray-500 uppercase mb-1">Required Evidence</p>
                  <div className="flex flex-wrap gap-2">
                    {inst.required_evidence_labels.map(l => (
                      <span key={l} className={clsx('badge',
                        inst.evidence?.some(e => e.label === l)
                          ? 'bg-green-100 text-green-700'
                          : 'bg-gray-100 text-gray-500')}>
                        {inst.evidence?.some(e => e.label === l) ? '✓ ' : ''}{l}
                      </span>
                    ))}
                  </div>
                </div>
              )}
            </div>
          )}
        </div>
      )}

      {/* Evidence */}
      <div className="card overflow-hidden">
        <div className="flex items-center gap-2 px-5 py-3.5 border-b border-gray-50">
          <PaperClipIcon className="h-4 w-4 text-gray-400" />
          <h2 className="font-semibold text-sm text-gray-900">Evidence ({inst.evidence?.length || 0})</h2>
        </div>
        {canEdit && inst.status !== 'complete' && (
          <form onSubmit={handleUpload} className="flex gap-3 px-5 py-3 border-b border-gray-50">
            <input name="label" className="input flex-1" placeholder="Label (e.g. ASV Report)" value={label}
              onChange={e => setLabel(e.target.value)} />
            <input name="file" type="file" required className="text-sm text-gray-600" />
            <button type="submit" disabled={uploading} className="btn-primary shrink-0 text-sm">
              {uploading ? 'Uploading…' : 'Upload'}
            </button>
          </form>
        )}
        {!inst.evidence?.length ? (
          <p className="px-5 py-4 text-sm text-gray-400">No evidence uploaded yet.</p>
        ) : (
          <table className="w-full text-sm">
            <thead className="bg-gray-50">
              <tr>
                {['Label','Filename','Uploaded By','Date'].map(h => (
                  <th key={h} className="text-left px-4 py-2 text-xs font-semibold text-gray-500 uppercase">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-50">
              {inst.evidence.map(ev => (
                <tr key={ev.id}>
                  <td className="px-4 py-2.5 font-medium text-gray-800">{ev.label}</td>
                  <td className="px-4 py-2.5 text-gray-500 max-w-xs truncate">{ev.filename}</td>
                  <td className="px-4 py-2.5 text-gray-500">{ev.uploaded_by_name}</td>
                  <td className="px-4 py-2.5 text-gray-400">{new Date(ev.uploaded_at).toLocaleDateString()}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {/* Notes */}
      <div className="card p-5 space-y-2">
        <h2 className="font-semibold text-sm text-gray-900">Notes</h2>
        <textarea rows={3} className="input resize-none w-full" value={notes} disabled={!canEdit}
          onChange={e => setNotes(e.target.value)}
          placeholder="Add notes, observations, or context for this check period…" />
        {canEdit && (
          <button onClick={handleSaveNotes} disabled={saving} className="btn-secondary text-sm">
            {saving ? 'Saving…' : 'Save Notes'}
          </button>
        )}
      </div>

      {/* Sign-offs */}
      {inst.signoffs?.length > 0 && (
        <div className="card p-5">
          <h2 className="font-semibold text-sm text-gray-900 mb-3">Sign-offs</h2>
          <div className="space-y-2">
            {inst.signoffs.map(s => (
              <div key={s.id} className="flex items-center gap-3 text-sm">
                <CheckBadgeIcon className="h-4 w-4 text-green-500" />
                <span className="font-medium">{s.signed_by_name}</span>
                <span className="badge bg-green-100 text-green-700 capitalize">{s.role}</span>
                <span className="text-gray-400">{new Date(s.signed_at).toLocaleString()}</span>
                {s.notes && <span className="text-gray-500 italic">— {s.notes}</span>}
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
