# Key Inventory Spec

System design for a cryptographic key and certificate inventory that satisfies PCI-DSS v4.0.1 requirement **3.6.1** (and the related 3.7.x lifecycle controls). Full stack: Postgres migration, RLS, Express API, a background expiry engine wired into the existing notification/calendar machinery, and a React UI.

**Scope guardrail:** this inventory stores **metadata only**. No secret material (private keys, symmetric key bytes, cert private keys) ever lands in the database. Key material stays in the designated vault / HSM / KMS. This is itself a 3.6.1 control (keys stored in the fewest possible locations and forms).

---

## 1. Requirements

### What it must do (functional)

- Track every cryptographic key **and certificate** in the CDE: storage location, purpose, strength/algorithm, expiration, type, custodian, status, last rotation.
- Cover mixed asset types: AES symmetric keys, RSA/ECDSA keypairs, TLS/SSL certificates, signing keys, HMAC keys, API secrets.
- Record the **KEK to DEK** relationship so we can prove key-encrypting keys are stored separately from and are at least as strong as the data-encrypting keys they protect.
- Flag keys approaching the end of their **cryptoperiod** and drive rotation reminders through the calendar + notifications already in the app.
- Capture retirement / replacement / compromise / destruction with a reason and timestamp.
- Feed the QSA export package as 3.6.1 evidence.

### Non-functional

- **Append-friendly, audit-first.** Keys are never hard-deleted (parallels the immutable-evidence chain-of-custody rule). Retirement is a status change. Every mutation hits `audit_log`.
- **Role-gated.** Admin and `ir_lead` edit. Everyone else reads. Enforced at both the route layer (`authorize`) and the database (RLS), matching the existing pattern.
- **Low volume.** Tens to low hundreds of keys. No sharding, no caching, no special scaling concerns. A single table plus one cron job is the right size.

### Constraints

- Must match existing conventions: numbered SQL migrations, `uuid_generate_v4()` PKs, `touch_updated_at()` trigger, RLS via `current_user_role()` / `current_user_uuid()`, `node-cron` background services registered like `deadlineEngine`, `authenticate` + `authorize` middleware, the axios `api/*.js` client, and page + route registration in `App.jsx`.

---

## 2. Control mapping (PCI-DSS v4.0.1)

The inventory is the documented artifact a QSA examines under 3.6.1 and 3.7.x. Each field below is traceable to control text.

| Control | Text (abbreviated) | How the inventory satisfies it |
|---|---|---|
| **3.6.1** | Procedures protect keys against disclosure/misuse, including the four bullets below | The inventory record + RLS + audit log is the documented, implemented procedure |
| 3.6.1 b1 | Access restricted to fewest custodians | `custodian_primary`, `custodian_backup` name the only custodians; RLS restricts edit; **periodic custodian access attestation** (§7) confirms the roster on a calendar cadence |
| 3.6.1 b2 | KEKs at least as strong as the DEKs they protect | `key_role`, `protected_by_key_id`, `key_strength_bits` + validation that KEK strength ≥ DEK strength |
| 3.6.1 b3 | KEKs stored separately from DEKs | `storage_location` / `storage_form` differ across the KEK→DEK link; surfaced in the detail view |
| 3.6.1.4 | Keys stored in fewest possible locations | `storage_location` makes every location explicit and auditable; metadata-only keeps material out of the DB |
| 3.7.1 | Generate strong keys | `algorithm` + `key_strength_bits` document strength per key |
| 3.7.4 | Change keys at end of cryptoperiod | `cryptoperiod_months`, `last_rotated_on`, `expires_on`, the rotate action, and the expiry engine |
| 3.7.5 | Retire / replace / destroy keys when needed | `status` (`retired`/`compromised`/`destroyed`) + `status_reason` + `retired_on` |

