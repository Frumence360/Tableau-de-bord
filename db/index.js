/**
 * Pool de connexions PostgreSQL (pg), partagé par toute l'application.
 * Utilise DATABASE_URL (format: postgres://user:pass@host:5432/db)
 * + PGSSL=true si l'hébergeur l'exige (Neon, Render, Railway…).
 */

require('dotenv').config();
const { Pool } = require('pg');

const connectionString = process.env.DATABASE_URL;

const pool = connectionString
  ? new Pool({
      connectionString,
      ssl: process.env.PGSSL === 'true' ? { rejectUnauthorized: false } : undefined
    })
  : null;

if (pool) {
  pool.on('error', (err) => {
    console.error('Erreur inattendue sur une connexion PostgreSQL inactive', err);
  });
} else {
  console.warn('⚠️ DATABASE_URL manquant. Le projet reste utilisable en mode utilitaire, mais PostgreSQL doit être configuré pour les requêtes de données.');
}

module.exports = pool;
