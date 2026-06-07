# Compliance Section — UI Spec
## Single nav item, two-tab layout

---

## Nav Structure

```
Sidebar
├── Dashboard
├── Cases
├── Tabletop
├── Compliance      ← single item, replaces any separate "Annual" page
└── Settings
```

The old 12.10.x / IR annual sign-off page is dissolved. Those checks (A7 — IR Plan Review + Test) become annual-cadence instances in the same system, surfaced through the same two tabs.

---

## Tab Layout

```
┌──────────────────────────────────────────────────────────┐
│  Compliance                          [Export] [Settings] │
│                                                          │
│  ██████████████████████░░░░░░░  14 of 18 complete        │
│  Q2 2026                                                 │
│                                                          │
│  [This Period]  [All Checks]                             │
└──────────────────────────────────────────────────────────┘
```

The progress bar and period label are always visible above the tabs. They reflect the currently selected cadence/period context.

---

## Tab 1 — "This Period" (default)

**Purpose:** Daily/weekly working view. Surfaces only what needs action right now.

### Layout

```
This Period — Q2 2026  (Apr 1 – Jun 30)

 OVERDUE (1)
 ┌─────────────────────────────────────────┐
 │ 🔴 Q1 External ASV Scan    Was due Apr 1│
 │    11.3.2 · Quarterly                   │
 │    [Start]  [Mark N/A]                  │
 └─────────────────────────────────────────┘

 DUE THIS PERIOD (5)
 ┌─────────────────────────────────────────┐
 │ 🟡 Q2 Internal Vuln Scan   Due Jun 30  │
 │ 🟡 Q4 Remote Access Review Due Jun 30  │
 │ 🟢 Q6 Log Review Attestation Complete  │
 │ 🟡 S4 User Access Review   Due Jun 30  │  ← semi-annual due this period
 │ 🔵 A7 IR Plan Review + Test Due Dec 31 │  ← annual, visible if within 30 days
 └─────────────────────────────────────────┘

 UPCOMING — NEXT 30 DAYS (2)
 ┌─────────────────────────────────────────┐
 │ Q3 Wireless Scan          Due Jul 1     │
 │ Q5 Payment Page Attestation Due Jul 1  │
 └─────────────────────────────────────────┘
```

### Logic

- **Overdue:** `status = overdue OR (due_date < today AND status NOT IN (complete, na, waived))`
- **Due this period:** `period_end >= today AND due_date >= today AND status != complete`
- **Upcoming (next 30 days):** checks from the *next* period whose `due_date` is within 30 days of today
- Annual checks surface in "This Period" only if due_date is within 30 days; otherwise they only appear in All Checks

### Status colors
- 🔴 Red — overdue
- 🟡 Amber — in period, not started or in progress
- 🟢 Green — complete
- 🔵 Blue — upcoming / future period

### Check card actions
- **Start** → opens instance detail drawer (notes, evidence upload, assignee, sign-off)
- **Mark N/A** → requires reason text before saving
- **Waive** → requires reason + approver sign-off

---

## Tab 2 — "All Checks"

**Purpose:** Annual planning, audit prep, full calendar view.

### Controls

```
[Cadence: All ▾]  [Year: 2026 ▾]  [Status: All ▾]
```

- **Cadence filter:** All / Quarterly / Semi-Annual / Annual / Event-Triggered
- **Year picker:** defaults to current assessment year from `org_settings.assessment_year`
- **Status filter:** All / Pending / In Progress / Complete / Overdue / N/A

### Layout — grouped by cadence, then period

