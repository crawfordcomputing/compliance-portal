'use strict';

const express = require('express');
const { v4: uuidv4 } = require('uuid');
const { query, queryWithAuditCtx } = require('../db');
const { authenticate, authorize } = require('../middleware/auth');
const auditContext = require('../middleware/auditContext');
const logger = require('../services/logger');

const router = express.Router({ mergeParams: true }); // inherits :id from parent
router.use(authenticate, auditContext);

// POST /api/cases/:id/actions — append a new action (immutable)
router.post('/', authorize('admin', 'ir_lead', 'ir_analyst'), async (req, res) => {
  try {
    const caseId = req.params.id;
    const { description, requirement_refs } = req.body;

    if (!description?.trim()) {
      return res.status(400).json({ error: 'description is required' });
    }

    // Verify case exists and is not closed
    const { rows: caseRows } = await query(
      'SELECT id, status FROM cases WHERE id = $1 AND deleted_at IS NULL',
      [caseId]
    );
    if (!caseRows[0]) return res.status(404).json({ error: 'Case not found' });
    if (caseRows[0].status === 'closed') {
      return res.status(400).json({ error: 'Cannot add actions to a closed case' });
    }

    const refs = Array.isArray(requirement_refs) ? requirement_refs : [];

    const action = await queryWithAuditCtx(req.auditCtx, async (client) => {
      const { rows } = await client.query(
        `INSERT INTO actions (id, case_id, description, actor_id, requirement_refs)
         VALUES ($1, $2, $3, $4, $5) RETURNING *`,
        [uuidv4(), caseId, description.trim(), req.user.id, refs]
      );
      await client.query(
        `INSERT INTO audit_log (user_id, user_email, client_ip, session_id, action, resource_type, resource_id, new_value)
         VALUES ($1, $2, $3, $4, 'action.created', 'action', $5, $6)`,
        [req.user.id, req.user.email, req.auditCtx.clientIp, req.auditCtx.sessionId,
         rows[0].id, JSON.stringify({ case_id: caseId, requirement_refs: refs })]
      );
      return rows[0];
    });

    logger.info({ actionId: action.id, caseId, userId: req.user.id }, 'Action logged');
    res.status(201).json(action);
  } catch (err) {
    logger.error({ err }, 'Create action error');
    res.status(500).json({ error: 'Internal server error' });
  }
});

// GET /api/cases/:id/actions — list all actions for a case (chronological)
router.get('/', async (req, res) => {
  try {
    const { rows } = await query(
      `SELECT a.*, u.full_name AS actor_name, u.email AS actor_email
       FROM actions a JOIN users u ON u.id = a.actor_id
       WHERE a.case_id = $1
       ORDER BY a.created_at ASC`,
      [req.params.id]
    );
    res.json(rows);
  } catch (err) {
    logger.error({ err }, 'List actions error');
    res.status(500).json({ error: 'Internal server error' });
  }
});

module.exports = router;