Out of scope by design: 3.6.1.3 (access to cleartext key components) and 3.7.6 (manual cleartext operations) concern handling of actual key material, which never enters this system. The custodian fields support the access-list testing procedure, but the operational control lives in the vault/HSM.

---

## 3. Data model

New migration: `migrations/013_key_inventory.sql`.

```sql
-- 013_key_inventory.sql
-- Cryptographic key & certificate inventory (PCI-DSS 3.6.1 / 3.7.x).
-- METADATA ONLY. No secret key material is ever stored in this table.

CREATE TYPE key_asset_type AS ENUM (
  'symmetric_key',      -- e.g. AES data-encrypting key
  'asymmetric_keypair', -- RSA/ECDSA keypair
  'tls_certificate',    -- SSL/TLS server or client cert
  'signing_key',        -- code/document signing
  'hmac_key',           -- message authentication
  'api_secret',         -- API/service credential
  'other'
);

CREATE TYPE key_role AS ENUM (
  'KEK',         -- key-encrypting key
  'DEK',         -- data-encrypting key
  'standalone'   -- cert, signing key, etc. with no wrap relationship
);

CREATE TYPE key_status AS ENUM (
  'active',
  'expiring_soon',  -- set automatically by the expiry engine
  'retired',
  'compromised',
  'destroyed',
  'pending'         -- provisioned, not yet in use
);

CREATE TABLE key_inventory (
  id                 UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  name               TEXT NOT NULL,                      -- human label, e.g. "PAN DEK - prod"
  asset_type         key_asset_type NOT NULL,
  key_role           key_role NOT NULL DEFAULT 'standalone',

  purpose            TEXT NOT NULL,                      -- what it protects / system it serves
  algorithm          TEXT NOT NULL,                      -- 'AES-GCM', 'RSA', 'ECDSA-P256', ...
  key_strength_bits  INT,                                -- 256, 2048, 4096 (NULL for some certs)

  storage_location   TEXT NOT NULL,                      -- vault path / HSM partition / KMS key ARN
  storage_form       TEXT NOT NULL DEFAULT 'vault',      -- 'HSM' | 'KMS' | 'vault' | 'smartcard' | ...

  protected_by_key_id UUID REFERENCES key_inventory(id), -- the KEK that wraps this DEK (3.6.1)

  custodian_primary  UUID REFERENCES users(id),          -- fewest custodians (3.6.1)
  custodian_backup   UUID REFERENCES users(id),

  cryptoperiod_months INT,                               -- defined cryptoperiod (3.7.4)
  activated_on       DATE,
  last_rotated_on    DATE,
  expires_on         DATE,                               -- cert expiry or activated/rotated + cryptoperiod

  status             key_status NOT NULL DEFAULT 'active',
  status_reason      TEXT,                               -- why retired/compromised/destroyed (3.7.5)
  retired_on         DATE,

  notes              TEXT,
  created_at         TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at         TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_by         UUID REFERENCES users(id),
  updated_by         UUID REFERENCES users(id),

  CONSTRAINT key_strength_positive CHECK (key_strength_bits IS NULL OR key_strength_bits > 0),
  CONSTRAINT no_self_wrap CHECK (protected_by_key_id IS NULL OR protected_by_key_id <> id)
  -- No secret-material column by design.
);

CREATE INDEX idx_key_inventory_status   ON key_inventory(status);
CREATE INDEX idx_key_inventory_expires  ON key_inventory(expires_on);
CREATE INDEX idx_key_inventory_type     ON key_inventory(asset_type);
CREATE INDEX idx_key_inventory_kek      ON key_inventory(protected_by_key_id);

CREATE TRIGGER trg_key_inventory_updated_at
  BEFORE UPDATE ON key_inventory
  FOR EACH ROW EXECUTE FUNCTION touch_updated_at();

-- Rotation / lifecycle alert log (mirrors notification_alerts).
CREATE TABLE key_rotation_alerts (
  id          UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  key_id      UUID NOT NULL REFERENCES key_inventory(id),
  alert_type  TEXT NOT NULL,            -- '90d' | '30d' | '7d' | 'expired'
  channel     TEXT NOT NULL,            -- 'email' | 'in_app'
  sent_to     TEXT NOT NULL,
  sent_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (key_id, alert_type)           -- send each threshold once
);

CREATE INDEX idx_key_rotation_alerts_key ON key_rotation_alerts(key_id);
```

