const test = require('node:test');
const assert = require('node:assert/strict');
const { windowDays, toShare, daysBetween, buildDailySeries, buildWorkIndicators } = require('../db/indicators');

const NOW = new Date('2026-03-31T12:00:00.000Z');

/** Fabrique une fiche avec une date de création relative à NOW. */
function record(id, daysAgo, overrides = {}) {
  const created = new Date(NOW.getTime());
  created.setDate(created.getDate() - daysAgo);
  return {
    id,
    source: 'Service A',
    reference: `REF-${id}`,
    title: `Donnée ${id}`,
    category: 'client',
    status: 'en_attente',
    quantity: 1,
    value: 10,
    notes: null,
    createdAt: created.toISOString(),
    updatedAt: created.toISOString(),
    ...overrides
  };
}

test('windowDays borne la fenêtre glissante', () => {
  assert.equal(windowDays('7d'), 7);
  assert.equal(windowDays('30d'), 30);
  assert.equal(windowDays('90d'), 90);
  assert.equal(windowDays('nimporte'), 30);
});

test('toShare convertit des effectifs en pourcentages triés', () => {
  const share = toShare({ a: 3, b: 1, '': 2 });
  assert.deepEqual(share.map((entry) => entry.label), ['a', 'b']);
  assert.equal(share[0].pct, 75);
  assert.equal(share[1].pct, 25);
});

test('toShare renvoie une liste vide sans effectif', () => {
  assert.deepEqual(toShare({}), []);
  assert.equal(toShare({ a: 0 })[0].pct, 0);
});

test('daysBetween compte les jours écoulés', () => {
  assert.equal(daysBetween('2026-03-01', '2026-03-31'), 30);
  assert.equal(daysBetween('2026-03-31', '2026-03-31'), 0);
  assert.equal(daysBetween(null, '2026-03-31'), 0);
});

test('buildDailySeries produit un point par jour de la fenêtre', () => {
  const from = new Date(NOW);
  from.setDate(from.getDate() - 6);
  const series = buildDailySeries([record(1, 0), record(2, 0), record(3, 3)], from, 7);

  assert.equal(series.labels.length, 7);
  assert.equal(series.values.length, 7);
  assert.equal(series.total, 3);
  // Dernier point = aujourd'hui (2 fiches), point J-3 en 4e position.
  assert.equal(series.values[series.values.length - 1], 2);
  assert.equal(series.values[3], 1);
  assert.equal(series.values[0], 0);
});

test('buildWorkIndicators : collecte sur la fenêtre et hors fenêtre', () => {
  const indicators = buildWorkIndicators(
    [record(1, 2), record(2, 5), record(3, 40)],
    [], [], [],
    { range: '30d', now: NOW }
  );

  assert.equal(indicators.collection.total, 3);
  assert.equal(indicators.collection.inWindow, 2);
  assert.equal(indicators.collection.byDay.values.length, 30);
  assert.equal(indicators.collection.bySource[0].label, 'Service A');
  assert.equal(indicators.collection.bySource[0].pct, 100);
  assert.ok(indicators.collection.perDay > 0);
});

test('buildWorkIndicators : anomalies ouvertes vs résolues', () => {
  const records = [record(1, 1, { status: 'valide' }), record(2, 1, { status: 'en_attente' })];
  const issues = [
    { id: 10, recordId: 1, issueType: 'missing_category', severity: 'error', createdAt: NOW.toISOString() },
    { id: 11, recordId: 2, issueType: 'missing_category', severity: 'error', createdAt: NOW.toISOString() },
    { id: 12, recordId: 2, issueType: 'long_notes', severity: 'warning', createdAt: NOW.toISOString() }
  ];

  const indicators = buildWorkIndicators(records, issues, [], [], { range: '30d', now: NOW });

  // L'anomalie de la fiche validée est résolue, les deux autres restent ouvertes.
  assert.equal(indicators.anomalies.total, 3);
  assert.equal(indicators.anomalies.open, 2);
  assert.equal(indicators.anomalies.errors, 1);
  assert.equal(indicators.anomalies.resolutionRate, 33.3);
  assert.equal(indicators.anomalies.byType[0].type, 'missing_category');
  assert.equal(indicators.anomalies.byType[0].open, 1);
  assert.equal(indicators.anomalies.byType[0].total, 2);
});

