'use strict';

const express = require('express');
const crypto = require('crypto');
const multer = require('multer');
const { v4: uuidv4 } = require('uuid');
const { query, queryWithAuditCtx } = require('../db');
const { authenticate, authorize } = require('../middleware/auth');
const auditContext = require('../middleware/auditContext');
const { uploadFile } = require('../services/storage');
const logger = require('../services/logger');

const router = express.Router({ mergeParams: true });
router.use(authenticate, auditContext);

// Store in memory for hashing before upload (max 100MB per file)
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 100 * 1024 * 1024 },
});

// POST /api/cases/:id/evidence — upload evidence file
router.post('/', authorize('admin', 'ir_lead', 'ir_analyst'),
  upload.single('file'), async (req, res) => {
  try {
    const caseId = req.params.id;
    if (!req.file) return res.status(400).json({ error: 'file is required (multipart field: file)' });

    // Verify case exists
    const { rows: caseRows } = await query(
      'SELECT id, status FROM cases WHERE id = $1 AND deleted_at IS NULL', [caseId]
    );
    if (!caseRows[0]) return res.status(404).json({ error: 'Case not found' });

    // SHA-256 computed server-side before storage
    const sha256Hash = crypto.createHash('sha256').update(req.file.buffer).digest('hex');

    const { blobUrl } = await uploadFile({
      buffer:   req.file.buffer,
      filename: req.file.originalname,
      mimeType: req.file.mimetype,
      caseId,
    });

    const actionId = req.body.action_id || null;

    const record = await queryWithAuditCtx(req.auditCtx, async (client) => {
      const { rows } = await client.query(
        `INSERT INTO evidence (id, case_id, action_id, filename, blob_url, sha256_hash, file_size, mime_type, uploaded_by)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9) RETURNING *`,
        [uuidv4(), caseId, actionId, req.file.originalname,
         blobUrl, sha256Hash, req.file.size, req.file.mimetype, req.user.id]
      );
      // Audit trigger in 008_audit_triggers.sql fires automatically on evidence INSERT
      return rows[0];
    });

    logger.info({ evidenceId: record.id, caseId, sha256: sha256Hash }, 'Evidence uploaded');
    res.status(201).json(record);
  } catch (err) {
    logger.error({ err }, 'Evidence upload error');
    res.status(500).json({ error: 'Internal server error' });
  }
});

// GET /api/cases/:id/evidence — chain of custody report
router.get('/', async (req, res) => {
  try {
    const { rows } = await query(
      `SELECT e.*, u.full_name AS uploaded_by_name, u.email AS uploaded_by_email
       FROM evidence e JOIN users u ON u.id = e.uploaded_by
       WHERE e.case_id = $1
       ORDER BY e.uploaded_at ASC`,
      [req.params.id]
    );
    res.json({
      case_id: req.params.id,
      total_files: rows.length,
      chain_of_custody: rows,
    });
  } catch (err) {
    logger.error({ err }, 'List evidence error');
    res.status(500).json({ error: 'Internal server error' });
  }
});

module.exports = router;
