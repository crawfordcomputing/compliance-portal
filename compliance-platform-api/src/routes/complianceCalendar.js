'use strict';

const express  = require('express');
const crypto   = require('crypto');
const multer   = require('multer');
const { v4: uuidv4 } = require('uuid');
const { query } = require('../db');
const { authenticate, authorize } = require('../middleware/auth');
const auditContext = require('../middleware/auditContext');
const { uploadFile } = require('../services/storage');
const { generateInstances } = require('../services/complianceScheduler');
const logger = require('../services/logger');

const router = express.Router();
router.use(authenticate, auditContext);

const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 100 * 1024 * 1024 } });

// GET /api/compliance-calendar/definitions — list all active check definitions
router.get('/definitions', async (req, res) => {
  try {
    const { rows } = await query(
      `SELECT * FROM compliance_check_definitions
       WHERE active = TRUE ORDER BY cadence, sort_order`
    );
    res.json(rows);
  } catch (err) {
    logger.error({ err }, 'List definitions error');
    res.status(500).json({ error: 'Internal server error' });
  }
});

// GET /api/compliance-calendar/current — bucketed view for "This Period" tab
router.get('/current', async (req, res) => {
  try {
    const BASE_SELECT = `
      SELECT ci.id, ci.definition_id, ci.period_label, ci.period_start, ci.period_end,
             ci.due_date, ci.status, ci.notes, ci.assigned_to, ci.completed_at,
             cd.name, cd.description, cd.pci_req_refs, cd.cadence,
             cd.required_evidence_labels, cd.sp_cadence_note, cd.conditional_on,
             u.full_name AS completed_by_name,
             COALESCE(
               json_agg(DISTINCT jsonb_build_object(
                 'id', ce.id, 'label', ce.label, 'filename', ce.filename,
                 'uploaded_at', ce.uploaded_at
               )) FILTER (WHERE ce.id IS NOT NULL), '[]'
             ) AS evidence
      FROM compliance_check_instances ci
      JOIN compliance_check_definitions cd ON cd.id = ci.definition_id
      LEFT JOIN users u ON u.id = ci.completed_by
      LEFT JOIN compliance_check_evidence ce ON ce.instance_id = ci.id
      WHERE cd.active = TRUE`;

    const [{ rows: overdue }, { rows: thisPeriod }, { rows: upcoming }] = await Promise.all([
      // Overdue: past their due_date and not closed (scheduler marks these 'overdue')
      query(`${BASE_SELECT}
        AND ci.status = 'overdue'
        GROUP BY ci.id, cd.id, u.full_name
        ORDER BY ci.due_date ASC`, []),

      // This period: period is currently active (start <= today <= end), excluding overdue
      query(`${BASE_SELECT}
        AND ci.period_start <= CURRENT_DATE AND ci.period_end >= CURRENT_DATE
        AND ci.status != 'overdue'
        GROUP BY ci.id, cd.id, u.full_name
        ORDER BY ci.due_date ASC, cd.sort_order`, []),

      // Upcoming: next period starting within 30 days
      query(`${BASE_SELECT}
        AND ci.period_start > CURRENT_DATE
        AND ci.period_start <= CURRENT_DATE + INTERVAL '30 days'
        GROUP BY ci.id, cd.id, u.full_name
        ORDER BY ci.period_start ASC`, []),
    ]);

    // Progress denominator: this-period instances excluding na/waived
    const denominator = thisPeriod.filter(i => !['na', 'waived'].includes(i.status)).length;
    const complete    = thisPeriod.filter(i => i.status === 'complete').length;
    const pct         = denominator ? Math.round((complete / denominator) * 100) : 0;

    res.json({
      overdue,
      this_period: thisPeriod,
      upcoming,
      progress: { complete, total: denominator, pct },
    });
  } catch (err) {
    logger.error({ err }, 'Current compliance GET error');
    res.status(500).json({ error: 'Internal server error' });
  }
});

