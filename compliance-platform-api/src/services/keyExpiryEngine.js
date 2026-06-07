'use strict';

const cron = require('node-cron');
const { query } = require('../db');
const { sendEmail } = require('./emailService');
const logger = require('./logger');

// Thresholds in days remaining before expiry. Each fires once per key.
const THRESHOLDS = [
  { key: '90d', daysRemaining: 90 },
  { key: '30d', daysRemaining: 30 },
  { key: '7d',  daysRemaining: 7  },
];

async function runKeyExpiryCheck() {
  logger.info('Key expiry engine: running check');
  try {
    const { rows: keys } = await query(`
      SELECT k.id, k.name, k.asset_type, k.algorithm, k.key_strength_bits,
             k.storage_location, k.expires_on, k.status,
             cp.email AS custodian_primary_email,
             cb.email AS custodian_backup_email
      FROM key_inventory k
      LEFT JOIN users cp ON cp.id = k.custodian_primary
      LEFT JOIN users cb ON cb.id = k.custodian_backup
      WHERE k.status IN ('active', 'expiring_soon')
        AND k.expires_on IS NOT NULL
    `);

    const now = new Date();

    for (const key of keys) {
      const expiry = new Date(key.expires_on);
      const daysRemaining = Math.ceil((expiry - now) / (1000 * 60 * 60 * 24));

      // Expired: high-severity alert + keep status visible as expiring_soon.
      if (daysRemaining <= 0) {
        if (!(await alreadyAlerted(key.id, 'expired'))) {
          await fireAlert(key, 'expired', daysRemaining);
        }
        await query(
          `UPDATE key_inventory SET status = 'expiring_soon', updated_at = NOW()
           WHERE id = $1 AND status = 'active'`,
          [key.id]
        );
        continue;
      }

      // Flip to expiring_soon inside the widest window.
      if (daysRemaining <= 90 && key.status === 'active') {
        await query(
          `UPDATE key_inventory SET status = 'expiring_soon', updated_at = NOW() WHERE id = $1`,
          [key.id]
        );
      }

      for (const threshold of THRESHOLDS) {
        if (daysRemaining <= threshold.daysRemaining) {
          if (await alreadyAlerted(key.id, threshold.key)) continue;
          await fireAlert(key, threshold.key, daysRemaining);
        }
      }
    }
  } catch (err) {
    logger.error({ err }, 'Key expiry engine error');
  }
}

async function alreadyAlerted(keyId, alertType) {
  const { rows } = await query(
    `SELECT id FROM key_rotation_alerts WHERE key_id = $1 AND alert_type = $2`,
    [keyId, alertType]
  );
  return rows.length > 0;
}

async function fireAlert(key, alertType, daysRemaining) {
  const expiredLabel = alertType === 'expired';
  const subject = expiredLabel
    ? `[COMPLIANCE] Key EXPIRED — ${key.name}`
    : `[COMPLIANCE] Key rotation due in ${alertType} — ${key.name}`;

  const body = [
    expiredLabel ? 'CRYPTOGRAPHIC KEY EXPIRED' : 'CRYPTOGRAPHIC KEY ROTATION ALERT',
    ``,
    `Key         : ${key.name} (${key.asset_type})`,
    `Algorithm   : ${key.algorithm}${key.key_strength_bits ? ` / ${key.key_strength_bits}-bit` : ''}`,
    `Location    : ${key.storage_location}`,
    `Expires     : ${new Date(key.expires_on).toISOString().slice(0, 10)}`,
    `Days left   : ${daysRemaining}`,
    ``,
    `Action required (PCI-DSS 3.7.4): rotate or retire this key in Compliance Platform`,
    `before the end of its cryptoperiod.`,
  ].join('\n');

  // Email custodians (if set) + all admins/ir_leads.
  const { rows: leads } = await query(
    `SELECT email FROM users
     WHERE role IN ('admin', 'ir_lead') AND is_active = TRUE AND deleted_at IS NULL`
  );
  const recipients = new Set(
    [key.custodian_primary_email, key.custodian_backup_email, ...leads.map(l => l.email)]
      .filter(Boolean)
  );

  for (const to of recipients) {
    try {
      await sendEmail({ to, subject, body });
      await query(
        `INSERT INTO key_rotation_alerts (key_id, alert_type, channel, sent_to)
         VALUES ($1, $2, 'email', $3)
         ON CONFLICT (key_id, alert_type) DO NOTHING`,
        [key.id, alertType, to]
      );
    } catch (err) {
      logger.error({ err, to, alertType }, 'Failed to send key expiry alert email');
    }
  }

  // In-app alert row (only one per key+threshold thanks to the UNIQUE constraint).
  await query(
    `INSERT INTO key_rotation_alerts (key_id, alert_type, channel, sent_to)
     VALUES ($1, $2, 'in_app', $3)
     ON CONFLICT (key_id, alert_type) DO NOTHING`,
    [key.id, alertType, key.id]
  );

  await query(
    `INSERT INTO audit_log (action, resource_type, resource_id, new_value)
     VALUES ('key.expiry_alert', 'key', $1, $2)`,
    [key.id, JSON.stringify({ alert_type: alertType, days_remaining: daysRemaining })]
  );

  logger.warn({ keyId: key.id, alertType, daysRemaining }, 'Key expiry alert fired');
}

/**
 * Start the key expiry engine. Runs daily at 01:00.
 * Called once from app.js on startup.
 */
function startKeyExpiryEngine() {
  logger.info('Key expiry engine: starting (daily at 01:00)');
  cron.schedule('0 1 * * *', runKeyExpiryCheck);
  runKeyExpiryCheck();
}

module.exports = { startKeyExpiryEngine, runKeyExpiryCheck };
