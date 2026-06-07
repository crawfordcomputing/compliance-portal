-- 011_compliance_calendar.sql

-- Organization configuration (single row)
CREATE TABLE org_settings (
  id                   UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  org_name             TEXT NOT NULL DEFAULT 'My Organization',
  is_service_provider  BOOLEAN NOT NULL DEFAULT FALSE,
  has_wireless_in_cde  BOOLEAN NOT NULL DEFAULT FALSE,
  has_ecommerce        BOOLEAN NOT NULL DEFAULT FALSE,
  has_cloud_infra      BOOLEAN NOT NULL DEFAULT FALSE,
  has_waf              BOOLEAN NOT NULL DEFAULT FALSE,
  siem_in_use          BOOLEAN NOT NULL DEFAULT TRUE,
  qsa_contact          TEXT,
  assessment_year      INT,
  updated_at           TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_by           UUID REFERENCES users(id)
);

-- Seed default org settings row
INSERT INTO org_settings (org_name) VALUES ('My Organization');

CREATE TYPE check_cadence AS ENUM ('quarterly', 'semi_annual', 'annual', 'event_triggered');
CREATE TYPE check_status  AS ENUM ('pending', 'in_progress', 'complete', 'overdue', 'na', 'waived');

-- Check type definitions (templates)
CREATE TABLE compliance_check_definitions (
  id                      UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  name                    TEXT NOT NULL,
  description             TEXT NOT NULL,
  instructions            TEXT,
  cadence                 check_cadence NOT NULL,
  pci_req_refs            TEXT[] NOT NULL DEFAULT '{}',
  required_evidence_labels TEXT[] NOT NULL DEFAULT '{}',
  conditional_on          TEXT,         -- NULL=always, or org_settings column name
  sp_cadence_note         TEXT,         -- display note when is_service_provider=true
  is_builtin              BOOLEAN NOT NULL DEFAULT TRUE,
  active                  BOOLEAN NOT NULL DEFAULT TRUE,
  sort_order              INT NOT NULL DEFAULT 0,
  created_at              TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_check_defs_cadence ON compliance_check_definitions(cadence) WHERE active = TRUE;

-- Check instances (one per period per definition)
CREATE TABLE compliance_check_instances (
  id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  definition_id   UUID NOT NULL REFERENCES compliance_check_definitions(id),
  period_label    TEXT NOT NULL,          -- Q1-2026, H1-2026, 2026
  period_start    DATE NOT NULL,
  period_end      DATE NOT NULL,
  due_date        DATE NOT NULL,
  status          check_status NOT NULL DEFAULT 'pending',
  assigned_to     UUID[] NOT NULL DEFAULT '{}',
  completed_by    UUID REFERENCES users(id),
  completed_at    TIMESTAMPTZ,
  notes           TEXT,
  na_reason       TEXT,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (definition_id, period_label)
);

CREATE INDEX idx_check_instances_status    ON compliance_check_instances(status);
CREATE INDEX idx_check_instances_due       ON compliance_check_instances(due_date);
CREATE INDEX idx_check_instances_def       ON compliance_check_instances(definition_id);

CREATE TRIGGER trg_check_instances_updated_at
  BEFORE UPDATE ON compliance_check_instances
  FOR EACH ROW EXECUTE FUNCTION touch_updated_at();

-- Evidence per instance
CREATE TABLE compliance_check_evidence (
  id            UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  instance_id   UUID NOT NULL REFERENCES compliance_check_instances(id),
  label         TEXT NOT NULL,
  filename      TEXT NOT NULL,
  blob_url      TEXT NOT NULL,
  sha256_hash   TEXT NOT NULL,
  file_size     BIGINT NOT NULL,
  mime_type     TEXT,
  uploaded_by   UUID NOT NULL REFERENCES users(id),
  uploaded_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_check_evidence_instance ON compliance_check_evidence(instance_id);

-- Sign-off chain per instance
CREATE TABLE compliance_check_signoffs (
  id          UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  instance_id UUID NOT NULL REFERENCES compliance_check_instances(id),
  signed_by   UUID NOT NULL REFERENCES users(id),
  signed_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  role        TEXT NOT NULL DEFAULT 'approver',  -- reviewer, approver
  notes       TEXT
);

CREATE INDEX idx_check_signoffs_instance ON compliance_check_signoffs(instance_id);
