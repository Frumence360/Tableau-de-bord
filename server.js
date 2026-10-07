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
const bcrypt = require('bcryptjs');
const rateLimit = require('express-rate-limit');
const crypto = require('crypto');

const queries = require('./db/queries');
const db = require('./db');
const imports = require('./db/imports');
const requireAuth = require('./middleware/auth');
const authRoutes = require('./routes/auth');

// ─── Tokens de téléchargement à usage unique ─────────────────────────────────
// Chaque token autorise UN seul téléchargement dans les 60 s qui suivent son
// émission. Seul le hash est stocké en base, partagé par les instances.
const EXPORT_TOKEN_TTL = 60 * 1000; // 60 s

function hashToken(token) {
  return crypto.createHash('sha256').update(token).digest('hex');
}

async function issueExportToken(userId, username) {
  const token = crypto.randomBytes(24).toString('hex');
  await db.query('DELETE FROM export_tokens WHERE expires_at <= now()');
  await db.query(
    `INSERT INTO export_tokens (token_hash, user_id, username, expires_at)
     VALUES ($1, $2, $3, now() + ($4 * interval '1 millisecond'))`,
    [hashToken(token), userId, username, EXPORT_TOKEN_TTL]
  );
  return token;
}

async function consumeExportToken(token) {
  const { rows } = await db.query(
    `DELETE FROM export_tokens
     WHERE token_hash = $1 AND expires_at > now()
     RETURNING user_id AS "userId", username`,
    [hashToken(token)]
  );
  return rows[0] || null;
}

const requireRole = (allowedRoles) => (req, res, next) => {
  if (!req.user) return res.status(401).json({ error: 'Authentification requise' });
  if (!allowedRoles.includes(req.user.role)) {
    return res.status(403).json({ error: 'Accès refusé : rôle insuffisant' });
  }
  next();
};

const requirePermission = (permission) => (req, res, next) => {
  if (!queries.getRolePermissions(req.user.role).includes(permission)) {
    return res.status(403).json({ error: `Permission requise : ${permission}` });
  }
  next();
};

if (!process.env.JWT_SECRET) {
  console.error('❌ JWT_SECRET manquant. Copie .env.example en .env et remplis-le.');
  process.exit(1);
}

const app = express();
const PORT = process.env.PORT || 3000;

// Petit wrapper pour ne pas répéter try/catch sur chaque route async
const asyncRoute = (fn) => (req, res, next) => fn(req, res, next).catch(next);

// ─── En-têtes de sécurité HTTP ────────────────────────────────────────────────
// Appliqués à toutes les réponses, y compris les fichiers statiques.
app.use((req, res, next) => {
  // Empêche l'intégration de la page dans un <iframe> (clickjacking)
  res.setHeader('X-Frame-Options', 'DENY');
  // Bloque le sniffing de type MIME par le navigateur
  res.setHeader('X-Content-Type-Options', 'nosniff');
  // Referrer limité à l'origine
  res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
  // Désactive les fonctionnalités sensibles non utilisées
  res.setHeader('Permissions-Policy', 'camera=(), microphone=(), geolocation=()');
  // CSP : sources de scripts/styles explicitement limitées
  res.setHeader(
    'Content-Security-Policy',
    [
      "default-src 'self'",
      // Chart.js via CDN autorisé explicitement
      "script-src 'self' https://cdnjs.cloudflare.com",
      // Les styles inline (style="…") et les variables CSS sont nécessaires
      "style-src 'self' 'unsafe-inline'",
      // Drapeaux nationaux via flagcdn.com
      "img-src 'self' data: https://flagcdn.com",
      "connect-src 'self'",
      "font-src 'self'",
      "object-src 'none'",
      "base-uri 'self'",
      "frame-ancestors 'none'"
    ].join('; ')
  );
  next();
});

const configuredOrigins = (process.env.ALLOWED_ORIGINS || 'http://localhost:3000,http://127.0.0.1:3000')
  .split(',')
  .map((origin) => origin.trim())
  .filter(Boolean);
const vercelOrigins = ['VERCEL_URL', 'VERCEL_PROJECT_PRODUCTION_URL']
  .map((name) => process.env[name])
  .filter(Boolean)
  .map((host) => `https://${host}`);
const allowedOrigins = new Set([...configuredOrigins, ...vercelOrigins]);

app.use(cors({
  origin(origin, callback) {
    if (!origin || allowedOrigins.has(origin)) {
      return callback(null, true);
    }
    return callback(new Error('Origin not allowed by CORS'));
  },
  credentials: false
}));
app.use(express.json({ limit: '1mb' }));

