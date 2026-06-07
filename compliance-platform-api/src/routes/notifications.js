'use strict';

const express = require('express');
const { v4: uuidv4 } = require('uuid');
const { query, queryWithAuditCtx } = require('../db');
const { authenticate, authorize } = require('../middleware/auth');
const auditContext = require('../middleware/auditContext');
const logger = require('../services/logger');

const router = express.Router({ mergeParams: true });
router.use(authenticate, authorize('admin', 'ir_lead'), auditContext);

const VALID_RECIPIENTS = ['visa', 'mastercard', 'acquiring_bank', 'custom'];

// POST /api/cases/:id/notifications — create a notification record
router.post('/', async (req, res) => {
  try {
    const caseId = req.params.id;
    const { recipient, custom_name, notes } = req.body;

    if (!VALID_RECIPIENTS.includes(recipient)) {
      return res.status(400).json({ error: `recipient must be one of: ${VALID_RECIPIENTS.join(', ')}` });
    }
    if (recipient === 'custom' && !custom_name) {
      return res.status(400).json({ error: 'custom_name is required when recipient is custom' });
    }

    const { rows: caseRows } = await query(
      'SELECT id, notification_deadline FROM cases WHERE id = $1 AND deleted_at IS NULL',
      [caseId]
    );
    if (!caseRows[0]) return res.status(404).json({ error: 'Case not found' });
    if (!caseRows[0].notification_deadline) {
      return res.status(400).json({ error: 'Case has no notification deadline (only breach/suspected cases require notifications)' });
    }

    const { rows } = await query(
      `INSERT INTO notifications (id, case_id, recipient, custom_name, required_by, notes)
       VALUES ($1, $2, $3, $4, $5, $6) RETURNING *`,
      [uuidv4(), caseId, recipient, custom_name || null,
       caseRows[0].notification_deadline, notes || null]
    );
    res.status(201).json(rows[0]);
  } catch (err) {
    logger.error({ err }, 'Create notification error');
    res.status(500).json({ error: 'Internal server error' });
  }
});

// GET /api/cases/:id/notifications — list all notifications + alert history
router.get('/', async (req, res) => {
  try {
    const { rows } = await query(
      `SELECT n.*,
              u.full_name AS sent_by_name,
              COALESCE(
                json_agg(na ORDER BY na.sent_at) FILTER (WHERE na.id IS NOT NULL), '[]'
              ) AS alerts
       FROM notifications n
       LEFT JOIN users u ON u.id = n.sent_by
       LEFT JOIN notification_alerts na ON na.notification_id = n.id
       WHERE n.case_id = $1
       GROUP BY n.id, u.full_name
       ORDER BY n.created_at ASC`,
      [req.params.id]
    );
    res.json(rows);
  } catch (err) {
    logger.error({ err }, 'List notifications error');
    res.status(500).json({ error: 'Internal server error' });
  }
});

// PATCH /api/cases/:id/notifications/:nid/sent — mark a notification as sent
router.patch('/:nid/sent', async (req, res) => {
  try {
    const { rows } = await queryWithAuditCtx(req.auditCtx, async (client) => {
      const { rows: r } = await client.query(
        `UPDATE notifications
         SET status = 'sent', sent_at = NOW(), sent_by = $1, notes = COALESCE($2, notes)
         WHERE id = $3 AND case_id = $4 AND status = 'pending'
         RETURNING *`,
        [req.user.id, req.body.notes || null, req.params.nid, req.params.id]
      );
      if (r[0]) {
        await client.query(
          `INSERT INTO audit_log (user_id, user_email, client_ip, session_id, action, resource_type, resource_id, new_value)
           VALUES ($1, $2, $3, $4, 'notification.sent', 'notification', $5, $6)`,
          [req.user.id, req.user.email, req.auditCtx.clientIp, req.auditCtx.sessionId,
           r[0].id, JSON.stringify({ recipient: r[0].recipient, sent_at: r[0].sent_at })]
        );
      }
      return r;
    });
    if (!rows[0]) return res.status(404).json({ error: 'Notification not found or already sent' });
    res.json(rows[0]);
  } catch (err) {
    logger.error({ err }, 'Mark notification sent error');
    res.status(500).json({ error: 'Internal server error' });
  }
});

module.exports = router;
