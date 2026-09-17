/**
 * Frumence Maintenance — API du tableau de bord
 * ------------------------------------------------
 * Node.js / Express + PostgreSQL (pg) + auth JWT.
 * Sert l'API sous /api et le frontend statique dans /public.
 */

require('dotenv').config();
const express = require('express');
const cors = require('cors');
const path = require('path');
const rateLimit = require('express-rate-limit');

const queries = require('./db/queries');
const requireAuth = require('./middleware/auth');
const authRoutes = require('./routes/auth');

if (!process.env.JWT_SECRET) {
  console.error('❌ JWT_SECRET manquant. Copie .env.example en .env et remplis-le.');
  process.exit(1);
}

const app = express();
const PORT = process.env.PORT || 3000;

// Petit wrapper pour ne pas répéter try/catch sur chaque route async
const asyncRoute = (fn) => (req, res, next) => fn(req, res, next).catch(next);

app.use(cors());
app.use(express.json());

// Limite générale contre les abus sur l'API
app.use('/api', rateLimit({ windowMs: 60 * 1000, max: 120 }));

// Routes d'authentification (non protégées)
app.use('/api/auth', authRoutes);

// Toutes les routes /api/* suivantes nécessitent un token valide
app.use('/api', requireAuth);

app.get('/api/stats', asyncRoute(async (req, res) => {
  res.json(await queries.getStats());
}));

app.get('/api/visits', asyncRoute(async (req, res) => {
  res.json(await queries.getVisits(req.query.range || '30d'));
}));

app.get('/api/traffic-sources', asyncRoute(async (req, res) => {
  res.json(await queries.getTrafficSources());
}));

app.get('/api/countries', asyncRoute(async (req, res) => {
  res.json(await queries.getCountries());
}));

app.get('/api/projects', asyncRoute(async (req, res) => {
  res.json(await queries.getProjects());
}));

app.post('/api/projects', asyncRoute(async (req, res) => {
  const { title, status, date, thumbGradient } = req.body || {};
  if (!title || !status || !date) {
    return res.status(400).json({ error: 'title, status et date sont requis' });
  }
  res.status(201).json(await queries.addProject({ title, status, date, thumbGradient }));
}));

app.get('/api/dashboard', asyncRoute(async (req, res) => {
  const range = req.query.range || '30d';
  const [stats, visits, trafficSources, countries, projects] = await Promise.all([
    queries.getStats(),
    queries.getVisits(range),
    queries.getTrafficSources(),
    queries.getCountries(),
    queries.getProjects()
  ]);
  res.json({ stats, visits, trafficSources, countries, projects });
}));

// Fichiers statiques (frontend) — le HTML/CSS/JS lui-même reste public,
// ce sont les données servies par /api/* qui sont protégées par le token
app.use(express.static(path.join(__dirname, 'public')));

// Gestion d'erreur centralisée pour les routes async
app.use((err, req, res, next) => {
  console.error(err);
  res.status(500).json({ error: 'Erreur serveur' });
});

app.listen(PORT, () => {
  console.log(`Frumence Maintenance API démarrée sur http://localhost:${PORT}`);
});
