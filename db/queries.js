/**
 * Requêtes PostgreSQL. Toutes les fonctions sont asynchrones (pg utilise
 * des promesses) — server.js les appelle avec await.
 */

const pool = require('./index');

async function getStats() {
  const { rows } = await pool.query('SELECT * FROM stats');
  const out = {};
  for (const r of rows) {
    out[r.key] = { value: Number(r.value), deltaPct: Number(r.delta_pct) };
    if (r.currency) out[r.key].currency = r.currency;
  }
  return out;
}

async function getTrafficSources() {
  const { rows } = await pool.query(
    'SELECT label, pct, color FROM traffic_sources ORDER BY sort_order'
  );
  return rows.map((r) => ({ label: r.label, pct: Number(r.pct), color: r.color }));
}

async function getCountries() {
  const { rows } = await pool.query(
    'SELECT code, label, pct FROM countries ORDER BY sort_order'
  );
  return rows.map((r) => ({ code: r.code, label: r.label, pct: Number(r.pct) }));
}

async function getProjects() {
  const { rows } = await pool.query(
    `SELECT id, title, status, date, thumb_gradient AS "thumbGradient"
     FROM projects ORDER BY date DESC`
  );
  return rows;
}

async function addProject({ title, status, date, thumbGradient }) {
  const gradient = thumbGradient || 'linear-gradient(135deg,#2a5fb0,#173a70)';
  const { rows } = await pool.query(
    `INSERT INTO projects (title, status, date, thumb_gradient)
     VALUES ($1, $2, $3, $4)
     RETURNING id, title, status, date, thumb_gradient AS "thumbGradient"`,
    [title, status, date, gradient]
  );
  return rows[0];
}

async function getVisits(range) {
  const days = range === '7d' ? 7 : range === '90d' ? 90 : 30;

  const { rows } = await pool.query(
    `SELECT date, count FROM daily_visits ORDER BY date DESC LIMIT $1`,
    [days]
  );
  const ordered = rows.reverse();

  const labels = ordered.map((r) =>
    new Date(r.date).toLocaleDateString('fr-FR', { day: '2-digit', month: 'short' })
  );
  const values = ordered.map((r) => r.count);
  const total = values.reduce((a, b) => a + b, 0);
  const first = values[0] || 0;
  const last = values[values.length - 1] || 0;
  const deltaPct = first ? Math.round(((last - first) / first) * 100) : 0;

  return { range, labels, values, total, deltaPct };
}

module.exports = {
  getStats,
  getTrafficSources,
  getCountries,
  getProjects,
  addProject,
  getVisits
};
