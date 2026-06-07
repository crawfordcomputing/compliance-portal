'use strict';

require('dotenv').config();
const express = require('express');
const helmet  = require('helmet');
const cors    = require('cors');
const rateLimit = require('express-rate-limit');

const logger = require('./services/logger');
const { testConnection } = require('./db');
const { startDeadlineEngine }       = require('./services/deadlineEngine');
const { startComplianceScheduler }  = require('./services/complianceScheduler');
const { seedScenarios }          = require('./db/seedScenarios');
const { seedComplianceChecks }   = require('./db/seedComplianceChecks');

const authRoutes          = require('./routes/auth');
const casesRoutes         = require('./routes/cases');
const actionsRoutes       = require('./routes/actions');
const evidenceRoutes      = require('./routes/evidence');
const notificationsRoutes = require('./routes/notifications');
const scenariosRoutes     = require('./routes/scenarios');
const exercisesRoutes     = require('./routes/exercises');
const gapsRoutes          = require('./routes/gaps');
const { router: exportsRoutes, downloadHandler } = require('./routes/exports');
const complianceRoutes         = require('./routes/compliance');
const orgSettingsRoutes        = require('./routes/orgSettings');
const complianceCalendarRoutes = require('./routes/complianceCalendar');

const app = express();

app.use(helmet());
app.use(cors({ origin: process.env.CORS_ORIGIN || 'http://localhost:3001' }));
app.use(express.json({ limit: '10mb' }));

const authLimiter = rateLimit({
  windowMs: 5 * 60 * 1000, max: 20,
  message: { error: 'Too many requests, please try again later.' },
  standardHeaders: true, legacyHeaders: false,
});

// Public download endpoint — MUST be before casesRoutes, which applies global auth middleware
app.get('/api/cases/:id/export/:exportId/download', downloadHandler);

app.use('/api/auth',                       authLimiter, authRoutes);
app.use('/api/cases',                      casesRoutes);
app.use('/api/cases/:id/actions',          actionsRoutes);
app.use('/api/cases/:id/evidence',         evidenceRoutes);
app.use('/api/cases/:id/notifications',    notificationsRoutes);
app.use('/api/cases/:id/export',           exportsRoutes);
app.use('/api/scenarios',                  scenariosRoutes);
app.use('/api/exercises',                  exercisesRoutes);
app.use('/api/exercises/:id/gaps',         gapsRoutes);
app.use('/api/compliance',                 complianceRoutes);
app.use('/api/org-settings',              orgSettingsRoutes);
app.use('/api/compliance-calendar',       complianceCalendarRoutes);

app.get('/health', (req, res) => res.json({ status: 'ok', phase: 5 }));
app.use((req, res) => res.status(404).json({ error: 'Not found' }));
app.use((err, req, res, next) => {
  logger.error({ err, path: req.path }, 'Unhandled error');
  res.status(err.status || 500).json({ error: err.message || 'Internal server error' });
});

const PORT = process.env.PORT || 3000;

(async () => {
  await testConnection();
  await seedScenarios();
  await seedComplianceChecks();
  startDeadlineEngine();
  startComplianceScheduler();
  app.listen(PORT, () => logger.info(`ir-platform listening on port ${PORT}`));
})();

module.exports = app;
