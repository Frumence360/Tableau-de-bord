/**
 * Remplit la base avec des données de démarrage (une seule fois, idempotent).
 * Lance-le avec : npm run seed (après npm run migrate)
 */

require('dotenv').config();
const bcrypt = require('bcryptjs');
const pool = require('./index');

async function seed() {

  // ─── Utilisateur admin ────────────────────────────────────────────────────
  const username = process.env.ADMIN_USERNAME || 'admin';
  const password = process.env.ADMIN_PASSWORD || 'change-ce-mot-de-passe';
  const { rows: existingUsers } = await pool.query(
    'SELECT id, password_hash FROM users WHERE username = $1', [username]
  );
  let adminUserId;
  if (existingUsers.length === 0) {
    const hash = bcrypt.hashSync(password, 10);
    const { rows: createdUsers } = await pool.query(
      'INSERT INTO users (username, password_hash) VALUES ($1, $2) RETURNING id', [username, hash]
    );
    adminUserId = createdUsers[0].id;
    console.log(`✔ Utilisateur admin créé : ${username}`);
  } else {
    const user = existingUsers[0];
    adminUserId = user.id;
    if (!bcrypt.compareSync(password, user.password_hash)) {
      const hash = bcrypt.hashSync(password, 10);
      await pool.query(
        'UPDATE users SET password_hash = $1, token_version = token_version + 1 WHERE id = $2',
        [hash, user.id]
      );
      console.log(`✔ Mot de passe admin mis à jour (sessions révoquées) : ${username}`);
    } else {
      console.log(`— Utilisateur admin "${username}" existe déjà, rien à faire.`);
    }
  }
  await pool.query(
    `INSERT INTO user_roles (user_id, role) VALUES ($1, 'admin')
     ON CONFLICT (user_id) DO UPDATE SET role = EXCLUDED.role`,
    [adminUserId]
  );

  // ─── Stats ────────────────────────────────────────────────────────────────
  const { rows: statsRows } = await pool.query('SELECT COUNT(*) AS n FROM stats');
  if (Number(statsRows[0].n) === 0) {
    const insertStat = 'INSERT INTO stats (key, label, value, currency, delta_pct) VALUES ($1,$2,$3,$4,$5)';
    await pool.query(insertStat, ['sitesWeb',   'Sites web',  24,   null,  33]);
    await pool.query(insertStat, ['clients',    'Clients',    152,  null,  18]);
    await pool.query(insertStat, ['commandes',  'Commandes',  89,   null,  27]);
    await pool.query(insertStat, ['revenus',    'Revenus',    4850, 'USD', 41]);
    console.log('✔ Stats initiales insérées');
  }

  // ─── Sources de trafic ────────────────────────────────────────────────────
  const { rows: trafficRows } = await pool.query('SELECT COUNT(*) AS n FROM traffic_sources');
  if (Number(trafficRows[0].n) === 0) {
    const insertSource = 'INSERT INTO traffic_sources (label, pct, color, sort_order) VALUES ($1,$2,$3,$4)';
    await pool.query(insertSource, ['Recherche Google', 45, '#2f9bff', 1]);
    await pool.query(insertSource, ['Réseaux sociaux',  28, '#5b6bff', 2]);
    await pool.query(insertSource, ['Accès directs',    15, '#8b6bff', 3]);
    await pool.query(insertSource, ['Sites référents',   8, '#ff4fa3', 4]);
    await pool.query(insertSource, ['Autres',            4, '#c9d6ea', 5]);
    console.log('✔ Sources de trafic insérées');
  }

  // ─── Pays ─────────────────────────────────────────────────────────────────
  const { rows: countryRows } = await pool.query('SELECT COUNT(*) AS n FROM countries');
  if (Number(countryRows[0].n) === 0) {
    const insertCountry = 'INSERT INTO countries (code, label, pct, sort_order) VALUES ($1,$2,$3,$4)';
    await pool.query(insertCountry, ['fr',  'France',         32, 1]);
    await pool.query(insertCountry, ['ci',  "Côte d'Ivoire",  18, 2]);
    await pool.query(insertCountry, ['ca',  'Canada',         12, 3]);
    await pool.query(insertCountry, ['be',  'Belgique',        8, 4]);
    await pool.query(insertCountry, [null,  'Autres',         30, 5]);
    console.log('✔ Pays insérés');
  }

  // ─── Projets ──────────────────────────────────────────────────────────────
  const { rows: projectRows } = await pool.query('SELECT COUNT(*) AS n FROM projects');
  if (Number(projectRows[0].n) === 0) {
    const insertProject = 'INSERT INTO projects (title, status, date, thumb_gradient) VALUES ($1,$2,$3,$4)';
    await pool.query(insertProject, ['Site vitrine – Entreprise BTP',  'Livré',    '2025-03-28', 'linear-gradient(135deg,#2a5fb0,#173a70)']);
    await pool.query(insertProject, ['Boutique en ligne – Mode',       'En cours', '2025-03-25', 'linear-gradient(135deg,#c98bd6,#7a4d9e)']);
    await pool.query(insertProject, ['Site institutionnel – ONG',      'Livré',    '2025-03-22', 'linear-gradient(135deg,#3fa9d6,#1b5f8a)']);
    console.log('✔ Projets insérés');
  }

  // ─── Visites (120 derniers jours) ─────────────────────────────────────────
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

  // ─── Clients ──────────────────────────────────────────────────────────────
  const { rows: clientRows } = await pool.query('SELECT COUNT(*) AS n FROM clients');
  if (Number(clientRows[0].n) === 0) {
    const insertClient = 'INSERT INTO clients (name, company, email, site, status) VALUES ($1,$2,$3,$4,$5)';
    await pool.query(insertClient, ['Jean Dupont',    'BTP Solutions',      'jean@btp.fr',        'btp-solutions.fr',    'Actif']);
    await pool.query(insertClient, ['Marie Koné',     'Mode & Style',       'marie@modestyle.ci', 'modestyle.ci',        'Actif']);
    await pool.query(insertClient, ['Paul Tremblay',  'ONG Espoir',         'paul@ong-espoir.ca', 'ong-espoir.ca',       'Actif']);
    await pool.query(insertClient, ['Sophie Martin',  'Cabinet Juridique',  'sophie@cabinet.be',  null,                  'Prospect']);
    await pool.query(insertClient, ['Amadou Diallo',  null,                 'amadou@gmail.com',   null,                  'Inactif']);
    console.log('✔ Clients insérés');
  }

  // ─── Commandes ────────────────────────────────────────────────────────────
  const { rows: orderRows } = await pool.query('SELECT COUNT(*) AS n FROM orders');
  if (Number(orderRows[0].n) === 0) {
    const insertOrder = 'INSERT INTO orders (ref, client_name, item, amount, status, date) VALUES ($1,$2,$3,$4,$5,$6)';
    await pool.query(insertOrder, ['CMD-001', 'Jean Dupont',   'Site vitrine',           1200, 'Payée',      '2025-03-28']);
    await pool.query(insertOrder, ['CMD-002', 'Marie Koné',    'Boutique en ligne',      2500, 'En attente', '2025-03-25']);
    await pool.query(insertOrder, ['CMD-003', 'Paul Tremblay', 'Site institutionnel',     800, 'Livrée',     '2025-03-22']);
    await pool.query(insertOrder, ['CMD-004', 'Sophie Martin', 'Maintenance mensuelle',   150, 'Payée',      '2025-03-15']);
    await pool.query(insertOrder, ['CMD-005', 'Amadou Diallo', 'Refonte site',           1800, 'Annulée',    '2025-03-10']);
    console.log('✔ Commandes insérées');
  }

  // ─── Messages ─────────────────────────────────────────────────────────────
  const { rows: msgRows } = await pool.query('SELECT COUNT(*) AS n FROM messages');
  if (Number(msgRows[0].n) === 0) {
    const insertMsg = 'INSERT INTO messages (sender, subject, body, is_read) VALUES ($1,$2,$3,$4)';
    await pool.query(insertMsg, ['Jean Dupont',   'Demande de devis',         'Bonjour, je souhaite un devis pour la refonte de mon site.',       false]);
    await pool.query(insertMsg, ['Marie Koné',    'Problème de connexion',    "Bonsoir, je n'arrive pas à accéder à mon espace client.",          false]);
    await pool.query(insertMsg, ['Paul Tremblay', 'Validation maquette',      'La maquette est approuvée, vous pouvez procéder au développement.', true]);
    await pool.query(insertMsg, ['Sophie Martin', 'Question facturation',     "Pourriez-vous m'envoyer la facture du dernier mois ?",              true]);
    console.log('✔ Messages insérés');
  }

  console.log('\n✅ Seed terminé avec succès.');
  await pool.end();
}

seed().catch((err) => {
  console.error('❌ Échec du seed :', err.message);
  process.exit(1);
});
