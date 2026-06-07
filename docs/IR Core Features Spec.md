================================================================
PCI-DSS INCIDENT RESPONSE TOOL -- COWORK BUILD PLAN
================================================================
Stack: Node.js, PostgreSQL (Azure Database for PostgreSQL Flexible Server)
Hosting: Azure App Service
Storage: Azure Blob Storage (evidence files)
Secrets: Azure Key Vault


----------------------------------------------------------------
PHASE 1 -- PROJECT SCAFFOLD
----------------------------------------------------------------
Goal: Working repo with DB connection, auth skeleton, and audit
      infrastructure in place before any features are built.

Tasks:
  1. Init Node.js project (Express, pg, dotenv, pdf-lib, archiver)
  2. Folder structure:
       /src
         /routes
         /middleware
         /db
         /services
         /exports
       /migrations
       /tests
  3. Azure infra setup:
       - App Service (Node 20 LTS)
       - PostgreSQL Flexible Server
       - Blob Storage container (evidence)
       - Key Vault (connection strings, blob SAS key)
  4. Database migrations (run in order):
       - 001_users.sql
       - 002_cases.sql
       - 003_actions.sql
       - 004_evidence.sql
       - 005_notifications.sql
       - 006_tabletop_scenarios.sql
       - 007_audit_log.sql
       - 008_audit_triggers.sql
       - 009_roles_and_permissions.sql
  5. pgaudit configuration on Azure Postgres:
       pgaudit.log = 'write, ddl'
       pgaudit.log_catalog = off
       pgaudit.log_relation = on
       pgaudit.log_parameter = on
  6. Audit context middleware (sets app.current_user_id,
     app.client_ip, app.session_id on every DB connection)
  7. Basic JWT auth (login, refresh, logout)
  8. Role definitions: admin, ir_lead, ir_analyst, readonly

Deliverable: Authenticated API with DB connected, audit triggers
             firing, and pgaudit logging to Azure Monitor.


----------------------------------------------------------------
PHASE 2 -- CASE MANAGEMENT (REACTIVE MODE)
----------------------------------------------------------------
Goal: Full lifecycle management of a live incident.

Schema (cases table):
  - id, title, classification, saq_type, cde_scope (JSONB)
  - status, notification_deadline, created_at, resolved_at
  - created_by, deleted_at (soft delete only)

Features:
  2.1  Create case
         - Classification: breach / suspected / near_miss
         - SAQ type selector (A, A-EP, B, B-IP, C, D)
         - CDE scope (free JSONB, list of systems/segments)
         - Auto-set notification_deadline = created_at + 72 hours
           for breach / suspected classifications

  2.2  Case detail view
         - Full metadata
         - Live countdown to notification deadline (if active)
         - Status transitions: open > contained > resolved > closed
         - All transitions logged to audit_log

  2.3  Action log
         - Append-only (no UPDATE/DELETE on actions table)
         - Required fields: description, actor, timestamp
         - Optional: requirement_refs (array of PCI-DSS req IDs
           e.g. ['12.10.1', '12.10.5', '10.7'])
         - Evidence attachment per action

  2.4  Evidence management
         - Upload to Azure Blob Storage
         - SHA-256 hash computed server-side on upload
         - Stored: filename, blob_url, hash, uploaded_by, timestamp
         - No delete endpoint (append-only)
         - Chain of custody report per case

  2.5  Requirement coverage tracker
         - Pull all requirement_refs from case actions
         - Display which PCI-DSS 12.10.x requirements have been
           addressed vs outstanding
         - Reference list of requirements to include:
             12.10.1  IR plan exists and is current
             12.10.2  IR plan tested annually
             12.10.3  Personnel designated and available 24/7
             12.10.4  Training provided
             12.10.5  Alerts from security monitoring systems
             12.10.6  Plan modified based on lessons learned
             12.10.7  IR procedures for PAN detection
             10.7     Failures of critical controls detected/reported
             6.3.3    All software components protected from vulns

Deliverable: Full reactive incident lifecycle from open to close
             with immutable audit trail and evidence chain.


----------------------------------------------------------------
PHASE 3 -- NOTIFICATION DEADLINE TRACKER
----------------------------------------------------------------
Goal: Never miss the 72-hour card brand notification window.

Features:
  3.1  Notification records per case
         - Recipients: Visa, Mastercard, Acquiring Bank, Custom
         - required_by auto-populated from case created_at
         - sent_at, status (pending / sent / overdue)

  3.2  Deadline engine
         - Background job (node-cron, runs every 15 min)
         - Escalation alerts at: 48hr, 60hr, 68hr, 72hr
         - Alert channels: email (Azure Communication Services)
           and in-app notification
         - If 72hr passes with status=pending, auto-flag overdue
           and create audit log entry

  3.3  Notification log
         - Every alert sent is logged (to whom, when, by whom)
         - Confirmation upload (attach email/letter as evidence)

Deliverable: Automated deadline tracking with escalating alerts
             and full notification audit trail.


----------------------------------------------------------------
PHASE 4 -- TABLETOP EXERCISE MODE
----------------------------------------------------------------
Goal: Run structured PCI-DSS tabletop exercises and capture
      results in the same case management system.

