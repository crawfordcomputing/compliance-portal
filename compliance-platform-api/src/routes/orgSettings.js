'use strict';

const express = require('express');
const { query } = require('../db');
const { authenticate, authorize } = require('../middleware/auth');
const logger = require('../services/logger');

const router = express.Router();
router.use(authenticate);

const ALLOWED_FIELDS = [
  'org_name', 'is_service_provider', 'has_wireless_in_cde',
  'has_ecommerce', 'has_cloud_infra', 'has_waf', 'siem_in_use',
  'qsa_contact', 'assessment_year',
  'compliance_quarterly_start_month', 'compliance_semi_annual_start_month', 'compliance_annual_due_month',
];

// GET /api/org-settings
router.get('/', async (req, res) => {
  try {
    const { rows } = await query('SELECT * FROM org_settings LIMIT 1');
    res.json(rows[0] || {});
  } catch (err) {
    logger.error({ err }, 'Get org settings error');
    res.status(500).json({ error: 'Internal server error' });
  }
});

// PATCH /api/org-settings
router.patch('/', authorize('admin', 'ir_lead'), async (req, res) => {
  try {
    const updates = Object.entries(req.body)
      .filter(([k]) => ALLOWED_FIELDS.includes(k));

    if (updates.length === 0) {
      return res.status(400).json({ error: 'No valid fields provided' });
    }

    const setClauses = updates.map(([k], i) => `${k} = $${i + 1}`).join(', ');
    const values     = updates.map(([, v]) => v);
    values.push(req.user.id);

    const { rows } = await query(
      `UPDATE org_settings
       SET ${setClauses}, updated_at = NOW(), updated_by = $${values.length}
       RETURNING *`,
      values
    );
    logger.info({ userId: req.user.id }, 'Org settings updated');
    res.json(rows[0]);
  } catch (err) {
    logger.error({ err }, 'Update org settings error');
    res.status(500).json({ error: 'Internal server error' });
  }
});

module.exports = router;
