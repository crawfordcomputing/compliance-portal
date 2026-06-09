# Compliance Platform — Build Document

## What This Is

A self-hosted, open-source PCI-DSS compliance platform. The primary function is proactive compliance management: scheduling and tracking every required PCI-DSS periodic check, collecting evidence, and providing QSA-ready export packages. Incident response is a first-class module within the platform, not the product itself.

**The pivot:** The codebase began as an IR tool. It has been extended into a compliance platform. When modifying or extending it, always treat Compliance as the primary surface and Incident Response as one module within it.

---

## Tech Stack

| Layer | Technology |
|---|---|
| Backend | Node.js (v20 LTS) + Express |
| Database | PostgreSQL 15 (via `pg` driver) |
| Frontend | React 18 + Vite + Tailwind CSS v3 |
| UI components | HeroIcons v2, HeadlessUI v2, clsx |
| Background jobs | `node-cron` |
| File storage | Local filesystem (`local-evidence/`) in dev; Azure Blob Storage in prod (pluggable via `src/services/storage.js`) |
| Exports | `pdf-lib` (PDF generation) + `archiver` (ZIP) |
| Auth | JWT (15-min access token + refresh token rotation) |
| Email | Azure Communication Services (pluggable — swap `emailService.js`) |
| Deployment | Docker Compose (primary); Azure App Service (documented option) |
| License | MIT |

**Stack is deliberately boring.** No ORMs, no GraphQL, no message queues. Plain SQL migrations, plain Express routes, plain React pages. Keep it that way unless there is a compelling reason to add a dependency.

---

## Repo Structure

```
compliance-platform/
├── compliance-platform-api/       # Node/Express backend
│   ├── migrations/                # Numbered SQL migrations (run in order)
│   ├── src/
│   │   ├── app.js                 # Entry point, route mounting, startup
│   │   ├── db/
│   │   │   ├── index.js           # pg Pool, query helper
│   │   │   ├── migrate.js         # Migration runner
│   │   │   ├── seedScenarios.js   # Tabletop scenario seed data
│   │   │   └── seedComplianceChecks.js  # PCI-DSS check definition seeds
│   │   ├── middleware/
│   │   │   ├── authenticate.js    # JWT verification → sets req.user
│   │   │   └── authorize.js       # Role check factory: authorize('admin','ir_lead')
│   │   ├── routes/                # One file per resource domain
│   │   ├── services/
│   │   │   ├── deadlineEngine.js      # 72-hour notification countdown
│   │   │   ├── complianceScheduler.js # Mints compliance_check_instances each period
│   │   │   ├── keyExpiryEngine.js     # Key/cert rotation alerts
│   │   │   ├── emailService.js        # Send email via Azure Comm or SMTP
│   │   │   └── storage.js             # Upload/download evidence files
│   │   └── exports/               # QSA export package builder
│   ├── tests/                     # Jest + supertest
│   └── docker-compose.yml
│
├── compliance-platform-ui/        # React + Vite frontend
│   ├── src/
│   │   ├── App.jsx                # Route definitions, ProtectedRoute
│   │   ├── context/AuthContext.jsx
│   │   ├── api/client.js          # Axios instance + all API methods
│   │   ├── components/Layout.jsx  # Shell: sidebar nav + outlet
│   │   └── pages/                 # One file per route
│   └── vite.config.js
│
└── docs/                          # Specs and this document
```

---

## Database Migrations

Run with `npm run migrate` from `compliance-platform-api/`. Migrations are idempotent — re-running is safe. Never edit a committed migration; always add a new numbered one.

