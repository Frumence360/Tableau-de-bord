require('dotenv').config();
const bcrypt = require('bcryptjs');
const pool = require('./index');

async function provisionAdmin() {
  const username = process.env.ADMIN_USERNAME;
  const password = process.env.ADMIN_PASSWORD;
  if (!pool) throw new Error('DATABASE_URL est requis.');
  if (!username || !password || password === 'change-ce-mot-de-passe' || password.length < 12) {
    throw new Error('Définis ADMIN_USERNAME et un ADMIN_PASSWORD de 12 caractères minimum.');
  }

  const passwordHash = await bcrypt.hash(password, 12);
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const { rows } = await client.query(
      `INSERT INTO users (username, password_hash, is_active)
       VALUES ($1, $2, true)
       ON CONFLICT (username)
       DO UPDATE SET password_hash = EXCLUDED.password_hash,
                     token_version = users.token_version + 1,
                     is_active = true
       RETURNING id`,
      [username, passwordHash]
    );
    await client.query(
      `INSERT INTO user_roles (user_id, role)
       VALUES ($1, 'admin')
       ON CONFLICT (user_id) DO UPDATE SET role = EXCLUDED.role`,
      [rows[0].id]
    );
    await client.query('COMMIT');
    console.log(`Compte administrateur prêt : ${username}`);
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}

provisionAdmin()
  .then(() => pool.end())
  .catch(async (error) => {
    console.error(`Échec de création de l’administrateur : ${error.message}`);
    if (pool) await pool.end();
    process.exitCode = 1;
  });
