'use strict';

const jwt = require('jsonwebtoken');
const logger = require('../services/logger');

const ROLES = ['admin', 'ir_lead', 'ir_analyst', 'readonly'];

/**
 * Verify JWT access token. Attaches decoded payload to req.user.
 */
function authenticate(req, res, next) {
  const authHeader = req.headers['authorization'];
  if (!authHeader?.startsWith('Bearer ')) {
    return res.status(401).json({ error: 'Missing or malformed Authorization header' });
  }
  const token = authHeader.slice(7);
  try {
    const payload = jwt.verify(token, process.env.JWT_SECRET);
    req.user = payload;  // { id, email, role, jti, iat, exp }
    next();
  } catch (err) {
    logger.warn({ err }, 'JWT verification failed');
    return res.status(401).json({ error: 'Invalid or expired token' });
  }
}

/**
 * Role-based access control middleware factory.
 * Usage: authorize('admin', 'ir_lead')
 */
function authorize(...allowedRoles) {
  return (req, res, next) => {
    if (!req.user) return res.status(401).json({ error: 'Unauthenticated' });
    if (!allowedRoles.includes(req.user.role)) {
      logger.warn({ userId: req.user.id, role: req.user.role, required: allowedRoles }, 'Authorization denied');
      return res.status(403).json({ error: 'Insufficient permissions' });
    }
    next();
  };
}

module.exports = { authenticate, authorize, ROLES };
