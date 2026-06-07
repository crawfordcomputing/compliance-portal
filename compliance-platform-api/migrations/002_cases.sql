-- 002_cases.sql
CREATE TYPE case_classification AS ENUM ('breach', 'suspected', 'near_miss', 'tabletop');
CREATE TYPE case_status AS ENUM ('open', 'contained', 'resolved', 'closed');
CREATE TYPE saq_type AS ENUM ('A', 'A-EP', 'B', 'B-IP', 'C', 'D');

CREATE TABLE cases (
  id                    UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  title                 TEXT NOT NULL,
  classification        case_classification NOT NULL,
  saq_type              saq_type,
  cde_scope             JSONB NOT NULL DEFAULT '[]',
  status                case_status NOT NULL DEFAULT 'open',
  notification_deadline TIMESTAMPTZ,            -- auto-set for breach/suspected
  created_by            UUID NOT NULL REFERENCES users(id),
  assigned_to           UUID[] NOT NULL DEFAULT '{}',
  created_at            TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at            TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  resolved_at           TIMESTAMPTZ,
  deleted_at            TIMESTAMPTZ            -- soft delete only, never hard delete
);

CREATE INDEX idx_cases_status     ON cases(status) WHERE deleted_at IS NULL;
CREATE INDEX idx_cases_created_by ON cases(created_by);
CREATE INDEX idx_cases_deadline   ON cases(notification_deadline) WHERE notification_deadline IS NOT NULL;

-- Auto-set notification_deadline on insert for breach/suspected
CREATE OR REPLACE FUNCTION set_notification_deadline()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.classification IN ('breach', 'suspected') AND NEW.notification_deadline IS NULL THEN
    NEW.notification_deadline := NEW.created_at + INTERVAL '72 hours';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER trg_cases_notification_deadline
  BEFORE INSERT ON cases
  FOR EACH ROW EXECUTE FUNCTION set_notification_deadline();

-- Keep updated_at current
CREATE OR REPLACE FUNCTION touch_updated_at()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  NEW.updated_at := NOW();
  RETURN NEW;
END;
$$;

CREATE TRIGGER trg_cases_updated_at
  BEFORE UPDATE ON cases
  FOR EACH ROW EXECUTE FUNCTION touch_updated_at();
