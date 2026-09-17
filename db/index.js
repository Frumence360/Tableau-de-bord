/**
 * Pool de connexions PostgreSQL, partagé par toute l'application.
 */

const { Pool } = require('pg');

if (!process.env.DATABASE_URL) {
  console.error('❌ DATABASE_URL manquant. Copie .env.example en .env et remplis-le.');
  process.exit(1);
}

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.PGSSL === 'true' ? { rejectUnauthorized: false } : false
});

pool.on('error', (err) => {
  console.error('Erreur inattendue sur une connexion PostgreSQL inactive', err);
});

module.exports = pool;
