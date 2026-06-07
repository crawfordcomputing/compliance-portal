import { useState, useEffect, useCallback, useRef } from 'react';
import { useParams, useNavigate, Link } from 'react-router-dom';
import { exercisesApi, actionsApi, gapsApi } from '../api/client';
import { useAuth } from '../context/AuthContext';
import { ArrowLeftIcon, PlayIcon, StopIcon, PlusIcon, ShieldExclamationIcon } from '@heroicons/react/24/outline';
import clsx from 'clsx';

export default function ExerciseDetail() {
  const { id } = useParams();
  const { user } = useAuth();
  const navigate = useNavigate();
  const [exercise, setExercise]     = useState(null);
  const [actions, setActions]       = useState([]);
  const [gaps, setGaps]             = useState([]);
  const [tab, setTab]               = useState('injects');
  const [actionText, setActionText] = useState('');
  const [actionRefs, setActionRefs] = useState('');
  const [gapRef, setGapRef]         = useState('');
  const [gapDesc, setGapDesc]       = useState('');
  const [elapsed, setElapsed]       = useState(0);
  const timerRef = useRef(null);

  const canFacilitate = ['admin', 'ir_lead'].includes(user?.role);

  const load = useCallback(async () => {
    const [{ data: ex }, { data: a }, { data: g }] = await Promise.all([
      exercisesApi.get(id),
      actionsApi.list(id).catch(() => ({ data: [] })),
      gapsApi.list(id),
    ]);
    // actions are on the linked case
    const { data: caseActions } = await actionsApi.list(ex.case_id).catch(() => ({ data: [] }));
    setExercise(ex); setActions(caseActions); setGaps(g);
  }, [id]);

  useEffect(() => { load(); }, [load]);

  // Elapsed timer
  useEffect(() => {
    if (exercise?.started_at && !exercise?.ended_at) {
      timerRef.current = setInterval(() => {
        setElapsed(Math.floor((Date.now() - new Date(exercise.started_at)) / 1000));
      }, 1000);
    }
    return () => clearInterval(timerRef.current);
  }, [exercise?.started_at, exercise?.ended_at]);

  async function handleStart() {
    await exercisesApi.start(id);
    load();
  }
  async function handleEnd() {
    if (!confirm('End this exercise and generate the after-action report?')) return;
    await exercisesApi.end(id);
    navigate(`/tabletop/exercises/${id}/after-action`);
  }
  async function handleLogAction(e) {
    e.preventDefault();
    if (!actionText.trim() || !exercise) return;
    const refs = actionRefs.split(',').map(s => s.trim()).filter(Boolean);
    await actionsApi.create(exercise.case_id, { description: actionText, requirement_refs: refs });
    setActionText(''); setActionRefs('');
    load();
  }
  async function handleAddGap(e) {
    e.preventDefault();
    await gapsApi.create(id, { requirement_ref: gapRef, description: gapDesc });
    setGapRef(''); setGapDesc('');
    load();
  }
  async function handleRemediate(gid) {
    await gapsApi.remediate(id, gid);
    load();
  }

  function formatElapsed(s) {
    const m = Math.floor(s / 60);
    const sec = s % 60;
    return `${String(m).padStart(2,'0')}:${String(sec).padStart(2,'0')}`;
  }

  if (!exercise) return <div className="p-6 text-sm text-gray-400">Loading…</div>;

  const isStarted  = !!exercise.started_at;
  const isEnded    = !!exercise.ended_at;
  const injects    = exercise.injects || [];

  return (
    <div className="p-6 space-y-5 max-w-5xl">
      <div>
        <button onClick={() => navigate('/tabletop')}
          className="flex items-center gap-1 text-sm text-gray-500 hover:text-gray-700 mb-3">
          <ArrowLeftIcon className="h-3 w-3" /> Tabletop
        </button>
        <div className="flex items-start justify-between gap-4">
          <div>
            <h1 className="text-xl font-bold text-gray-900">{exercise.scenario_title}</h1>
            <p className="text-sm text-gray-500 mt-1">{exercise.scenario_description}</p>
          </div>
          <div className="flex items-center gap-3 shrink-0">
            {isStarted && !isEnded && (
              <div className="font-mono text-lg font-bold text-green-600 bg-green-50 px-3 py-1 rounded-lg">
                {formatElapsed(elapsed)}
              </div>
            )}
            {canFacilitate && !isStarted && (
              <button onClick={handleStart} className="btn-primary">
                <PlayIcon className="h-4 w-4" /> Start Exercise
              </button>
            )}
            {canFacilitate && isStarted && !isEnded && (
              <button onClick={handleEnd} className="btn-secondary text-red-600 border-red-200 hover:bg-red-50">
                <StopIcon className="h-4 w-4" /> End & Report
              </button>
            )}
            {isEnded && (
              <Link to={`/tabletop/exercises/${id}/after-action`} className="btn-primary">
                View After-Action Report
              </Link>
            )}
          </div>
        </div>
        {!isStarted && (
          <div className="mt-3 text-sm text-yellow-700 bg-yellow-50 border border-yellow-200 rounded-md px-4 py-2">
            Exercise has not started. Click "Start Exercise" to begin the clock and enable action logging.
          </div>
        )}
      </div>

      {/* Tabs */}
      <div className="border-b border-gray-200 flex gap-0">
        {[
          { key: 'injects', label: `Injects (${injects.length})` },
          { key: 'actions', label: `Response Log (${actions.length})` },
          { key: 'gaps',    label: `Gaps (${gaps.length})` },
        ].map(({ key, label }) => (
          <button key={key} onClick={() => setTab(key)}
            className={clsx('px-4 py-2.5 text-sm font-medium border-b-2 -mb-px transition-colors',
              tab === key ? 'border-brand-600 text-brand-600' : 'border-transparent text-gray-500 hover:text-gray-700')}>
            {label}
          </button>
        ))}
      </div>

      {/* Injects tab */}
      {tab === 'injects' && (
        <div className="space-y-3">
          {injects.map((inject, i) => (
            <div key={i} className="card p-4">
              <div className="flex items-center gap-3 mb-2">
                <span className="badge bg-brand-50 text-brand-700">Inject {inject.order}</span>
                <span className="text-xs text-gray-400 flex items-center gap-1">
                  T+{inject.delay_min}min
                </span>
              </div>
              <p className="text-sm text-gray-800">{inject.prompt}</p>
            </div>
          ))}
        </div>
      )}

      {/* Response log tab */}
      {tab === 'actions' && (
        <div className="space-y-4">
          {isStarted && !isEnded && (
            <form onSubmit={handleLogAction} className="card p-4 space-y-3">
              <h3 className="font-medium text-sm text-gray-900">Log Response</h3>
              <textarea required rows={3} className="input resize-none"
                placeholder="What did the team decide or do in response to this inject?"
                value={actionText} onChange={e => setActionText(e.target.value)} />
              <div className="flex gap-3">
                <input className="input flex-1" placeholder="PCI-DSS refs: 12.10.1, 10.7 (optional)"
                  value={actionRefs} onChange={e => setActionRefs(e.target.value)} />
                <button type="submit" className="btn-primary shrink-0">Log</button>
              </div>
            </form>
          )}
          <div className="space-y-2">
            {actions.length === 0 && <p className="text-sm text-gray-400 text-center py-8">No responses logged yet.</p>}
            {actions.map(a => (
              <div key={a.id} className="card p-4">
                <div className="flex items-start justify-between gap-4">
                  <p className="text-sm text-gray-800 flex-1">{a.description}</p>
                  <time className="text-xs text-gray-400 shrink-0">{new Date(a.created_at).toLocaleTimeString()}</time>
                </div>
                <div className="mt-2 flex items-center gap-3">
                  <span className="text-xs text-gray-500">{a.actor_name}</span>
                  {a.requirement_refs?.map(r => (
                    <span key={r} className="badge bg-brand-50 text-brand-700 text-xs">{r}</span>
                  ))}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Gaps tab */}
      {tab === 'gaps' && (
        <div className="space-y-4">
          {canFacilitate && (
            <form onSubmit={handleAddGap} className="card p-4 space-y-3">
              <h3 className="font-medium text-sm text-gray-900">Add Gap</h3>
              <div className="flex gap-3">
                <input required className="input w-40 shrink-0" placeholder="Req. ref (e.g. 12.10.5)"
                  value={gapRef} onChange={e => setGapRef(e.target.value)} />
                <input required className="input flex-1" placeholder="Describe the gap observed…"
                  value={gapDesc} onChange={e => setGapDesc(e.target.value)} />
                <button type="submit" className="btn-primary shrink-0"><PlusIcon className="h-4 w-4" /></button>
              </div>
            </form>
          )}
          <div className="space-y-2">
            {gaps.length === 0 && <p className="text-sm text-gray-400 text-center py-8">No gaps recorded.</p>}
            {gaps.map(g => (
              <div key={g.id} className="card p-4 flex items-start gap-3">
                <ShieldExclamationIcon className={clsx('h-5 w-5 shrink-0 mt-0.5', g.remediated ? 'text-green-500' : 'text-red-400')} />
                <div className="flex-1">
                  <span className="badge bg-gray-100 text-gray-600 mb-1">{g.requirement_ref}</span>
                  <p className="text-sm text-gray-800">{g.description}</p>
                  {g.remediated && (
                    <p className="text-xs text-green-600 mt-1">Remediated {new Date(g.remediated_at).toLocaleDateString()}</p>
                  )}
                </div>
                {canFacilitate && !g.remediated && (
                  <button onClick={() => handleRemediate(g.id)} className="btn-secondary text-xs px-2 py-1 shrink-0">
                    Mark Remediated
                  </button>
                )}
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
