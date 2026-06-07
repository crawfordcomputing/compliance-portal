-- 009_roles_and_permissions.sql
-- Row-Level Security (RLS) on cases and related tables.
-- Admins and ir_leads see all cases.
-- ir_analysts and readonly users only see cases they are assigned to.

-- Enable RLS
ALTER TABLE cases     ENABLE ROW LEVEL SECURITY;
ALTER TABLE actions   ENABLE ROW LEVEL SECURITY;
ALTER TABLE evidence  ENABLE ROW LEVEL SECURITY;
ALTER TABLE notifications ENABLE ROW LEVEL SECURITY;

-- Helper: get current user's role from session GUC
CREATE OR REPLACE FUNCTION current_user_role()
RETURNS TEXT LANGUAGE sql STABLE AS $$
  SELECT role::TEXT FROM users
  WHERE id = NULLIF(current_setting('app.current_user_id', true), '')::UUID
    AND deleted_at IS NULL
    AND is_active = TRUE;
$$;

-- Helper: get current user's id
CREATE OR REPLACE FUNCTION current_user_uuid()
RETURNS UUID LANGUAGE sql STABLE AS $$
  SELECT NULLIF(current_setting('app.current_user_id', true), '')::UUID;
$$;

-- Cases policy
CREATE POLICY cases_select ON cases FOR SELECT
  USING (
    deleted_at IS NULL AND (
      current_user_role() IN ('admin', 'ir_lead')
      OR current_user_uuid() = ANY(assigned_to)
      OR current_user_uuid() = created_by
    )
  );

CREATE POLICY cases_insert ON cases FOR INSERT
  WITH CHECK (current_user_role() IN ('admin', 'ir_lead', 'ir_analyst'));

CREATE POLICY cases_update ON cases FOR UPDATE
  USING (
    current_user_role() IN ('admin', 'ir_lead')
    OR (current_user_role() = 'ir_analyst' AND current_user_uuid() = ANY(assigned_to))
  );

-- Actions policy (all assigned users can insert; no updates/deletes at DB level anyway)
CREATE POLICY actions_select ON actions FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM cases c WHERE c.id = actions.case_id AND (
        current_user_role() IN ('admin', 'ir_lead')
        OR current_user_uuid() = ANY(c.assigned_to)
        OR current_user_uuid() = c.created_by
      )
    )
  );

CREATE POLICY actions_insert ON actions FOR INSERT
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM cases c WHERE c.id = case_id AND (
        current_user_role() IN ('admin', 'ir_lead')
        OR current_user_uuid() = ANY(c.assigned_to)
      )
    )
  );

-- Evidence follows case access
CREATE POLICY evidence_select ON evidence FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM cases c WHERE c.id = evidence.case_id AND (
        current_user_role() IN ('admin', 'ir_lead')
        OR current_user_uuid() = ANY(c.assigned_to)
        OR current_user_uuid() = c.created_by
      )
    )
  );

CREATE POLICY evidence_insert ON evidence FOR INSERT
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM cases c WHERE c.id = case_id AND (
        current_user_role() IN ('admin', 'ir_lead')
        OR current_user_uuid() = ANY(c.assigned_to)
      )
    )
  );

-- Notifications: ir_lead and admin only
CREATE POLICY notifications_select ON notifications FOR SELECT
  USING (current_user_role() IN ('admin', 'ir_lead'));

CREATE POLICY notifications_all ON notifications FOR ALL
  USING (current_user_role() IN ('admin', 'ir_lead'));

-- pgaudit configuration note (apply in Azure portal or via ALTER SYSTEM):
-- ALTER SYSTEM SET pgaudit.log = 'write, ddl';
-- ALTER SYSTEM SET pgaudit.log_catalog = off;
-- ALTER SYSTEM SET pgaudit.log_relation = on;
-- ALTER SYSTEM SET pgaudit.log_parameter = on;
-- SELECT pg_reload_conf();
