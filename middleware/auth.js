const jwt = require('jsonwebtoken');
const pool = require('../db');

module.exports = async function requireAuth(req, res, next) {
  const header = req.headers.authorization || '';
  const token = header.startsWith('Bearer ') ? header.slice(7) : null;

  if (!token) {
    return res.status(401).json({ error: 'Authentification requise' });
  }

  try {
    const payload = jwt.verify(token, process.env.JWT_SECRET);
    const userId = payload.sub;
    const { rows } = await pool.query(
      `SELECT u.id, u.username, u.token_version, u.is_active, COALESCE(ur.role, 'capturer') AS role
       FROM users u
       LEFT JOIN user_roles ur ON ur.user_id = u.id
       WHERE u.id = $1`,
      [userId]
    );
    const user = rows[0];
    if (!user || !user.is_active || Number(payload.tv) !== Number(user.token_version)) {
      return res.status(401).json({ error: 'Token invalide ou expiré' });
    }
    req.user = { id: user.id, username: user.username, role: user.role || 'capturer' };
    next();
  } catch (err) {
    if (err.name === 'JsonWebTokenError' || err.name === 'TokenExpiredError') {
      return res.status(401).json({ error: 'Token invalide ou expiré' });
    }
    next(err);
  }
};
