/**
 * Applique db/schema.sql sur la base pointée par DATABASE_URL.
 * Lance-le avec : npm run migrate
 */

require('dotenv').config();
const fs = require('fs');
const path = require('path');
const pool = require('./index');

async function migrate() {
  const sql = fs.readFileSync(path.join(__dirname, 'schema.sql'), 'utf8');
  await pool.query(sql);
  console.log('✔ Schéma appliqué avec succès.');
  await pool.end();
}

migrate().catch((err) => {
  console.error('❌ Échec de la migration :', err.message);
  process.exit(1);
});
