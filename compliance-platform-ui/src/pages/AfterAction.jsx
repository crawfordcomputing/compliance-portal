import { useState, useEffect } from 'react';
import { useParams, Link } from 'react-router-dom';
import { exercisesApi, exportsApi } from '../api/client';
import { useAuth } from '../context/AuthContext';
import { ShieldCheckIcon, ShieldExclamationIcon, ClockIcon, DocumentTextIcon, ArrowDownTrayIcon } from '@heroicons/react/24/outline';
import clsx from 'clsx';

export default function AfterAction() {
  const { id } = useParams();
  const { user } = useAuth();
  const [report, setReport]   = useState(null);
  const [loading, setLoading] = useState(true);
  const [exporting, setExporting] = useState(false);
  const [exportUrl, setExportUrl] = useState(null);

  async function handleExport(caseId) {
    setExporting(true);
    try {
      const { data } = await exportsApi.generate(caseId);
      setExportUrl(data.download_url);
    } catch (err) {
      alert(err.response?.data?.error || 'Export failed');
    } finally {
      setExporting(false);
    }
  }

  useEffect(() => {
    exercisesApi.afterAction(id).then(({ data }) => setReport(data)).finally(() => setLoading(false));
  }, [id]);

  if (loading) return <div className="p-6 text-sm text-gray-400">Generating report…</div>;
  if (!report)  return <div className="p-6 text-sm text-red-500">Failed to load report.</div>;

  const { exercise, summary, timeline, gaps } = report;

  return (
    <div className="p-6 space-y-6 max-w-4xl">
      <div className="flex items-start justify-between">
        <div>
          <Link to="/tabletop" className="text-sm text-gray-500 hover:text-gray-700">← Tabletop</Link>
          {['admin','ir_lead'].includes(user?.role) && report && (
            <div className="mt-2">
              {exportUrl ? (
                <a href={exportUrl} target="_blank" rel="noreferrer" className="btn-primary text-sm">
                  <ArrowDownTrayIcon className="h-4 w-4" /> Download QSA Export
                </a>
              ) : (
                <button onClick={() => handleExport(report.exercise.case_id)}
                  disabled={exporting} className="btn-secondary text-sm">
                  <ArrowDownTrayIcon className="h-4 w-4" />
                  {exporting ? 'Generating…' : 'QSA Export Package'}
                </button>
              )}
            </div>
          )}
          <h1 className="text-2xl font-bold text-gray-900 mt-2">After-Action Report</h1>
          <p className="text-gray-600 mt-1">{exercise.scenario_title}</p>
          <p className="text-xs text-gray-400 mt-1">
            {exercise.started_at ? new Date(exercise.started_at).toLocaleString() : 'Not started'} —{' '}
            {exercise.ended_at ? new Date(exercise.ended_at).toLocaleString() : 'Ongoing'}
          </p>
        </div>
      </div>

      {/* Summary cards */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        {[
          { label: 'Duration',           value: summary.duration_minutes != null ? `${summary.duration_minutes}m` : '—', icon: ClockIcon, color: 'text-blue-600 bg-blue-50' },
          { label: 'Responses Logged',   value: summary.actions_logged, icon: DocumentTextIcon, color: 'text-brand-600 bg-brand-50' },
          { label: 'Requirements Covered', value: `${summary.requirements_covered}/${summary.requirements_in_focus}`, icon: ShieldCheckIcon, color: 'text-green-600 bg-green-50' },
          { label: 'Gaps Identified',    value: summary.gaps_identified, icon: ShieldExclamationIcon, color: 'text-red-600 bg-red-50' },
        ].map(({ label, value, icon: Icon, color }) => (
          <div key={label} className="card p-4 flex items-center gap-3">
            <div className={clsx('p-2 rounded-lg', color)}><Icon className="h-5 w-5" /></div>
            <div>
              <p className="text-xl font-bold text-gray-900">{value}</p>
              <p className="text-xs text-gray-500">{label}</p>
            </div>
          </div>
        ))}
      </div>

      {/* Missed requirements */}
      {summary.requirements_missed?.length > 0 && (
        <div className="card p-4 border-red-200 bg-red-50">
          <h2 className="font-semibold text-red-700 mb-2 text-sm">Requirements Not Referenced</h2>
          <div className="flex flex-wrap gap-2">
            {summary.requirements_missed.map(r => (
              <span key={r} className="badge bg-red-100 text-red-700">{r}</span>
            ))}
          </div>
          <p className="text-xs text-red-600 mt-2">
            These requirements were in scope for this scenario but no actions referenced them. Consider targeted training.
          </p>
        </div>
      )}

      {/* Gaps */}
      {gaps.length > 0 && (
        <div>
          <h2 className="font-semibold text-gray-900 mb-3">
            Gaps Identified ({summary.gaps_remediated}/{summary.gaps_identified} remediated)
          </h2>
          <div className="card divide-y divide-gray-50">
            {gaps.map(g => (
              <div key={g.id} className="flex items-start gap-3 px-4 py-3">
                <ShieldExclamationIcon className={clsx('h-5 w-5 shrink-0 mt-0.5', g.remediated ? 'text-green-500' : 'text-red-400')} />
                <div className="flex-1">
                  <span className="badge bg-gray-100 text-gray-600 mb-1 mr-2">{g.requirement_ref}</span>
                  {g.remediated && <span className="badge bg-green-100 text-green-700 mb-1">Remediated</span>}
                  <p className="text-sm text-gray-800">{g.description}</p>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Response timeline */}
      <div>
        <h2 className="font-semibold text-gray-900 mb-3">Response Timeline ({timeline.length} actions)</h2>
        {timeline.length === 0 ? (
          <p className="text-sm text-gray-400">No responses were logged during this exercise.</p>
        ) : (
          <div className="space-y-2">
            {timeline.map((a, i) => (
              <div key={a.id} className="flex gap-4">
                <div className="flex flex-col items-center">
                  <div className="w-6 h-6 rounded-full bg-brand-100 text-brand-700 text-xs font-bold flex items-center justify-center shrink-0">
                    {i + 1}
                  </div>
                  {i < timeline.length - 1 && <div className="w-px flex-1 bg-gray-200 my-1" />}
                </div>
                <div className="card p-3 flex-1 mb-2">
                  <div className="flex items-start justify-between gap-2">
                    <p className="text-sm text-gray-800">{a.description}</p>
                    <time className="text-xs text-gray-400 shrink-0">{new Date(a.created_at).toLocaleTimeString()}</time>
                  </div>
                  <div className="mt-1.5 flex items-center gap-2 flex-wrap">
                    <span className="text-xs text-gray-500">{a.actor_name}</span>
                    {a.requirement_refs?.map(r => (
                      <span key={r} className="badge bg-brand-50 text-brand-700 text-xs">{r}</span>
                    ))}
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
