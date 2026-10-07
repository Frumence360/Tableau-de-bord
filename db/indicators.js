/**
 * Indicateurs de pilotage du travail réel
 * ---------------------------------------
 * Remplace les statistiques génériques (sites, clients, commandes, revenus) par
 * des indicateurs calculés sur les données réellement saisies :
 *
 *   - collecte    : volume saisi, période d'activité, sources, catégories
 *   - anomalies   : anomalies ouvertes, repartition par type, taux de traitement
 *   - validation  : taux de validation, statuts des fiches
 *   - archivage   : fiches archivées, classifications, durées de conservation
 *
 * Les fonctions pures (buildWorkIndicators et ses aides) ne dépendent pas de
 * PostgreSQL : elles sont testées dans tests/indicators.test.js. La couche SQL
 * vit dans db/queries.js (getWorkIndicators).
 */

const STATUSES = ['en_attente', 'valide', 'incomplet', 'rejete'];

/** Bornes d'une fenêtre glissante, en jours. */
function windowDays(range) {
  return range === '7d' ? 7 : range === '90d' ? 90 : 30;
}

function startOfWindow(range, now = new Date()) {
  const days = windowDays(range);
  const from = new Date(now.getTime());
  from.setDate(from.getDate() - days);
  return from;
}

function isWithin(value, from) {
  if (!value) return false;
  const time = new Date(value).getTime();
  return Number.isFinite(time) && time >= from.getTime();
}

/** Répartition en pourcentage, triée par effectif décroissant. */
function toShare(counts) {
  const entries = Object.entries(counts)
    .filter(([key]) => key)
    .map(([key, value]) => ({ label: key, count: value }));
  const total = entries.reduce((sum, entry) => sum + entry.count, 0);
  return entries
    .sort((a, b) => b.count - a.count || a.label.localeCompare(b.label, 'fr'))
    .map((entry) => ({
      ...entry,
      pct: total ? Math.round((entry.count / total) * 1000) / 10 : 0
    }));
}

/** Nombre de jours entre deux instants, arrondi à l'entier supérieur. */
function daysBetween(from, to) {
  if (!from || !to) return 0;
  const diff = new Date(to).getTime() - new Date(from).getTime();
  if (!Number.isFinite(diff) || diff <= 0) return 0;
  return Math.ceil(diff / (1000 * 60 * 60 * 24));
}

/**
 * Construit l'ensemble des indicateurs.
 *
 * @param records    fiches data_records
 * @param issues     anomalies de validation
 * @param corrections historique des corrections
 * @param archives   entrées d'archivage
 * @param options    { range, now }
 */