Schema (tabletop_scenarios table):
  - id, title, injects (JSONB array), roles (text array)
  - requirement_focus (text array), created_at

Features:
  4.1  Scenario library
         - Pre-built scenarios:
             * Unencrypted PAN found on file share
             * Skimmer detected on POS terminal
             * Third-party service provider breach
             * Ransomware in CDE adjacent network
             * Insider threat / rogue employee
         - Custom scenario builder
         - Each scenario has: injects (timed prompts),
           roles to assign, requirements in focus

  4.2  Exercise runner
         - Facilitator creates exercise from scenario
         - Assigns roles to team members
         - Delivers injects on a timer or manually
         - Participants log responses as actions
           (same action log as live cases)
         - Classification locked to 'tabletop'

  4.3  After-action report
         - Auto-generated from action log
         - Gaps: requirements referenced vs requirements missed
         - Timeline of responses
         - Participant activity summary
         - Exportable as PDF (same pipeline as QSA export)

  4.4  Gap tracker
         - Persist gaps from each tabletop to a gaps table
         - Track remediation status over time
         - Feed into annual requirement coverage view

Deliverable: Full tabletop workflow from scenario selection
             through after-action gap reporting.


----------------------------------------------------------------
PHASE 5 -- QSA EXPORT PACKAGE
----------------------------------------------------------------
Goal: One-click export of everything a QSA needs to review
      an incident or verify tabletop compliance.

Export package (ZIP) contains:
  - incident_report.pdf
      * Case metadata and classification
      * Full timestamped action log (actor, description, req refs)
      * Notification timeline with proof
      * Requirement coverage map (addressed vs outstanding)
      * Evidence manifest with SHA-256 hashes
  - evidence/ (all attached files)
  - manifest.json
      * All file hashes
      * Export timestamp and exporting user
      * Case ID and status at time of export
  - audit_trail.pdf
      * Raw audit_log entries for the case
      * Covers every DB-level change with user and IP

Implementation notes:
  - PDF generated with pdf-lib
  - ZIP assembled with archiver
  - Export event itself logged to audit_log
  - Exports are stored in Blob Storage (not ephemeral)
  - Download link expires after 24 hours (SAS token)

Deliverable: Downloadable QSA-ready package generated in <10s
             for any case or tabletop exercise.


----------------------------------------------------------------
PHASE 6 -- HARDENING AND QSA READINESS
----------------------------------------------------------------
Goal: Make the tool itself defensible if a QSA asks about it.

  6.1  Row-level security on all tables (users only see cases
       they are assigned to, unless role=admin or ir_lead)

  6.2  All secrets in Azure Key Vault, zero secrets in env files
       or source code

  6.3  HTTPS only, enforced at App Service level

  6.4  Session management: short-lived JWTs (15 min),
       refresh token rotation, forced logout on role change

  6.5  Dependency audit (npm audit) in CI pipeline

  6.6  Rate limiting on auth endpoints

  6.7  Azure Monitor alerts on:
         - Failed login attempts > 5 in 5 min
         - Audit log table INSERT failures
         - Notification deadline breaches

  6.8  Backup policy: daily automated backups on Azure Postgres,
       7-day retention minimum, test restore quarterly

  6.9  Access review log: admin can export all users, roles,
       and last-login timestamps

Deliverable: Tool passes basic security review and can be
             presented to a QSA as an in-scope system with
             appropriate controls documented.

# ir-platform

Open-source PCI-DSS Incident Response Platform. Supports incident lifecycle management, 72-hour notification tracking, tabletop exercises, and QSA-ready export packages.

## PCI-DSS Requirements Supported

| Requirement | Description |
|-------------|-------------|
| 12.10.1 | IR plan exists and is current |
| 12.10.2 | IR plan tested annually (tabletop mode) |
| 12.10.3 | Personnel designated and available 24/7 |
| 12.10.4 | Training provided |
| 12.10.5 | Alerts from security monitoring systems |
| 12.10.6 | Plan modified based on lessons learned |
| 12.10.7 | IR procedures for PAN detection |
| 10.7     | Failures of critical controls detected/reported |
| 6.3.3    | All software components protected from vulnerabilities |


----------------------------------------------------------------
OPEN SOURCE CONSIDERATIONS
----------------------------------------------------------------
  - License: MIT or Apache 2.0 (MIT is simpler)
  - README must include:
      * What PCI-DSS requirements this tool supports
      * Deployment guide (Azure-specific + generic Docker)
      * Clear disclaimer: tool aids compliance, does not
        guarantee it. QSA assessment still required.
  - No hardcoded tenant/org data anywhere
  - Config-driven: requirement refs, notification recipients,
    and scenario content all in config files not source code
  - Docker Compose for local dev (Postgres + Node)
  - GitHub Actions CI: lint, test, npm audit on every PR


----------------------------------------------------------------
BUILD ORDER SUMMARY
----------------------------------------------------------------
  Phase 1  Project scaffold + audit infrastructure
  Phase 2  Case management (reactive)
  Phase 3  Notification deadline tracker
  Phase 4  Tabletop exercise mode
  Phase 5  QSA export package
  Phase 6  Hardening

Each phase should be a working, testable state before moving
to the next. Phases 2 and 3 are the MVP. Phases 4-6 are v1.0.

================================================================
END OF PLAN
================================================================