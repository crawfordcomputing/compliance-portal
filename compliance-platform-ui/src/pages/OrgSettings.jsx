import { useState, useEffect } from 'react';
import { orgSettingsApi, calendarApi } from '../api/client';
import { useAuth } from '../context/AuthContext';
import { Cog6ToothIcon, ArrowPathIcon } from '@heroicons/react/24/outline';

const MONTH_NAMES = [
  'January','February','March','April','May','June',
  'July','August','September','October','November','December',
];
const MONTH_SHORT = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];

const TOGGLES = [
  { key: 'is_service_provider',  label: 'We are a Service Provider',         note: 'Enables SP-specific requirements (11.4.6 semi-annual segmentation, 12.5.2.1 scope review)' },
  { key: 'has_wireless_in_cde',  label: 'Wireless networks in/near CDE',      note: 'Enables quarterly wireless AP scans (11.2.1) and annual wireless review' },
  { key: 'has_ecommerce',        label: 'E-commerce / payment pages in scope', note: 'Enables payment page integrity checks (11.6.1)' },
  { key: 'has_cloud_infra',      label: 'Cloud infrastructure in scope',       note: 'Enables cloud NSG/security group review (1.2.7)' },
  { key: 'has_waf',              label: 'WAF in scope',                        note: 'Enables WAF rule review (1.2.7, 6.4.1)' },
  { key: 'siem_in_use',          label: 'SIEM / automated log monitoring in use', note: 'Shapes log review attestation guidance (10.4.1)' },
];

