import { useState, useEffect, useCallback, useRef } from "react";
import { useNavigate, useLocation } from "react-router-dom";
import { calendarApi, keyInventoryApi } from "../api/client";
import {
  ShieldCheckIcon, ShieldExclamationIcon, ClockIcon,
  ExclamationTriangleIcon, ChevronRightIcon, KeyIcon,
  BoltIcon, XMarkIcon,
} from "@heroicons/react/24/outline";
import clsx from "clsx";

const CADENCE_LABELS = {
  quarterly:       "Quarterly",
  semi_annual:     "Semi-Annual",
  annual:          "Annual",
  event_triggered: "Event-Triggered",
};
const CADENCE_ORDER = ["quarterly", "semi_annual", "annual", "event_triggered"];

const STATUS_STYLE = {
  pending:     "bg-gray-100 text-gray-500",
  in_progress: "bg-blue-100 text-blue-700",
  complete:    "bg-green-100 text-green-700",
  overdue:     "bg-red-100 text-red-700",
  na:          "bg-purple-100 text-purple-600",
  waived:      "bg-yellow-100 text-yellow-700",
};

function daysFromNow(date) {
  return Math.ceil((new Date(date) - new Date()) / (1000 * 60 * 60 * 24));
}

function StatusIcon({ status }) {
  if (status === "complete")                   return <ShieldCheckIcon         className="h-5 w-5 text-green-500 shrink-0" />;
  if (status === "overdue")                    return <ExclamationTriangleIcon className="h-5 w-5 text-red-500 shrink-0" />;
  if (status === "in_progress")                return <ClockIcon               className="h-5 w-5 text-blue-500 shrink-0" />;
  if (status === "na" || status === "waived")  return <ShieldCheckIcon         className="h-5 w-5 text-purple-400 shrink-0" />;
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
          {inst.pci_req_refs?.length > 0 && ` · ${inst.pci_req_refs.join(", ")}`}
        </p>
      </div>
      <div className="flex items-center gap-3 shrink-0">
        {days > 0 && days <= 14 && inst.status !== "complete" && (
          <span className="text-xs text-orange-600 font-medium">{days}d left</span>
        )}
        {inst.status === "overdue" && (
          <span className="text-xs text-red-600 font-semibold">{Math.abs(days)}d overdue</span>
        )}
        <span className={clsx("badge", STATUS_STYLE[inst.status])}>
          {inst.status.replace("_", " ")}
        </span>
        {inst.evidence?.length > 0 && (
          <span className="text-xs text-gray-400">
            {inst.evidence.length} file{inst.evidence.length !== 1 ? "s" : ""}
          </span>
        )}
        <ChevronRightIcon className="h-4 w-4 text-gray-300" />
      </div>
    </button>
  );
}

// ── This Period Tab ──────────────────────────────────────────────────────────

