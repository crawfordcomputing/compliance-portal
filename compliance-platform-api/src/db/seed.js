'use strict';

/**
 * Seed script — creates an initial admin user.
 * Run: node src/db/seed.js
 *
 * Override defaults with env vars:
 *   SEED_EMAIL, SEED_PASSWORD, SEED_NAME, SEED_ROLE
 */

require('dotenv').config();
const bcrypt = require('bcryptjs');
const { Pool } = require('pg');

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: true } : false,
});

const EMAIL     = process.env.SEED_EMAIL    || 'admin@ir-platform.local';
const PASSWORD  = process.env.SEED_PASSWORD || 'ChangeMe123!';
const FULL_NAME = process.env.SEED_NAME     || 'Platform Admin';
const ROLE      = process.env.SEED_ROLE     || 'admin';

async function seed() {
  const client = await pool.connect();
  try {
    const { rows: existing } = await client.query(
      'SELECT id FROM users WHERE email = $1', [EMAIL]
    );
    let adminId;
    if (existing.length > 0) {
      console.log(`User already exists: ${EMAIL}`);
      adminId = existing[0].id;
    } else {
      const hash = await bcrypt.hash(PASSWORD, 12);
      const { rows } = await client.query(
        `INSERT INTO users (email, password_hash, full_name, role)
         VALUES ($1, $2, $3, $4) RETURNING id, email, role`,
        [EMAIL, hash, FULL_NAME, ROLE]
      );
      adminId = rows[0].id;
      console.log('\nSeed user created:');
      console.log(`  ID    : ${rows[0].id}`);
      console.log(`  Email : ${rows[0].email}`);
      console.log(`  Role  : ${rows[0].role}`);
      console.log(`  Pass  : ${PASSWORD}`);
      console.log('\nChange this password after first login.\n');
    }

    await seedSampleKeys(client, adminId);
  } finally {
    client.release();
    await pool.end();
  }
}

/**
 * Seed a small sample key inventory (idempotent): one KEK, one DEK it protects,
 * and one TLS certificate. Demonstrates the KEK->DEK relationship and cert expiry.
 */
async function seedSampleKeys(client, adminId) {
  const { rows: count } = await client.query('SELECT COUNT(*)::int AS n FROM key_inventory');
  if (count[0].n > 0) {
    console.log('Key inventory already has rows — skipping sample keys.');
    return;
  }

  const today = new Date();
  const plusMonths = (n) => {
    const d = new Date(today); d.setMonth(d.getMonth() + n); return d.toISOString().slice(0, 10);
  };

  const { rows: kek } = await client.query(
    `INSERT INTO key_inventory
       (name, asset_type, key_role, purpose, algorithm, key_strength_bits,
        storage_location, storage_form, custodian_primary, cryptoperiod_months,
        activated_on, last_rotated_on, expires_on, status, created_by, updated_by)
     VALUES ('Master KEK - prod','symmetric_key','KEK','Wraps the PAN data-encrypting key',
             'AES-GCM',256,'HSM partition prod-1','HSM',$1,36,
             $2,$2,$3,'active',$1,$1)
     RETURNING id`,
    [adminId, plusMonths(0), plusMonths(36)]
  );

  await client.query(
    `INSERT INTO key_inventory
       (name, asset_type, key_role, purpose, algorithm, key_strength_bits,
        storage_location, storage_form, protected_by_key_id, custodian_primary, cryptoperiod_months,
        activated_on, last_rotated_on, expires_on, status, created_by, updated_by)
     VALUES ('PAN DEK - prod','symmetric_key','DEK','Encrypts stored PAN in payments DB',
             'AES-GCM',256,'vault://kv/prod/pan-dek','vault',$2,$1,12,
             $3,$3,$4,'active',$1,$1)`,
    [adminId, kek[0].id, plusMonths(0), plusMonths(2)]
  );

  await client.query(
    `INSERT INTO key_inventory
       (name, asset_type, key_role, purpose, algorithm, key_strength_bits,
        storage_location, storage_form, custodian_primary, activated_on, expires_on, status, created_by, updated_by)
     VALUES ('api.example.com TLS cert','tls_certificate','standalone','TLS for public API endpoint',
             'RSA',2048,'/etc/ssl/api.example.com','vault',$1,$2,$3,'active',$1,$1)`,
    [adminId, plusMonths(0), plusMonths(1)]
  );

  console.log('Sample key inventory seeded: Master KEK, PAN DEK, TLS cert.');
}

seed().catch(err => { console.error(err.message); process.exit(1); });
