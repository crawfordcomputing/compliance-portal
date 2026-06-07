'use strict';

const express = require('express');
const { v4: uuidv4 } = require('uuid');
const { query, queryWithAuditCtx } = require('../db');
const { authenticate, authorize } = require('../middleware/auth');
const auditContext = require('../middleware/auditContext');
const logger = require('../services/logger');

const router = express.Router();
router.use(authenticate, auditContext);

// POST /api/exercises — create an exercise from a scenario
router.post('/', authorize('admin', 'ir_lead'), async (req, res) => {
  try {
    const { scenario_id, participants } = req.body;
    if (!scenario_id) return res.status(400).json({ error: 'scenario_id is required' });

    const { rows: scenarios } = await query(
      'SELECT * FROM tabletop_scenarios WHERE id = $1', [scenario_id]
    );
    if (!scenarios[0]) return res.status(404).json({ error: 'Scenario not found' });

    // Create a linked tabletop case
    const caseId = uuidv4();
    const exerciseId = uuidv4();

    await queryWithAuditCtx(req.auditCtx, async (client) => {
      await client.query(
        `INSERT INTO cases (id, title, classification, created_by, assigned_to)
         VALUES ($1, $2, 'tabletop', $3, $4)`,
        [caseId, `[Tabletop] ${scenarios[0].title}`, req.user.id,
         [req.user.id]]
      );
      await client.query(
        `INSERT INTO tabletop_exercises
           (id, scenario_id, case_id, facilitator, participants)
         VALUES ($1, $2, $3, $4, $5)`,
        [exerciseId, scenario_id, caseId, req.user.id,
         JSON.stringify(participants || [])]
      );
      await client.query(
        `INSERT INTO audit_log (user_id, user_email, client_ip, session_id, action, resource_type, resource_id, new_value)
         VALUES ($1,$2,$3,$4,'exercise.created','exercise',$5,$6)`,
        [req.user.id, req.user.email, req.auditCtx.clientIp, req.auditCtx.sessionId,
         exerciseId, JSON.stringify({ scenario_id, case_id: caseId })]
      );
    });

    const { rows } = await query(
      `SELECT e.*, s.title AS scenario_title, s.injects, s.roles, s.requirement_focus
       FROM tabletop_exercises e JOIN tabletop_scenarios s ON s.id = e.scenario_id
       WHERE e.id = $1`,
      [exerciseId]
    );
    res.status(201).json(rows[0]);
  } catch (err) {
    logger.error({ err }, 'Create exercise error');
    res.status(500).json({ error: 'Internal server error' });
  }
});

// GET /api/exercises — list all exercises
router.get('/', async (req, res) => {
  try {
    const { rows } = await query(
      `SELECT e.*, s.title AS scenario_title, u.full_name AS facilitator_name,
              c.status AS case_status
       FROM tabletop_exercises e
       JOIN tabletop_scenarios s ON s.id = e.scenario_id
       JOIN users u ON u.id = e.facilitator
       JOIN cases c ON c.id = e.case_id
       ORDER BY e.created_at DESC`
    );
    res.json(rows);
  } catch (err) {
    logger.error({ err }, 'List exercises error');
    res.status(500).json({ error: 'Internal server error' });
  }
});

// GET /api/exercises/:id
router.get('/:id', async (req, res) => {
  try {
    const { rows } = await query(
      `SELECT e.*, s.title AS scenario_title, s.description AS scenario_description,
              s.injects, s.roles, s.requirement_focus,
              u.full_name AS facilitator_name, c.status AS case_status
       FROM tabletop_exercises e
       JOIN tabletop_scenarios s ON s.id = e.scenario_id
       JOIN users u ON u.id = e.facilitator
       JOIN cases c ON c.id = e.case_id
       WHERE e.id = $1`,
      [req.params.id]
    );
    if (!rows[0]) return res.status(404).json({ error: 'Exercise not found' });
    res.json(rows[0]);
  } catch (err) {
    logger.error({ err }, 'Get exercise error');
    res.status(500).json({ error: 'Internal server error' });
  }
});

// PATCH /api/exercises/:id/start
router.patch('/:id/start', authorize('admin', 'ir_lead'), async (req, res) => {
  try {
    const { rows } = await query(
      `UPDATE tabletop_exercises SET started_at = NOW()
       WHERE id = $1 AND started_at IS NULL RETURNING *`,
      [req.params.id]
    );
    if (!rows[0]) return res.status(404).json({ error: 'Exercise not found or already started' });
    logger.info({ exerciseId: req.params.id }, 'Exercise started');
    res.json(rows[0]);
  } catch (err) {
    logger.error({ err }, 'Start exercise error');
    res.status(500).json({ error: 'Internal server error' });
  }
});

// PATCH /api/exercises/:id/end
router.patch('/:id/end', authorize('admin', 'ir_lead'), async (req, res) => {
  try {
    const { rows } = await query(
      `UPDATE tabletop_exercises SET ended_at = NOW()
       WHERE id = $1 AND started_at IS NOT NULL AND ended_at IS NULL RETURNING *`,
      [req.params.id]
    );
    if (!rows[0]) return res.status(404).json({ error: 'Exercise not found, not started, or already ended' });
    // Transition linked case to resolved
    await query(
      `UPDATE cases SET status = 'resolved', resolved_at = NOW()
       WHERE id = (SELECT case_id FROM tabletop_exercises WHERE id = $1)
         AND status = 'open'`,
      [req.params.id]
    );
    logger.info({ exerciseId: req.params.id }, 'Exercise ended');
    res.json(rows[0]);
  } catch (err) {
    logger.error({ err }, 'End exercise error');
    res.status(500).json({ error: 'Internal server error' });
  }
});

// GET /api/exercises/:id/after-action — auto-generated after-action report
router.get('/:id/after-action', async (req, res) => {
  try {
    const { rows: ex } = await query(
      `SELECT e.*, s.title AS scenario_title, s.requirement_focus, s.injects
       FROM tabletop_exercises e JOIN tabletop_scenarios s ON s.id = e.scenario_id
       WHERE e.id = $1`,
      [req.params.id]
    );
    if (!ex[0]) return res.status(404).json({ error: 'Exercise not found' });

    const { rows: actions } = await query(
      `SELECT a.*, u.full_name AS actor_name
       FROM actions a JOIN users u ON u.id = a.actor_id
       WHERE a.case_id = $1 ORDER BY a.created_at ASC`,
      [ex[0].case_id]
    );

    const { rows: gaps } = await query(
      'SELECT * FROM tabletop_gaps WHERE exercise_id = $1 ORDER BY created_at ASC',
      [req.params.id]
    );

    // Requirement coverage
    const covered = new Set(actions.flatMap(a => a.requirement_refs));
    const required = ex[0].requirement_focus || [];
    const missedRequirements = required.filter(r => !covered.has(r));

    const durationMin = ex[0].started_at && ex[0].ended_at
      ? Math.round((new Date(ex[0].ended_at) - new Date(ex[0].started_at)) / 60000)
      : null;

    res.json({
      exercise: ex[0],
      summary: {
        duration_minutes: durationMin,
        actions_logged: actions.length,
        requirements_in_focus: required.length,
        requirements_covered: covered.size,
        requirements_missed: missedRequirements,
        gaps_identified: gaps.length,
        gaps_remediated: gaps.filter(g => g.remediated).length,
      },
      timeline: actions,
      gaps,
    });
  } catch (err) {
    logger.error({ err }, 'After-action report error');
    res.status(500).json({ error: 'Internal server error' });
  }
});

module.exports = router;