| # | File | Contents |
|---|---|---|
| 001 | `001_users.sql` | `users` table, password hash, roles |
| 002 | `002_cases.sql` | `cases` table — IR incidents |
| 003 | `003_actions.sql` | `actions` — append-only incident timeline |
| 004 | `004_evidence.sql` | `evidence` — file attachments with SHA-256 |
| 005 | `005_notifications.sql` | `notification_alerts` — 72hr deadline records |
| 006 | `006_tabletop_scenarios.sql` | Scenario library + exercise tables |
| 007 | `007_audit_log.sql` | Immutable `audit_log` table |
| 008 | `008_audit_triggers.sql` | DB-level triggers writing to `audit_log` |
| 009 | `009_roles_and_permissions.sql` | RLS policies + `current_user_role()` / `current_user_uuid()` functions |
| 010 | `010_annual_compliance.sql` | Early annual compliance tables (superseded by 011) |
| 011 | `011_compliance_calendar.sql` | `compliance_check_definitions`, `compliance_check_instances`, `compliance_check_evidence`, `compliance_check_signoffs`, `org_settings` |
| 012 | `012_compliance_quarter_start.sql` | Org setting for quarter start configuration |
| 013 | `013_key_inventory.sql` | `key_inventory`, `key_rotation_alerts`, `key_custodian_attestations` |

**Next migration number: 014.** Always check the highest existing number before creating one.

---

## Core Conventions — Follow These Exactly

These patterns appear throughout the codebase. Any new feature must match them.

### 1. Primary Keys
All PKs are `UUID DEFAULT uuid_generate_v4()`. Never use serial/integer PKs.

### 2. Updated-at trigger
Every mutable table uses:
```sql
CREATE TRIGGER trg_<table>_updated_at
  BEFORE UPDATE ON <table>
  FOR EACH ROW EXECUTE FUNCTION touch_updated_at();
```
The `touch_updated_at()` function is defined in `008_audit_triggers.sql`.

### 3. Row-Level Security
Every table with sensitive data enables RLS. The pattern from `009`:
```sql
ALTER TABLE <table> ENABLE ROW LEVEL SECURITY;

CREATE POLICY <table>_select ON <table> FOR SELECT
  USING (current_user_role() IS NOT NULL);

CREATE POLICY <table>_insert ON <table> FOR INSERT
  WITH CHECK (current_user_role() IN ('admin', 'ir_lead'));

CREATE POLICY <table>_update ON <table> FOR UPDATE
  USING (current_user_role() IN ('admin', 'ir_lead'));
-- No DELETE policy: hard deletes blocked for all roles.
```
The `current_user_role()` and `current_user_uuid()` functions are session-local variables set by the middleware (see §4 below).

### 4. Auth middleware
Every protected route mounts `authenticate` at the router level, then `authorize(role1, role2)` on individual mutation endpoints:
```js
const router = express.Router();
router.use(authenticate);              // sets req.user on all routes
router.post('/', authorize('admin','ir_lead'), handler);
router.get('/', handler);              // reads need no authorize()
```
`authenticate` is in `src/middleware/authenticate.js`. `authorize` is a factory in `src/middleware/authorize.js`.

### 5. Audit logging
Every mutation writes to `audit_log` in the application layer. Use the existing pattern:
```js
await db.query(
  `INSERT INTO audit_log (user_id, action, entity_type, entity_id, details)
   VALUES ($1, $2, $3, $4, $5)`,
  [req.user.id, 'key.created', 'key_inventory', newKey.id, JSON.stringify({ name: newKey.name })]
);
```
Action strings are `<entity>.<verb>`, e.g. `case.created`, `key.rotated`, `compliance.signed_off`.

### 6. Soft deletes only
No hard deletes anywhere. Use `deleted_at TIMESTAMPTZ` (cases) or `status = 'retired'/'destroyed'` (keys). Immutable tables (actions, evidence, audit_log, attestations) have no delete path at all.

### 7. Frontend API client
All API calls go through `src/api/client.js`, which exports named domain objects:
```js
export const casesApi      = { list, get, create, update };
export const calendarApi   = { getPeriod, getAll, getInstance, ... };
export const keyInventoryApi = { list, get, create, update, rotate, retire, expiring };
// etc.
```
Never call `axios` directly in a page component. Add new domains to `client.js`.

### 8. Background services
Services are `node-cron` jobs exported as `start<ServiceName>()` and registered in `app.js` inside the startup IIFE:
```js
(async () => {
  await testConnection();
  startDeadlineEngine();
  startComplianceScheduler();
  startKeyExpiryEngine();
  app.listen(PORT, ...);
})();
```

### 9. Storage
File uploads go through `src/services/storage.js`. In dev it writes to `local-evidence/`. In prod it writes to Azure Blob Storage. The interface is:
```js
await storage.upload(buffer, filename, mimeType) // returns { url, hash }
await storage.download(url)                       // returns buffer
```
Never write to disk directly in a route handler.