// GET /api/compliance-calendar/instances — list instances with optional filters
router.get('/instances', async (req, res) => {
  try {
    const { cadence, status, year } = req.query;
    let sql = `
      SELECT ci.*, cd.name, cd.description, cd.pci_req_refs, cd.required_evidence_labels,
             cd.cadence, cd.conditional_on, cd.sp_cadence_note,
             u.full_name AS completed_by_name,
             COALESCE(
               json_agg(DISTINCT jsonb_build_object(
                 'id', ce.id, 'label', ce.label, 'filename', ce.filename,
                 'uploaded_at', ce.uploaded_at
               )) FILTER (WHERE ce.id IS NOT NULL), '[]'
             ) AS evidence,
             COALESCE(
               json_agg(DISTINCT jsonb_build_object(
                 'id', cs.id, 'role', cs.role, 'signed_at', cs.signed_at,
                 'notes', cs.notes, 'signed_by', cs.signed_by
               )) FILTER (WHERE cs.id IS NOT NULL), '[]'
             ) AS signoffs
      FROM compliance_check_instances ci
      JOIN compliance_check_definitions cd ON cd.id = ci.definition_id
      LEFT JOIN users u ON u.id = ci.completed_by
      LEFT JOIN compliance_check_evidence ce ON ce.instance_id = ci.id
      LEFT JOIN compliance_check_signoffs cs ON cs.instance_id = ci.id
      WHERE cd.active = TRUE`;

    const params = [];
    if (cadence) { params.push(cadence); sql += ` AND cd.cadence = $${params.length}`; }
    if (status)  { params.push(status);  sql += ` AND ci.status = $${params.length}`; }
    if (year)    { params.push(`${year}-%`); sql += ` AND ci.period_label LIKE $${params.length}`; }

    sql += ' GROUP BY ci.id, cd.id, u.full_name ORDER BY ci.due_date ASC, cd.sort_order';

    const { rows } = await query(sql, params);
    res.json(rows);
  } catch (err) {
    logger.error({ err }, 'List instances error');
    res.status(500).json({ error: 'Internal server error' });
  }
});

// GET /api/compliance-calendar/instances/:id
router.get('/instances/:id', async (req, res) => {
  try {
    const { rows: inst } = await query(
      `SELECT ci.*, cd.name, cd.description, cd.instructions, cd.pci_req_refs,
              cd.required_evidence_labels, cd.cadence, cd.sp_cadence_note,
              u.full_name AS completed_by_name
       FROM compliance_check_instances ci
       JOIN compliance_check_definitions cd ON cd.id = ci.definition_id
       LEFT JOIN users u ON u.id = ci.completed_by
       WHERE ci.id = $1`, [req.params.id]
    );
    if (!inst[0]) return res.status(404).json({ error: 'Instance not found' });

    const [{ rows: evidence }, { rows: signoffs }] = await Promise.all([
      query(`SELECT ce.*, u.full_name AS uploaded_by_name FROM compliance_check_evidence ce
             JOIN users u ON u.id = ce.uploaded_by WHERE ce.instance_id = $1
             ORDER BY ce.uploaded_at ASC`, [req.params.id]),
      query(`SELECT cs.*, u.full_name AS signed_by_name FROM compliance_check_signoffs cs
             JOIN users u ON u.id = cs.signed_by WHERE cs.instance_id = $1
             ORDER BY cs.signed_at ASC`, [req.params.id]),
    ]);

    res.json({ ...inst[0], evidence, signoffs });
  } catch (err) {
    logger.error({ err }, 'Get instance error');
    res.status(500).json({ error: 'Internal server error' });
  }
});

// PATCH /api/compliance-calendar/instances/:id — update status/notes/assignment
router.patch('/instances/:id', authorize('admin', 'ir_lead', 'ir_analyst'), async (req, res) => {
  try {
    const { status, notes, na_reason, assigned_to } = req.body;
    const valid = ['pending', 'in_progress', 'complete', 'overdue', 'na', 'waived'];
    if (status && !valid.includes(status)) {
      return res.status(400).json({ error: `status must be one of: ${valid.join(', ')}` });
    }

    const completedAt = status === 'complete' ? 'NOW()' : 'NULL';
    const completedBy = status === 'complete' ? req.user.id : null;

    const { rows } = await query(
      `UPDATE compliance_check_instances
       SET status       = COALESCE($1, status),
           notes        = COALESCE($2, notes),
           na_reason    = COALESCE($3, na_reason),
           assigned_to  = COALESCE($4, assigned_to),
           completed_at = CASE WHEN $1 = 'complete' THEN NOW() ELSE completed_at END,
           completed_by = CASE WHEN $1 = 'complete' THEN $5 ELSE completed_by END,
           updated_at   = NOW()
       WHERE id = $6 RETURNING *`,
      [status || null, notes || null, na_reason || null,
       assigned_to || null, completedBy, req.params.id]
    );
    if (!rows[0]) return res.status(404).json({ error: 'Instance not found' });
    res.json(rows[0]);
  } catch (err) {
    logger.error({ err }, 'Update instance error');
    res.status(500).json({ error: 'Internal server error' });
  }
});

