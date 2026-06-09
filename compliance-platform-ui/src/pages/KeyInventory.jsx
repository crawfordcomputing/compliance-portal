import { useState, useEffect, useCallback } from 'react';
import { keyInventoryApi } from '../api/client';
import { useAuth } from '../context/AuthContext';
import {
  KeyIcon, PlusIcon, ArrowPathIcon, ArchiveBoxXMarkIcon,
  ShieldCheckIcon, XMarkIcon, ClipboardDocumentCheckIcon,
} from '@heroicons/react/24/outline';
import clsx from 'clsx';

const ASSET_TYPES = [
  { value: 'symmetric_key',      label: 'Symmetric key' },
  { value: 'asymmetric_keypair', label: 'Asymmetric keypair' },
  { value: 'tls_certificate',    label: 'TLS certificate' },
  { value: 'signing_key',        label: 'Signing key' },
  { value: 'hmac_key',           label: 'HMAC key' },
  { value: 'api_secret',         label: 'API secret' },
  { value: 'other',              label: 'Other' },
];
const KEY_ROLES = ['KEK', 'DEK', 'standalone'];
const STORAGE_FORMS = ['vault', 'HSM', 'KMS', 'smartcard', 'encrypted file', 'other'];

const STATUS_STYLE = {
  active:        'bg-green-100 text-green-700',
  expiring_soon: 'bg-orange-100 text-orange-700',
  retired:       'bg-gray-100 text-gray-500',
  compromised:   'bg-red-100 text-red-700',
  destroyed:     'bg-gray-100 text-gray-400',
  pending:       'bg-blue-100 text-blue-700',
};

function daysUntil(date) {
  if (!date) return null;
  return Math.ceil((new Date(date) - new Date()) / (1000 * 60 * 60 * 24));
}

function ExpiryChip({ date, status }) {
  const d = daysUntil(date);
  if (d === null) return <span className="text-xs text-gray-300">—</span>;
  if (['retired', 'destroyed'].includes(status)) {
    return <span className="text-xs text-gray-400">{new Date(date).toLocaleDateString()}</span>;
  }
  const tone = d < 0 ? 'text-red-600 font-semibold'
    : d <= 30 ? 'text-red-600 font-medium'
    : d <= 90 ? 'text-orange-600 font-medium'
    : 'text-gray-500';
  const label = d < 0 ? `${Math.abs(d)}d overdue` : `${d}d`;
  return (
    <span className={clsx('text-xs', tone)} title={new Date(date).toLocaleDateString()}>
      {new Date(date).toLocaleDateString()} · {label}
    </span>
  );
}

const EMPTY_FORM = {
  name: '', asset_type: 'symmetric_key', key_role: 'standalone', purpose: '',
  algorithm: '', key_strength_bits: '', storage_location: '', storage_form: 'vault',
  protected_by_key_id: '', custodian_primary: '', custodian_backup: '',
  cryptoperiod_months: '', activated_on: '', expires_on: '', notes: '',
};