---

## Modules

### Module 1: Authentication
**Routes:** `src/routes/auth.js`
**Endpoints:** `POST /api/auth/login`, `POST /api/auth/refresh`, `POST /api/auth/logout`
**Roles:** `admin`, `ir_lead`, `ir_analyst`, `readonly`
**Status: Complete**

JWT access tokens (15-min expiry) + refresh token rotation. Passwords hashed with bcryptjs. Rate-limited to 20 requests per 5 minutes on auth endpoints.

---

### Module 2: Incident Response (Cases)
**Routes:** `src/routes/cases.js`, `actions.js`, `evidence.js`, `notifications.js`, `exports.js`
**Pages:** `CaseList.jsx`, `CaseDetail.jsx`
**Status: Complete**

Core incident lifecycle: create → open → contained → resolved → closed. Every status transition writes to `audit_log`.

Key behaviors:
- `breach` and `suspected` classifications auto-set `notification_deadline = created_at + 72 hours`
- The action log is append-only (no UPDATE/DELETE on `actions`)
- Evidence files are SHA-256 hashed server-side on upload
- Requirement coverage tracker: pulls all `requirement_refs` from case actions and shows which PCI-DSS 12.10.x items have been addressed

**QSA export** (`/api/cases/:id/export`): Produces a ZIP containing `incident_report.pdf`, all evidence files, `manifest.json` (hashes + export metadata), and `audit_trail.pdf`. Export stored in Blob Storage with a 24-hour SAS download link.

---

### Module 3: Notification Deadline Engine
**Service:** `src/services/deadlineEngine.js`
**Routes:** `src/routes/notifications.js`
**Status: Complete**

Runs every 15 minutes via `node-cron`. Escalates at 48hr, 60hr, 68hr, 72hr. Sends email + in-app alerts. Flags `overdue` if 72hr passes with `status = pending`. Every alert written to `notification_alerts` and `audit_log`.

---

### Module 4: Tabletop Exercises
**Routes:** `src/routes/scenarios.js`, `exercises.js`, `gaps.js`
**Pages:** `Tabletop.jsx`, `ExerciseDetail.jsx`, `AfterAction.jsx`
**Status: Complete**

Pre-built scenario library (5 scenarios) plus custom scenario builder. Exercise runner assigns roles, delivers injects, captures responses as actions (same `actions` table as live cases, with `case_type = 'tabletop'`). After-action report auto-generated from action log. Gap tracker persists gaps to a `gaps` table and feeds into the annual requirement coverage view.

---

### Module 5: Compliance Calendar
**Routes:** `src/routes/complianceCalendar.js`
**Service:** `src/services/complianceScheduler.js`
**Pages:** `CompliancePage.jsx`, `ComplianceCheckDetail.jsx`
**Status: Complete (UI has known improvement opportunity — see §Gaps below)**

The compliance scheduler runs at startup and daily. It reads `compliance_check_definitions` (seeded from `seedComplianceChecks.js`) and mints `compliance_check_instances` for each period that doesn't already have one.

**Org settings** (`org_settings` table, single row) control which conditional checks appear:
- `is_service_provider` → enables S8, E8 and semi-annual segmentation
- `has_wireless_in_cde` → enables Q3, A16
- `has_ecommerce` → enables Q5
- `has_cloud_infra` → enables S3
- `has_waf` → enables S2

**Check definitions** (seeded, not editable via UI):

| Cadence | IDs | Count |
|---|---|---|
| Quarterly | Q1–Q7 | 7 |
| Semi-annual | S1–S8 | 8 |
| Annual | A1–A17 | 17 |
| Event-triggered | E1–E8 | 8 |

Full definitions are in `src/db/seedComplianceChecks.js`. PCI-DSS requirement citations are in `docs/Compliance Calendar Spec.md`.

**Sign-off chain:** Each instance has a reviewer + approver sign-off via `compliance_check_signoffs`. `Mark Complete` is blocked until all `required_evidence_labels` have at least one file uploaded.

---

