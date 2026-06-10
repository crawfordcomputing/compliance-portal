'use strict';

const express = require('express');
const { v4: uuidv4 } = require('uuid');
const { query, queryWithAuditCtx } = require('../db');
const { authenticate, authorize } = require('../middleware/auth');
const auditContext = require('../middleware/auditContext');
const logger = require('../services/logger');

const router = express.Router();
router.use(authenticate, auditContext);

// Per-case PCI-DSS requirements — relevant to every incident response.
// 12.10.7 and 3.4 may be marked N/A when cardholder data is not in scope.
const PCI_REQUIREMENTS = {
  '12.10.1': 'IR plan confirmed current before/during response',
  '12.10.3': 'Designated IR personnel engaged and available 24/7',
  '12.10.5': 'Security monitoring alerts reviewed and documented',
  '12.10.6': 'IR plan updated based on lessons learned (N/A if no changes needed)',
  '12.10.7': 'PAN detection procedures followed (N/A if no CHD in scope)',
  '10.2.1':  'Audit logs collected and reviewed for this incident',
  '3.4':     'Confirmed PAN exposure status — encrypted or not in scope (N/A if no CHD)',
};

const VALID_STATUSES = ['open', 'contained', 'resolved', 'closed'];
const STATUS_TRANSITIONS = {
  open:      ['contained'],
  contained: ['open', 'resolved'],
  resolved:  ['contained', 'closed'],
  closed:    ['resolved'],
};

// POST /api/cases — create a new case
router.post('/', authorize('admin', 'ir_lead', 'ir_analyst'), async (req, res) => {
  try {
    const { title, classification, saq_type, cde_scope, assigned_to } = req.body;
    if (!title || !classification) {
      return res.status(400).json({ error: 'title and classification are required' });
    }
    const validClassifications = ['breach', 'suspected', 'near_miss', 'tabletop'];
    if (!validClassifications.includes(classification)) {
      return res.status(400).json({ error: `classification must be one of: ${validClassifications.join(', ')}` });
    }

    const id = uuidv4();
    const assignees = Array.isArray(assigned_to) ? assigned_to : [req.user.id];

    const result = await queryWithAuditCtx(req.auditCtx, async (client) => {
      const { rows } = await client.query(
        `INSERT INTO cases (id, title, classification, saq_type, cde_scope, created_by, assigned_to)
         VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING *`,
        [id, title, classification, saq_type || null, JSON.stringify(cde_scope || []), req.user.id, assignees]
      );
      await client.query(
        `INSERT INTO audit_log (user_id, user_email, client_ip, session_id, action, resource_type, resource_id, new_value)
         VALUES ($1, $2, $3, $4, 'case.created', 'case', $5, $6)`,
        [req.user.id, req.user.email, req.auditCtx.clientIp, req.auditCtx.sessionId,
         rows[0].id, JSON.stringify({ title, classification })]
      );
      return rows[0];
    });

    logger.info({ caseId: result.id, userId: req.user.id }, 'Case created');
    res.status(201).json(result);
  } catch (err) {
    logger.error({ err }, 'Create case error');
    res.status(500).json({ error: 'Internal server error' });
  }
});

// GET /api/cases — list all cases visible to the current user
router.get('/', async (req, res) => {
  try {
    const { status, classification } = req.query;
    let sql = `SELECT c.*, u.full_name AS created_by_name
               FROM cases c JOIN users u ON u.id = c.created_by
               WHERE c.deleted_at IS NULL`;
    const params = [];

    if (status) {
      params.push(status);
      sql += ` AND c.status = $${params.length}`;
    }
    if (classification) {
      params.push(classification);
      sql += ` AND c.classification = $${params.length}`;
    }
    sql += ' ORDER BY c.created_at DESC';

    const { rows } = await query(sql, params);

    // Attach countdown for cases with active deadlines
    const now = Date.now();
    const enriched = rows.map(c => ({
      ...c,
      deadline_remaining_ms: c.notification_deadline
        ? Math.max(0, new Date(c.notification_deadline).getTime() - now)
        : null,
    }));

    res.json(enriched);
  } catch (err) {
    logger.error({ err }, 'List cases error');
    res.status(500).json({ error: 'Internal server error' });
  }
});

// GET /api/cases/:id — case detail with deadline countdown
router.get('/:id', async (req, res) => {
  try {
    const { rows } = await query(
      `SELECT c.*, u.full_name AS created_by_name
       FROM cases c JOIN users u ON u.id = c.created_by
       WHERE c.id = $1 AND c.deleted_at IS NULL`,
      [req.params.id]
    );
    if (!rows[0]) return res.status(404).json({ error: 'Case not found' });

    const c = rows[0];
    const now = Date.now();
    res.json({
      ...c,
      deadline_remaining_ms: c.notification_deadline
        ? Math.max(0, new Date(c.notification_deadline).getTime() - now)
        : null,
    });
  } catch (err) {
    logger.error({ err }, 'Get case error');
    res.status(500).json({ error: 'Internal server error' });
  }
});

