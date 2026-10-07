const test = require('node:test');
const assert = require('node:assert/strict');
const {
  MAX_IMPORT_FILE_BYTES, parseImportFile, suggestMapping, parseNumber, normalizeStatus,
  validateMapping, buildImportPlan
} = require('../db/imports');
const XLSX = require('xlsx');

const HEADERS = ['source', 'reference', 'title', 'category', 'status', 'quantity', 'value', 'notes'];
const mapping = Object.fromEntries(HEADERS.map((h) => [h, h]));

test('parseImportFile lit un CSV point-virgule avec BOM et espaces', () => {
  const csv = '\uFEFFSource;Référence;Titre;Quantité;Valeur\r\n' +
              'Service A;REF-1;Donnée une;2;150,50\r\n' +
              'Service B;REF-2;Donnée deux;abc;10\r\n' +
              '\r\n';
  const parsed = parseImportFile(Buffer.from(csv, 'utf8'), 'lot.csv');

  assert.deepEqual(parsed.headers, ['Source', 'Référence', 'Titre', 'Quantité', 'Valeur']);
  assert.equal(parsed.totalRows, 2);
  assert.equal(parsed.rows[0].Référence, 'REF-1');
  assert.equal(parsed.rows[1].Titre, 'Donnée deux');
});

test('parseImportFile lit un classeur Excel et suffixe les en-têtes dupliqués', () => {
  const book = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(book, XLSX.utils.aoa_to_sheet([
    ['source', 'source', 'title'],
    ['Service A', 'Autre', 'Donnée']
  ]), 'Lot');
  const buffer = XLSX.write(book, { type: 'buffer', bookType: 'xlsx' });
  const parsed = parseImportFile(buffer, 'lot.xlsx');

  assert.deepEqual(parsed.headers, ['source', 'source (2)', 'title']);
  assert.equal(parsed.totalRows, 1);
  assert.equal(parsed.rows[0]['source (2)'], 'Autre');
});

test('parseImportFile refuse un fichier vide ou sans ligne de données', () => {
  assert.throws(() => parseImportFile(Buffer.from(''), 'lot.csv'), /vide/i);
  assert.throws(() => parseImportFile(Buffer.from('a,b\n   \n ,  \n'), 'lot.csv'), /aucune ligne de donn/i);
  // Un CSV nommé .xlsx reste lisible : la détection de format est automatique.
  assert.equal(parseImportFile(Buffer.from('a,b\n1,2'), 'lot.xlsx').headers.length, 2);
  // Un classeur corrompu est rejeté, avec un message exploitable.
  assert.throws(() => parseImportFile(Buffer.from([0, 1, 2, 3]), 'corrompu.xlsx'), (err) => {
    assert.match(err.message, /impossible|données/i);
    assert.ok([400, 413].includes(err.status));
    return true;
  });
});

test('parseImportFile refuse les fichiers supérieurs à 3 Mo', () => {
  assert.equal(MAX_IMPORT_FILE_BYTES, 3 * 1024 * 1024);
  assert.throws(
    () => parseImportFile(Buffer.alloc(MAX_IMPORT_FILE_BYTES + 1), 'lot.csv'),
    (err) => err.status === 413 && /3 Mo maximum/.test(err.message)
  );
});

test('parseNumber tolère les formats français et anglais', () => {
  assert.equal(parseNumber('1 234,56'), 1234.56);
  assert.equal(parseNumber('1,234.56'), 1234.56);
  assert.equal(parseNumber('42'), 42);
  assert.equal(parseNumber(''), null);
  assert.ok(Number.isNaN(parseNumber('beaucoup')));
});

test('normalizeStatus accepte les libellés métier', () => {
  assert.equal(normalizeStatus('Validé'), 'valide');
  assert.equal(normalizeStatus('EN ATTENTE'), 'en_attente');
  assert.equal(normalizeStatus('À corriger'), 'rejete');
  assert.equal(normalizeStatus('mystere'), 'mystere');
});