function ThisPeriodTab({ onNavigate, refreshKey }) {
  const [data, setData]       = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    setLoading(true);
    calendarApi.current()
      .then(({ data }) => setData(data))
      .finally(() => setLoading(false));
  }, [refreshKey]);

  if (loading) return <div className="text-center text-sm text-gray-400 py-12">Loading…</div>;

  const { overdue = [], this_period = [], upcoming = [], progress } = data || {};
  const isEmpty = overdue.length === 0 && this_period.length === 0 && upcoming.length === 0;

  return (
    <div className="space-y-6">
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

      <section>
        <h2 className="text-sm font-semibold text-gray-500 uppercase tracking-wide mb-3">
          Due This Period{this_period.length > 0 && ` (${this_period.length})`}
        </h2>
        {this_period.length === 0 ? (
          <div className="card p-6 text-sm text-gray-400 text-center">
            {isEmpty ? "Nothing due right now." : "All current-period checks are overdue or complete."}
          </div>
        ) : (
          <div className="card divide-y divide-gray-50 overflow-hidden">
            {this_period.map(inst => <CheckRow key={inst.id} inst={inst} onClick={onNavigate} />)}
          </div>
        )}
      </section>

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

function AllChecksTab({ onNavigate, refreshKey }) {
  const navigate = useNavigate();
  const [instances, setInstances]         = useState([]);
  const [expiringKeys, setExpiringKeys]   = useState([]);
  const [loading, setLoading]             = useState(true);
  const [filterCadence, setFilterCadence] = useState("");
  const [filterStatus, setFilterStatus]   = useState("");
  const [filterYear, setFilterYear]       = useState(String(new Date().getFullYear()));

  const years = Array.from({ length: 3 }, (_, i) => String(new Date().getFullYear() - 1 + i));

  const load = useCallback(() => {
    setLoading(true);
    Promise.all([
      calendarApi.instances({
        cadence: filterCadence || undefined,
        status:  filterStatus  || undefined,
        year:    filterYear,
      }),
      keyInventoryApi.expiring(90),
    ])
      .then(([{ data: inst }, { data: keys }]) => {
        setInstances(inst);
        setExpiringKeys(keys);
      })
      .finally(() => setLoading(false));
  }, [filterCadence, filterStatus, filterYear, refreshKey]);

  useEffect(() => { load(); }, [load]);

  const grouped = CADENCE_ORDER.reduce((acc, c) => {
    acc[c] = instances.filter(i => i.cadence === c);
    return acc;
  }, {});

  const complete = instances.filter(i => i.status === "complete").length;
  const overdue  = instances.filter(i => i.status === "overdue").length;
  const naCount  = instances.filter(i => ["na", "waived"].includes(i.status)).length;
  const denom    = instances.length - naCount;
  const pct      = denom ? Math.round((complete / denom) * 100) : 0;

  return (
    <div className="space-y-6">
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
          {["pending", "in_progress", "complete", "overdue", "na", "waived"].map(s => (
            <option key={s} value={s}>{s.replace("_", " ")}</option>
          ))}
        </select>
      </div>

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

      {loading ? (
        <div className="text-center text-sm text-gray-400 py-12">Loading…</div>
      ) : (
        <>
          {CADENCE_ORDER.map(cadence => {
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
          })}

          {expiringKeys.length > 0 && (
            <div>
              <h2 className="text-sm font-semibold text-gray-500 uppercase tracking-wide mb-3">
                Key Rotation
              </h2>
              <div className="card divide-y divide-gray-50 overflow-hidden">
                {expiringKeys.map(key => {
                  const days = daysFromNow(key.expires_on);
                  const isExpiringSoon = key.status === "expiring_soon";
                  return (
                    <button
                      key={key.id}
                      onClick={() => navigate("/key-inventory", { state: { openKeyId: key.id } })}
                      className="w-full flex items-center gap-4 px-5 py-3.5 hover:bg-gray-50 transition-colors text-left"
                    >
                      <KeyIcon className={clsx("h-5 w-5 shrink-0", isExpiringSoon ? "text-orange-400" : "text-gray-400")} />
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-medium text-gray-900 truncate">{key.name}</p>
                        <p className="text-xs text-gray-400 mt-0.5">
                          {key.asset_type} · Expires {new Date(key.expires_on).toLocaleDateString()}
                          {key.custodian_primary_name && ` · ${key.custodian_primary_name}`}
                        </p>
                      </div>
                      <div className="flex items-center gap-3 shrink-0">
                        {days <= 0 ? (
                          <span className="text-xs text-red-600 font-semibold">{Math.abs(days)}d overdue</span>
                        ) : (
                          <span className={clsx("text-xs font-medium",
                            days <= 14 ? "text-red-600" : days <= 30 ? "text-orange-600" : "text-gray-500")}>
                            {days}d left
                          </span>
                        )}
                        <span className={clsx("badge", isExpiringSoon ? "bg-orange-100 text-orange-700" : "bg-blue-100 text-blue-700")}>
                          {key.status.replace("_", " ")}
                        </span>
                        <ChevronRightIcon className="h-4 w-4 text-gray-300" />
                      </div>
                    </button>
                  );
                })}
              </div>
            </div>
          )}
        </>
      )}
    </div>
  );
}

// ── Log Event Modal ──────────────────────────────────────────────────────────

function LogEventModal({ onClose, onCreated }) {
  const [defs, setDefs]               = useState([]);
  const [defId, setDefId]             = useState("");
  const [periodLabel, setPeriodLabel] = useState("");
  const [dueDate, setDueDate]         = useState("");
  const [notes, setNotes]             = useState("");
  const [saving, setSaving]           = useState(false);
  const [error, setError]             = useState(null);
  const firstRef = useRef(null);

  useEffect(() => {
    calendarApi.definitions().then(({ data }) => {
      const evDefs = data.filter(d => d.cadence === "event_triggered");
      setDefs(evDefs);
      if (evDefs.length) setDefId(evDefs[0].id);
    });
    const d = new Date();
    d.setDate(d.getDate() + 30);
    setDueDate(d.toISOString().slice(0, 10));
    setTimeout(() => firstRef.current?.focus(), 50);
  }, []);

  async function handleSubmit(e) {
    e.preventDefault();
    if (!defId || !periodLabel.trim() || !dueDate) {
      setError("All fields are required.");
      return;
    }
    setSaving(true);
    setError(null);
    try {
      await calendarApi.createManual({
        definition_id: defId,
        period_label:  periodLabel.trim(),
        due_date:      dueDate,
        notes:         notes.trim() || undefined,
      });
      onCreated();
    } catch (err) {
      setError(err.response?.data?.error || "Failed to create event.");
      setSaving(false);
    }
  }

  const selectedDef = defs.find(d => d.id === defId);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm px-4">
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-lg">
        <div className="flex items-center justify-between px-6 pt-5 pb-4 border-b border-gray-100">
          <div className="flex items-center gap-2">
            <BoltIcon className="h-5 w-5 text-brand-600" />
            <h2 className="text-base font-semibold text-gray-900">Log Event-Triggered Check</h2>
          </div>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600">
            <XMarkIcon className="h-5 w-5" />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="px-6 py-5 space-y-4">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Event Type</label>
            <select
              ref={firstRef}
              value={defId}
              onChange={e => setDefId(e.target.value)}
              className="input w-full"
              required
            >
              {defs.map(d => (
                <option key={d.id} value={d.id}>{d.name}</option>
              ))}
            </select>
            {selectedDef?.pci_req_refs?.length > 0 && (
              <p className="text-xs text-gray-400 mt-1">PCI {selectedDef.pci_req_refs.join(", ")}</p>
            )}
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              Trigger Description
              <span className="ml-1 text-gray-400 font-normal">(used as the period label)</span>
            </label>
            <input
              type="text"
              value={periodLabel}
              onChange={e => setPeriodLabel(e.target.value)}
              placeholder="e.g. Firewall rule change 2026-06-10"
              className="input w-full"
              required
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Due Date</label>
            <input
              type="date"
              value={dueDate}
              onChange={e => setDueDate(e.target.value)}
              className="input w-full"
              required
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              Notes <span className="text-gray-400 font-normal">(optional)</span>
            </label>
            <textarea
              value={notes}
              onChange={e => setNotes(e.target.value)}
              rows={2}
              className="input w-full resize-none"
              placeholder="Context, ticket reference, etc."
            />
          </div>

          {error && <p className="text-sm text-red-600">{error}</p>}

          <div className="flex justify-end gap-3 pt-1">
            <button type="button" onClick={onClose} className="btn btn-secondary">Cancel</button>
            <button type="submit" disabled={saving} className="btn btn-primary">
              {saving ? "Creating…" : "Create Check"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

// ── Main Page ────────────────────────────────────────────────────────────────

const TABS = [
  { id: "period", label: "This Period", path: "/compliance"     },
  { id: "all",    label: "All Checks",  path: "/compliance/all" },
];

export default function CompliancePage() {
  const navigate = useNavigate();
  const location = useLocation();
  const tab = location.pathname === "/compliance/all" ? "all" : "period";
  const [showLogEvent, setShowLogEvent] = useState(false);
  const [refreshKey, setRefreshKey]     = useState(0);

  function goToInstance(id) {
    navigate(`/compliance/instances/${id}`, { state: { tab } });
  }

  function handleEventCreated() {
    setShowLogEvent(false);
    setRefreshKey(k => k + 1);
    navigate("/compliance/all");
  }

  return (
    <div className="p-6 space-y-6 max-w-5xl">
      <div className="flex items-start justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Compliance</h1>
          <p className="text-sm text-gray-500 mt-1">PCI-DSS recurring checks and sign-offs</p>
        </div>
        <button
          onClick={() => setShowLogEvent(true)}
          className="btn btn-secondary flex items-center gap-1.5 text-sm"
        >
          <BoltIcon className="h-4 w-4" />
          Log Event
        </button>
      </div>

      <div className="border-b border-gray-200">
        <nav className="-mb-px flex gap-6">
          {TABS.map(t => (
            <button
              key={t.id}
              onClick={() => navigate(t.path)}
              className={clsx(
                "pb-3 text-sm font-medium border-b-2 transition-colors",
                tab === t.id
                  ? "border-brand-600 text-brand-700"
                  : "border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300"
              )}
            >
              {t.label}
            </button>
          ))}
        </nav>
      </div>

      {tab === "period"
        ? <ThisPeriodTab onNavigate={goToInstance} refreshKey={refreshKey} />
        : <AllChecksTab  onNavigate={goToInstance} refreshKey={refreshKey} />
      }

      {showLogEvent && (
        <LogEventModal
          onClose={() => setShowLogEvent(false)}
          onCreated={handleEventCreated}
        />
      )}
    </div>
  );
}
