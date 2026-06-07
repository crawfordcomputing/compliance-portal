-- 008_audit_triggers.sql
-- Automatically writes to audit_log on status changes to cases.
-- The app layer writes audit_log for most events; these triggers are a safety net
-- for any direct DB changes and for case status transitions specifically.

CREATE OR REPLACE FUNCTION audit_case_status_change()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  IF OLD.status IS DISTINCT FROM NEW.status THEN
    INSERT INTO audit_log (
      user_id, user_email, client_ip, session_id,
      action, resource_type, resource_id,
      old_value, new_value
    ) VALUES (
      NULLIF(current_setting('app.current_user_id', true), '')::UUID,
      NULL,
      current_setting('app.client_ip', true),
      current_setting('app.session_id', true),
      'case.status_changed',
      'case',
      NEW.id,
      jsonb_build_object('status', OLD.status),
      jsonb_build_object('status', NEW.status)
    );
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER trg_audit_case_status
  AFTER UPDATE ON cases
  FOR EACH ROW EXECUTE FUNCTION audit_case_status_change();

-- Audit log entry on every new evidence upload
CREATE OR REPLACE FUNCTION audit_evidence_insert()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  INSERT INTO audit_log (
    user_id, client_ip, session_id,
    action, resource_type, resource_id,
    new_value
  ) VALUES (
    NULLIF(current_setting('app.current_user_id', true), '')::UUID,
    current_setting('app.client_ip', true),
    current_setting('app.session_id', true),
    'evidence.uploaded',
    'evidence',
    NEW.id,
    jsonb_build_object('filename', NEW.filename, 'sha256', NEW.sha256_hash, 'case_id', NEW.case_id)
  );
  RETURN NEW;
END;
$$;

CREATE TRIGGER trg_audit_evidence
  AFTER INSERT ON evidence
  FOR EACH ROW EXECUTE FUNCTION audit_evidence_insert();