export default function OrgSettings() {
  const { user } = useAuth();
  const [settings, setSettings] = useState(null);
  const [saving, setSaving]     = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [saved, setSaved]       = useState(false);
  const canEdit = ['admin', 'ir_lead'].includes(user?.role);

  useEffect(() => {
    orgSettingsApi.get().then(({ data }) => setSettings(data));
  }, []);

  async function handleToggle(key) {
    if (!canEdit) return;
    const updated = { ...settings, [key]: !settings[key] };
    setSettings(updated);
  }

  async function handleSave() {
    setSaving(true);
    try {
      const { data } = await orgSettingsApi.update(settings);
      setSettings(data);
      setSaved(true);
      setTimeout(() => setSaved(false), 2000);
    } finally { setSaving(false); }
  }

  async function handleRefreshCalendar() {
    setRefreshing(true);
    try {
      await calendarApi.refresh();
      alert('Compliance calendar refreshed — new instances generated based on current settings.');
    } finally { setRefreshing(false); }
  }

  if (!settings) return <div className="p-6 text-sm text-gray-400">Loading…</div>;

  return (
    <div className="p-6 space-y-6 max-w-2xl">
      <div className="flex items-center gap-3">
        <Cog6ToothIcon className="h-6 w-6 text-gray-400" />
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Organization Settings</h1>
          <p className="text-sm text-gray-500 mt-0.5">Controls which compliance checks are required and at what cadence.</p>
        </div>
      </div>

      {/* Org info */}
      <div className="card p-5 space-y-4">
        <h2 className="font-semibold text-gray-900">Organization</h2>
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">Organization Name</label>
          <input className="input" value={settings.org_name || ''} disabled={!canEdit}
            onChange={e => setSettings(s => ({ ...s, org_name: e.target.value }))} />
        </div>
        <div className="grid grid-cols-2 gap-4">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">QSA Contact</label>
            <input className="input" placeholder="Firm and contact name" disabled={!canEdit}
              value={settings.qsa_contact || ''}
              onChange={e => setSettings(s => ({ ...s, qsa_contact: e.target.value }))} />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Assessment Year</label>
            <input className="input" type="number" placeholder={new Date().getFullYear()} disabled={!canEdit}
              value={settings.assessment_year || ''}
              onChange={e => setSettings(s => ({ ...s, assessment_year: parseInt(e.target.value) || null }))} />
          </div>
        </div>
      </div>

      {/* Compliance schedule */}
      <div className="card p-5 space-y-5">
        <div>
          <h2 className="font-semibold text-gray-900">Compliance Schedule</h2>
          <p className="text-sm text-gray-500 mt-0.5">
            Each cadence has an independent review window — a 1-month period when checks
            are active and due. Configure each to match your organization's review cycle.
          </p>
        </div>

        {/* Quarterly */}
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">
            Quarterly — Q1 review opens in
          </label>
          <select
            className="input w-48"
            disabled={!canEdit}
            value={settings.compliance_quarterly_start_month || 3}
            onChange={e => setSettings(s => ({ ...s, compliance_quarterly_start_month: parseInt(e.target.value) }))}
          >
            {MONTH_NAMES.map((name, i) => (
              <option key={i + 1} value={i + 1}>{name}</option>
            ))}
          </select>
          <p className="text-xs text-gray-400 mt-1">
            {(() => {
              const m = settings.compliance_quarterly_start_month || 3;
              return [0,1,2,3].map(q => {
                const mo = MONTH_SHORT[(m - 1 + q * 3) % 12];
                return `Q${q+1} due ${mo}`;
              }).join(' · ');
            })()}
          </p>
        </div>

        {/* Semi-annual */}
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">
            Semi-annual — H1 review opens in
          </label>
          <select
            className="input w-48"
            disabled={!canEdit}
            value={settings.compliance_semi_annual_start_month || 6}
            onChange={e => setSettings(s => ({ ...s, compliance_semi_annual_start_month: parseInt(e.target.value) }))}
          >
            {MONTH_NAMES.map((name, i) => (
              <option key={i + 1} value={i + 1}>{name}</option>
            ))}
          </select>
          <p className="text-xs text-gray-400 mt-1">
            {(() => {
              const m = settings.compliance_semi_annual_start_month || 6;
              const h1 = MONTH_SHORT[(m - 1) % 12];
              const h2 = MONTH_SHORT[(m - 1 + 6) % 12];
              return `H1 due ${h1} · H2 due ${h2}`;
            })()}
          </p>
        </div>

        {/* Annual */}
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">
            Annual — review due in
          </label>
          <select
            className="input w-48"
            disabled={!canEdit}
            value={settings.compliance_annual_due_month || 12}
            onChange={e => setSettings(s => ({ ...s, compliance_annual_due_month: parseInt(e.target.value) }))}
          >
            {MONTH_NAMES.map((name, i) => (
              <option key={i + 1} value={i + 1}>{name}</option>
            ))}
          </select>
          <p className="text-xs text-gray-400 mt-1">
            Annual checks due last day of {MONTH_NAMES[(settings.compliance_annual_due_month || 12) - 1]}
          </p>
        </div>

        <div className="flex items-start gap-2 rounded-md bg-amber-50 border border-amber-200 px-3 py-2.5 text-xs text-amber-700">
          <span className="mt-0.5">⚠</span>
          <span>
            Schedule changes only affect <strong>new</strong> instances. After saving,
            click <strong>Refresh Compliance Calendar</strong> to regenerate pending
            checks with the updated dates. In-progress checks are not affected.
          </span>
        </div>
      </div>

      {/* Environment flags */}
      <div className="card p-5 space-y-4">
        <h2 className="font-semibold text-gray-900">Environment Configuration</h2>
        <p className="text-sm text-gray-500">These flags determine which compliance checks apply to your environment.</p>
        <div className="space-y-3">
          {TOGGLES.map(({ key, label, note }) => (
            <div key={key} className="flex items-start gap-3">
              <button onClick={() => handleToggle(key)} disabled={!canEdit}
                className={`mt-0.5 relative inline-flex h-5 w-9 shrink-0 cursor-pointer rounded-full border-2 border-transparent
                  transition-colors focus:outline-none ${settings[key] ? 'bg-brand-600' : 'bg-gray-200'}
                  ${!canEdit ? 'opacity-50 cursor-not-allowed' : ''}`}>
                <span className={`pointer-events-none inline-block h-4 w-4 rounded-full bg-white shadow
                  transform transition-transform ${settings[key] ? 'translate-x-4' : 'translate-x-0'}`} />
              </button>
              <div>
                <p className="text-sm font-medium text-gray-900">{label}</p>
                <p className="text-xs text-gray-500">{note}</p>
              </div>
            </div>
          ))}
        </div>
      </div>

      {canEdit && (
        <div className="flex gap-3">
          <button onClick={handleSave} disabled={saving} className="btn-primary">
            {saving ? 'Saving…' : saved ? '✓ Saved' : 'Save Settings'}
          </button>
          <button onClick={handleRefreshCalendar} disabled={refreshing} className="btn-secondary">
            <ArrowPathIcon className="h-4 w-4" />
            {refreshing ? 'Refreshing…' : 'Refresh Compliance Calendar'}
          </button>
        </div>
      )}
    </div>
  );
}