// ─── Rate limiters ────────────────────────────────────────────────────────────
// Limite générale contre les abus sur l'API
app.use('/api', rateLimit({ windowMs: 60 * 1000, max: 120 }));

// Export CSV : maximum 5 émissions de token par minute par IP
const exportRateLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 5,
  message: { error: 'Trop de demandes d\'export. Réessaie dans une minute.' }
});

// Écritures (POST/PUT/DELETE) : budget plus serré que la lecture, car elles
// écrivent en base et déclenchent des audits.
const writeLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 30,
  message: { error: 'Trop de modifications. Réessaie dans une minute.' }
});

// Imports de lots : très coûteux (parse + transaction d'insertion). 5 par minute.
const importLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 5,
  message: { error: 'Trop d\'imports. Réessaie dans une minute.' }
});

// Administration (création/activation/rôle/mot de passe des comptes) : 10/min.
const adminLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 10,
  message: { error: 'Trop de requêtes d\'administration. Réessaie dans une minute.' }
});

// Routes d'authentification (non protégées sauf /me et /change-password)
app.use('/api/auth', authRoutes);

// Toutes les routes /api/* suivantes nécessitent un token valide
app.use('/api', requireAuth);

// ─── Stats & Dashboard ────────────────────────────────────────────────────────

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

// ─── Indicateurs de pilotage ───────────────────────────────────────────────────
// Remplacent les statistiques génériques par des indicateurs calculés sur les
// fiches réellement collectées, leurs anomalies et leur archivage.

app.get('/api/indicators', requirePermission('read'), asyncRoute(async (req, res) => {
  res.json(await queries.getWorkIndicators(req.query.range || '30d'));
}));

app.get('/api/dashboard', asyncRoute(async (req, res) => {
  const range = req.query.range || '30d';
  const [stats, visits, trafficSources, countries, projects, indicators] = await Promise.all([
    queries.getStats(),
    queries.getVisits(range),
    queries.getTrafficSources(),
    queries.getCountries(),
    queries.getProjects(),
    queries.getWorkIndicators(range)
  ]);
  res.json({ stats, visits, trafficSources, countries, projects, indicators });
}));

// ─── Projets ──────────────────────────────────────────────────────────────────

app.get('/api/projects', asyncRoute(async (req, res) => {
  res.json(await queries.getProjects());
}));

app.post('/api/projects', writeLimiter, requirePermission('write'), asyncRoute(async (req, res) => {
  const validation = queries.validateProjectPayload(req.body || {});
  if (!validation.valid) {
    return res.status(400).json({ error: validation.error });
  }
  res.status(201).json(await queries.addProject(validation.value));
}));

app.put('/api/projects/:id', writeLimiter, requirePermission('write'), asyncRoute(async (req, res) => {
  const id = parseInt(req.params.id, 10);
  if (!id) return res.status(400).json({ error: 'ID invalide' });

  const validation = queries.validateProjectPayload(req.body || {});
  if (!validation.valid) {
    return res.status(400).json({ error: validation.error });
  }

  const updated = await queries.updateProject(id, validation.value);
  if (!updated) return res.status(404).json({ error: 'Projet introuvable' });
  res.json(updated);
}));

app.delete('/api/projects/:id', writeLimiter, requirePermission('write'), asyncRoute(async (req, res) => {
  const id = parseInt(req.params.id, 10);
  if (!id) return res.status(400).json({ error: 'ID invalide' });
  const deleted = await queries.deleteProject(id);
  if (!deleted) return res.status(404).json({ error: 'Projet introuvable' });
  res.json({ success: true });
}));

// ─── Clients ──────────────────────────────────────────────────────────────────

app.get('/api/clients', asyncRoute(async (req, res) => {
  res.json(await queries.getClients());
}));

// ─── Commandes ────────────────────────────────────────────────────────────────

app.get('/api/orders', asyncRoute(async (req, res) => {
  res.json(await queries.getOrders());
}));

// ─── Messages ─────────────────────────────────────────────────────────────────

app.get('/api/messages', asyncRoute(async (req, res) => {
  res.json(await queries.getMessages());
}));

app.post('/api/messages/read-all', writeLimiter, requirePermission('write'), asyncRoute(async (req, res) => {
  await queries.markAllMessagesRead();
  res.json({ success: true });
}));

// ─── Données capturées ───────────────────────────────────────────────────────

