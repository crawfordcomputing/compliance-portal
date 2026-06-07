'use strict';

const { PDFDocument, rgb, StandardFonts } = require('pdf-lib');

const BRAND_BLUE = rgb(0.11, 0.30, 0.55);
const BLACK      = rgb(0, 0, 0);
const GRAY       = rgb(0.4, 0.4, 0.4);
const RED        = rgb(0.75, 0.1, 0.1);
const GREEN      = rgb(0.1, 0.5, 0.2);
const WHITE      = rgb(1, 1, 1);

const PAGE_W = 612;
const PAGE_H = 792;
const MARGIN  = 54;
const COL_W   = PAGE_W - MARGIN * 2;

class PDFWriter {
  constructor(doc, page, fonts) {
    this.doc   = doc;
    this.page  = page;
    this.fonts = fonts;
    this.y     = PAGE_H - MARGIN;
    this.pages = [page];
  }

  newPage() {
    const p = this.doc.addPage([PAGE_W, PAGE_H]);
    this.pages.push(p);
    this.page = p;
    this.y = PAGE_H - MARGIN;
    return p;
  }

  ensureSpace(needed = 20) {
    if (this.y - needed < MARGIN + 40) this.newPage();
  }

  drawText(text, { x = MARGIN, size = 10, font, color = BLACK, maxWidth } = {}) {
    const f = font || this.fonts.regular;
    const safeText = String(text || '')
      .replace(/[\x00-\x08\x0B\x0C\x0E-\x1F]/g, '')  // control chars
      .replace(/[^\x00-\xFF]/g, '?');                  // anything outside WinAnsi range
    if (maxWidth) {
      const words = safeText.split(' ');
      let line = '';
      for (const word of words) {
        const test = line ? `${line} ${word}` : word;
        const w = f.widthOfTextAtSize(test, size);
        if (w > maxWidth && line) {
          this.ensureSpace(size + 4);
          this.page.drawText(line, { x, y: this.y, size, font: f, color });
          this.y -= size + 3;
          line = word;
        } else {
          line = test;
        }
      }
      if (line) {
        this.ensureSpace(size + 4);
        this.page.drawText(line, { x, y: this.y, size, font: f, color });
        this.y -= size + 3;
      }
    } else {
      this.ensureSpace(size + 4);
      this.page.drawText(safeText, { x, y: this.y, size, font: f, color });
      this.y -= size + 4;
    }
  }

  heading(text, level = 1) {
    this.y -= level === 1 ? 14 : 8;
    const size  = level === 1 ? 16 : level === 2 ? 13 : 11;
    const color = level === 1 ? BRAND_BLUE : BLACK;
    const font  = this.fonts.bold;
    this.ensureSpace(size + 8);
    if (level === 1) {
      this.page.drawRectangle({ x: MARGIN, y: this.y - 4, width: COL_W, height: size + 8, color: BRAND_BLUE });
      this.page.drawText(text, { x: MARGIN + 6, y: this.y, size, font, color: WHITE });
    } else {
      this.page.drawText(text, { x: MARGIN, y: this.y, size, font, color });
    }
    this.y -= size + 10;
  }

  divider() {
    this.y -= 4;
    this.page.drawLine({ start: { x: MARGIN, y: this.y }, end: { x: PAGE_W - MARGIN, y: this.y }, thickness: 0.5, color: GRAY });
    this.y -= 6;
  }

  kv(label, value, { valueColor } = {}) {
    this.ensureSpace(14);
    this.page.drawText(`${label}:`, { x: MARGIN, y: this.y, size: 9, font: this.fonts.bold, color: GRAY });
    this.page.drawText(String(value || '—'), { x: MARGIN + 130, y: this.y, size: 9, font: this.fonts.regular, color: valueColor || BLACK });
    this.y -= 14;
  }

  gap(n = 10) { this.y -= n; }
}

async function makeWriter(doc) {
  const [bold, regular] = await Promise.all([
    doc.embedFont(StandardFonts.HelveticaBold),
    doc.embedFont(StandardFonts.Helvetica),
  ]);
  const page = doc.addPage([PAGE_W, PAGE_H]);
  return new PDFWriter(doc, page, { bold, regular });
}

