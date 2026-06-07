'use strict';

const express = require('express');
const { query } = require('../db');
const { authenticate, authorize } = require('../middleware/auth');
const logger = require('../services/logger');

const router = express.Router();
router.use(authenticate);

// Annual compliance requirements — manually checked
const ANNUAL_REQUIREMENTS = [
  { ref: '12.10.1', description: 'IR plan reviewed and updated this year',                  allows_na: false },
  { ref: '12.10.2', description: 'IR plan tested annually via tabletop or real incident',   allows_na: false, auto_derive: true },
  { ref: '12.10.3', description: 'Designated IR personnel confirmed available 24/7',        allows_na: false },
  { ref: '12.10.4', description: 'IR training provided to all relevant personnel',          allows_na: false },
  { ref: '12.10.7', description: 'IR procedures for PAN detection reviewed and in place',   allows_na: false },
  { ref: '10.7',    description: 'Failures of critical security controls detected/reported', allows_na: false },
  { ref: '6.3.3',   description: 'All software components reviewed for known vulnerabilities', allows_na: false },
  { ref: 'TABLETOP','description': 'Annual tabletop exercise completed (required if no real breach/suspected cases)', allows_na: true, auto_derive: true },
];

// GET /api/compliance/:year
router.get('/:year', async (req, res) => {
  try {
    const year = parseInt(req.params.year);
    if (isNaN(year) || year < 2020 || year > 2100) {
      return res.status(400).json({ error: 'Invalid year' });
    }

    // Load saved checkins for this year
    const { rows: saved } = await query(
      `SELECT ac.*, u.full_name AS checked_by_name
       FROM annual_compliance ac
       LEFT JOIN users u ON u.id = ac.checked_by
       WHERE ac.year = $1`, [year]
    );
    const savedMap = Object.fromEntries(saved.map(r => [r.requirement_ref, r]));

    // Auto-derive 12.10.2: any tabletop exercise OR real breach/suspected case this year
    const yearStart = `${year}-01-01`;
    const yearEnd   = `${year + 1}-01-01`;

    const { rows: tabletops } = await query(
      `SELECT COUNT(*) AS cnt FROM tabletop_exercises
       WHERE ended_at >= $1 AND ended_at < $2`, [yearStart, yearEnd]
    );
    const { rows: realCases } = await query(
      `SELECT COUNT(*) AS cnt FROM cases
       WHERE classification IN ('breach','suspected')
         AND created_at >= $1 AND created_at < $2
         AND deleted_at IS NULL`, [yearStart, yearEnd]
    );

    const tabletopCount = parseInt(tabletops[0].cnt);
    const realCaseCount = parseInt(realCases[0].cnt);
    const tested = tabletopCount > 0 || realCaseCount > 0;
    const tabletopRequired = realCaseCount === 0; // required if no real cases

    // Build checklist
    const checklist = ANNUAL_REQUIREMENTS.map(req => {
      const saved = savedMap[req.ref];
      let status = saved?.status || 'pending';
      let auto_derived = false;
      let auto_detail  = null;

      if (req.ref === '12.10.2' && !saved) {
        status = tested ? 'met' : 'pending';
        auto_derived = true;
        auto_detail  = tested
          ? `Auto-derived: ${tabletopCount} tabletop(s), ${realCaseCount} real case(s) this year`
          : 'No tabletop exercises or real incidents recorded yet this year';
      }
      if (req.ref === 'TABLETOP' && !saved) {
        if (!tabletopRequired) {
          status = 'na';
          auto_derived = true;
          auto_detail  = `Auto-derived: N/A — ${realCaseCount} real incident(s) recorded this year`;
        } else if (tabletopCount > 0) {
          status = 'met';
          auto_derived = true;
          auto_detail  = `Auto-derived: ${tabletopCount} tabletop exercise(s) completed`;
        } else {
          status = 'pending';
          auto_derived = true;
          auto_detail  = 'Required — no real cases this year and no tabletop completed yet';
        }
      }

      return {
        ref: req.ref,
        description: req.description,
        allows_na: req.allows_na,
        status,
        notes: saved?.notes || auto_detail,
        auto_derived,
        checked_by: saved?.checked_by_name || null,
        checked_at: saved?.checked_at || null,
      };
    });

    const metCount = checklist.filter(c => c.status === 'met' || c.status === 'na').length;

    res.json({
      year,
      checklist,
      met_count: metCount,
      total: checklist.length,
      tabletop_count: tabletopCount,
      real_case_count: realCaseCount,
      tabletop_required: tabletopRequired,
    });
  } catch (err) {
    logger.error({ err }, 'Annual compliance GET error');
    res.status(500).json({ error: 'Internal server error' });
  }
});

// PATCH /api/compliance/:year/:ref — sign off on a requirement
router.patch('/:year/:ref', authorize('admin', 'ir_lead'), async (req, res) => {
  try {
    const year = parseInt(req.params.year);
    const ref  = decodeURIComponent(req.params.ref);
    const { status, notes } = req.body;
    const valid = ['pending', 'met', 'not_met', 'na'];
    if (!valid.includes(status)) return res.status(400).json({ error: `status must be one of: ${valid.join(', ')}` });

    const { rows } = await query(
      `INSERT INTO annual_compliance (id, year, requirement_ref, status, notes, checked_by, checked_at)
       VALUES (uuid_generate_v4(), $1, $2, $3, $4, $5, NOW())
       ON CONFLICT (year, requirement_ref) DO UPDATE
         SET status=$3, notes=$4, checked_by=$5, checked_at=NOW(), updated_at=NOW()
       RETURNING *`,
      [year, ref, status, notes || null, req.user.id]
    );
    res.json(rows[0]);
  } catch (err) {
    logger.error({ err }, 'Annual compliance PATCH error');
    res.status(500).json({ error: 'Internal server error' });
  }
});

module.exports = router;