function buildWorkIndicators(records = [], issues = [], corrections = [], archives = [], options = {}) {
  const range = options.range || '30d';
  const now = options.now ? new Date(options.now) : new Date();
  const from = startOfWindow(range, now);

  // ─── Collecte ────────────────────────────────────────────────────────────────
  const inWindow = records.filter((record) => isWithin(record.createdAt, from));
  const previousWindowStart = new Date(from.getTime());
  previousWindowStart.setDate(previousWindowStart.getDate() - windowDays(range));
  const previousWindow = records.filter((record) => {
    const time = new Date(record.createdAt || 0).getTime();
    return Number.isFinite(time) && time >= previousWindowStart.getTime() && time < from.getTime();
  });

  // Une cadence d'activité : moyenne sur les jours réellement couverts, sinon
  // la fenêtre entière. Évite d'afficher « 0 / jour » sur un jeu de test récent.
  const firstCreated = records
    .map((record) => new Date(record.createdAt || 0).getTime())
    .filter(Number.isFinite)
    .sort((a, b) => a - b)[0];
  const activeSpan = Math.max(1, daysBetween(firstCreated, now));
  const perDay = inWindow.length ? Math.round((inWindow.length / activeSpan) * 10) / 10 : 0;

  const collection = {
    total: records.length,
    inWindow: inWindow.length,
    previousInWindow: previousWindow.length,
    perDay,
    activeDays: new Set(inWindow.map((record) => new Date(record.createdAt).toISOString().slice(0, 10))).size,
    totalQuantity: records.reduce((sum, record) => sum + Number(record.quantity || 0), 0),
    totalValue: records.reduce((sum, record) => sum + Number(record.value || 0), 0),    bySource: toShare(records.reduce((acc, record) => {
      const key = record.source || 'inconnue';
      acc[key] = (acc[key] || 0) + 1;
      return acc;
    }, {})),
    byCategory: toShare(records.reduce((acc, record) => {
      const key = record.category || 'non catégorisée';
      acc[key] = (acc[key] || 0) + 1;
      return acc;
    }, {})),
    firstAt: firstCreated ? new Date(firstCreated).toISOString() : null,
    lastAt: records.length
      ? new Date(Math.max(...records.map((record) => new Date(record.createdAt || 0).getTime() || 0))).toISOString()
      : null,
    byDay: buildDailySeries(inWindow, from, windowDays(range))
  };

  // ─── Anomalies ───────────────────────────────────────────────────────────────
  const recordById = new Map(records.map((record) => [record.id, record]));
  const correctionsByRecord = new Map();
  for (const correction of corrections) {
    if (!correctionsByRecord.has(correction.recordId)) correctionsByRecord.set(correction.recordId, []);
    correctionsByRecord.get(correction.recordId).push(correction);
  }

  const resolvedIssue = (issue) => {
    const record = recordById.get(issue.recordId);
    return issue.status === 'valide' || record?.status === 'valide'
      || (correctionsByRecord.get(issue.recordId) || [])
        .some((correction) => new Date(correction.createdAt) >= new Date(issue.createdAt));
  };

  const openIssues = issues.filter((issue) => !resolvedIssue(issue));
  const byType = issues.reduce((acc, issue) => {
    const key = issue.issueType || 'inconnu';
    acc[key] = acc[key] || { type: key, total: 0, open: 0, errors: 0 };
    acc[key].total += 1;
    if (!resolvedIssue(issue)) acc[key].open += 1;
    if (issue.severity === 'error') acc[key].errors += 1;
    return acc;
  }, {});

  const anomalies = {
    total: issues.length,
    open: openIssues.length,
    errors: openIssues.filter((issue) => issue.severity === 'error').length,
    warnings: openIssues.filter((issue) => issue.severity !== 'error').length,
    resolutionRate: issues.length
      ? Math.round(((issues.length - openIssues.length) / issues.length) * 1000) / 10
      : 0,
    byType: Object.values(byType)
      .map((entry) => ({ ...entry, pct: issues.length ? Math.round((entry.open / issues.length) * 1000) / 10 : 0 }))
      .sort((a, b) => b.open - a.open || b.total - a.total || a.type.localeCompare(b.type, 'fr'))
  };

  // ─── Validation ─────────────────────────────────────────────────────────────
  const byStatus = STATUSES.reduce((acc, status) => {
    acc[status] = records.filter((record) => record.status === status).length;
    return acc;
  }, {});

  const validation = {
    byStatus,
    valid: byStatus.valide,
    pending: byStatus.en_attente,
    incomplete: byStatus.incomplet,
    rejected: byStatus.rejete,
    validationRate: records.length
      ? Math.round((byStatus.valide / records.length) * 1000) / 10
      : 0,
    // Une fiche « traitée » n'est plus en attente de décision.
    treatedRate: records.length
      ? Math.round(((records.length - byStatus.en_attente) / records.length) * 1000) / 10
      : 0
  };

  // ─── Archivage ──────────────────────────────────────────────────────────────
  const archivedRecordIds = new Set(archives.map((archive) => archive.recordId));
  const byClassification = archives.reduce((acc, archive) => {
    const key = archive.classification || 'interne';
    acc[key] = (acc[key] || 0) + 1;
    return acc;
  }, {});
  const confidential = archives.filter((archive) => archive.confidentiality === 'confidentiel'
    || archive.confidentiality === 'strict').length;

  const retention = archives
    .map((archive) => Number(archive.retentionYears || 0))
    .filter((years) => years > 0);

  const dueByYear = new Date(now.getTime());
  dueByYear.setFullYear(dueByYear.getFullYear() + 3);

  const archiving = {
    total: archives.length,
    archivedRecords: archivedRecordIds.size,
    rate: records.length ? Math.round((archivedRecordIds.size / records.length) * 1000) / 10 : 0,
    confidential,
    byClassification: toShare(byClassification),
    avgRetention: retention.length
      ? Math.round((retention.reduce((a, b) => a + b, 0) / retention.length) * 10) / 10
      : 0,
    dueBefore: archives.filter((archive) => {
      const years = Number(archive.retentionYears || 0);
      if (!years || !archive.archivedAt) return false;
      const due = new Date(archive.archivedAt);
      due.setFullYear(due.getFullYear() + years);
      return due <= dueByYear;
    }).length,
    lastAt: archives.length
      ? new Date(Math.max(...archives.map((archive) => new Date(archive.archivedAt || 0).getTime() || 0))).toISOString()
      : null
  };

  // ─── Cartes d'en-tête ───────────────────────────────────────────────────────
  // Une seule source de vérité pour les cartes affichées en haut des vues.
  const cards = [
    {
      key: 'collecte',
      label: 'Données collectées',
      value: collection.inWindow,
      total: collection.total,
      unit: `sur ${windowDays(range)} j`,
      hint: `${collection.perDay} / jour · ${collection.activeDays} jour(s) actif(s)`,
      tone: collection.inWindow > 0 ? 'ok' : 'idle'
    },
    {
      key: 'anomalies',
      label: 'Anomalies ouvertes',
      value: anomalies.open,
      total: anomalies.total,
      unit: anomalies.total ? `${anomalies.resolutionRate} % traitées` : 'aucune',
      hint: `${anomalies.errors} erreur(s) bloquante(s)`,
      tone: anomalies.errors > 0 ? 'alert' : anomalies.open > 0 ? 'warn' : 'ok'
    },
    {
      key: 'validation',
      label: 'Taux de validation',
      value: validation.validationRate,
      total: null,
      unit: '%',
      formatted: `${validation.validationRate} %`,
      hint: `${validation.pending} en attente · ${validation.rejected} rejetée(s)`,
      tone: validation.validationRate >= 80 ? 'ok' : validation.validationRate >= 50 ? 'warn' : 'alert'
    },
    {
      key: 'archivage',
      label: 'Fiches archivées',
      value: archiving.archivedRecords,
      total: records.length,
      unit: records.length ? `${archiving.rate} % du fonds` : '—',
      hint: `${archiving.confidential} confidentielle(s) · rétention ${archiving.avgRetention} ans`,
      tone: 'info'
    }
  ];

  return {
    range,
    windowDays: windowDays(range),
    generatedAt: now.toISOString(),
    cards,
    collection,
    anomalies,
    validation,
    archiving
  };
}

/**
 * Série journalière de collecte : un point par jour de la fenêtre, à partir des
 * dates de création réelles des fiches. Remplace les compteurs de visites.
 */
function buildDailySeries(records, from, days) {
  const counts = new Map();
  for (const record of records) {
    const time = new Date(record.createdAt).getTime();
    if (!Number.isFinite(time)) continue;
    const key = new Date(time).toISOString().slice(0, 10);
    counts.set(key, (counts.get(key) || 0) + 1);
  }

  const labels = [];
  const values = [];
  // Ordre chronologique croissant : le premier point est le début de la fenêtre,
  // le dernier est aujourd'hui.
  for (let i = 0; i < days; i += 1) {
    const day = new Date(from.getTime());
    day.setDate(day.getDate() + i);
    const key = day.toISOString().slice(0, 10);
    labels.push(day.toLocaleDateString('fr-FR', { day: '2-digit', month: 'short' }));
    values.push(counts.get(key) || 0);
  }
  return { labels, values, total: values.reduce((a, b) => a + b, 0) };
}

module.exports = {
  STATUSES,
  windowDays,
  startOfWindow,
  toShare,
  daysBetween,
  buildDailySeries,
  buildWorkIndicators
};
