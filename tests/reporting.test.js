const test = require('node:test');
const assert = require('node:assert/strict');
const { buildDataReport, generateRecordsCsv, validateProjectPayload } = require('../db/queries');

test('buildDataReport aggregates records and archive status', () => {
  const report = buildDataReport([
    { id: 1, source: 'Service A', title: 'Client 1', category: 'client', status: 'valide', quantity: 5, value: 100 },
    { id: 2, source: 'Service B', title: 'Client 2', category: 'client', status: 'incomplet', quantity: 2, value: 40 },
    { id: 3, source: 'Service A', title: 'Client 3', category: 'commande', status: 'rejete', quantity: 0, value: 0 },
    { id: 4, source: 'Service C', title: 'Client 4', category: 'commande', status: 'valide', quantity: 8, value: 200 }
  ], [
    { record_id: 2, classification: 'interne' },
    { record_id: 4, classification: 'confidentielle' }
  ]);

  assert.equal(report.total, 4);
  assert.equal(report.byStatus.valide, 2);
  assert.equal(report.byStatus.incomplet, 1);
  assert.equal(report.byStatus.rejete, 1);
  assert.equal(report.totalValue, 340);
  assert.equal(report.archivedRecords, 2);
  assert.equal(report.categoryBreakdown.client, 2);
  assert.equal(report.sourceBreakdown['Service A'], 2);
});

test('generateRecordsCsv includes expected headers and values', () => {
  const csv = generateRecordsCsv([
    { source: 'Service A', reference: 'REF-001', title: 'Client 1', category: 'client', status: 'valide', quantity: 5, value: 100 }
  ]);

  assert.match(csv, /source,reference,title,category,status,quantity,value/);
  assert.match(csv, /Service A/);
  assert.match(csv, /REF-001/);
  assert.match(csv, /valide/);
});

test('validateProjectPayload rejects empty project data and accepts valid updates', () => {
  const invalid = validateProjectPayload({ title: '', status: 'En cours', date: '2026-10-03' });
  assert.equal(invalid.valid, false);
  assert.match(invalid.error, /Titre/);

  const valid = validateProjectPayload({ title: 'Site vitrine', status: 'Livré', date: '2026-10-03' });
  assert.equal(valid.valid, true);
  assert.equal(valid.value.status, 'Livré');
});

test('role permissions and audit summary are computed correctly', () => {
  const { getRolePermissions, buildAuditSummary } = require('../db/queries');

  assert.deepEqual(getRolePermissions('admin'), ['read', 'write', 'validate', 'archive', 'export', 'manage_users']);
  assert.deepEqual(getRolePermissions('manager'), ['read', 'write', 'validate', 'archive', 'export']);
  assert.deepEqual(getRolePermissions('capturer'), ['read', 'write']);
  assert.deepEqual(getRolePermissions('viewer'), ['read']);
  assert.equal(buildAuditSummary([{ action: 'login' }, { action: 'archive' }, { action: 'login' }]).login, 2);
  assert.equal(buildAuditSummary([{ action: 'archive' }, { action: 'archive' }]).archive, 2);
});

test('record validation applies configurable category, notes, and duplicate rules', () => {
  const { evaluateRecordValidation } = require('../db/queries');
  const record = { source: 'Import A', reference: 'ref-1', title: 'Fiche 1', category: '', status: 'en_attente', quantity: 1, value: 10, notes: 'note trop longue' };
  const rules = {
    requireCategory: false,
    detectDuplicateReferences: true,
    rejectNegativeQuantity: true,
    rejectNegativeValue: true,
    maxNotesLength: 5
  };

  const duplicate = evaluateRecordValidation(record, rules, { duplicateFound: true });
  assert.equal(duplicate.finalStatus, 'rejete');
  assert.deepEqual(duplicate.issues.map((issue) => issue.issueType), ['long_notes', 'duplicate_reference']);

  const unique = evaluateRecordValidation(record, rules);
  assert.equal(unique.finalStatus, 'incomplet');
  assert.deepEqual(unique.issues.map((issue) => issue.issueType), ['long_notes']);
});