// Pagination + filtres côté serveur : ?page=&limit=&status=&source=&category=&search=
// Réponse : { items, page, limit, total, totalPages }
app.get('/api/records', asyncRoute(async (req, res) => {
  res.json(await queries.getRecordsPage(req.query));
}));

app.get('/api/validation/rules', requirePermission('read'), asyncRoute(async (req, res) => {
  res.json(await queries.getValidationRules());
}));

app.put('/api/validation/rules', writeLimiter, requirePermission('manage_users'), asyncRoute(async (req, res) => {
  const { requireCategory, detectDuplicateReferences, rejectNegativeQuantity, rejectNegativeValue, maxNotesLength } = req.body || {};
  const flags = [requireCategory, detectDuplicateReferences, rejectNegativeQuantity, rejectNegativeValue];
  if (flags.some((value) => typeof value !== 'boolean') ||
      !Number.isInteger(maxNotesLength) || maxNotesLength < 1 || maxNotesLength > 5000) {
    return res.status(400).json({ error: 'Règles invalides : indique des options booléennes et une longueur entre 1 et 5000.' });
  }

  const rules = await queries.updateValidationRules({
    requireCategory,
    detectDuplicateReferences,
    rejectNegativeQuantity,
    rejectNegativeValue,
    maxNotesLength
  });
  await queries.addAuditLog({
    userId: req.user.id,
    username: req.user.username,
    action: 'validation_rules_update',
    entity: 'validation_rules',
    details: rules
  });
  res.json(rules);
}));

app.post('/api/records', writeLimiter, requirePermission('write'), asyncRoute(async (req, res) => {
  const { source, reference, title, category, status, quantity, value, notes } = req.body || {};
  if (typeof title !== 'string' || !title.trim() || typeof source !== 'string' || !source.trim()) {
    return res.status(400).json({ error: 'source et title sont requis' });
  }
  const normalizedQuantity = quantity === undefined || quantity === null || quantity === '' ? 0 : Number(quantity);
  const normalizedValue = value === undefined || value === null || value === '' ? null : Number(value);
  if (!Number.isInteger(normalizedQuantity)) {
    return res.status(400).json({ error: 'La quantité doit être un nombre entier.' });
  }
  if (normalizedValue !== null && !Number.isFinite(normalizedValue)) {
    return res.status(400).json({ error: 'La valeur doit être un nombre valide.' });
  }
  res.status(201).json(await queries.addRecord({ source, reference, title, category, status, quantity, value, notes }));
}));

const MAX_RECORD_ATTACHMENT_BYTES = 10 * 1024 * 1024;

app.get('/api/records/:id/attachments', requirePermission('read'), asyncRoute(async (req, res) => {
  const recordId = Number(req.params.id);
  if (!Number.isInteger(recordId) || recordId < 1) {
    return res.status(400).json({ error: 'ID de fiche invalide.' });
  }
  res.json(await queries.getRecordAttachments(recordId));
}));

app.post(
  '/api/records/:id/attachments',
  writeLimiter,
  requirePermission('write'),
  express.raw({ type: 'application/octet-stream', limit: MAX_RECORD_ATTACHMENT_BYTES }),
  asyncRoute(async (req, res) => {
    const recordId = Number(req.params.id);
    if (!Number.isInteger(recordId) || recordId < 1) {
      return res.status(400).json({ error: 'ID de fiche invalide.' });
    }
    if (!Buffer.isBuffer(req.body) || req.body.length === 0) {
      return res.status(400).json({ error: 'Le fichier est vide ou absent.' });
    }

    let fileName;
    try {
      fileName = decodeURIComponent(req.get('X-File-Name') || '');
    } catch {
      return res.status(400).json({ error: 'Nom de fichier invalide.' });
    }
    fileName = path.basename(fileName.replace(/[\\/]/g, path.sep))
      .replace(/[\u0000-\u001f\u007f]/g, '').trim();
    if (!fileName || Buffer.byteLength(fileName, 'utf8') > 255) {
      return res.status(400).json({ error: 'Le nom du fichier est requis et limité à 255 octets.' });
    }

    const { rows: matchingRecords } = await require('./db').query(
      'SELECT id FROM data_records WHERE id = $1',
      [recordId]
    );
    if (!matchingRecords.length) {
      return res.status(404).json({ error: 'Fiche introuvable.' });
    }

    const attachment = await queries.addRecordAttachment({
      recordId,
      fileName,
      content: req.body,
      uploadedBy: req.user.username
    });
    await queries.addAuditLog({
      userId: req.user.id,
      username: req.user.username,
      action: 'record_attachment_upload',
      entity: 'record_attachment',
      details: { recordId, attachmentId: attachment.id, fileName, fileSize: attachment.fileSize }
    });
    res.status(201).json(attachment);
  })
);