// POST /api/compliance-calendar/instances/:id/evidence — upload evidence file
router.post('/instances/:id/evidence', authorize('admin', 'ir_lead', 'ir_analyst'),
  upload.single('file'), async (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ error: 'file is required' });
    const label = req.body.label || req.file.originalname;

    const sha256Hash = crypto.createHash('sha256').update(req.file.buffer).digest('hex');
    const { blobUrl } = await uploadFile({
      buffer: req.file.buffer, filename: req.file.originalname,
      mimeType: req.file.mimetype, caseId: `compliance-${req.params.id}`,
    });

    const { rows } = await query(
      `INSERT INTO compliance_check_evidence
         (id, instance_id, label, filename, blob_url, sha256_hash, file_size, mime_type, uploaded_by)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING *`,
      [uuidv4(), req.params.id, label, req.file.originalname,
       blobUrl, sha256Hash, req.file.size, req.file.mimetype, req.user.id]
    );

    // Auto-progress to in_progress if still pending
    await query(
      `UPDATE compliance_check_instances SET status='in_progress', updated_at=NOW()
       WHERE id=$1 AND status='pending'`,
      [req.params.id]
    );

    res.status(201).json(rows[0]);
  } catch (err) {
    logger.error({ err }, 'Upload compliance evidence error');
    res.status(500).json({ error: 'Internal server error' });
  }
});

// POST /api/compliance-calendar/instances/:id/signoff — sign off on an instance
router.post('/instances/:id/signoff', authorize('admin', 'ir_lead'), async (req, res) => {
  try {
    const { role, notes } = req.body;

    // Enforce required evidence labels before allowing approval
    if (!role || role === 'approver') {
      const { rows: defRows } = await query(
        `SELECT cd.required_evidence_labels
         FROM compliance_check_instances ci
         JOIN compliance_check_definitions cd ON cd.id = ci.definition_id
         WHERE ci.id = $1`, [req.params.id]
      );
      const required = defRows[0]?.required_evidence_labels || [];
      if (required.length > 0) {
        const { rows: evRows } = await query(
          `SELECT DISTINCT label FROM compliance_check_evidence WHERE instance_id = $1`, [req.params.id]
        );
        const uploaded = new Set(evRows.map(r => r.label));
        const missing  = required.filter(l => !uploaded.has(l));
        if (missing.length > 0) {
          return res.status(422).json({
            error: 'Missing required evidence',
            missing_labels: missing,
          });
        }
      }
    }

    const { rows } = await query(
      `INSERT INTO compliance_check_signoffs (id, instance_id, signed_by, role, notes)
       VALUES ($1,$2,$3,$4,$5) RETURNING *`,
      [uuidv4(), req.params.id, req.user.id, role || 'approver', notes || null]
    );

    // Mark complete on second sign-off (or on first if role=approver)
    if (!role || role === 'approver') {
      await query(
        `UPDATE compliance_check_instances
         SET status='complete', completed_by=$1, completed_at=NOW(), updated_at=NOW()
         WHERE id=$2 AND status != 'complete'`,
        [req.user.id, req.params.id]
      );
    }

    res.status(201).json(rows[0]);
  } catch (err) {
    logger.error({ err }, 'Sign-off error');
    res.status(500).json({ error: 'Internal server error' });
  }
});

// POST /api/compliance-calendar/instances — manually create event-triggered instance
router.post('/instances', authorize('admin', 'ir_lead'), async (req, res) => {
  try {
    const { definition_id, period_label, due_date, notes } = req.body;
    if (!definition_id || !period_label || !due_date) {
      return res.status(400).json({ error: 'definition_id, period_label, and due_date are required' });
    }
    const { rows } = await query(
      `INSERT INTO compliance_check_instances
         (id, definition_id, period_label, period_start, period_end, due_date, notes)
       VALUES ($1,$2,$3,$4,$5,$6,$7)
       ON CONFLICT (definition_id, period_label) DO NOTHING RETURNING *`,
      [uuidv4(), definition_id, period_label, due_date, due_date, due_date, notes || null]
    );
    if (!rows[0]) return res.status(409).json({ error: 'Instance for this period already exists' });
    res.status(201).json(rows[0]);
  } catch (err) {
    logger.error({ err }, 'Create manual instance error');
    res.status(500).json({ error: 'Internal server error' });
  }
});

// POST /api/compliance-calendar/refresh — manually trigger instance generation
router.post('/refresh', authorize('admin', 'ir_lead'), async (req, res) => {
  try {
    await generateInstances();
    res.json({ message: 'Compliance instances refreshed' });
  } catch (err) {
    logger.error({ err }, 'Refresh error');
    res.status(500).json({ error: 'Internal server error' });
  }
});

module.exports = router;