```
QUARTERLY

  Q1 2026 (Jan–Mar)          [4/6 complete]
  ├── ✅ Q1 External ASV Scan
  ├── ✅ Q2 Internal Vuln Scan
  ├── ⏳ Q4 Remote Access Review   [In Progress]
  ├── ✅ Q6 Log Review Attestation
  ├── ➖ Q3 Wireless Scan          [N/A — no wireless in CDE]
  └── ✅ Q5 Payment Page Attestation

  Q2 2026 (Apr–Jun)          [1/6 complete]
  ├── 🔴 Q1 External ASV Scan      [Overdue]
  ├── ⬜ Q2 Internal Vuln Scan
  ...

SEMI-ANNUAL

  H1 2026 (Jan–Jun)          [2/5 complete]
  ├── ✅ S1 NSC/Firewall Review
  ...

ANNUAL

  2026                       [0/17 complete]
  ├── ⬜ A1 Internal Pen Test
  ├── ⬜ A7 IR Plan Review + Test   ← same system, annual cadence
  ...

EVENT-TRIGGERED

  ├── E1 Post-Change Segmentation Retest   [Trigger-based, no due date]
  ...
```

Clicking any check row opens the same instance detail drawer.

---

## Instance Detail Drawer

Slides in from the right. Same component used from both tabs.

```
┌─────────────────────────────────────────────────────────┐
│  Q1 · External ASV Vulnerability Scan         [×]      │
│  11.3.2 · Quarterly · Q2 2026 · Due Jun 30            │
│                                                         │
│  Status:  [Pending ▾]                                  │
│  Assigned: [+ Add person]                               │
│                                                         │
│  ─── Instructions ───────────────────────────────────  │
│  1. Engage approved ASV vendor...                       │
│  (collapsible)                                          │
│                                                         │
│  ─── Evidence ───────────────────────────────────────  │
│  Required:                                              │
│    □ ASV Passing Report                                 │
│    □ ASV Attestation                                    │
│    □ Remediation Evidence (if findings)                 │
│                                                         │
│  [📎 Upload file]                                       │
│                                                         │
│  ─── Notes ──────────────────────────────────────────  │
│  [                                    ]                 │
│                                                         │
│  ─── Sign-off ───────────────────────────────────────  │
│  Reviewer:  [Not signed]  [Sign as Reviewer]            │
│  Approver:  [Not signed]  [Sign as Approver]            │
│                                                         │
│  [Mark Complete]  [Mark N/A]  [Waive]                  │
└─────────────────────────────────────────────────────────┘
```

Mark Complete is disabled until all required evidence labels have at least one file uploaded.

---

## Progress Bar Logic

```
progress = count(instances WHERE status = 'complete' AND period matches context)
         / count(instances WHERE status != 'na' AND period matches context)
```

- "This Period" tab: counts current period only
- "All Checks" tab: counts the filtered year

---

## Conditional Check Display

Checks with `conditional_on` set are:
- Hidden entirely if the org setting is false (not shown as N/A, just absent)
- Shown normally if the org setting is true

Exception: if a check was previously completed or has evidence, show it even if the setting is now false (data integrity).

---

## Routing

```
/compliance                → This Period tab (default)
/compliance/all            → All Checks tab
/compliance/instance/:id   → opens drawer over whichever tab is active
```

---

## What Happened to the Separate Annual / 12.10.x Page

Dissolved. The IR-specific annual sign-offs (A7 — IR Plan Review + Test, which covers 12.10.1 and 12.10.2) are annual-cadence check instances. They appear:

- In "This Period" when due within 30 days
- In "All Checks" under the Annual section, filterable by cadence = Annual

The requirement coverage tracker in Case Management still shows 12.10.x coverage from action logs. That's a different view (reactive incident tracking). These are the proactive annual sign-offs. No overlap in function.

---

## Build Sequence (within Phase 5 of main build plan)

1. DB: confirm `compliance_check_definitions` seed data includes all checks in spec (Q1–Q6, S1–S8, A1–A17, E1–E8)
2. Backend: `/api/compliance/periods/current` — returns this-period instances
3. Backend: `/api/compliance/instances` — filterable by cadence, year, status
4. Backend: instance CRUD (status update, notes, sign-off, evidence upload)
5. React: `CompliancePage` with tab router
6. React: `ThisPeriodTab` component
7. React: `AllChecksTab` component  
8. React: `InstanceDrawer` component (shared)
9. React: progress bar component (shared)
