'use strict';

const express = require('express');
const { v4: uuidv4 } = require('uuid');
const { query } = require('../db');
const { authenticate, authorize } = require('../middleware/auth');
const logger = require('../services/logger');

const router = express.Router();
router.use(authenticate);

// GET /api/scenarios — list all scenarios
router.get('/', async (req, res) => {
  try {
    const { rows } = await query(
      `SELECT s.*, u.full_name AS created_by_name
       FROM tabletop_scenarios s
       LEFT JOIN users u ON u.id = s.created_by
       ORDER BY s.is_builtin DESC, s.created_at DESC`
    );
    res.json(rows);
  } catch (err) {
    logger.error({ err }, 'List scenarios error');
    res.status(500).json({ error: 'Internal server error' });
  }
});

// GET /api/scenarios/:id
router.get('/:id', async (req, res) => {
  try {
    const { rows } = await query(
      `SELECT s.*, u.full_name AS created_by_name
       FROM tabletop_scenarios s
       LEFT JOIN users u ON u.id = s.created_by
       WHERE s.id = $1`,
      [req.params.id]
    );
    if (!rows[0]) return res.status(404).json({ error: 'Scenario not found' });
    res.json(rows[0]);
  } catch (err) {
    logger.error({ err }, 'Get scenario error');
    res.status(500).json({ error: 'Internal server error' });
  }
});

// POST /api/scenarios — create custom scenario
router.post('/', authorize('admin', 'ir_lead'), async (req, res) => {
  try {
    const { title, description, injects, roles, requirement_focus } = req.body;
    if (!title) return res.status(400).json({ error: 'title is required' });

    const { rows } = await query(
      `INSERT INTO tabletop_scenarios
         (id, title, description, injects, roles, requirement_focus, is_builtin, created_by)
       VALUES ($1,$2,$3,$4,$5,$6,FALSE,$7) RETURNING *`,
      [uuidv4(), title, description || null,
       JSON.stringify(injects || []),
       roles || [], requirement_focus || [],
       req.user.id]
    );
    res.status(201).json(rows[0]);
  } catch (err) {
    logger.error({ err }, 'Create scenario error');
    res.status(500).json({ error: 'Internal server error' });
  }
});

// PUT /api/scenarios/:id — update custom scenario (not built-in)
router.put('/:id', authorize('admin', 'ir_lead'), async (req, res) => {
  try {
    const { title, description, injects, roles, requirement_focus } = req.body;
    const { rows } = await query(
      `UPDATE tabletop_scenarios
       SET title=$1, description=$2, injects=$3, roles=$4, requirement_focus=$5, updated_at=NOW()
       WHERE id=$6 AND is_builtin=FALSE RETURNING *`,
      [title, description, JSON.stringify(injects || []),
       roles || [], requirement_focus || [], req.params.id]
    );
    if (!rows[0]) return res.status(404).json({ error: 'Scenario not found or is built-in (cannot edit)' });
    res.json(rows[0]);
  } catch (err) {
    logger.error({ err }, 'Update scenario error');
    res.status(500).json({ error: 'Internal server error' });
  }
});

module.exports = router;
