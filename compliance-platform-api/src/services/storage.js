'use strict';

/**
 * Storage service — Azure Blob Storage in production, local disk in dev.
 * Set AZURE_STORAGE_CONNECTION_STRING in .env to switch to Azure.
 */

const fs = require('fs');
const path = require('path');
const logger = require('./logger');

const LOCAL_STORAGE_DIR = path.join(process.cwd(), 'local-evidence');

function ensureLocalDir() {
  if (!fs.existsSync(LOCAL_STORAGE_DIR)) {
    fs.mkdirSync(LOCAL_STORAGE_DIR, { recursive: true });
  }
}

async function uploadFile({ buffer, filename, mimeType, caseId }) {
  if (process.env.AZURE_STORAGE_CONNECTION_STRING) {
    return uploadToAzure({ buffer, filename, mimeType, caseId });
  }
  return uploadToLocal({ buffer, filename, caseId });
}

async function uploadToLocal({ buffer, filename, caseId }) {
  ensureLocalDir();
  const safeName = `${caseId}_${Date.now()}_${path.basename(filename)}`;
  const dest = path.join(LOCAL_STORAGE_DIR, safeName);
  fs.writeFileSync(dest, buffer);
  logger.info({ dest }, 'Evidence stored locally');
  return { blobUrl: `local://${safeName}`, blobName: safeName };
}

async function uploadToAzure({ buffer, filename, mimeType, caseId }) {
  const { BlobServiceClient } = require('@azure/storage-blob');
  const client = BlobServiceClient.fromConnectionString(process.env.AZURE_STORAGE_CONNECTION_STRING);
  const container = client.getContainerClient(process.env.AZURE_BLOB_CONTAINER || 'evidence');
  await container.createIfNotExists({ access: 'private' });

  const blobName = `${caseId}/${Date.now()}_${path.basename(filename)}`;
  const blockBlob = container.getBlockBlobClient(blobName);
  await blockBlob.upload(buffer, buffer.length, {
    blobHTTPHeaders: { blobContentType: mimeType || 'application/octet-stream' },
  });

  logger.info({ blobName }, 'Evidence uploaded to Azure Blob');
  return { blobUrl: blockBlob.url, blobName };
}

module.exports = { uploadFile };