// PATCH /api/cases/:id/status — transition case status
router.patch('/:id/status', authorize('admin', 'ir_lead', 'ir_analyst'), async (req, res) => {
  try {
    const { status } = req.body;
    if (!VALID_STATUSES.includes(status)) {
      return res.status(400).json({ error: `status must be one of: ${VALID_STATUSES.join(', ')}` });
    }

    const { rows } = await query(
      'SELECT id, status FROM cases WHERE id = $1 AND deleted_at IS NULL',
      [req.params.id]
    );
    if (!rows[0]) return res.status(404).json({ error: 'Case not found' });

    const current = rows[0].status;
    if (!STATUS_TRANSITIONS[current].includes(status)) {
      return res.status(400).json({
        error: `Cannot transition from '${current}' to '${status}'. ` +
               `Allowed: ${STATUS_TRANSITIONS[current].join(', ') || 'none (terminal state)'}`,
      });
    }

    const updated = await queryWithAuditCtx(req.auditCtx, async (client) => {
      const resolvedAt = status === 'resolved' ? 'NOW()' : 'NULL';
      const { rows: r } = await client.query(
        `UPDATE cases SET status = $1, resolved_at = ${resolvedAt}, updated_at = NOW()
         WHERE id = $2 RETURNING *`,
        [status, req.params.id]
      );
      // Audit trigger handles audit_log insert for status changes (008_audit_triggers.sql)
      return r[0];
    });

    logger.info({ caseId: updated.id, from: current, to: status, userId: req.user.id }, 'Case status changed');
    res.json(updated);
  } catch (err) {
    logger.error({ err }, 'Status transition error');
    res.status(500).json({ error: 'Internal server error' });
  }
});

// GET /api/cases/:id/requirements — per-case requirement checklist
router.get('/:id/requirements', async (req, res) => {
  try {
    const { rows: checkins } = await query(
      `SELECT crc.*, u.full_name AS checked_by_name
       FROM case_requirement_checkins crc
       LEFT JOIN users u ON u.id = crc.checked_by
       WHERE crc.case_id = $1`,
      [req.params.id]
    );
    const checkinMap = Object.fromEntries(checkins.map(c => [c.requirement_ref, c]));

    const coverage = Object.entries(PCI_REQUIREMENTS).map(([ref, desc]) => {
      const checkin = checkinMap[ref];
      return {
        ref,
        description: desc,
        status: checkin?.status || 'pending',
        notes: checkin?.notes || null,
        checked_by: checkin?.checked_by_name || null,
        checked_at: checkin?.checked_at || null,
        allows_na: ['12.10.6', '12.10.7', '3.4'].includes(ref),
      };
    });

    const met = coverage.filter(c => c.status === 'met' || c.status === 'na').length;
    res.json({ coverage, met_count: met, total: coverage.length });
  } catch (err) {
    logger.error({ err }, 'Requirements coverage error');
    res.status(500).json({ error: 'Internal server error' });
  }
});

// PATCH /api/cases/:id/requirements/:ref — update a requirement check-in
router.patch('/:id/requirements/:ref', authorize('admin', 'ir_lead', 'ir_analyst'), async (req, res) => {
  try {
    const { status, notes } = req.body;
    const validStatuses = ['pending', 'met', 'not_met', 'na'];
    if (!validStatuses.includes(status)) {
      return res.status(400).json({ error: `status must be one of: ${validStatuses.join(', ')}` });
    }
    const ref = decodeURIComponent(req.params.ref);
    if (!PCI_REQUIREMENTS[ref]) {
      return res.status(400).json({ error: 'Unknown requirement ref' });
    }
    const { rows } = await query(
      `INSERT INTO case_requirement_checkins (id, case_id, requirement_ref, status, notes, checked_by, checked_at)
       VALUES (uuid_generate_v4(), $1, $2, $3, $4, $5, NOW())
       ON CONFLICT (case_id, requirement_ref) DO UPDATE
         SET status=$3, notes=$4, checked_by=$5, checked_at=NOW(), updated_at=NOW()
       RETURNING *`,
      [req.params.id, ref, status, notes || null, req.user.id]
    );
    res.json(rows[0]);
  } catch (err) {
    logger.error({ err }, 'Update requirement checkin error');
    res.status(500).json({ error: 'Internal server error' });
  }
});

// DELETE (soft) /api/cases/:id — admin only
router.delete('/:id', authorize('admin'), async (req, res) => {
  try {
    const { rows } = await query(
      'UPDATE cases SET deleted_at = NOW() WHERE id = $1 AND deleted_at IS NULL RETURNING id',
      [req.params.id]
    );
    if (!rows[0]) return res.status(404).json({ error: 'Case not found' });
    logger.info({ caseId: rows[0].id, userId: req.user.id }, 'Case soft-deleted');
    res.json({ message: 'Case deleted' });
  } catch (err) {
    logger.error({ err }, 'Delete case error');
    res.status(500).json({ error: 'Internal server error' });
  }
});

module.exports = router;
