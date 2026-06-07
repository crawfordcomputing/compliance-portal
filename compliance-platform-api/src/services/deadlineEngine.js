'use strict';

const cron = require('node-cron');
const { query } = require('../db');
const { sendEmail } = require('./emailService');
const logger = require('./logger');

// Escalation thresholds in hours before/at deadline
const THRESHOLDS = [
  { key: '48hr',  hoursRemaining: 24 },  // alert when 24hr remain (48hr elapsed)
  { key: '60hr',  hoursRemaining: 12 },
  { key: '68hr',  hoursRemaining: 4  },
  { key: '72hr',  hoursRemaining: 0  },
];

async function runDeadlineCheck() {
  logger.info('Deadline engine: running check');
  try {
    // Fetch all pending notifications with an active deadline
    const { rows: notifications } = await query(`
      SELECT n.id, n.case_id, n.recipient, n.custom_name, n.required_by,
             c.title AS case_title, c.classification
      FROM notifications n
      JOIN cases c ON c.id = n.case_id
      WHERE n.status = 'pending'
        AND c.deleted_at IS NULL
        AND n.required_by IS NOT NULL
    `);

    const now = new Date();

    for (const notif of notifications) {
      const deadline = new Date(notif.required_by);
      const msRemaining = deadline - now;
      const hoursRemaining = msRemaining / (1000 * 60 * 60);

      // Auto-flag overdue
      if (hoursRemaining <= 0) {
        await query(
          `UPDATE notifications SET status = 'overdue', updated_at = NOW() WHERE id = $1`,
          [notif.id]
        );
        await query(
          `INSERT INTO audit_log (action, resource_type, resource_id, new_value)
           VALUES ('notification.overdue', 'notification', $1, $2)`,
          [notif.id, JSON.stringify({ case_id: notif.case_id, recipient: notif.recipient })]
        );
        logger.warn({ notifId: notif.id, caseId: notif.case_id }, 'Notification deadline OVERDUE');
        continue;
      }

      // Check which thresholds need alerting (haven't been alerted yet)
      for (const threshold of THRESHOLDS) {
        if (hoursRemaining <= threshold.hoursRemaining + 0.25) { // 15min grace for cron jitter
          const { rows: existing } = await query(
            `SELECT id FROM notification_alerts
             WHERE notification_id = $1 AND alert_type = $2`,
            [notif.id, threshold.key]
          );
          if (existing.length > 0) continue; // already sent this alert

          await fireAlert(notif, threshold.key, hoursRemaining);
        }
      }
    }
  } catch (err) {
    logger.error({ err }, 'Deadline engine error');
  }
}

async function fireAlert(notif, alertType, hoursRemaining) {
  const recipientLabel = notif.custom_name || notif.recipient.toUpperCase();
  const hoursLeft = hoursRemaining.toFixed(1);

  const subject = `[IR-PLATFORM] PCI Notification Deadline Alert — ${alertType} — Case: ${notif.case_title}`;
  const body = [
    `INCIDENT NOTIFICATION DEADLINE ALERT`,
    ``,
    `Alert Type  : ${alertType}`,
    `Case        : ${notif.case_title} (${notif.classification})`,
    `Recipient   : ${recipientLabel}`,
    `Deadline    : ${new Date(notif.required_by).toISOString()}`,
    `Time Left   : ~${hoursLeft} hours`,
    ``,
    `Action required: Log into Compliance Platform and mark this notification as sent,`,
    `or escalate immediately to your IR Lead.`,
  ].join('\n');

  // Get IR lead emails to notify
  const { rows: leads } = await query(
    `SELECT u.email FROM users u
     JOIN cases c ON c.id = $1
     WHERE u.role IN ('admin', 'ir_lead') AND u.is_active = TRUE AND u.deleted_at IS NULL`,
    [notif.case_id]
  );

  for (const lead of leads) {
    try {
      await sendEmail({ to: lead.email, subject, body });
      await query(
        `INSERT INTO notification_alerts (notification_id, alert_type, channel, sent_to)
         VALUES ($1, $2, 'email', $3)`,
        [notif.id, alertType, lead.email]
      );
    } catch (err) {
      logger.error({ err, to: lead.email, alertType }, 'Failed to send deadline alert email');
    }
  }

  // In-app alert entry (channel = 'in_app', sent_to = case_id for UI polling)
  await query(
    `INSERT INTO notification_alerts (notification_id, alert_type, channel, sent_to)
     VALUES ($1, $2, 'in_app', $3)`,
    [notif.id, alertType, notif.case_id]
  );

  logger.info({ notifId: notif.id, alertType, hoursLeft }, 'Deadline alert fired');
}

/**
 * Start the deadline engine. Runs every 15 minutes.
 * Called once from app.js on startup.
 */
function startDeadlineEngine() {
  logger.info('Deadline engine: starting (every 15 min)');
  cron.schedule('*/15 * * * *', runDeadlineCheck);
  // Also run immediately on startup to catch anything missed during downtime
  runDeadlineCheck();
}

module.exports = { startDeadlineEngine };