app.get('/api/records/:id/attachments/:attachmentId/download', requirePermission('read'), asyncRoute(async (req, res) => {
  const recordId = Number(req.params.id);
  const attachmentId = Number(req.params.attachmentId);
  if (!Number.isInteger(recordId) || recordId < 1 || !Number.isInteger(attachmentId) || attachmentId < 1) {
    return res.status(400).json({ error: 'ID de fiche ou de pièce jointe invalide.' });
  }

  const attachment = await queries.getRecordAttachment(recordId, attachmentId);
  if (!attachment) return res.status(404).json({ error: 'Pièce jointe introuvable.' });

  res.setHeader('Content-Type', 'application/octet-stream');
  res.setHeader('Content-Length', attachment.fileSize);
  res.setHeader('Content-Disposition', `attachment; filename*=UTF-8''${encodeURIComponent(attachment.fileName)}`);
  res.setHeader('Cache-Control', 'no-store');
  res.send(attachment.content);
}));

// Anomalies paginées + filtrées : ?page=&limit=&status=&source=&severity=
app.get('/api/validation/issues', asyncRoute(async (req, res) => {
  res.json(await queries.getValidationIssuesPage(req.query));
}));

app.put('/api/records/:id/status', writeLimiter, requirePermission('validate'), asyncRoute(async (req, res) => {
  const id = Number(req.params.id);
  const { status } = req.body || {};
  if (!id || !status) {
    return res.status(400).json({ error: 'id et status requis' });
  }
  const updated = await queries.updateRecordStatus(id, status, {
    correctedBy: req.user && req.user.username,
    reason: (req.body || {}).reason || 'Mise à jour du statut'
  });
  if (!updated) {
    return res.status(404).json({ error: 'Donnée introuvable' });
  }
  res.json(updated);
}));

const RECORD_UPDATE_FIELDS = ['source', 'reference', 'title', 'category', 'status', 'quantity', 'value', 'notes'];

app.put('/api/records/:id', writeLimiter, requirePermission('write'), asyncRoute(async (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id) || id < 1) {
    return res.status(400).json({ error: 'id requis' });
  }

  const body = req.body || {};
  const canValidateStatus = queries.getRolePermissions(req.user.role).includes('validate');
  if (Object.prototype.hasOwnProperty.call(body, 'status') && !canValidateStatus) {
    return res.status(403).json({ error: 'Permission requise : validate' });
  }

  const patch = {};
  for (const field of RECORD_UPDATE_FIELDS) {
    if (Object.prototype.hasOwnProperty.call(body, field)) patch[field] = body[field];
  }
  if (Object.keys(patch).length === 0) {
    return res.status(400).json({ error: 'Aucun champ à modifier.' });
  }
  if (patch.title !== undefined && (typeof patch.title !== 'string' || !patch.title.trim())) {
    return res.status(400).json({ error: 'Le titre est obligatoire.' });
  }
  if (patch.source !== undefined && (typeof patch.source !== 'string' || !patch.source.trim())) {
    return res.status(400).json({ error: 'La source est obligatoire.' });
  }

  const reason = typeof body.reason === 'string' ? body.reason.trim() : '';
  const correctedBy = (typeof body.correctedBy === 'string' && body.correctedBy.trim())
    || (req.user && req.user.username)
    || 'system';

  const result = await queries.updateRecord(id, patch, { correctedBy, reason, canValidateStatus });
  if (!result) {
    return res.status(404).json({ error: 'Donnée introuvable' });
  }
  if (result.error === 'invalid_status') {
    return res.status(400).json({ error: 'Statut invalide.' });
  }
  if (result.error === 'invalid_quantity') {
    return res.status(400).json({ error: 'La quantité doit être un nombre entier.' });
  }
  if (result.error === 'invalid_value') {
    return res.status(400).json({ error: 'La valeur doit être un nombre valide.' });
  }

  await queries.addAuditLog({
    userId: req.user && req.user.id,
    username: req.user && req.user.username,
    action: 'record_update',
    entity: 'data_record',
    details: {
      recordId: id,
      correctedBy,
      reason: reason || null,
      changes: result.changes
    }
  });

  res.json({
    ...result.record,
    changes: result.changes,
    validationIssues: result.validationIssues
  });
}));