### Module 6: Key Inventory
**Routes:** `src/routes/keyInventory.js`
**Service:** `src/services/keyExpiryEngine.js`
**Page:** `KeyInventory.jsx`
**Status: Complete**

Cryptographic key and certificate inventory satisfying PCI-DSS 3.6.1 and 3.7.x. **Metadata only — no secret material is ever stored.** Key material stays in the vault/HSM/KMS; this table records the reference, not the bytes.

Tracks: AES symmetric keys, RSA/ECDSA keypairs, TLS/SSL certificates, signing keys, HMAC keys, API secrets. The `key_role` column (KEK/DEK/standalone) plus `protected_by_key_id` self-reference proves the 3.6.1 requirement that key-encrypting keys are stored separately from and are at least as strong as the DEKs they protect.

**Expiry engine:** Runs daily. Sends email + in-app alerts at 90d, 30d, 7d, and expired thresholds. Each threshold fires once (unique constraint on `key_rotation_alerts`). Flips status to `expiring_soon` inside the window.

**Custodian attestation (3.6.1 b1):** A built-in compliance check definition (`Cryptographic Key Custodian Access Review`, semi-annual cadence) is seeded into the calendar. When a reviewer submits an attestation, the route snapshots the live custodian roster into `key_custodian_attestations` and automatically closes the linked calendar instance with evidence and sign-off.

---

### Module 7: Org Settings
**Routes:** `src/routes/orgSettings.js`
**Page:** `OrgSettings.jsx`
**Status: Complete**

Single-row `org_settings` table. Controls conditional compliance checks, org name, QSA contact, assessment year, and quarter start month. Only `admin` can edit.

---

## PCI-DSS Requirement Coverage

| Requirement | Where it's addressed |
|---|---|
| 3.6.1 / 3.7.x | Key Inventory module (metadata + custodian attestation) |
| 6.3.3 | A8 — Software Component / SBOM Review (compliance calendar) |
| 7.2.4 | S4 — User Access Review (semi-annual, compliance calendar) |
| 8.2.7 | Q4 — Remote Access Account Review |
| 10.4.1 | Q6 — Log Review Attestation (daily requirement, quarterly sign-off) |
| 11.2.1 | Q3 — Wireless Rogue AP Scan (conditional on `has_wireless_in_cde`) |
| 11.3.1 | Q2 — Internal Vulnerability Scan |
| 11.3.2 | Q1 — External ASV Scan |
| 11.4.2–4.3 | A1, A2 — Internal + External Pen Tests |
| 11.4.5–4.6 | A3, S8 — Segmentation testing (all entities annual; SPs semi-annual) |
| 11.6.1 | Q5 — Payment Page Integrity (conditional on `has_ecommerce`) |
| 12.1.2 | A4 — Information Security Policy Review |
| 12.3.1 | A5 — Targeted Risk Assessment |
| 12.5.2 | S5 — CDE Scoping Review |
| 12.6.3 | A6 — Security Awareness Training |
| 12.8.x | S6, A11, A12 — TPSP management checks |
| 12.10.1 | A7 — IR Plan Review + Test; also evidenced by active case management |
| 12.10.2 | Tabletop exercise module (exercise report = evidence) |
| 12.10.3–7 | Requirement coverage tracker on case detail view |

---

## Known Gaps and Improvement Areas

These are things the specs call for that are incomplete or need updating:

### 1. Dashboard is IR-centric (needs compliance-first update)
The current `Dashboard.jsx` shows only incident stats (open cases, contained, overdue). Per the compliance-platform pivot, it should lead with compliance health:
- Compliance progress bar for the current period (same logic as `CompliancePage.jsx`)
- Overdue checks count + quick link
- Keys expiring within 90 days count (from `GET /api/key-inventory/expiring?days=90`)
- Incident stats remain but as a secondary section

### 2. CompliancePage tab routing
The Compliance UI Spec calls for `/compliance` (This Period tab) and `/compliance/all` (All Checks tab) as distinct routes. The current `CompliancePage.jsx` handles both tabs in a single component with local state. The routes exist in `App.jsx` but the URL doesn't change on tab switch. Align the tab switch with URL routing so deep-links work.

