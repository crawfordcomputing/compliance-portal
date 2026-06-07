'use strict';

const express = require('express');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const crypto = require('crypto');
const { v4: uuidv4 } = require('uuid');
const { query } = require('../db');
const { authenticate } = require('../middleware/auth');
const logger = require('../services/logger');

const router = express.Router();

function signAccess(user) {
  return jwt.sign(
    { id: user.id, email: user.email, role: user.role, jti: uuidv4() },
    process.env.JWT_SECRET,
    { expiresIn: process.env.JWT_EXPIRES_IN || '15m' }
  );
}

function signRefresh(userId) {
  const token = crypto.randomBytes(48).toString('hex');
  const hash  = crypto.createHash('sha256').update(token).digest('hex');
  return { token, hash };
}

// POST /api/auth/login
router.post('/login', async (req, res) => {
  try {
    const { email, password } = req.body;
    if (!email || !password) return res.status(400).json({ error: 'email and password required' });

    const { rows } = await query(
      'SELECT id, email, role, password_hash, is_active FROM users WHERE email = $1 AND deleted_at IS NULL',
      [email.toLowerCase().trim()]
    );
    const user = rows[0];
    if (!user || !user.is_active) return res.status(401).json({ error: 'Invalid credentials' });

    const valid = await bcrypt.compare(password, user.password_hash);
    if (!valid) return res.status(401).json({ error: 'Invalid credentials' });

    const accessToken = signAccess(user);
    const { token: refreshToken, hash } = signRefresh(user.id);
    const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);

    await query(
      'INSERT INTO refresh_tokens (user_id, token_hash, expires_at) VALUES ($1, $2, $3)',
      [user.id, hash, expiresAt]
    );
    await query('UPDATE users SET last_login_at = NOW() WHERE id = $1', [user.id]);

    logger.info({ userId: user.id, email: user.email }, 'User logged in');
    res.json({ accessToken, refreshToken, expiresIn: 900 });
  } catch (err) {
    logger.error({ err }, 'Login error');
    res.status(500).json({ error: 'Internal server error' });
  }
});

// POST /api/auth/refresh
router.post('/refresh', async (req, res) => {
  try {
    const { refreshToken } = req.body;
    if (!refreshToken) return res.status(400).json({ error: 'refreshToken required' });

    const hash = crypto.createHash('sha256').update(refreshToken).digest('hex');
    const { rows } = await query(
      `SELECT rt.id, rt.user_id, rt.expires_at, u.email, u.role, u.is_active
       FROM refresh_tokens rt
       JOIN users u ON u.id = rt.user_id
       WHERE rt.token_hash = $1 AND rt.revoked_at IS NULL AND u.deleted_at IS NULL`,
      [hash]
    );
    const record = rows[0];
    if (!record || new Date(record.expires_at) < new Date() || !record.is_active) {
      return res.status(401).json({ error: 'Invalid or expired refresh token' });
    }

    // Rotate: revoke old token, issue new pair
    await query('UPDATE refresh_tokens SET revoked_at = NOW() WHERE id = $1', [record.id]);
    const user = { id: record.user_id, email: record.email, role: record.role };
    const accessToken = signAccess(user);
    const { token: newRefresh, hash: newHash } = signRefresh(user.id);
    const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);
    await query(
      'INSERT INTO refresh_tokens (user_id, token_hash, expires_at) VALUES ($1, $2, $3)',
      [user.id, newHash, expiresAt]
    );

    res.json({ accessToken, refreshToken: newRefresh, expiresIn: 900 });
  } catch (err) {
    logger.error({ err }, 'Refresh error');
    res.status(500).json({ error: 'Internal server error' });
  }
});

// POST /api/auth/logout
router.post('/logout', authenticate, async (req, res) => {
  try {
    const { refreshToken } = req.body;
    if (refreshToken) {
      const hash = crypto.createHash('sha256').update(refreshToken).digest('hex');
      await query(
        'UPDATE refresh_tokens SET revoked_at = NOW() WHERE token_hash = $1 AND user_id = $2',
        [hash, req.user.id]
      );
    }
    logger.info({ userId: req.user.id }, 'User logged out');
    res.json({ message: 'Logged out' });
  } catch (err) {
    logger.error({ err }, 'Logout error');
    res.status(500).json({ error: 'Internal server error' });
  }
});

// GET /api/auth/me
router.get('/me', authenticate, async (req, res) => {
  const { rows } = await query(
    'SELECT id, email, full_name, role, last_login_at, created_at FROM users WHERE id = $1',
    [req.user.id]
  );
  if (!rows[0]) return res.status(404).json({ error: 'User not found' });
  res.json(rows[0]);
});

module.exports = router;