app.post('/api/records/:id/correction', writeLimiter, requirePermission('write'), asyncRoute(async (req, res) => {
  const id = Number(req.params.id);
  const { correctedBy, fieldName, oldValue, newValue, reason } = req.body || {};
  if (!id) {
    return res.status(400).json({ error: 'id requis' });
  }
  const correction = await queries.addCorrection({ recordId: id, correctedBy, fieldName, oldValue, newValue, reason });
  await queries.addAuditLog({
    userId: req.user && req.user.id,
    username: req.user && req.user.username,
    action: 'anomaly_correction',
    entity: 'data_record',
    details: { recordId: id, correctedBy, fieldName, reason }
  });
  res.status(201).json(correction);
}));

app.get('/api/corrections', asyncRoute(async (req, res) => {
  res.json(await queries.getCorrections());
}));

app.get('/api/archives', asyncRoute(async (req, res) => {
  res.json(await queries.getArchives());
}));

app.post('/api/records/:id/archive', writeLimiter, requirePermission('archive'), asyncRoute(async (req, res) => {
  const id = Number(req.params.id);
  const { archiveCode, classification, confidentiality, retentionYears, archivedBy, reason } = req.body || {};
  if (!id) {
    return res.status(400).json({ error: 'id requis' });
  }

  const archived = await queries.archiveRecord({
    recordId: id,
    archiveCode,
    classification,
    confidentiality,
    retentionYears,
    archivedBy,
    reason
  });

  if (!archived) {
    return res.status(404).json({ error: 'Donnée introuvable' });
  }

  await queries.addAuditLog({
    userId: req.user && req.user.id,
    username: req.user && req.user.username,
    action: 'archive',
    entity: 'data_record',
    details: { recordId: id, archiveCode: archived.archiveCode, classification, confidentiality }
  });

  res.status(201).json(archived);
}));

app.get('/api/reports/data', asyncRoute(async (req, res) => {
  const [records, archives] = await Promise.all([
    queries.getRecords(),
    queries.getArchives()
  ]);

  const report = queries.buildDataReport(records, archives);
  res.json(report);
}));

// ─── Export CSV sécurisé : token à usage unique ──────────────────────────────
//
// Flux en deux étapes :
//   1. Le frontend (authentifié par JWT) appelle POST /api/exports/token → reçoit
//      un token hexadécimal de 48 car., valable 60 s, à usage unique.
//   2. Le frontend ouvre GET /api/exports/data.csv?token=<token> en tant que lien
//      de téléchargement. Aucun JWT dans l'URL, pas d'historique de navigateur
//      avec des credentials. Le token est consommé (supprimé) à la première use.

app.post('/api/exports/token', exportRateLimiter, requirePermission('export'), asyncRoute(async (req, res) => {
  const token = await issueExportToken(req.user.id, req.user.username);
  res.json({ token, expiresIn: EXPORT_TOKEN_TTL / 1000 });
}));

// Route de téléchargement : pas de requireAuth (le token fait office de credential)
app.get('/api/exports/data.csv', asyncRoute(async (req, res) => {
  const meta = await consumeExportToken(req.query.token || '');
  if (!meta) {
    return res.status(401).json({ error: 'Token d\'export invalide ou expiré.' });
  }

  const records = await queries.getRecords();
  const csv = queries.generateRecordsCsv(records);

  await queries.addAuditLog({
    userId: meta.userId,
    username: meta.username,
    action: 'export',
    entity: 'data_records',
    details: { count: records.length }
  });

  res.setHeader('Content-Type', 'text/csv; charset=utf-8');
  res.setHeader('Content-Disposition', 'attachment; filename="frumence-donnees.csv"');
  // Empêche le navigateur et les proxies de mettre le CSV en cache
  res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate');
  res.setHeader('Pragma', 'no-cache');
  res.send(csv);
}));

// L'ancienne route /api/reports/data/export.csv a été supprimée : elle exigeait
// l'en-tête Authorization, qu'un <a href> ou un lien de téléchargement n'envoie
// jamais. Elle était donc inutilisable depuis le navigateur tout en exposant une
// surface d'export non journalisée côté client. Le flux à token ci-dessus la
// remplace entièrement.
//
// ⚠️ Choix assumé : le token transite dans l'URL, ce qui l'expose à l'historique
// du navigateur, aux logs d'accès du serveur et à l'en-tête Referer. C'est
// accepté parce que le token est à USAGE UNIQUE et expire en 60 s : la fenêtre
// d'exposition est étroite et le secret est consommé dès le premier téléchargement.
// L'alternative (fetch + Authorization puis Blob côté client) supprime l'URL mais
// charge le CSV entier en mémoire JS. À reconsidérer si la taille des exports
// devient importante.

