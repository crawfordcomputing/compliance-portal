'use strict';

const express = require('express');
const { v4: uuidv4 } = require('uuid');
const { query } = require('../db');
const { authenticate, authorize } = require('../middleware/auth');
const logger = require('../services/logger');

const router = express.Router({ mergeParams: true });
router.use(authenticate);

// GET /api/exercises/:id/gaps
router.get('/', async (req, res) => {
  try {
    const { rows } = await query(
      `SELECT g.*, e.case_id,
              s.title AS scenario_title
       FROM tabletop_gaps g
       JOIN tabletop_exercises e ON e.id = g.exercise_id
       JOIN tabletop_scenarios s ON s.id = e.scenario_id
       WHERE g.exercise_id = $1
       ORDER BY g.created_at ASC`,
      [req.params.id]
    );
    res.json(rows);
  } catch (err) {
    logger.error({ err }, 'List gaps error');
    res.status(500).json({ error: 'Internal server error' });
  }
});

// POST /api/exercises/:id/gaps — manually add a gap
router.post('/', authorize('admin', 'ir_lead'), async (req, res) => {
  try {
    const { requirement_ref, description } = req.body;
    if (!requirement_ref || !description) {
      return res.status(400).json({ error: 'requirement_ref and description are required' });
    }
    const { rows } = await query(
      `INSERT INTO tabletop_gaps (id, exercise_id, requirement_ref, description)
       VALUES ($1, $2, $3, $4) RETURNING *`,
      [uuidv4(), req.params.id, requirement_ref, description]
    );
    res.status(201).json(rows[0]);
  } catch (err) {
    logger.error({ err }, 'Create gap error');
    res.status(500).json({ error: 'Internal server error' });
  }
});

// PATCH /api/exercises/:id/gaps/:gid/remediate — mark gap as remediated
router.patch('/:gid/remediate', authorize('admin', 'ir_lead'), async (req, res) => {
  try {
    const { rows } = await query(
      `UPDATE tabletop_gaps
       SET remediated = TRUE, remediated_at = NOW()
       WHERE id = $1 AND exercise_id = $2 AND remediated = FALSE
       RETURNING *`,
      [req.params.gid, req.params.id]
    );
    if (!rows[0]) return res.status(404).json({ error: 'Gap not found or already remediated' });
    res.json(rows[0]);
  } catch (err) {
    logger.error({ err }, 'Remediate gap error');
    res.status(500).json({ error: 'Internal server error' });
  }
});

// GET /api/gaps/summary — cross-exercise gap summary (annual view)
router.get('/summary', async (req, res) => {
  try {
    const { rows } = await query(
      `SELECT requirement_ref,
              COUNT(*) AS total_occurrences,
              SUM(CASE WHEN remediated THEN 1 ELSE 0 END) AS remediated_count,
              MAX(g.created_at) AS last_seen
       FROM tabletop_gaps g
       GROUP BY requirement_ref
       ORDER BY total_occurrences DESC`
    );
    res.json(rows);
  } catch (err) {
    logger.error({ err }, 'Gap summary error');
    res.status(500).json({ error: 'Internal server error' });
  }
});

module.exports = router;
