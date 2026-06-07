'use strict';

const express  = require('express');
const fs       = require('fs');
const path     = require('path');
const crypto   = require('crypto');
const { v4: uuidv4 } = require('uuid');
const { query, queryWithAuditCtx } = require('../db');
const { authenticate, authorize }  = require('../middleware/auth');
const auditContext = require('../middleware/auditContext');
const { generateIncidentReport, generateAuditTrail } = require('../exports/pdfGenerator');
const { buildExportZip } = require('../exports/zipBuilder');
const logger = require('../services/logger');

const router = express.Router({ mergeParams: true });

const LOCAL_EXPORT_DIR = path.join(process.cwd(), 'local-exports');

// Per-case PCI-DSS requirements (mirrors cases.js)
const PCI_REQS = {
  '12.10.1': 'IR plan confirmed current before/during response',
  '12.10.3': 'Designated IR personnel engaged and available 24/7',
  '12.10.5': 'Security monitoring alerts reviewed and documented',
  '12.10.6': 'IR plan updated based on lessons learned (N/A if no changes needed)',
  '12.10.7': 'PAN detection procedures followed (N/A if no CHD in scope)',
  '10.2.1':  'Audit logs collected and reviewed for this incident',
  '3.4':     'Confirmed PAN exposure status — encrypted or not in scope (N/A if no CHD)',
};

function ensureExportDir() {
  if (!fs.existsSync(LOCAL_EXPORT_DIR)) fs.mkdirSync(LOCAL_EXPORT_DIR, { recursive: true });
}
function sha256Buffer(buf) {
  return crypto.createHash('sha256').update(buf).digest('hex');
}
function storeLocally(buffer, exportId, caseId) {
  ensureExportDir();
  fs.writeFileSync(path.join(LOCAL_EXPORT_DIR, `${exportId}_${caseId}.zip`), buffer);
  return `/api/cases/${caseId}/export/${exportId}/download`;
}
async function storeToAzure(buffer, exportId, caseId) {
  const { BlobServiceClient, generateBlobSASQueryParameters, BlobSASPermissions } = require('@azure/storage-blob');
  const client    = BlobServiceClient.fromConnectionString(process.env.AZURE_STORAGE_CONNECTION_STRING);
  const container = client.getContainerClient('exports');
  await container.createIfNotExists({ access: 'private' });
  const blobName  = `${caseId}/${exportId}.zip`;
  const blob      = container.getBlockBlobClient(blobName);
  await blob.upload(buffer, buffer.length, { blobHTTPHeaders: { blobContentType: 'application/zip' } });
  const expiry = new Date(Date.now() + 24 * 60 * 60 * 1000);
  const sas = generateBlobSASQueryParameters(
    { containerName: 'exports', blobName, permissions: BlobSASPermissions.parse('r'), expiresOn: expiry },
    blob.credential
  ).toString();
  return `${blob.url}?${sas}`;
}