export default function KeyInventory() {
  const { user } = useAuth();
  const canEdit = ['admin', 'ir_lead'].includes(user?.role);

  const [keys, setKeys]           = useState([]);
  const [custodians, setCustodians] = useState([]);
  const [loading, setLoading]     = useState(true);
  const [filterStatus, setFilterStatus] = useState('');
  const [filterType, setFilterType]     = useState('');
  const [expiringOnly, setExpiringOnly] = useState(false);

  const [editing, setEditing]     = useState(null);   // form object or null
  const [reviewing, setReviewing] = useState(false);  // custodian review panel

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const params = {};
      if (filterStatus) params.status = filterStatus;
      if (filterType) params.asset_type = filterType;
      if (expiringOnly) params.expiring_within_days = 90;
      const { data } = await keyInventoryApi.list(params);
      setKeys(data);
    } finally { setLoading(false); }
  }, [filterStatus, filterType, expiringOnly]);

  useEffect(() => { load(); }, [load]);
  useEffect(() => {
    if (canEdit) keyInventoryApi.custodians().then(({ data }) => setCustodians(data)).catch(() => {});
  }, [canEdit]);

  const keksList = keys.filter(k => k.key_role === 'KEK');

  return (
    <div className="p-6 space-y-6">
      <div className="flex items-start justify-between gap-4">
        <div className="flex items-center gap-3">
          <KeyIcon className="h-6 w-6 text-gray-400" />
          <div>
            <h1 className="text-2xl font-bold text-gray-900">Key Inventory</h1>
            <p className="text-sm text-gray-500 mt-0.5">
              Cryptographic keys and certificates — storage, strength, expiry, and custodians (PCI-DSS 3.6.1 / 3.7).
            </p>
          </div>
        </div>
        {canEdit && (
          <div className="flex gap-2 shrink-0">
            <button onClick={() => setReviewing(true)} className="btn-secondary">
              <ClipboardDocumentCheckIcon className="h-4 w-4" />
              Custodian review
            </button>
            <button onClick={() => setEditing({ ...EMPTY_FORM })} className="btn-primary">
              <PlusIcon className="h-4 w-4" />
              Add key
            </button>
          </div>
        )}
      </div>

      {/* Filters */}
      <div className="flex flex-wrap items-center gap-3">
        <select className="input w-44" value={filterStatus} onChange={e => setFilterStatus(e.target.value)}>
          <option value="">All statuses</option>
          {Object.keys(STATUS_STYLE).map(s => <option key={s} value={s}>{s.replace('_', ' ')}</option>)}
        </select>
        <select className="input w-48" value={filterType} onChange={e => setFilterType(e.target.value)}>
          <option value="">All types</option>
          {ASSET_TYPES.map(t => <option key={t.value} value={t.value}>{t.label}</option>)}
        </select>
        <label className="flex items-center gap-2 text-sm text-gray-600">
          <input type="checkbox" checked={expiringOnly} onChange={e => setExpiringOnly(e.target.checked)} />
          Expiring within 90 days
        </label>
      </div>

      {/* Table */}
      <div className="card overflow-hidden">
        {loading ? (
          <div className="p-8 text-center text-sm text-gray-400">Loading…</div>
        ) : keys.length === 0 ? (
          <div className="p-8 text-center text-sm text-gray-400">No keys match these filters.</div>
        ) : (
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-gray-100 text-left text-xs text-gray-400 uppercase tracking-wide">
                <th className="px-4 py-3 font-medium">Name</th>
                <th className="px-4 py-3 font-medium">Type</th>
                <th className="px-4 py-3 font-medium">Algorithm</th>
                <th className="px-4 py-3 font-medium">Location</th>
                <th className="px-4 py-3 font-medium">Custodian</th>
                <th className="px-4 py-3 font-medium">Expires</th>
                <th className="px-4 py-3 font-medium">Status</th>
                {canEdit && <th className="px-4 py-3" />}
              </tr>
            </thead>
            <tbody>
              {keys.map(k => (
                <tr key={k.id} className="border-b border-gray-50 hover:bg-gray-50">
                  <td className="px-4 py-3">
                    <p className="font-medium text-gray-900">{k.name}</p>
                    <p className="text-xs text-gray-400">
                      {k.key_role}{k.protected_by_key_name ? ` · wrapped by ${k.protected_by_key_name}` : ''}
                    </p>
                  </td>
                  <td className="px-4 py-3 text-gray-600">
                    {ASSET_TYPES.find(t => t.value === k.asset_type)?.label || k.asset_type}
                  </td>
                  <td className="px-4 py-3 text-gray-600">
                    {k.algorithm}{k.key_strength_bits ? ` / ${k.key_strength_bits}-bit` : ''}
                  </td>
                  <td className="px-4 py-3 text-gray-500 max-w-[180px] truncate" title={k.storage_location}>
                    {k.storage_location}
                  </td>
                  <td className="px-4 py-3 text-gray-600">{k.custodian_primary_name || '—'}</td>
                  <td className="px-4 py-3"><ExpiryChip date={k.expires_on} status={k.status} /></td>
                  <td className="px-4 py-3">
                    <span className={clsx('badge', STATUS_STYLE[k.status])}>{k.status.replace('_', ' ')}</span>
                  </td>
                  {canEdit && (
                    <td className="px-4 py-3 text-right whitespace-nowrap">
                      <button className="text-xs text-brand-600 hover:underline"
                        onClick={() => setEditing(toForm(k))}>Edit</button>
                      <button className="text-xs text-brand-600 hover:underline ml-3"
                        onClick={() => rotate(k, load)}>Rotate</button>
                      {!['retired', 'destroyed'].includes(k.status) && (
                        <button className="text-xs text-red-600 hover:underline ml-3"
                          onClick={() => retire(k, load)}>Retire</button>
                      )}
                    </td>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {editing && (
        <KeyForm
          form={editing} setForm={setEditing} custodians={custodians} keks={keksList}
          onClose={() => setEditing(null)} onSaved={() => { setEditing(null); load(); }}
        />
      )}
      {reviewing && (
        <CustodianReview onClose={() => setReviewing(false)} onDone={() => { setReviewing(false); load(); }} />
      )}
    </div>
  );
}

function toForm(k) {
  return {
    id: k.id, name: k.name, asset_type: k.asset_type, key_role: k.key_role,
    purpose: k.purpose, algorithm: k.algorithm, key_strength_bits: k.key_strength_bits ?? '',
    storage_location: k.storage_location, storage_form: k.storage_form,
    protected_by_key_id: k.protected_by_key_id ?? '',
    custodian_primary: k.custodian_primary ?? '', custodian_backup: k.custodian_backup ?? '',
    cryptoperiod_months: k.cryptoperiod_months ?? '',
    activated_on: k.activated_on ? k.activated_on.slice(0, 10) : '',
    expires_on: k.expires_on ? k.expires_on.slice(0, 10) : '',
    notes: k.notes ?? '',
  };
}

async function rotate(k, reload) {
  const months = window.prompt(
    `Rotate "${k.name}". New cryptoperiod in months (blank = keep ${k.cryptoperiod_months || 'existing'}):`,
    k.cryptoperiod_months || ''
  );
  if (months === null) return;
  try {
    await keyInventoryApi.rotate(k.id, months ? { cryptoperiod_months: parseInt(months, 10) } : {});
    reload();
  } catch (e) { alert(e.response?.data?.error || 'Rotate failed'); }
}

async function retire(k, reload) {
  const status = window.prompt('Retire as: retired, compromised, or destroyed?', 'retired');
  if (!status) return;
  const reason = window.prompt('Reason (required):', '');
  if (!reason) { alert('A reason is required.'); return; }
  try {
    await keyInventoryApi.retire(k.id, { status: status.trim(), reason });
    reload();
  } catch (e) { alert(e.response?.data?.error || 'Retire failed'); }
}

// ── Add / edit form (modal) ───────────────────────────────────────────────────
function KeyForm({ form, custodians, keks, onClose, onSaved }) {
  const [f, setF]       = useState(form);
  const [saving, setSaving] = useState(false);
  const [error, setError]   = useState('');
  const isCert = f.asset_type === 'tls_certificate';
  const isDek  = f.key_role === 'DEK';
  const set = (k, v) => setF(prev => ({ ...prev, [k]: v }));

  async function save() {
    setSaving(true); setError('');
    const payload = {
      ...f,
      key_strength_bits: f.key_strength_bits === '' ? null : parseInt(f.key_strength_bits, 10),
      cryptoperiod_months: f.cryptoperiod_months === '' ? null : parseInt(f.cryptoperiod_months, 10),
      protected_by_key_id: f.protected_by_key_id || null,
      custodian_primary: f.custodian_primary || null,
      custodian_backup: f.custodian_backup || null,
      activated_on: f.activated_on || null,
      expires_on: f.expires_on || null,
    };
    try {
      if (f.id) await keyInventoryApi.update(f.id, payload);
      else await keyInventoryApi.create(payload);
      onSaved();
    } catch (e) {
      setError(e.response?.data?.error || 'Save failed');
      setSaving(false);
    }
  }

  return (
    <Modal title={f.id ? 'Edit key' : 'Add key'} onClose={onClose}>
      {error && <div className="rounded-md bg-red-50 border border-red-200 px-3 py-2 text-sm text-red-700">{error}</div>}
      <div className="grid grid-cols-2 gap-4">
        <Field label="Name" full>
          <input className="input" value={f.name} onChange={e => set('name', e.target.value)} />
        </Field>
        <Field label="Asset type">
          <select className="input" value={f.asset_type} onChange={e => set('asset_type', e.target.value)}>
            {ASSET_TYPES.map(t => <option key={t.value} value={t.value}>{t.label}</option>)}
          </select>
        </Field>
        <Field label="Key role">
          <select className="input" value={f.key_role} onChange={e => set('key_role', e.target.value)}>
            {KEY_ROLES.map(r => <option key={r} value={r}>{r}</option>)}
          </select>
        </Field>
        <Field label="Purpose" full>
          <input className="input" value={f.purpose} placeholder="What it protects / system it serves"
            onChange={e => set('purpose', e.target.value)} />
        </Field>
        <Field label="Algorithm">
          <input className="input" value={f.algorithm} placeholder="AES-GCM, RSA, ECDSA-P256"
            onChange={e => set('algorithm', e.target.value)} />
        </Field>
        <Field label="Strength (bits)">
          <input className="input" type="number" value={f.key_strength_bits}
            onChange={e => set('key_strength_bits', e.target.value)} />
        </Field>
        <Field label="Storage location" full>
          <input className="input" value={f.storage_location} placeholder="vault path / HSM partition / KMS ARN"
            onChange={e => set('storage_location', e.target.value)} />
        </Field>
        <Field label="Storage form">
          <select className="input" value={f.storage_form} onChange={e => set('storage_form', e.target.value)}>
            {STORAGE_FORMS.map(s => <option key={s} value={s}>{s}</option>)}
          </select>
        </Field>
        {isDek && (
          <Field label="Protected by (KEK)">
            <select className="input" value={f.protected_by_key_id} onChange={e => set('protected_by_key_id', e.target.value)}>
              <option value="">— select KEK —</option>
              {keks.map(k => <option key={k.id} value={k.id}>{k.name} ({k.key_strength_bits}-bit)</option>)}
            </select>
          </Field>
        )}
        <Field label="Primary custodian">
          <select className="input" value={f.custodian_primary} onChange={e => set('custodian_primary', e.target.value)}>
            <option value="">— none —</option>
            {custodians.map(u => <option key={u.id} value={u.id}>{u.full_name}</option>)}
          </select>
        </Field>
        <Field label="Backup custodian">
          <select className="input" value={f.custodian_backup} onChange={e => set('custodian_backup', e.target.value)}>
            <option value="">— none —</option>
            {custodians.map(u => <option key={u.id} value={u.id}>{u.full_name}</option>)}
          </select>
        </Field>
        {!isCert && (
          <Field label="Cryptoperiod (months)">
            <input className="input" type="number" value={f.cryptoperiod_months}
              onChange={e => set('cryptoperiod_months', e.target.value)} />
          </Field>
        )}
        <Field label="Activated on">
          <input className="input" type="date" value={f.activated_on} onChange={e => set('activated_on', e.target.value)} />
        </Field>
        <Field label={isCert ? 'Expires on (required for certs)' : 'Expires on (auto if blank)'}>
          <input className="input" type="date" value={f.expires_on} onChange={e => set('expires_on', e.target.value)} />
        </Field>
        <Field label="Notes" full>
          <textarea className="input" rows={2} value={f.notes} onChange={e => set('notes', e.target.value)} />
        </Field>
      </div>
      <div className="flex justify-end gap-2 pt-2">
        <button className="btn-secondary" onClick={onClose}>Cancel</button>
        <button className="btn-primary" onClick={save} disabled={saving}>{saving ? 'Saving…' : 'Save'}</button>
      </div>
    </Modal>
  );
}

// ── Custodian access review (modal) ───────────────────────────────────────────
function CustodianReview({ onClose, onDone }) {
  const [roster, setRoster]   = useState(null);
  const [notes, setNotes]     = useState('');
  const [changes, setChanges] = useState(false);
  const [saving, setSaving]   = useState(false);

  useEffect(() => { keyInventoryApi.roster().then(({ data }) => setRoster(data)); }, []);

  async function submit() {
    setSaving(true);
    try {
      const year = new Date().getFullYear();
      const half = new Date().getMonth() < 6 ? 'H1' : 'H2';
      await keyInventoryApi.attest({ period_label: `${half}-${year}`, changes_required: changes, notes });
      alert('Attestation recorded. The custodian access review on the compliance calendar has been signed off.');
      onDone();
    } catch (e) {
      alert(e.response?.data?.error || 'Attestation failed');
      setSaving(false);
    }
  }

  return (
    <Modal title="Custodian access review (3.6.1)" onClose={onClose}>
      <p className="text-sm text-gray-500">
        Confirm the custodians for every active key represent the fewest necessary. Flag stale access, update the key,
        then submit to snapshot the roster and sign off the calendar check.
      </p>
      {!roster ? (
        <div className="py-6 text-center text-sm text-gray-400">Loading roster…</div>
      ) : (
        <div className="border border-gray-100 rounded-md divide-y divide-gray-50 max-h-72 overflow-auto">
          {roster.map(r => (
            <div key={r.key_id} className="flex items-center justify-between px-3 py-2 text-sm">
              <div>
                <p className="font-medium text-gray-900">{r.key_name}</p>
                <p className="text-xs text-gray-400">
                  Primary: {r.custodian_primary_name || '— none —'} · Backup: {r.custodian_backup_name || '— none —'}
                </p>
              </div>
              <ShieldCheckIcon className="h-4 w-4 text-green-400 shrink-0" />
            </div>
          ))}
        </div>
      )}
      <label className="flex items-center gap-2 text-sm text-gray-600">
        <input type="checkbox" checked={changes} onChange={e => setChanges(e.target.checked)} />
        Changes were required during this review
      </label>
      <textarea className="input" rows={2} placeholder="Review notes (optional)" value={notes}
        onChange={e => setNotes(e.target.value)} />
      <div className="flex justify-end gap-2 pt-2">
        <button className="btn-secondary" onClick={onClose}>Cancel</button>
        <button className="btn-primary" onClick={submit} disabled={saving || !roster}>
          {saving ? 'Submitting…' : 'Confirm & sign off'}
        </button>
      </div>
    </Modal>
  );
}

// ── Small UI helpers ──────────────────────────────────────────────────────────
function Modal({ title, children, onClose }) {
  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center bg-black/40 p-4 overflow-auto">
      <div className="card w-full max-w-2xl p-5 space-y-4 mt-10">
        <div className="flex items-center justify-between">
          <h2 className="font-semibold text-gray-900">{title}</h2>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600"><XMarkIcon className="h-5 w-5" /></button>
        </div>
        {children}
      </div>
    </div>
  );
}

function Field({ label, full, children }) {
  return (
    <div className={full ? 'col-span-2' : ''}>
      <label className="block text-sm font-medium text-gray-700 mb-1">{label}</label>
      {children}
    </div>
  );
}