app.get('/api/security/roles/:userId', asyncRoute(async (req, res) => {
  const userId = Number(req.params.userId);
  if (!userId) return res.status(400).json({ error: 'userId requis' });
  res.json({ role: await queries.getUserRole(userId) });
}));

app.get('/api/security/audit', requireRole(['admin', 'manager']), asyncRoute(async (req, res) => {
  res.json(await queries.getAuditLogs());
}));

app.get('/api/users', requireRole(['admin', 'manager']), asyncRoute(async (req, res) => {
  res.json(await queries.getUsers());
}));

app.post('/api/users', adminLimiter, requireRole(['admin']), asyncRoute(async (req, res) => {
  const { username, password, role = 'capturer' } = req.body || {};
  const normalizedUsername = typeof username === 'string' ? username.trim() : '';
  const allowedRoles = ['admin', 'manager', 'capturer', 'viewer'];

  if (!/^[a-zA-Z0-9._-]{3,32}$/.test(normalizedUsername)) {
    return res.status(400).json({ error: 'Le nom doit contenir 3 à 32 caractères (lettres, chiffres, point, tiret ou underscore).' });
  }
  if (typeof password !== 'string' || password.length < 8) {
    return res.status(400).json({ error: 'Le mot de passe doit contenir au moins 8 caractères.' });
  }
  if (!allowedRoles.includes(role)) {
    return res.status(400).json({ error: 'Rôle invalide.' });
  }

  try {
    const passwordHash = await bcrypt.hash(password, 10);
    const user = await queries.addUser({ username: normalizedUsername, passwordHash, role });
    await queries.addAuditLog({
      userId: req.user.id,
      username: req.user.username,
      action: 'user_create',
      entity: 'user',
      details: { targetUserId: user.id, role }
    });
    res.status(201).json(user);
  } catch (err) {
    if (err.code === '23505') {
      return res.status(409).json({ error: 'Ce nom d’utilisateur existe déjà.' });
    }
    throw err;
  }
}));

app.put('/api/users/:id/password', adminLimiter, requireRole(['admin']), asyncRoute(async (req, res) => {
  const userId = Number(req.params.id);
  const { password } = req.body || {};
  if (!Number.isInteger(userId) || userId < 1) {
    return res.status(400).json({ error: 'ID utilisateur invalide.' });
  }
  if (userId === Number(req.user.id)) {
    return res.status(400).json({ error: 'Utilise les paramètres du compte pour changer ton propre mot de passe.' });
  }
  if (typeof password !== 'string' || password.length < 8) {
    return res.status(400).json({ error: 'Le mot de passe doit contenir au moins 8 caractères.' });
  }

  const passwordHash = await bcrypt.hash(password, 10);
  const user = await queries.resetUserPassword(userId, passwordHash);
  if (!user) return res.status(404).json({ error: 'Utilisateur introuvable.' });
  await queries.addAuditLog({
    userId: req.user.id,
    username: req.user.username,
    action: 'user_password_reset',
    entity: 'user',
    details: { targetUserId: user.id }
  });
  res.json({ success: true });
}));

app.put('/api/users/:id/status', adminLimiter, requireRole(['admin']), asyncRoute(async (req, res) => {
  const userId = Number(req.params.id);
  const { active } = req.body || {};
  if (!Number.isInteger(userId) || userId < 1 || typeof active !== 'boolean') {
    return res.status(400).json({ error: 'ID utilisateur et état actif valide requis.' });
  }
  if (!active && userId === Number(req.user.id)) {
    return res.status(400).json({ error: 'Tu ne peux pas désactiver ton propre compte.' });
  }

  const user = await queries.setUserActive(userId, active);
  if (!user) return res.status(404).json({ error: 'Utilisateur introuvable.' });
  if (user.error === 'last_admin') {
    return res.status(409).json({ error: 'Impossible de retirer le dernier administrateur actif.' });
  }
  await queries.addAuditLog({
    userId: req.user.id,
    username: req.user.username,
    action: active ? 'user_activate' : 'user_deactivate',
    entity: 'user',
    details: { targetUserId: user.id }
  });
  res.json(user);
}));