async function generateIncidentReport({ caseData, actions, evidence, notifications, coverage, exportedBy }) {
  const doc    = await PDFDocument.create();
  const writer = await makeWriter(doc);
  const now    = new Date().toISOString();

  // Cover
  writer.gap(30);
  writer.drawText('PCI-DSS INCIDENT RESPONSE REPORT', { size: 18, font: writer.fonts.bold, color: BRAND_BLUE, x: MARGIN });
  writer.gap(6);
  writer.drawText(`Generated: ${now}`, { size: 9, color: GRAY });
  writer.drawText(`Exported by: ${exportedBy}`, { size: 9, color: GRAY });
  writer.divider();

  // Section 1: Case Metadata
  writer.heading('1. Case Metadata');
  writer.kv('Case ID',         caseData.id);
  writer.kv('Title',           caseData.title);
  writer.kv('Classification',  caseData.classification?.toUpperCase(),
    { valueColor: caseData.classification === 'breach' ? RED : BLACK });
  writer.kv('SAQ Type',        caseData.saq_type || 'Not specified');
  writer.kv('Status',          caseData.status?.toUpperCase());
  writer.kv('Created',         new Date(caseData.created_at).toISOString());
  writer.kv('Resolved',        caseData.resolved_at ? new Date(caseData.resolved_at).toISOString() : 'Not yet resolved');
  writer.kv('Created By',      caseData.created_by_name || caseData.created_by);
  if (Array.isArray(caseData.cde_scope) && caseData.cde_scope.length) {
    writer.kv('CDE Scope',     caseData.cde_scope.join(', '));
  }
  writer.gap(8);

  // Section 2: Notification Timeline
  writer.heading('2. Notification Timeline');
  if (!notifications?.length) {
    writer.drawText('No notification records for this case.', { color: GRAY, size: 9 });
  } else {
    writer.kv('72hr Deadline', caseData.notification_deadline
      ? new Date(caseData.notification_deadline).toISOString() : 'N/A');
    writer.gap(6);
    for (const n of notifications) {
      writer.ensureSpace(40);
      writer.drawText(`${(n.recipient || '').toUpperCase()}${n.custom_name ? ` (${n.custom_name})` : ''}`,
        { font: writer.fonts.bold, size: 10 });
      writer.kv('  Status',    n.status?.toUpperCase(), { valueColor: n.status === 'overdue' ? RED : n.status === 'sent' ? GREEN : BLACK });
      writer.kv('  Required By', new Date(n.required_by).toISOString());
      writer.kv('  Sent At',   n.sent_at ? new Date(n.sent_at).toISOString() : 'Not sent');
      writer.gap(4);
    }
  }
  writer.gap(8);

  // Section 3: Action Log
  writer.heading('3. Action Log (Immutable)');
  writer.drawText(`Total actions: ${actions.length}`, { size: 9, color: GRAY });
  writer.gap(6);
  for (let i = 0; i < actions.length; i++) {
    const a = actions[i];
    writer.ensureSpace(50);
    writer.drawText(`[${i + 1}] ${new Date(a.created_at).toISOString()} — ${a.actor_name || a.actor_id}`,
      { font: writer.fonts.bold, size: 9, color: BRAND_BLUE });
    writer.drawText(a.description, { size: 9, maxWidth: COL_W, x: MARGIN + 10 });
    if (a.requirement_refs?.length) {
      writer.drawText(`PCI Refs: ${a.requirement_refs.join(', ')}`, { size: 8, color: GRAY, x: MARGIN + 10 });
    }
    writer.gap(5);
  }
  writer.gap(8);

  // Section 4: Requirement Coverage
  writer.heading('4. PCI-DSS Requirement Coverage');
  if (coverage?.coverage) {
    const STATUS_LABEL = { met: '[MET]', not_met: '[NOT MET]', na: '[N/A]', pending: '[PENDING]' };
    const STATUS_COLOR = { met: GREEN, not_met: RED, na: GRAY, pending: GRAY };
    for (const { ref, description, status, notes } of coverage.coverage) {
      writer.ensureSpace(notes ? 28 : 14);
      const label = STATUS_LABEL[status] || '[PENDING]';
      const color = STATUS_COLOR[status] || GRAY;
      writer.page.drawText(label, { x: MARGIN, y: writer.y, size: 9, font: writer.fonts.bold, color });
      writer.page.drawText(`${ref}  ${description}`, { x: MARGIN + 70, y: writer.y, size: 9, font: writer.fonts.regular, color: BLACK });
      writer.y -= 13;
      if (notes) {
        writer.page.drawText(`Notes: ${notes}`, { x: MARGIN + 70, y: writer.y, size: 8, font: writer.fonts.regular, color: GRAY });
        writer.y -= 13;
      }
    }
  }
  writer.gap(8);

  // Section 5: Evidence Manifest
  writer.heading('5. Evidence Manifest');
  writer.drawText(`Total files: ${evidence.length}`, { size: 9, color: GRAY });
  writer.gap(6);
  for (const ev of evidence) {
    writer.ensureSpace(40);
    writer.drawText(ev.filename, { font: writer.fonts.bold, size: 9 });
    writer.kv('  SHA-256',     ev.sha256_hash);
    writer.kv('  Size',        `${(ev.file_size / 1024).toFixed(1)} KB`);
    writer.kv('  Uploaded By', ev.uploaded_by_name || ev.uploaded_by);
    writer.kv('  Uploaded At', new Date(ev.uploaded_at).toISOString());
    writer.gap(4);
  }

  return doc.save();
}

async function generateAuditTrail({ caseData, auditEntries, exportedBy }) {
  const doc    = await PDFDocument.create();
  const writer = await makeWriter(doc);

  writer.gap(20);
  writer.drawText('PCI-DSS AUDIT TRAIL', { size: 18, font: writer.fonts.bold, color: BRAND_BLUE });
  writer.gap(6);
  writer.drawText(`Case: ${caseData.title} (${caseData.id})`, { size: 9, color: GRAY });
  writer.drawText(`Generated: ${new Date().toISOString()} by ${exportedBy}`, { size: 9, color: GRAY });
  writer.divider();

  writer.drawText(`Total audit entries: ${auditEntries.length}`, { size: 9, color: GRAY });
  writer.gap(8);

  for (const entry of auditEntries) {
    writer.ensureSpace(55);
    writer.drawText(`${new Date(entry.event_time).toISOString()}`, { size: 8, color: GRAY });
    writer.drawText(`${entry.action}  |  ${entry.resource_type}${entry.resource_id ? ` / ${entry.resource_id}` : ''}`,
      { font: writer.fonts.bold, size: 9 });
    if (entry.user_email) writer.drawText(`User: ${entry.user_email}  IP: ${entry.client_ip || '—'}`, { size: 8, color: GRAY });
    if (entry.old_value) writer.drawText(`Before: ${JSON.stringify(entry.old_value)}`, { size: 8, color: GRAY, maxWidth: COL_W });
    if (entry.new_value) writer.drawText(`After:  ${JSON.stringify(entry.new_value)}`, { size: 8, color: GRAY, maxWidth: COL_W });
    writer.divider();
  }

  return doc.save();
}

module.exports = { generateIncidentReport, generateAuditTrail };
