-- 007_audit_log.sql
-- Application-level audit log (separate from pgaudit which goes to Azure Monitor).
-- This table is append-only and must never be truncated or deleted from.
CREATE TABLE audit_log (
  id            UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  event_time    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  user_id       UUID REFERENCES users(id),
  user_email    TEXT,                           -- denormalized in case user is deleted
  client_ip     TEXT,
  session_id    TEXT,
  action        TEXT NOT NULL,                 -- e.g. 'case.status_changed', 'evidence.uploaded'
  resource_type TEXT NOT NULL,                 -- 'case' | 'action' | 'evidence' | 'notification' | 'user'
  resource_id   UUID,
  old_value     JSONB,
  new_value     JSONB,
  meta          JSONB NOT NULL DEFAULT '{}'
);

CREATE INDEX idx_audit_log_resource   ON audit_log(resource_type, resource_id);
CREATE INDEX idx_audit_log_user_id    ON audit_log(user_id);
CREATE INDEX idx_audit_log_event_time ON audit_log(event_time DESC);

-- Prevent mutation of audit log
CREATE OR REPLACE FUNCTION deny_audit_log_mutation()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'audit_log is immutable. No updates or deletes permitted.';
END;
$$;

CREATE TRIGGER trg_audit_log_no_update
  BEFORE UPDATE ON audit_log
  FOR EACH ROW EXECUTE FUNCTION deny_audit_log_mutation();

CREATE TRIGGER trg_audit_log_no_delete
  BEFORE DELETE ON audit_log
  FOR EACH ROW EXECUTE FUNCTION deny_audit_log_mutation();
