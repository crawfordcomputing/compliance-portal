-- 006_tabletop_scenarios.sql
CREATE TABLE tabletop_scenarios (
  id                UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  title             TEXT NOT NULL,
  description       TEXT,
  injects           JSONB NOT NULL DEFAULT '[]',   -- [{order, delay_min, prompt}]
  roles             TEXT[] NOT NULL DEFAULT '{}',  -- ['facilitator','ir_lead','analyst']
  requirement_focus TEXT[] NOT NULL DEFAULT '{}',  -- ['12.10.1','12.10.5']
  is_builtin        BOOLEAN NOT NULL DEFAULT FALSE,
  created_by        UUID REFERENCES users(id),
  created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TRIGGER trg_scenarios_updated_at
  BEFORE UPDATE ON tabletop_scenarios
  FOR EACH ROW EXECUTE FUNCTION touch_updated_at();

-- Tracks each run of a scenario (one exercise = one case with classification='tabletop')
CREATE TABLE tabletop_exercises (
  id          UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  scenario_id UUID NOT NULL REFERENCES tabletop_scenarios(id),
  case_id     UUID NOT NULL REFERENCES cases(id),   -- the linked tabletop case
  facilitator UUID NOT NULL REFERENCES users(id),
  participants JSONB NOT NULL DEFAULT '[]',          -- [{user_id, role}]
  started_at  TIMESTAMPTZ,
  ended_at    TIMESTAMPTZ,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_exercises_case ON tabletop_exercises(case_id);

-- Gaps identified during after-action review
CREATE TABLE tabletop_gaps (
  id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  exercise_id     UUID NOT NULL REFERENCES tabletop_exercises(id),
  requirement_ref TEXT NOT NULL,
  description     TEXT NOT NULL,
  remediated      BOOLEAN NOT NULL DEFAULT FALSE,
  remediated_at   TIMESTAMPTZ,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_gaps_exercise ON tabletop_gaps(exercise_id);
