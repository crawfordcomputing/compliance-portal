'use strict';

/**
 * Audit Context Middleware
 *
 * Sets PostgreSQL session-level GUCs on every request so that
 * pgaudit and our audit triggers can capture who did what.
 *
 * GUCs set:
 *   app.current_user_id  -- UUID of the authenticated user
 *   app.client_ip        -- remote IP of the HTTP request
 *   app.session_id       -- JWT jti or generated session identifier
 *
 * Must be applied AFTER auth middleware so req.user is populated.
 * The actual GUC setting happens lazily inside queryWithAuditCtx()
 * in src/db/index.js; this middleware just attaches the context to req.
 */

const { v4: uuidv4 } = require('uuid');

function auditContext(req, res, next) {
  req.auditCtx = {
    userId:    req.user?.id    || 'anonymous',
    clientIp:  req.ip          || req.socket?.remoteAddress || 'unknown',
    sessionId: req.user?.jti   || uuidv4(),
  };
  next();
}

module.exports = auditContext;