// POST /api/cases/:id/export — authenticated, generates the QSA package
router.post('/', authenticate, authorize('admin', 'ir_lead'), auditContext, async (req, res) => {
  const caseId = req.params.id;
  try {
    const [
      { rows: caseRows },
      { rows: actions },
      { rows: evidenceRows },
      { rows: notifications },
      { rows: auditEntries },
      { rows: checkins },
    ] = await Promise.all([
      query(`SELECT c.*, u.full_name AS created_by_name FROM cases c
             JOIN users u ON u.id = c.created_by WHERE c.id = $1 AND c.deleted_at IS NULL`, [caseId]),
      query(`SELECT a.*, u.full_name AS actor_name FROM actions a
             JOIN users u ON u.id = a.actor_id WHERE a.case_id = $1 ORDER BY a.created_at ASC`, [caseId]),
      query(`SELECT e.*, u.full_name AS uploaded_by_name FROM evidence e
             JOIN users u ON u.id = e.uploaded_by WHERE e.case_id = $1 ORDER BY e.uploaded_at ASC`, [caseId]),
      query(`SELECT * FROM notifications WHERE case_id = $1 ORDER BY created_at ASC`, [caseId]),
      query(`SELECT * FROM audit_log WHERE resource_id = $1 ORDER BY event_time ASC`, [caseId]),
      query(`SELECT requirement_ref, status, notes FROM case_requirement_checkins WHERE case_id = $1`, [caseId]),
    ]);

    if (!caseRows[0]) return res.status(404).json({ error: 'Case not found' });
    const caseData = caseRows[0];

    const checkinMap = Object.fromEntries(checkins.map(c => [c.requirement_ref, c]));
    const coverageItems = Object.entries(PCI_REQS).map(([ref, description]) => {
      const c = checkinMap[ref];
      return { ref, description, status: c?.status || 'pending', notes: c?.notes || null };
    });
    const metCount = coverageItems.filter(c => c.status === 'met' || c.status === 'na').length;
    const coverage = { coverage: coverageItems, met_count: metCount, total: coverageItems.length };

    const exportedBy = req.user.email;
    const exportId   = uuidv4();

    const [incidentPdf, auditPdf] = await Promise.all([
      generateIncidentReport({ caseData, actions, evidence: evidenceRows, notifications, coverage, exportedBy }),
      generateAuditTrail({ caseData, auditEntries, exportedBy }),
    ]);

    const manifest = {
      export_id:   exportId,
      exported_at: new Date().toISOString(),
      exported_by: exportedBy,
      case_id:     caseId,
      case_status: caseData.status,
      case_title:  caseData.title,
      files: [
        { name: 'incident_report.pdf', sha256: sha256Buffer(incidentPdf) },
        { name: 'audit_trail.pdf',     sha256: sha256Buffer(auditPdf) },
        ...evidenceRows.map(ev => ({
          name: `evidence/${ev.filename}`, sha256: ev.sha256_hash,
          blob_url: ev.blob_url, uploaded_by: ev.uploaded_by_name, uploaded_at: ev.uploaded_at,
        })),
      ],
    };

    const zipBuffer = await buildExportZip({ incidentPdf, auditPdf, evidenceFiles: evidenceRows, manifest });

    const downloadUrl = process.env.AZURE_STORAGE_CONNECTION_STRING
      ? await storeToAzure(zipBuffer, exportId, caseId)
      : storeLocally(zipBuffer, exportId, caseId);

    await queryWithAuditCtx(req.auditCtx, async (client) => {
      await client.query(
        `INSERT INTO audit_log (user_id, user_email, client_ip, session_id, action, resource_type, resource_id, new_value)
         VALUES ($1,$2,$3,$4,'export.generated','case',$5,$6)`,
        [req.user.id, req.user.email, req.auditCtx.clientIp, req.auditCtx.sessionId,
         caseId, JSON.stringify({ export_id: exportId, file_count: manifest.files.length })]
      );
    });

    logger.info({ caseId, exportId, userId: req.user.id }, 'QSA export generated');
    res.json({ export_id: exportId, download_url: downloadUrl, expires_in: '24h', manifest });
  } catch (err) {
    logger.error({ err, caseId }, 'Export generation error');
    res.status(500).json({ error: 'Export failed: ' + err.message });
  }
});

// GET /api/cases/:id/export/:exportId/download — public, UUID is the access token
function downloadHandler(req, res) {
  const { id, exportId } = req.params;
  const filePath = path.join(LOCAL_EXPORT_DIR, `${exportId}_${id}.zip`);
  if (!fs.existsSync(filePath)) return res.status(404).json({ error: 'Export not found or expired' });
  res.setHeader('Content-Type', 'application/zip');
  res.setHeader('Content-Disposition', `attachment; filename="qsa-export-${id}.zip"`);
  fs.createReadStream(filePath).pipe(res);
}

router.get('/:exportId/download', downloadHandler);

module.exports = { router, downloadHandler };