test('buildWorkIndicators : une correction postérieure résout l’anomalie', () => {
  const records = [record(1, 1)];
  const issues = [{
    id: 10, recordId: 1, issueType: 'duplicate_reference', severity: 'error',
    createdAt: new Date(NOW.getTime() - 86400000).toISOString()
  }];
  const corrections = [{
    id: 1, recordId: 1, correctedBy: 'alice', fieldName: 'reference',
    oldValue: 'A', newValue: 'B', reason: 'doublon', createdAt: NOW.toISOString()
  }];

  const indicators = buildWorkIndicators(records, issues, corrections, [], { range: '30d', now: NOW });

  assert.equal(indicators.anomalies.open, 0);
  assert.equal(indicators.anomalies.resolutionRate, 100);
});

test('buildWorkIndicators : taux de validation par statut', () => {
  const records = [
    record(1, 1, { status: 'valide' }),
    record(2, 1, { status: 'valide' }),
    record(3, 1, { status: 'valide' }),
    record(4, 1, { status: 'en_attente' })
  ];

  const indicators = buildWorkIndicators(records, [], [], [], { range: '30d', now: NOW });

  assert.equal(indicators.validation.valid, 3);
  assert.equal(indicators.validation.pending, 1);
  assert.equal(indicators.validation.validationRate, 75);
  assert.equal(indicators.validation.treatedRate, 75);
});

test('buildWorkIndicators : archivage et classifications', () => {
  const records = [record(1, 1), record(2, 1), record(3, 1), record(4, 1)];
  const archives = [
    { recordId: 1, classification: 'interne', confidentiality: 'interne', retentionYears: 3, archivedAt: '2025-01-10' },
    { recordId: 2, classification: 'reglementaire', confidentiality: 'confidentiel', retentionYears: 5, archivedAt: '2024-06-01' }
  ];

  const indicators = buildWorkIndicators(records, [], [], archives, { range: '30d', now: NOW });

  assert.equal(indicators.archiving.total, 2);
  assert.equal(indicators.archiving.archivedRecords, 2);
  assert.equal(indicators.archiving.rate, 50);
  assert.equal(indicators.archiving.confidential, 1);
  assert.equal(indicators.archiving.avgRetention, 4);
  // NOW = 2026-03-31, échéance à 3 ans.
  // 2025-01-10 + 3 ans = 2028-01-10 → dépassée ; 2024-06-01 + 5 ans = 2029-06-01 → non dépassée.
  assert.equal(indicators.archiving.dueBefore, 1);
  assert.equal(indicators.archiving.byClassification.length, 2);
  // Effectifs égaux : le tri alphabétique départage.
  assert.deepEqual(indicators.archiving.byClassification.map((e) => e.label), ['interne', 'reglementaire']);
});

test('buildWorkIndicators : jeu vide ne produit pas de NaN', () => {
  const indicators = buildWorkIndicators([], [], [], [], { range: '30d', now: NOW });

  assert.equal(indicators.collection.total, 0);
  assert.equal(indicators.collection.perDay, 0);
  assert.equal(indicators.validation.validationRate, 0);
  assert.equal(indicators.archiving.rate, 0);
  assert.equal(indicators.archiving.avgRetention, 0);
  assert.equal(indicators.anomalies.resolutionRate, 0);
  assert.deepEqual(indicators.collection.bySource, []);
  assert.equal(indicators.cards.length, 4);
  for (const card of indicators.cards) {
    assert.ok(Number.isFinite(card.value), `${card.key} doit être un nombre fini`);
  }
});

test('buildWorkIndicators : quatre cartes de pilotage cohérentes', () => {
  const records = [record(1, 1, { status: 'valide' }), record(2, 1, { status: 'en_attente' })];
  const indicators = buildWorkIndicators(records, [], [], [], { range: '30d', now: NOW });

  const cards = Object.fromEntries(indicators.cards.map((card) => [card.key, card]));
  assert.deepEqual(Object.keys(cards), ['collecte', 'anomalies', 'validation', 'archivage']);
  assert.equal(cards.collecte.value, 2);
  assert.equal(cards.anomalies.value, 0);
  assert.equal(cards.validation.formatted, '50 %');
  assert.equal(cards.archivage.value, 0);
  assert.equal(cards.validation.tone, 'warn');
});
