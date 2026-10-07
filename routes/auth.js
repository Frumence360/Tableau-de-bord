const express = require('express');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const rateLimit = require('express-rate-limit');
const pool = require('../db');
const requireAuth = require('../middleware/auth');
const queries = require('../db/queries');

const router = express.Router();

// Limite les tentatives de connexion pour freiner le brute-force
const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 10,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Trop de tentatives, réessaie dans quelques minutes.' }
});

// ─── POST /api/auth/login ─────────────────────────────────────────────────────

router.post('/login', loginLimiter, async (req, res, next) => {
  try {
    const { username, password } = req.body || {};

    if (!username || !password) {
      return res.status(400).json({ error: "Nom d'utilisateur et mot de passe requis" });
    }

    const { rows } = await pool.query(
      `SELECT u.*, COALESCE(ur.role, 'capturer') AS role
       FROM users u
       LEFT JOIN user_roles ur ON ur.user_id = u.id
       WHERE u.username = $1`,
      [username]
    );
    const user = rows[0];

    if (!user || !user.is_active || !bcrypt.compareSync(password, user.password_hash)) {
      return res.status(401).json({ error: 'Identifiants invalides' });
    }

    const token = jwt.sign(
      { sub: user.id, username: user.username, tv: user.token_version, role: user.role || 'capturer' },
      process.env.JWT_SECRET,
      { expiresIn: process.env.JWT_EXPIRES_IN || '8h' }
    );

    res.json({
      token,
      username: user.username,
      role: user.role || 'capturer',
      permissions: queries.getRolePermissions(user.role || 'capturer'),
      expiresIn: process.env.JWT_EXPIRES_IN || '8h'
    });
  } catch (err) {
    next(err);
  }
});

// ─── GET /api/auth/me ─────────────────────────────────────────────────────────
// Permet au frontend de vérifier si le token en mémoire est toujours valide

router.get('/me', requireAuth, (req, res) => {
  res.json({
    username: req.user.username,
    role: req.user.role,
    permissions: queries.getRolePermissions(req.user.role)
  });
});

// ─── POST /api/auth/change-password ───────────────────────────────────────────
// Permet à l'utilisateur connecté de changer son mot de passe

router.post('/change-password', requireAuth, async (req, res, next) => {
  try {
    const { currentPassword, newPassword } = req.body || {};

    if (!currentPassword || !newPassword) {
      return res.status(400).json({ error: 'Mot de passe actuel et nouveau requis' });
    }
    if (newPassword.length < 8) {
      return res.status(400).json({ error: 'Le nouveau mot de passe doit faire au moins 8 caractères' });
    }

    // Vérifier le mot de passe actuel
    const { rows } = await pool.query('SELECT * FROM users WHERE id = $1', [req.user.id]);
    const user = rows[0];
    if (!user || !bcrypt.compareSync(currentPassword, user.password_hash)) {
      return res.status(401).json({ error: 'Mot de passe actuel incorrect' });
    }

    // Hasher et mettre à jour
    const hash = bcrypt.hashSync(newPassword, 10);
    const { rows: updated } = await pool.query(
      `UPDATE users
       SET password_hash = $1, token_version = token_version + 1
       WHERE id = $2
       RETURNING id, username, token_version`,
      [hash, user.id]
    );
    const u = updated[0];
    const finalRole = await pool.query('SELECT role FROM user_roles WHERE user_id = $1', [u.id]);
    const role = finalRole.rows[0] ? finalRole.rows[0].role : 'capturer';
    const token = jwt.sign(
      { sub: u.id, username: u.username, tv: u.token_version, role },
      process.env.JWT_SECRET,
      { expiresIn: process.env.JWT_EXPIRES_IN || '8h' }
    );

    res.json({
      success: true,
      message: 'Mot de passe modifié avec succès',
      token,
      username: u.username,
      role,
      permissions: queries.getRolePermissions(role),
      expiresIn: process.env.JWT_EXPIRES_IN || '8h'
    });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
