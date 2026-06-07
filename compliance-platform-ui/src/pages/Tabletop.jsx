import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { scenariosApi, exercisesApi } from '../api/client';
import { useAuth } from '../context/AuthContext';
import { ShieldCheckIcon, PlayIcon, ClockIcon, LockClosedIcon } from '@heroicons/react/24/outline';
import clsx from 'clsx';

const REQ_COLORS = {
  '12.10': 'bg-blue-50 text-blue-700',
  '10.':   'bg-purple-50 text-purple-700',
  '6.':    'bg-green-50 text-green-700',
  '9.':    'bg-orange-50 text-orange-700',
  '7.':    'bg-yellow-50 text-yellow-700',
  '8.':    'bg-red-50 text-red-700',
};

function reqColor(ref) {
  for (const [prefix, cls] of Object.entries(REQ_COLORS)) {
    if (ref.startsWith(prefix)) return cls;
  }
  return 'bg-gray-100 text-gray-600';
}

export default function Tabletop() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const [scenarios, setScenarios] = useState([]);
  const [exercises, setExercises] = useState([]);
  const [loading, setLoading] = useState(true);
  const [launching, setLaunching] = useState(null);

  const canLaunch = ['admin', 'ir_lead'].includes(user?.role);

  useEffect(() => {
    Promise.all([scenariosApi.list(), exercisesApi.list()])
      .then(([{ data: s }, { data: e }]) => { setScenarios(s); setExercises(e); })
      .finally(() => setLoading(false));
  }, []);

  async function launchExercise(scenarioId) {
    setLaunching(scenarioId);
    try {
      const { data } = await exercisesApi.create({ scenario_id: scenarioId, participants: [] });
      navigate(`/tabletop/exercises/${data.id}`);
    } catch (err) {
      alert(err.response?.data?.error || 'Failed to create exercise');
    } finally {
      setLaunching(null);
    }
  }

  if (loading) return <div className="p-6 text-sm text-gray-400">Loading scenarios…</div>;

  return (
    <div className="p-6 space-y-8">
      <div>
        <h1 className="text-2xl font-bold text-gray-900">Tabletop Exercises</h1>
        <p className="text-sm text-gray-500 mt-1">PCI-DSS 12.10.2 — annual exercise requirement</p>
      </div>

      {/* Recent exercises */}
      {exercises.length > 0 && (
        <div>
          <h2 className="text-base font-semibold text-gray-900 mb-3">Recent Exercises</h2>
          <div className="card divide-y divide-gray-50">
            {exercises.slice(0, 5).map(ex => (
              <button key={ex.id} onClick={() => navigate(`/tabletop/exercises/${ex.id}`)}
                className="w-full flex items-center justify-between px-5 py-3 hover:bg-gray-50 transition-colors text-left">
                <div>
                  <p className="text-sm font-medium text-gray-900">{ex.scenario_title}</p>
                  <p className="text-xs text-gray-400">
                    Facilitated by {ex.facilitator_name} · {new Date(ex.created_at).toLocaleDateString()}
                  </p>
                </div>
                <span className={clsx('badge', ex.ended_at ? 'bg-gray-100 text-gray-500' : ex.started_at ? 'bg-green-100 text-green-700' : 'bg-blue-100 text-blue-700')}>
                  {ex.ended_at ? 'Completed' : ex.started_at ? 'In Progress' : 'Not Started'}
                </span>
              </button>
            ))}
          </div>
        </div>
      )}

      {/* Scenario library */}
      <div>
        <h2 className="text-base font-semibold text-gray-900 mb-3">Scenario Library</h2>
        <div className="grid gap-4 lg:grid-cols-2">
          {scenarios.map(s => (
            <div key={s.id} className="card p-5 flex flex-col gap-3">
              <div className="flex items-start justify-between gap-3">
                <div className="flex items-start gap-3">
                  <div className={clsx('p-2 rounded-lg mt-0.5 shrink-0', s.is_builtin ? 'bg-brand-50' : 'bg-gray-50')}>
                    <ShieldCheckIcon className={clsx('h-5 w-5', s.is_builtin ? 'text-brand-600' : 'text-gray-400')} />
                  </div>
                  <div>
                    <div className="flex items-center gap-2">
                      <p className="text-sm font-semibold text-gray-900">{s.title}</p>
                      {s.is_builtin && <span className="badge bg-brand-50 text-brand-600">Built-in</span>}
                    </div>
                    <p className="text-xs text-gray-500 mt-1 line-clamp-2">{s.description}</p>
                  </div>
                </div>
              </div>

              <div className="flex items-center gap-2 text-xs text-gray-500">
                <ClockIcon className="h-3.5 w-3.5" />
                {s.injects?.length || 0} injects
                <span className="mx-1">·</span>
                {s.roles?.length || 0} roles
              </div>

              <div className="flex flex-wrap gap-1">
                {(s.requirement_focus || []).map(ref => (
                  <span key={ref} className={clsx('badge', reqColor(ref))}>{ref}</span>
                ))}
              </div>

              <div className="pt-1">
                {canLaunch ? (
                  <button onClick={() => launchExercise(s.id)}
                    disabled={launching === s.id}
                    className="btn-primary w-full justify-center">
                    <PlayIcon className="h-4 w-4" />
                    {launching === s.id ? 'Creating exercise…' : 'Launch Exercise'}
                  </button>
                ) : (
                  <div className="flex items-center gap-2 text-xs text-gray-400 justify-center py-1">
                    <LockClosedIcon className="h-3.5 w-3.5" /> ir_lead or admin role required to launch
                  </div>
                )}
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
