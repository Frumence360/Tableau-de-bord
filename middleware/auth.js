const jwt = require('jsonwebtoken');
const pool = require('../db');

module.exports = async function requireAuth(req, res, next) {
  const header = req.headers.authorization || '';
  const token = header.startsWith('Bearer ') ? header.slice(7) : null;

  if (!token) {
    return res.status(401).json({ error: 'Authentification requise' });
  }

  let payload;
  try {
    payload = jwt.verify(token, process.env.JWT_SECRET);
  } catch (err) {
    return res.status(401).json({ error: 'Token invalide ou expiré' });
  }

  try {
    // Le token porte la version courante au moment de son émission (tv).
    // Si un changement de mot de passe a eu lieu depuis, la version en base
    // a été incrémentée et ce token ne doit plus être accepté.
    const { rows } = await pool.query('SELECT token_version FROM users WHERE id = $1', [payload.sub]);
    if (!rows[0] || rows[0].token_version !== (payload.tv || 0)) {
      return res.status(401).json({ error: 'Session expirée, reconnecte-toi' });
    }

    req.user = { id: payload.sub, username: payload.username };
    next();
  } catch (err) {
    next(err);
  }
};
