-- 013_key_inventory.sql
-- Cryptographic key & certificate inventory (PCI-DSS v4.0.1 3.6.1 / 3.7.x).
-- METADATA ONLY. No secret key material is ever stored in these tables.

CREATE TYPE key_asset_type AS ENUM (
  'symmetric_key',      -- e.g. AES data-encrypting key
  'asymmetric_keypair', -- RSA/ECDSA keypair
  'tls_certificate',    -- SSL/TLS server or client cert
  'signing_key',        -- code/document signing
  'hmac_key',           -- message authentication
  'api_secret',         -- API/service credential
  'other'
);

CREATE TYPE key_role AS ENUM (
  'KEK',         -- key-encrypting key
  'DEK',         -- data-encrypting key
  'standalone'   -- cert, signing key, etc. with no wrap relationship
);

CREATE TYPE key_status AS ENUM (
  'active',
  'expiring_soon',  -- set automatically by the expiry engine
  'retired',
  'compromised',
  'destroyed',
  'pending'         -- provisioned, not yet in use
);

CREATE TABLE key_inventory (
  id                  UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  name                TEXT NOT NULL,                      -- human label, e.g. "PAN DEK - prod"
  asset_type          key_asset_type NOT NULL,
  key_role            key_role NOT NULL DEFAULT 'standalone',

  purpose             TEXT NOT NULL,                      -- what it protects / system it serves
  algorithm           TEXT NOT NULL,                      -- 'AES-GCM', 'RSA', 'ECDSA-P256', ...
  key_strength_bits   INT,                                -- 256, 2048, 4096 (NULL for some certs)

  storage_location    TEXT NOT NULL,                      -- vault path / HSM partition / KMS key ARN
  storage_form        TEXT NOT NULL DEFAULT 'vault',      -- 'HSM' | 'KMS' | 'vault' | 'smartcard' | ...

  protected_by_key_id UUID REFERENCES key_inventory(id),  -- the KEK that wraps this DEK (3.6.1)

  custodian_primary   UUID REFERENCES users(id),          -- fewest custodians (3.6.1)
  custodian_backup    UUID REFERENCES users(id),

  cryptoperiod_months INT,                                -- defined cryptoperiod (3.7.4)
  activated_on        DATE,
  last_rotated_on     DATE,
  expires_on          DATE,                               -- cert expiry or activated/rotated + cryptoperiod

  status              key_status NOT NULL DEFAULT 'active',
  status_reason       TEXT,                               -- why retired/compromised/destroyed (3.7.5)
  retired_on          DATE,

  notes               TEXT,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_by          UUID REFERENCES users(id),
  updated_by          UUID REFERENCES users(id),

  CONSTRAINT key_strength_positive CHECK (key_strength_bits IS NULL OR key_strength_bits > 0),
  CONSTRAINT no_self_wrap CHECK (protected_by_key_id IS NULL OR protected_by_key_id <> id)
  -- No secret-material column by design.
);

CREATE INDEX idx_key_inventory_status  ON key_inventory(status);
CREATE INDEX idx_key_inventory_expires ON key_inventory(expires_on);
CREATE INDEX idx_key_inventory_type    ON key_inventory(asset_type);
CREATE INDEX idx_key_inventory_kek     ON key_inventory(protected_by_key_id);

CREATE TRIGGER trg_key_inventory_updated_at
  BEFORE UPDATE ON key_inventory
  FOR EACH ROW EXECUTE FUNCTION touch_updated_at();

-- Rotation / lifecycle alert log (mirrors notification_alerts).
CREATE TABLE key_rotation_alerts (
  id          UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  key_id      UUID NOT NULL REFERENCES key_inventory(id),
  alert_type  TEXT NOT NULL,            -- '90d' | '30d' | '7d' | 'expired'
  channel     TEXT NOT NULL,            -- 'email' | 'in_app'
  sent_to     TEXT NOT NULL,
  sent_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (key_id, alert_type)           -- send each threshold once
);

CREATE INDEX idx_key_rotation_alerts_key ON key_rotation_alerts(key_id);

-- Custodian access attestation snapshot (PCI-DSS 3.6.1 bullet 1).
-- Append-only: a point-in-time record of the confirmed custodian roster.
CREATE TABLE key_custodian_attestations (
  id               UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  instance_id      UUID REFERENCES compliance_check_instances(id), -- links to the calendar check (nullable for ad-hoc)
  period_label     TEXT NOT NULL,                                  -- 'H1-2026'
  attested_by      UUID NOT NULL REFERENCES users(id),
  attested_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  roster_snapshot  JSONB NOT NULL,        -- frozen: [{key_id, key_name, custodian_primary_name, custodian_backup_name}]
  changes_required BOOLEAN NOT NULL DEFAULT FALSE,
  notes            TEXT
);

CREATE INDEX idx_custodian_attest_instance ON key_custodian_attestations(instance_id);
CREATE INDEX idx_custodian_attest_period   ON key_custodian_attestations(period_label);

-- Attestations are immutable evidence: block updates and deletes.
CREATE OR REPLACE FUNCTION deny_attestation_mutation()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'Custodian attestations are immutable. Updates and deletes are not permitted.';
END;
$$;

CREATE TRIGGER trg_attestation_no_update
  BEFORE UPDATE ON key_custodian_attestations
  FOR EACH ROW EXECUTE FUNCTION deny_attestation_mutation();

CREATE TRIGGER trg_attestation_no_delete
  BEFORE DELETE ON key_custodian_attestations
  FOR EACH ROW EXECUTE FUNCTION deny_attestation_mutation();

-- ── Row-Level Security ───────────────────────────────────────────────────────
-- Mirrors 009: all authenticated roles read; admin/ir_lead write. No DELETE policy.
-- (Table owner bypasses RLS; these are the safety net for non-owner connections.)

ALTER TABLE key_inventory ENABLE ROW LEVEL SECURITY;

CREATE POLICY key_inventory_select ON key_inventory FOR SELECT
  USING (current_user_role() IS NOT NULL);

CREATE POLICY key_inventory_insert ON key_inventory FOR INSERT
  WITH CHECK (current_user_role() IN ('admin', 'ir_lead'));

CREATE POLICY key_inventory_update ON key_inventory FOR UPDATE
  USING (current_user_role() IN ('admin', 'ir_lead'));

ALTER TABLE key_custodian_attestations ENABLE ROW LEVEL SECURITY;

CREATE POLICY key_attest_select ON key_custodian_attestations FOR SELECT
  USING (current_user_role() IS NOT NULL);

CREATE POLICY key_attest_insert ON key_custodian_attestations FOR INSERT
  WITH CHECK (current_user_role() IN ('admin', 'ir_lead'));
