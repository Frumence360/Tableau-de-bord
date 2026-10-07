/**
 * Applique db/schema.sql sur la base PostgreSQL pointée par DATABASE_URL.
 * Lance-le avec : npm run migrate
 */

require('dotenv').config();
const fs = require('fs');
const path = require('path');
const pool = require('./index');

async function migrate() {
  // pg n'accepte pas plusieurs instructions en un seul appel — on découpe
  // le schéma sur les ";" de fin de statement.
  const sql = fs.readFileSync(path.join(__dirname, 'schema.sql'), 'utf8');
  const statements = sql
    .split(/;[ \t]*(?:\r?\n|$)/)
    .map((s) => s.trim())
    .filter(Boolean);

  for (const stmt of statements) {
    await pool.query(stmt);
  }

  // Bases déjà créées : CREATE TABLE IF NOT EXISTS n'ajoute pas les nouvelles colonnes.
  await pool.query(`
    ALTER TABLE users
    ADD COLUMN IF NOT EXISTS token_version INTEGER NOT NULL DEFAULT 1
  `);
  await pool.query(`
    ALTER TABLE users
    ADD COLUMN IF NOT EXISTS is_active BOOLEAN NOT NULL DEFAULT true
  `);

  console.log(`✔ Schéma appliqué avec succès (${statements.length} instructions).`);
  await pool.end();
}

migrate().catch((err) => {
  console.error('❌ Échec de la migration :', err.message);
  process.exit(1);
});
