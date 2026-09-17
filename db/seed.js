/**
 * Remplit la base avec des données de démarrage (une seule fois, idempotent).
 * Lance-le avec : npm run seed (après npm run migrate)
 */

require('dotenv').config();
const bcrypt = require('bcryptjs');
const pool = require('./index');

async function seed() {
  // ---------- Utilisateur admin ----------
  const username = process.env.ADMIN_USERNAME || 'admin';
  const password = process.env.ADMIN_PASSWORD || 'change-ce-mot-de-passe';
  const { rows: existingUsers } = await pool.query(
    'SELECT id, password_hash FROM users WHERE username = $1', [username]
  );

  if (existingUsers.length === 0) {
    const hash = bcrypt.hashSync(password, 10);
    await pool.query(
      'INSERT INTO users (username, password_hash) VALUES ($1, $2)', [username, hash]
    );
    console.log(`✔ Utilisateur admin créé : ${username}`);
  } else if (!bcrypt.compareSync(password, existingUsers[0].password_hash)) {
    // Le mot de passe du .env a changé : on aligne la base pour éviter
    // le piège classique "j'ai modifié ADMIN_PASSWORD mais je ne peux plus me connecter".
    const hash = bcrypt.hashSync(password, 10);
    await pool.query('UPDATE users SET password_hash = $1 WHERE id = $2', [hash, existingUsers[0].id]);
    console.log(`✔ Mot de passe de "${username}" mis à jour depuis ADMIN_PASSWORD.`);
  } else {
    console.log(`— Utilisateur admin "${username}" existe déjà avec le bon mot de passe, rien à faire.`);
  }

  // ---------- Stats ----------
  const { rows: statsRows } = await pool.query('SELECT COUNT(*) AS n FROM stats');
  if (Number(statsRows[0].n) === 0) {
    const insertStat = 'INSERT INTO stats (key, label, value, currency, delta_pct) VALUES ($1,$2,$3,$4,$5)';
    await pool.query(insertStat, ['sitesWeb', 'Sites web', 24, null, 33]);
    await pool.query(insertStat, ['clients', 'Clients', 152, null, 18]);
    await pool.query(insertStat, ['commandes', 'Commandes', 89, null, 27]);
    await pool.query(insertStat, ['revenus', 'Revenus', 4850, 'USD', 41]);
    console.log('✔ Stats initiales insérées');
  }

  // ---------- Sources de trafic ----------
  const { rows: trafficRows } = await pool.query('SELECT COUNT(*) AS n FROM traffic_sources');
  if (Number(trafficRows[0].n) === 0) {
    const insertSource = 'INSERT INTO traffic_sources (label, pct, color, sort_order) VALUES ($1,$2,$3,$4)';
    await pool.query(insertSource, ['Recherche Google', 45, '#2f9bff', 1]);
    await pool.query(insertSource, ['Réseaux sociaux', 28, '#5b6bff', 2]);
    await pool.query(insertSource, ['Accès directs', 15, '#8b6bff', 3]);
    await pool.query(insertSource, ['Sites référents', 8, '#ff4fa3', 4]);
    await pool.query(insertSource, ['Autres', 4, '#c9d6ea', 5]);
    console.log('✔ Sources de trafic insérées');
  }

  // ---------- Pays ----------
  const { rows: countryRows } = await pool.query('SELECT COUNT(*) AS n FROM countries');
  if (Number(countryRows[0].n) === 0) {
    const insertCountry = 'INSERT INTO countries (code, label, pct, sort_order) VALUES ($1,$2,$3,$4)';
    await pool.query(insertCountry, ['fr', 'France', 32, 1]);
    await pool.query(insertCountry, ['ci', "Côte d'Ivoire", 18, 2]);
    await pool.query(insertCountry, ['ca', 'Canada', 12, 3]);
    await pool.query(insertCountry, ['be', 'Belgique', 8, 4]);
    await pool.query(insertCountry, [null, 'Autres', 30, 5]);
    console.log('✔ Pays insérés');
  }

  // ---------- Projets ----------
  const { rows: projectRows } = await pool.query('SELECT COUNT(*) AS n FROM projects');
  if (Number(projectRows[0].n) === 0) {
    const insertProject = 'INSERT INTO projects (title, status, date, thumb_gradient) VALUES ($1,$2,$3,$4)';
    await pool.query(insertProject, ['Site vitrine – Entreprise BTP', 'Livré', '2025-03-28', 'linear-gradient(135deg,#2a5fb0,#173a70)']);
    await pool.query(insertProject, ['Boutique en ligne – Mode', 'En cours', '2025-03-25', 'linear-gradient(135deg,#c98bd6,#7a4d9e)']);
    await pool.query(insertProject, ['Site institutionnel – ONG', 'Livré', '2025-03-22', 'linear-gradient(135deg,#3fa9d6,#1b5f8a)']);
    console.log('✔ Projets insérés');
  }

  // ---------- Visites (120 derniers jours) ----------
  const { rows: visitRows } = await pool.query('SELECT COUNT(*) AS n FROM daily_visits');
  if (Number(visitRows[0].n) === 0) {
    let base = 3000;
    const today = new Date();
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      for (let i = 119; i >= 0; i--) {
        const d = new Date(today);
        d.setDate(d.getDate() - i);
        base += Math.round(Math.sin((119 - i) / 6) * 700 + (Math.random() - 0.3) * 900);
        base = Math.max(500, base);
        await client.query(
          'INSERT INTO daily_visits (date, count) VALUES ($1, $2) ON CONFLICT (date) DO NOTHING',
          [d.toISOString().slice(0, 10), base]
        );
      }
      await client.query('COMMIT');
      console.log('✔ 120 jours de visites générés');
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    } finally {
      client.release();
    }
  }

  console.log('Terminé.');
  await pool.end();
}

seed().catch((err) => {
  console.error('❌ Échec du seed :', err.message);
  process.exit(1);
});