app.put('/api/users/:id/role', adminLimiter, requireRole(['admin']), asyncRoute(async (req, res) => {
  const userId = Number(req.params.id);
  const { role } = req.body || {};
  if (!userId || !role) {
    return res.status(400).json({ error: 'userId et role requis' });
  }
  if (!['admin', 'manager', 'capturer', 'viewer'].includes(role)) {
    return res.status(400).json({ error: 'Rôle invalide.' });
  }

  const updated = await queries.setUserRole(userId, role);
  if (updated && updated.error === 'last_admin') {
    return res.status(409).json({ error: 'Impossible de retirer le rôle du dernier administrateur actif.' });
  }
  if (!updated) {
    return res.status(404).json({ error: 'Utilisateur introuvable' });
  }

  await queries.addAuditLog({
    userId: req.user.id,
    username: req.user.username,
    action: 'role_update',
    entity: 'user',
    details: { targetUserId: userId, role }
  });

  res.json(updated);
}));

// ─── Import de lots CSV / Excel ──────────────────────────────────────────────
// Le fichier est envoyé en base64 dans le JSON (pas de dépendance multer) puis
// conservé brièvement en base pour fonctionner sur les instances serverless.

const IMPORT_SESSION_TTL = 30 * 60 * 1000; // 30 minutes
const MAX_IMPORT_FILE_BYTES = 10 * 1024 * 1024;

async function cleanupImportSessions() {
  await db.query(
    `DELETE FROM import_sessions
     WHERE created_at <= now() - ($1 * interval '1 millisecond')`,
    [IMPORT_SESSION_TTL]
  );
}

async function newImportSession(session) {
  await cleanupImportSessions();
  const token = `imp_${Date.now().toString(36)}_${crypto.randomBytes(12).toString('hex')}`;
  await db.query(
    'INSERT INTO import_sessions (token, payload) VALUES ($1, $2::jsonb)',
    [token, JSON.stringify(session)]
  );
  return token;
}

async function getImportSession(token) {
  const { rows } = await db.query(
    `SELECT payload
     FROM import_sessions
     WHERE token = $1
       AND created_at > now() - ($2 * interval '1 millisecond')`,
    [token, IMPORT_SESSION_TTL]
  );
  return rows[0] ? rows[0].payload : null;
}

async function updateImportSession(token, session) {
  const result = await db.query(
    `UPDATE import_sessions
     SET payload = $2::jsonb
     WHERE token = $1
       AND created_at > now() - ($3 * interval '1 millisecond')`,
    [token, JSON.stringify(session), IMPORT_SESSION_TTL]
  );
  return result.rowCount > 0;
}

/** Clés (source, référence) déjà en base, pour la détection de doublons. */
async function loadExistingReferenceKeys(client = null) {
  const runner = client
    ? (sql) => client.query(sql)
    : (sql) => require('./db').query(sql);
  const { rows } = await runner(
    `SELECT LOWER(BTRIM(source)) AS source, LOWER(BTRIM(reference)) AS reference
     FROM data_records WHERE reference IS NOT NULL`
  );
  return new Set(rows.map((r) => JSON.stringify([r.source, r.reference])));
}

async function buildPlanForSession(session, mapping) {
  const rules = await queries.getValidationRules();
  return imports.buildImportPlan(session.rows, mapping, {
    existingKeys: await loadExistingReferenceKeys(),
    rules
  });
}

app.post('/api/imports/preview', importLimiter, requirePermission('write'), asyncRoute(async (req, res) => {
  const { filename = 'import.csv', content } = req.body || {};
  if (typeof content !== 'string' || !content.trim()) {
    return res.status(400).json({ error: 'Aucun fichier reçu.' });
  }

  const buffer = Buffer.from(content, 'base64');
  if (buffer.length > MAX_IMPORT_FILE_BYTES) {
    return res.status(413).json({ error: 'Fichier trop volumineux (10 Mo maximum).' });
  }

  let parsed;
  try {
    parsed = imports.parseImportFile(buffer, filename);
  } catch (err) {
    return res.status(err.status || 400).json({ error: err.message });
  }

  const mapping = imports.suggestMapping(parsed.headers);
  const token = await newImportSession({
    filename,
    headers: parsed.headers,
    rows: parsed.rows,
    mapping,
    createdAt: Date.now()
  });

  res.json({
    token,
    filename,
    headers: parsed.headers,
    totalRows: parsed.totalRows,
    preview: parsed.rows.slice(0, imports.PREVIEW_ROWS),
    suggestedMapping: mapping,
    fields: imports.IMPORT_FIELDS,
    mappingErrors: imports.validateMapping(mapping, parsed.headers)
  });
}));