test('suggestMapping rapproche les en-têtes français', () => {
  const suggestion = suggestMapping(['Origine', 'Réf', 'Libellé', 'Type', 'Statut', 'Qté', 'Montant', 'Commentaire']);
  assert.equal(suggestion['Origine'], 'source');
  assert.equal(suggestion['Réf'], 'reference');
  assert.equal(suggestion['Libellé'], 'title');
  assert.equal(suggestion['Montant'], 'value');
  assert.equal(suggestion['Commentaire'], 'notes');
});

test('validateMapping bloque une association incomplète ou incohérente', () => {
  assert.ok(validateMapping(mapping, HEADERS).length === 0);
  assert.ok(validateMapping({ source: 'source' }, ['source']).some((e) => /titre/i.test(e)));
  assert.ok(validateMapping({ title: 'title', titre2: 'title' }, ['title', 'titre2'])
    .some((e) => /plusieurs colonnes/i.test(e)));
  assert.ok(validateMapping({ title: 'title', x: 'inconnu' }, ['title', 'x'])
    .some((e) => /inconnu/i.test(e)));
});

test('buildImportPlan classe les lignes et compte les doublons du fichier', () => {
  const rows = [
    { source: 'A', reference: 'R1', title: 'Ligne 1', category: 'client', status: 'validé', quantity: '2', value: '10,00', notes: '' },
    { source: 'A', reference: 'R1', title: 'Ligne 1 bis', category: 'client', status: 'en attente', quantity: '2', value: '10,00', notes: '' },
    { source: 'A', reference: 'R2', title: '', category: 'client', status: 'en attente', quantity: '1', value: '5', notes: '' },
    { source: 'A', reference: 'R3', title: 'Ligne 4', category: 'client', status: 'en attente', quantity: 'beaucoup', value: '5', notes: '' },
    { source: 'A', reference: 'R4', title: 'Ligne 5', category: 'client', status: 'inconnu', quantity: '1', value: '5', notes: '' }
  ];

  const plan = buildImportPlan(rows, mapping);

  assert.equal(plan.summary.totalRows, 5);
  assert.equal(plan.summary.valid, 1);
  assert.equal(plan.summary.errors, 4);
  assert.equal(plan.summary.duplicates, 1);
  assert.equal(plan.rows[0].line, 2);
  assert.equal(plan.rows[0].record.quantity, 2);
  assert.equal(plan.rows[0].record.value, 10);
  assert.equal(plan.rows[0].record.requestedStatus, 'valide');

  const types = plan.errors.flatMap((e) => e.issues.map((i) => i.type));
  assert.ok(types.includes('duplicate_reference'));
  assert.ok(types.includes('missing_title'));
  assert.ok(types.includes('invalid_quantity'));
  assert.ok(types.includes('invalid_status'));
});

test('buildImportPlan écarte les références déjà en base', () => {
  const rows = [{ source: 'Service A', reference: 'REF-1', title: 'Déjà présente', category: 'c', status: 'en_attente', quantity: '1', value: '1', notes: '' }];
  const existingKeys = new Set([JSON.stringify(['service a', 'ref-1'])]);

  const plan = buildImportPlan(rows, mapping, { existingKeys });

  assert.equal(plan.summary.valid, 0);
  assert.equal(plan.summary.duplicates, 1);
  assert.match(plan.errors[0].issues[0].message, /base/i);
});

test('buildImportPlan respecte la longueur maximale des notes', () => {
  const rows = [{
    source: 'A', reference: 'R1', title: 'Longues notes', category: 'c',
    status: 'en_attente', quantity: '1', value: '1', notes: 'x'.repeat(50)
  }];

  const tolerant = buildImportPlan(rows, mapping, { rules: { maxNotesLength: 100 } });
  assert.equal(tolerant.summary.valid, 1);
  assert.equal(tolerant.warnings.length, 0);

  const strict = buildImportPlan(rows, mapping, { rules: { maxNotesLength: 10 } });
  // Les notes trop longues n'empêchent pas l'import : c'est un avertissement.
  assert.equal(strict.summary.valid, 1);
  assert.equal(strict.summary.warnings, 1);
  assert.equal(strict.warnings[0].type, 'long_notes');
});