### Row-Level Security (`009`-style, add to `013` or a follow-on `014`)

```sql
ALTER TABLE key_inventory ENABLE ROW LEVEL SECURITY;

-- Everyone authenticated can read the inventory.
CREATE POLICY key_inventory_select ON key_inventory FOR SELECT
  USING (current_user_role() IS NOT NULL);

-- Only admin / ir_lead may create or modify.
CREATE POLICY key_inventory_insert ON key_inventory FOR INSERT
  WITH CHECK (current_user_role() IN ('admin', 'ir_lead'));

CREATE POLICY key_inventory_update ON key_inventory FOR UPDATE
  USING (current_user_role() IN ('admin', 'ir_lead'));

-- No DELETE policy: hard deletes are blocked for everyone.
-- Keys are retired via status, never removed (audit retention).
```

### Field decisions and trade-offs

- **Asset type vs key role are separate columns.** `asset_type` answers "what is it" (AES key, TLS cert) and is what the user scans for. `key_role` answers the 3.6.1 question "is this a KEK or DEK." A cert is `tls_certificate` / `standalone`; a PAN key is `symmetric_key` / `DEK`. Conflating them would lose the KEK→DEK proof.
- **`expires_on` is stored, not computed.** Certificates expire on a fixed date unrelated to any cryptoperiod, while symmetric keys expire at `last_rotated_on + cryptoperiod_months`. Storing the column handles both; the API computes a sensible default on create/rotate and lets you override for certs. A generated column can't express both rules.
- **KEK ≥ DEK strength is validated in the API, not a hard DB constraint.** It needs a lookup against the parent row; a `CHECK` can't do cross-row reads cleanly. The route rejects a DEK whose `protected_by_key_id` points at a weaker KEK, and the verification job re-checks it. (If you want belt-and-suspenders, a `BEFORE INSERT/UPDATE` trigger can enforce it in-DB; noted as optional.)
- **No hard delete.** Same reasoning as the evidence table. An auditor wants to see that a compromised key was retired, not find it vanished. `status = 'destroyed'` + `retired_on` is the record of destruction (3.7.5).

---

## 4. API

New router `src/routes/keyInventory.js`, mounted in `app.js`:

```js
app.use('/api/key-inventory', keyInventoryRoutes);
```

Built on the same `authenticate` (router-level) + `authorize('admin','ir_lead')` (mutation-level) pattern as `orgSettings.js`.

| Method | Path | Auth | Purpose |
|---|---|---|---|
| GET | `/api/key-inventory` | any | List. Filters: `?status=`, `?asset_type=`, `?expiring_within_days=` |
| GET | `/api/key-inventory/:id` | any | Single key + resolved custodian names + KEK/DEK links |
| POST | `/api/key-inventory` | admin, ir_lead | Create. Computes `expires_on` default, validates KEK strength |
| PATCH | `/api/key-inventory/:id` | admin, ir_lead | Edit allowed fields (whitelist, like `orgSettings`) |
| POST | `/api/key-inventory/:id/rotate` | admin, ir_lead | Sets `last_rotated_on = today`, recomputes `expires_on`, optional new `algorithm`/`strength`, status → `active`, clears alerts. Logs `key.rotated` (3.7.4) |
| POST | `/api/key-inventory/:id/retire` | admin, ir_lead | Body `{ status: retired\|compromised\|destroyed, reason }`. Sets `retired_on`. Logs `key.retired` (3.7.5) |
| GET | `/api/key-inventory/expiring` | any | `?days=90` feed for the calendar + dashboard widget |

