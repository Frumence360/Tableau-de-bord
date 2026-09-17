const express = require('express');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const rateLimit = require('express-rate-limit');
const pool = require('../db');
const requireAuth = require('../middleware/auth');

const router = express.Router();

// Limite les tentatives de connexion pour freiner le brute-force
const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 10,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Trop de tentatives, réessaie dans quelques minutes.' }
});

// Limite les tentatives de changement de mot de passe (mêmes raisons)
const changePasswordLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 10,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Trop de tentatives, réessaie dans quelques minutes.' }
});

const MIN_PASSWORD_LENGTH = 8;

router.post('/login', loginLimiter, async (req, res, next) => {
  try {
    const { username, password } = req.body || {};

    if (!username || !password) {
      return res.status(400).json({ error: "Nom d'utilisateur et mot de passe requis" });
    }

    const { rows } = await pool.query('SELECT * FROM users WHERE username = $1', [username]);
    const user = rows[0];

    if (!user || !bcrypt.compareSync(password, user.password_hash)) {
      return res.status(401).json({ error: 'Identifiants invalides' });
    }

    const token = jwt.sign(
      { sub: user.id, username: user.username, tv: user.token_version },
      process.env.JWT_SECRET,
      { expiresIn: process.env.JWT_EXPIRES_IN || '8h' }
    );

    res.json({ token, username: user.username, expiresIn: process.env.JWT_EXPIRES_IN || '8h' });
  } catch (err) {
    next(err);
  }
});

// Permet au frontend de vérifier si le token en mémoire est toujours valide
router.get('/me', requireAuth, (req, res) => {
  res.json({ username: req.user.username });
});

// Changement de mot de passe : exige le token + l'ancien mot de passe
router.post('/change-password', requireAuth, changePasswordLimiter, async (req, res, next) => {
  try {
    const { currentPassword, newPassword } = req.body || {};

    if (!currentPassword || !newPassword) {
      return res.status(400).json({ error: 'Mot de passe actuel et nouveau mot de passe requis' });
    }
    if (newPassword.length < MIN_PASSWORD_LENGTH) {
      return res.status(400).json({ error: `Le nouveau mot de passe doit faire au moins ${MIN_PASSWORD_LENGTH} caractères` });
    }
    if (newPassword === currentPassword) {
      return res.status(400).json({ error: "Le nouveau mot de passe doit être différent de l'actuel" });
    }

    const { rows } = await pool.query('SELECT * FROM users WHERE id = $1', [req.user.id]);
    const user = rows[0];

    if (!user || !bcrypt.compareSync(currentPassword, user.password_hash)) {
      return res.status(401).json({ error: 'Mot de passe actuel incorrect' });
    }

    // On incrémente token_version dans le même UPDATE : tous les tokens émis
    // avant ce changement deviennent invalides (y compris celui utilisé ici).
    const hash = bcrypt.hashSync(newPassword, 10);
    await pool.query(
      'UPDATE users SET password_hash = $1, token_version = token_version + 1 WHERE id = $2',
      [hash, user.id]
    );

    res.json({ ok: true });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
