-- 003_actions.sql
-- Actions are append-only. No UPDATE or DELETE ever issued against this table.
CREATE TABLE actions (
  id               UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  case_id          UUID NOT NULL REFERENCES cases(id),
  description      TEXT NOT NULL,
  actor_id         UUID NOT NULL REFERENCES users(id),
  requirement_refs TEXT[] NOT NULL DEFAULT '{}',  -- e.g. ['12.10.1', '10.7']
  created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW()
  -- No updated_at or deleted_at -- this table is immutable
);

CREATE INDEX idx_actions_case_id ON actions(case_id);
CREATE INDEX idx_actions_actor   ON actions(actor_id);

-- Prevent any UPDATE or DELETE on actions (immutability enforced at DB level)
CREATE OR REPLACE FUNCTION deny_action_mutation()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'Actions are immutable. Updates and deletes are not permitted.';
END;
$$;

CREATE TRIGGER trg_actions_no_update
  BEFORE UPDATE ON actions
  FOR EACH ROW EXECUTE FUNCTION deny_action_mutation();

CREATE TRIGGER trg_actions_no_delete
  BEFORE DELETE ON actions
  FOR EACH ROW EXECUTE FUNCTION deny_action_mutation();
