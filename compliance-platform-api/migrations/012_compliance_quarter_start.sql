-- 012_compliance_quarter_start.sql
-- Adds per-cadence schedule configuration to org_settings.
--
-- compliance_quarterly_start_month (1–12):
--   Month Q1's 1-month review window opens. Q2/Q3/Q4 are +3 months each.
--   Default 3 = March (Q1 Mar, Q2 Jun, Q3 Sep, Q4 Dec).
--
-- compliance_semi_annual_start_month (1–12):
--   Month H1's review window opens. H2 is +6 months.
--   Default 6 = June (H1 Jun, H2 Dec).
--
-- compliance_annual_due_month (1–12):
--   Month the annual review window opens and is due.
--   Default 12 = December.
--
-- All review windows are 1 calendar month (period_start = 1st, period_end = last day).

ALTER TABLE org_settings
  ADD COLUMN IF NOT EXISTS compliance_quarterly_start_month   INT NOT NULL DEFAULT 3
    CHECK (compliance_quarterly_start_month   BETWEEN 1 AND 12),
  ADD COLUMN IF NOT EXISTS compliance_semi_annual_start_month INT NOT NULL DEFAULT 6
    CHECK (compliance_semi_annual_start_month BETWEEN 1 AND 12),
  ADD COLUMN IF NOT EXISTS compliance_annual_due_month        INT NOT NULL DEFAULT 12
    CHECK (compliance_annual_due_month        BETWEEN 1 AND 12);
