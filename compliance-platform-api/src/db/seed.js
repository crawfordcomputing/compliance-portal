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
    if (existing.length > 0) {
      console.log(`User already exists: ${EMAIL}`);
      return;
    }
    const hash = await bcrypt.hash(PASSWORD, 12);
    const { rows } = await client.query(
      `INSERT INTO users (email, password_hash, full_name, role)
       VALUES ($1, $2, $3, $4) RETURNING id, email, role`,
      [EMAIL, hash, FULL_NAME, ROLE]
    );
    console.log('\nSeed user created:');
    console.log(`  ID    : ${rows[0].id}`);
    console.log(`  Email : ${rows[0].email}`);
    console.log(`  Role  : ${rows[0].role}`);
    console.log(`  Pass  : ${PASSWORD}`);
    console.log('\nChange this password after first login.\n');
  } finally {
    client.release();
    await pool.end();
  }
}

seed().catch(err => { console.error(err.message); process.exit(1); });