### 3. Tests directory is empty
`tests/` exists but has no test files. Per the CLAUDE.md workflow, routes need tests for: auth (read vs. edit by role), business-rule validation (e.g., KEK strength rejection), background service threshold/idempotency, and attestation snapshot + auto-signoff.

### 4. Calendar does not surface Key Inventory expiries
The Key Inventory Spec calls for `ComplianceCalendar.jsx` to merge expiring keys as a distinct "Key rotation" lane from `GET /api/key-inventory/expiring`. This is not yet implemented.

### 5. Export package does not include key inventory
The QSA export ZIP should include `key-inventory.csv` and the latest custodian attestation. The `src/exports/` builder does not currently include these.

### 6. `app.name` in package.json still says `ir-platform`
Change to `compliance-platform` to reflect the pivot.

---

## Adding New Features — Checklist

When Claude (or a developer) adds a new feature:

1. **New table?** → Create `migrations/0NN_<name>.sql`. Follow naming conventions: UUID PKs, `touch_updated_at()` trigger, RLS policies, no hard-delete policy.
2. **New route file?** → Add `router.use(authenticate)` at the top. Use `authorize('admin','ir_lead')` on mutations. Mount in `app.js`.
3. **New background service?** → Export `start<Name>()`. Register in the startup IIFE in `app.js`.
4. **New page?** → Add the `import` + `<Route>` in `App.jsx`. Add to the sidebar nav in `Layout.jsx`. Add the API domain to `client.js`.
5. **Every mutation** → Write to `audit_log` with action string `<entity>.<verb>`.
6. **Conditional feature?** → Add a boolean to `org_settings` and use it in `seedComplianceChecks.js` as `conditional_on`.

---

## Running Locally

```bash
# Backend
cd compliance-platform-api
cp .env.example .env        # fill in DATABASE_URL, JWT_SECRET, etc.
docker compose up -d        # starts Postgres
npm install
npm run migrate
npm run dev                 # listens on :3000

# Frontend
cd compliance-platform-ui
npm install
npm run dev                 # listens on :3001, proxied to :3000
```

Docker Compose in `compliance-platform-api/docker-compose.yml` brings up Postgres and (optionally) the API itself. For local development running the API outside Docker and Postgres inside is the fastest loop.

---

## Environment Variables

```env
# compliance-platform-api/.env
DATABASE_URL=postgresql://postgres:password@localhost:5432/compliance_platform
JWT_SECRET=<random 64-char hex>
JWT_REFRESH_SECRET=<different random 64-char hex>
CORS_ORIGIN=http://localhost:3001
PORT=3000

# Storage — local dev uses filesystem, prod uses Azure
STORAGE_PROVIDER=local           # 'local' | 'azure'
AZURE_STORAGE_CONNECTION_STRING= # required if STORAGE_PROVIDER=azure
AZURE_STORAGE_CONTAINER=evidence

# Email — optional in dev (alerts just log to console if not set)
EMAIL_PROVIDER=console           # 'console' | 'azure'
AZURE_COMM_CONNECTION_STRING=    # required if EMAIL_PROVIDER=azure
EMAIL_FROM=noreply@yourdomain.com
```

---

## Open Source Notes

- License: MIT
- No hardcoded tenant/org data anywhere — all org-specific config lives in `org_settings`
- Disclaimer must appear in README: this tool aids compliance, it does not guarantee it. QSA assessment is still required.
- The `local-evidence/` and `local-exports/` directories are gitignored. Never commit evidence files.
- GitHub Actions CI should run: `npm run lint`, `npm test`, `npm run audit-deps` on every PR.

---

## What Was Originally the IR Tool

The original build plan was a standalone IR tool (Phases 1–6 in `docs/IR Core Features Spec.md`). All of that has been built. The pivot to a compliance platform means:

- The nav item formerly called "Incidents" is now "Cases" (a module, not the product)
- The old separate "Annual Compliance" page (`010_annual_compliance.sql`) is superseded by the full compliance calendar
- The `12.10.x` annual sign-offs are now `A7` in the compliance calendar, not a separate route
- The Dashboard should lead with compliance health, not incident stats

Do not delete the IR infrastructure — it is the evidence backbone for the entire platform. Every compliance check that requires a tabletop or real incident as evidence relies on it.
