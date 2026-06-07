'use strict';

const archiver = require('archiver');
const fs       = require('fs');
const path     = require('path');
const { Readable } = require('stream');

/**
 * Build the QSA export ZIP in memory and return a Buffer.
 *
 * Contents:
 *   incident_report.pdf
 *   audit_trail.pdf
 *   evidence/<original filenames>   (local-stored files only; blob URLs are listed in manifest)
 *   manifest.json
 */
async function buildExportZip({ incidentPdf, auditPdf, evidenceFiles, manifest }) {
  return new Promise((resolve, reject) => {
    const archive = archiver('zip', { zlib: { level: 6 } });
    const chunks  = [];

    archive.on('data',  chunk => chunks.push(chunk));
    archive.on('end',   () => resolve(Buffer.concat(chunks)));
    archive.on('error', reject);
    archive.on('warning', err => {
      if (err.code !== 'ENOENT') reject(err);
    });

    // PDFs
    archive.append(Buffer.from(incidentPdf), { name: 'incident_report.pdf' });
    archive.append(Buffer.from(auditPdf),    { name: 'audit_trail.pdf' });

    // Evidence files (local dev — blob URLs are logged but files served from disk)
    const LOCAL_DIR = path.join(process.cwd(), 'local-evidence');
    for (const ev of evidenceFiles) {
      if (ev.blob_url?.startsWith('local://')) {
        const blobName = ev.blob_url.replace('local://', '');
        const filePath = path.join(LOCAL_DIR, blobName);
        if (fs.existsSync(filePath)) {
          archive.file(filePath, { name: `evidence/${ev.filename}` });
        }
      }
      // Azure blob files: listed in manifest.json but not bundled (use SAS URL)
    }

    // manifest.json
    archive.append(JSON.stringify(manifest, null, 2), { name: 'manifest.json' });

    archive.finalize();
  });
}

module.exports = { buildExportZip };