app.post('/api/imports/validate', importLimiter, requirePermission('write'), asyncRoute(async (req, res) => {
  const { token, mapping } = req.body || {};
  const session = await getImportSession(token);
  if (!session) {
    return res.status(404).json({ error: 'Session d’import expirée. Recharge le fichier.' });
  }
  if (mapping && typeof mapping === 'object') {
    const errors = imports.validateMapping(mapping, session.headers);
    if (errors.length) {
      return res.status(400).json({ error: 'Association des colonnes invalide.', mappingErrors: errors });
    }
    session.mapping = mapping;
    if (!await updateImportSession(token, session)) {
      return res.status(404).json({ error: 'Session d’import expirée. Recharge le fichier.' });
    }
  }

  const plan = await buildPlanForSession(session, session.mapping);
  res.json({
    summary: plan.summary,
    mapping: session.mapping,
    validRows: plan.rows.slice(0, imports.PREVIEW_ROWS).map((entry) => ({
      line: entry.line,
      ...entry.record
    })),
    errors: plan.errors.slice(0, 200),
    warnings: plan.warnings.slice(0, 200)
  });
}));

app.post('/api/imports/commit', importLimiter, requirePermission('write'), asyncRoute(async (req, res) => {
  const { token, skipInvalid = true } = req.body || {};
  const session = await getImportSession(token);
  if (!session) {
    return res.status(404).json({ error: 'Session d’import expirée. Recharge le fichier.' });
  }

  const plan = await buildPlanForSession(session, session.mapping);
  if (!plan.rows.length) {
    return res.status(422).json({
      error: 'Aucune ligne valide à importer.',
      report: { imported: 0, skipped: 0, failed: plan.errors.length, errors: plan.errors.slice(0, 200) }
    });
  }
  if (plan.errors.length && !skipInvalid) {
    return res.status(422).json({
      error: `${plan.errors.length} ligne(s) en erreur. Corrige-les ou importe malgré tout.`,
      errors: plan.errors.slice(0, 200)
    });
  }

  const pool = require('./db');
  const client = await pool.connect();
  let report;
  try {
    await client.query('BEGIN');
    report = await imports.insertImportPlan(client, plan, {
      evaluateRecordValidation: queries.evaluateRecordValidation,
      DEFAULT_VALIDATION_RULES: {
        requireCategory: true, detectDuplicateReferences: true,
        rejectNegativeQuantity: true, rejectNegativeValue: true, maxNotesLength: 300
      }
    });
    await client.query(
      `INSERT INTO data_corrections (record_id, corrected_by, field_name, old_value, new_value, reason)
       SELECT id, $1, 'import', NULL, $2, $3
       FROM data_records
       WHERE id = ANY($4::int[])`,
      [
        (req.user && req.user.username) || 'system',
        `${report.imported} ligne(s)`,
        `Import du fichier ${session.filename}`,
        report.items.map((item) => item.id)
      ]
    );
    await client.query('COMMIT');
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }

  // La session a été consommée : on repart d'un fichier neuf.
  await db.query('DELETE FROM import_sessions WHERE token = $1', [token]);

  await queries.addAuditLog({
    userId: req.user && req.user.id,
    username: req.user && req.user.username,
    action: 'records_import',
    entity: 'data_records',
    details: {
      filename: session.filename,
      imported: report.imported,
      skipped: report.skipped,
      failed: report.failed
    }
  });

  res.status(201).json({
    ...report,
    planErrors: plan.errors.slice(0, 200),
    items: report.items.slice(0, 200)
  });
}));

// ─── Fichiers statiques ───────────────────────────────────────────────────────
// Express les sert en local. Sur Vercel, public/ est servi par le CDN de la
// plateforme et express.static n'est pas utilisé pour les assets.

app.use(express.static(path.join(__dirname, 'public')));

// ─── Gestion d'erreur centralisée ─────────────────────────────────────────────

app.use((err, req, res, next) => {
  console.error(err);
  if (err.type === 'entity.too.large') {
    return res.status(413).json({ error: 'Le fichier dépasse la limite de 10 Mo.' });
  }
  res.status(500).json({ error: 'Erreur serveur' });
});

if (require.main === module) {
  app.listen(PORT, () => {
    console.log(`Frumence Maintenance API démarrée sur http://localhost:${PORT}`);
  });
}

module.exports = app;
