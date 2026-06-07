'use strict';

const { Pool } = require('pg');
const logger = require('../services/logger');

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: true } : false,
  max: 10,
  idleTimeoutMillis: 30000,
  connectionTimeoutMillis: 5000,
});

pool.on('error', (err) => {
  logger.error({ err }, 'Unexpected PG pool error');
});

/**
 * Run a query. For audit-sensitive queries, use queryWithAuditCtx instead.
 */
async function query(text, params) {
  const start = Date.now();
  const result = await pool.query(text, params);
  logger.debug({ query: text, duration: Date.now() - start, rows: result.rowCount }, 'db query');
  return result;
}

/**
 * Acquire a client, set audit context GUCs, run fn(client), then release.
 * Ensures pgaudit captures current_user_id, client_ip, session_id for every write.
 */
async function queryWithAuditCtx(auditCtx, fn) {
  const client = await pool.connect();
  try {
    const { userId, clientIp, sessionId } = auditCtx;
    await client.query(`
      SELECT
        set_config('app.current_user_id', $1, true),
        set_config('app.client_ip',        $2, true),
        set_config('app.session_id',       $3, true)
    `, [String(userId), String(clientIp), String(sessionId)]);
    return await fn(client);
  } finally {
    client.release();
  }
}

async function testConnection() {
  try {
    await query('SELECT 1');
    logger.info('Database connection established');
  } catch (err) {
    logger.error({ err }, 'Database connection failed');
    process.exit(1);
  }
}

module.exports = { query, queryWithAuditCtx, pool, testConnection };