### Contracts

```jsonc
// POST /api/key-inventory  (request)
{
  "name": "PAN DEK - prod",
  "asset_type": "symmetric_key",
  "key_role": "DEK",
  "purpose": "Encrypts stored PAN in payments DB",
  "algorithm": "AES-GCM",
  "key_strength_bits": 256,
  "storage_location": "vault://kv/prod/pan-dek",
  "storage_form": "vault",
  "protected_by_key_id": "<kek-uuid>",
  "custodian_primary": "<user-uuid>",
  "custodian_backup": "<user-uuid>",
  "cryptoperiod_months": 12,
  "activated_on": "2026-06-07"
  // expires_on omitted -> server sets activated_on + 12 months
}

// 201 response: full row + custodian_primary_name, protected_by_key_name
// 400 if key_role='DEK' and protected_by KEK strength < this key's strength
```

Validation rules enforced in the route:

- `expires_on` default: `tls_certificate` requires an explicit `expires_on` (cert dates are external); other types default to `COALESCE(last_rotated_on, activated_on) + cryptoperiod_months`.
- KEK strength check: if `key_role = 'DEK'` and `protected_by_key_id` set, load the parent and reject if `parent.key_strength_bits < this.key_strength_bits` (3.6.1 bullet 2).
- Mutations write `audit_log` in the app layer (`key.created`, `key.updated`, `key.rotated`, `key.retired`), matching how the rest of the API logs.

---

## 5. Expiry engine (calendar + notification integration)

