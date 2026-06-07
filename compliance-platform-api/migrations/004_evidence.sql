-- 004_evidence.sql
-- Evidence is append-only. Chain of custody requires no deletions.
CREATE TABLE evidence (
  id            UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  case_id       UUID NOT NULL REFERENCES cases(id),
  action_id     UUID REFERENCES actions(id),   -- optional: link to specific action
  filename      TEXT NOT NULL,
  blob_url      TEXT NOT NULL,
  sha256_hash   TEXT NOT NULL,
  file_size     BIGINT NOT NULL,
  mime_type     TEXT,
  uploaded_by   UUID NOT NULL REFERENCES users(id),
  uploaded_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
  -- No deleted_at. Evidence cannot be removed (chain of custody).
);

CREATE INDEX idx_evidence_case_id ON evidence(case_id);

-- Prevent any UPDATE or DELETE on evidence
CREATE OR REPLACE FUNCTION deny_evidence_mutation()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'Evidence records are immutable. Updates and deletes are not permitted.';
END;
$$;

CREATE TRIGGER trg_evidence_no_update
  BEFORE UPDATE ON evidence
  FOR EACH ROW EXECUTE FUNCTION deny_evidence_mutation();

CREATE TRIGGER trg_evidence_no_delete
  BEFORE DELETE ON evidence
  FOR EACH ROW EXECUTE FUNCTION deny_evidence_mutation();
