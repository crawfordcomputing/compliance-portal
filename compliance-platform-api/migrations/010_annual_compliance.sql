-- 010_annual_compliance.sql
-- Annual compliance checklist sign-off per requirement per year.
-- Some rows are auto-derived from cases/exercises; others are manually checked.

CREATE TYPE compliance_status AS ENUM ('pending', 'met', 'not_met', 'na');

CREATE TABLE annual_compliance (
  id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  year            INT NOT NULL,
  requirement_ref TEXT NOT NULL,
  status          compliance_status NOT NULL DEFAULT 'pending',
  notes           TEXT,
  auto_derived    BOOLEAN NOT NULL DEFAULT FALSE,
  checked_by      UUID REFERENCES users(id),
  checked_at      TIMESTAMPTZ,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (year, requirement_ref)
);

CREATE INDEX idx_annual_compliance_year ON annual_compliance(year);

CREATE TRIGGER trg_annual_compliance_updated_at
  BEFORE UPDATE ON annual_compliance
  FOR EACH ROW EXECUTE FUNCTION touch_updated_at();

-- Also store per-case requirement check-ins (replaces the action-ref approach for the 7 items)
-- status: 'met' | 'not_met' | 'na' | 'pending'
CREATE TABLE case_requirement_checkins (
  id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  case_id         UUID NOT NULL REFERENCES cases(id),
  requirement_ref TEXT NOT NULL,
  status          compliance_status NOT NULL DEFAULT 'pending',
  notes           TEXT,
  checked_by      UUID REFERENCES users(id),
  checked_at      TIMESTAMPTZ,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (case_id, requirement_ref)
);

CREATE INDEX idx_case_checkins_case ON case_requirement_checkins(case_id);

CREATE TRIGGER trg_case_checkins_updated_at
  BEFORE UPDATE ON case_requirement_checkins
  FOR EACH ROW EXECUTE FUNCTION touch_updated_at();