A new `node-cron` service, `src/services/keyExpiryEngine.js`, registered at startup exactly like `deadlineEngine`. It is decoupled from the case-scoped `notifications` table (whose `case_id` is NOT NULL and doesn't fit keys), and instead uses its own `key_rotation_alerts` log plus the shared `emailService`.

**Daily run:**

1. Select keys where `status IN ('active','expiring_soon')` and `expires_on` is not null.
2. For each, compute days remaining and walk thresholds `[90d, 30d, 7d, expired]` (mirrors the `THRESHOLDS` array in `deadlineEngine`).
3. On crossing a threshold not yet in `key_rotation_alerts`: email the custodians + all `ir_lead`s, write an `in_app` alert row, and write `audit_log` (`key.expiry_alert`).
4. Flip `status` to `expiring_soon` inside the window; `expires_on <= today` raises a high-severity `key.expired` alert and an overdue flag.

**Calendar surfacing.** The calendar already renders due-dated items. Add expiring keys as a derived feed rather than minting `compliance_check_instances` per key (which would bloat the calendar and conflate periodic checks with point-in-time expiries). `GET /api/key-inventory/expiring?days=90` returns `{ id, name, expires_on, status, custodian }[]`, and `ComplianceCalendar.jsx` merges it into the timeline as a distinct "Key rotation" lane. The Dashboard gets a "Keys expiring in 90 days" count tile.

**Trade-off:** a dedicated engine + alert table is slightly more code than reusing `notifications`, but it keeps key lifecycle cleanly separated from incident notifications, avoids a forced/fake `case_id`, and lets thresholds differ (keys think in days/months, breach notifications think in hours).

---

## 6. UI

### New page `KeyInventory.jsx` at `/key-inventory`

Registered in `App.jsx` and the nav, gated so the edit controls only render for `admin` / `ir_lead` (read-only users see the table without action buttons, same as other pages).

**List view**

- Table columns: Name, Type (badge), Algorithm + strength, Location, Custodian, Status (badge), Expires (countdown chip — amber < 90d, red < 30d, grey if retired).
- Filters: status, asset type, and an "Expiring soon" quick filter.
- Primary action `+ Add key` (admin/lead only).

**Detail / drawer**

- All fields, plus the KEK→DEK relationship rendered as a small link ("Protected by: PAN KEK - prod, AES-256") which directly evidences 3.6.1 separation and strength.
- Lifecycle history: created, rotations, retirement (read from `audit_log`).
- Actions (admin/lead): Edit, Rotate, Retire. Rotate opens a small form (new algorithm/strength optional, confirm date). Retire requires choosing `retired`/`compromised`/`destroyed` and a reason.

**Add / edit form**

- Mirrors the form conventions in `OrgSettings.jsx`. Type-aware: choosing `tls_certificate` makes `expires_on` required and hides `cryptoperiod_months`; choosing `DEK` reveals the `protected_by_key_id` picker (filtered to `key_role = 'KEK'`).

### API client

Add to `src/api/` alongside the others:

```js
export const keyInventoryApi = {
  list:    (params) => api.get('/key-inventory', { params }),
  get:     (id) => api.get(`/key-inventory/${id}`),
  create:  (data) => api.post('/key-inventory', data),
  update:  (id, data) => api.patch(`/key-inventory/${id}`, data),
  rotate:  (id, data) => api.post(`/key-inventory/${id}/rotate`, data),
  retire:  (id, data) => api.post(`/key-inventory/${id}/retire`, data),
  expiring:(days = 90) => api.get('/key-inventory/expiring', { params: { days } }),
};
```

### Export

Add the inventory to the QSA export package (`src/exports/`) as `key-inventory.csv` (or JSON) so 3.6.1 evidence ships with the rest of the audit bundle.

---

## 7. Custodian access attestation (3.6.1 bullet 1)

The inventory names custodians, but 3.6.1 bullet 1 ("access restricted to the fewest custodians necessary") is only a live control if someone periodically re-confirms that list. This feature drives a recurring "confirm the custodian roster" review through the **existing** compliance calendar so it gets the same scheduling, evidence, and sign-off machinery as every other PCI check, and freezes a snapshot of what was confirmed as audit evidence.

### How it rides the existing calendar

No new scheduling code. Add one **built-in check definition** so the calendar generates an instance every period automatically (seeded in `seedComplianceChecks.js`, same shape as the existing checks):

```js
{
  name: 'Cryptographic Key Custodian Access Review',
  description: 'Confirm that the recorded custodians for every active key and certificate are still correct and represent the fewest custodians necessary. Flag and remediate any stale or excess access.',
  instructions:
    '1. Open the live custodian roster (Key Inventory > Custodian review).\n' +
    '2. Confirm each active key\'s primary and backup custodian are still correct and still required.\n' +
    '3. Flag any custodian who has left, changed roles, or is no longer needed.\n' +
    '4. Update the affected key records.\n' +
    '5. Submit the attestation to snapshot the confirmed roster and sign off the check.',
  cadence: 'semi_annual',                 // recommended; annual is acceptable
  pci_req_refs: ['3.6.1'],
  required_evidence_labels: ['Confirmed Custodian Roster', 'Access Review Sign-off'],
  conditional_on: null,
  sort_order: 200,
}
```

Because it's a normal definition, `complianceScheduler` mints a `compliance_check_instance` each period, it shows up on the calendar with a due date, and overdue handling, evidence upload, and the two-step signoff all work with zero new calendar code.

### Snapshot table (the evidence)

A check instance proves the review happened; this table proves *what* was confirmed. New table in `migrations/013_key_inventory.sql`:

```sql
CREATE TABLE key_custodian_attestations (
  id            UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  instance_id   UUID REFERENCES compliance_check_instances(id), -- links to the calendar check (nullable for ad-hoc)
  period_label  TEXT NOT NULL,                                  -- 'H1-2026'
  attested_by   UUID NOT NULL REFERENCES users(id),
  attested_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  roster_snapshot JSONB NOT NULL,        -- frozen list: [{key_id, key_name, custodian_primary_name, custodian_backup_name}]
  changes_required BOOLEAN NOT NULL DEFAULT FALSE,
  notes         TEXT
  -- Append-only: an attestation is a point-in-time record, never edited.
);

CREATE INDEX idx_custodian_attest_instance ON key_custodian_attestations(instance_id);
CREATE INDEX idx_custodian_attest_period   ON key_custodian_attestations(period_label);
```

Same RLS posture as the inventory: all roles read; `admin` / `ir_lead` insert; no update/delete (it's frozen evidence, like the immutable-evidence pattern).

### API

| Method | Path | Auth | Purpose |
|---|---|---|---|
| GET | `/api/key-inventory/custodian-roster` | any | Live roster of active keys + resolved custodian names — drives the review form |
| POST | `/api/key-inventory/attestations` | admin, ir_lead | Snapshot the roster, record attester, set `changes_required`/`notes`; optionally `instance_id` to tie it to the calendar check |
| GET | `/api/key-inventory/attestations` | any | History (filter `?period_label=`) |

On `POST /attestations` with an `instance_id`, the route also closes the loop on the calendar check using the existing endpoints: it writes a `compliance_check_evidence` row labeled "Confirmed Custodian Roster" (the snapshot rendered as a file) and records a `compliance_check_signoff`, so the calendar instance flips toward complete without the user re-entering anything. Each step writes `audit_log` (`key.custodian_attested`).

### UI

- **Custodian review panel** on `KeyInventory.jsx`: a read view of the live roster with a `Start review` button (admin/lead). The button is also reachable from the calendar check instance detail (`ComplianceCheckDetail.jsx`) so the attester can launch it straight from the due item.
- The review form lists each active key with its primary/backup custodian and a per-row confirm / flag toggle. Flagging a row deep-links to that key's edit form. Submitting captures the snapshot and (if launched from a check) signs the instance off.
- Attestation history is shown on the panel and attached to the calendar instance, giving the QSA a dated trail of who confirmed the custodian list each period.

### Trade-off

Modeling this as a calendar check definition rather than a bespoke scheduler means it inherits cadence config, overdue alerts, evidence, and signoff for free, and it sits alongside the other PCI checks where a QSA expects to find it. The only added surface is the snapshot table and a thin review UI. The alternative (a standalone attestation scheduler) would duplicate machinery you already have.

## 8. Build order

1. `migrations/013_key_inventory.sql` — table, enums, indexes, triggers, RLS. Run `npm run migrate`.
2. `src/services/keyExpiryEngine.js` — cron service; register in app startup next to `deadlineEngine`.
3. `src/routes/keyInventory.js` — CRUD + rotate/retire/expiring; mount in `app.js`.
4. Seed a few sample keys (one KEK + one DEK it protects, one TLS cert) in `seed.js` for demo/testing.
5. `keyInventoryApi` client + `KeyInventory.jsx` page + nav/route registration.
6. Calendar feed merge + Dashboard tile.
7. Custodian attestation: `key_custodian_attestations` table + RLS in `013`; seed the `Cryptographic Key Custodian Access Review` check definition; `custodian-roster` + `attestations` routes; review panel UI; calendar-instance signoff wiring.
8. Export inclusion (key inventory CSV + latest custodian attestation).
9. Tests: route auth (read vs edit by role), KEK-strength rejection, `expires_on` default logic, expiry-engine threshold/idempotency (alert sent once), attestation snapshot + auto-signoff of the linked instance.

## 9. What I'd revisit as it grows

- **KMS/HSM auto-discovery.** Today the inventory is hand-maintained. If key count or churn grows, add a read-only sync from AWS KMS / Vault to reconcile real keys against the inventory and flag drift. The metadata-only model makes this safe.
- **Per-key cryptoperiod policy table.** If different key types need standardized cryptoperiods (NIST SP 800-57 Table 1), promote `cryptoperiod_months` to a policy lookup keyed by `asset_type` with per-key override.
- **In-DB KEK-strength trigger** if you ever want the guarantee independent of the API layer.
