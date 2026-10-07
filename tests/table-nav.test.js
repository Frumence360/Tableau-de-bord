const test = require('node:test');
const assert = require('node:assert/strict');
const {
  normalizeText, tokenize, matchesSearch, filterRows, compareValues,
  sortRows, paginate, buildView, createState, debounce
} = require('../public/table-nav');

const RECORDS = [
  { id: 1, source: 'Service A', title: 'Client Alpha', category: 'client', status: 'valide', quantity: 5, value: 100 },
  { id: 2, source: 'Service B', title: 'Dossier Beta', category: 'commande', status: 'en_attente', quantity: 2, value: 40 },
  { id: 3, source: 'Service A', title: 'Commande Gamma', category: 'commande', status: 'rejete', quantity: 10, value: 20 },
  { id: 4, source: 'Service C', title: 'Équipe Delta', category: 'client', status: 'incomplet', quantity: 8, value: 200 },
  { id: 5, source: 'Service A', title: 'Alpha bis', category: 'client', status: 'en_attente', quantity: 1, value: null }
];

test('normalizeText ignore la casse, les accents et les espaces', () => {
  assert.equal(normalizeText('  Élève  '), 'eleve');
  assert.equal(normalizeText(null), '');
  assert.equal(normalizeText(undefined), '');
});

test('tokenize découpe la recherche en jetons', () => {
  assert.deepEqual(tokenize('  Service   Alpha  '), ['service', 'alpha']);
  assert.deepEqual(tokenize(''), []);
  assert.deepEqual(tokenize('   '), []);
});

test('matchesSearch exige tous les jetons, sans accent ni casse', () => {
  const row = RECORDS[3];
  assert.ok(matchesSearch(row, 'equipe', ['title', 'source']));
  assert.ok(matchesSearch(row, 'ÉQUIPE delta', ['title', 'source']));
  assert.ok(matchesSearch(row, 'service client', ['title', 'source', 'category']));
  assert.ok(!matchesSearch(row, 'service inexistant', ['title', 'source']));
  assert.ok(matchesSearch(row, '', ['title']));
});

test('filterRows combine recherche et filtres', () => {
  const onlyPending = filterRows(RECORDS, {
    filters: [{ field: 'status', value: 'en_attente' }]
  });
  assert.equal(onlyPending.length, 2);
  assert.ok(onlyPending.every((r) => r.status === 'en_attente'));

  const emptyFilterIsIgnored = filterRows(RECORDS, {
    filters: [{ field: 'status', value: '' }]
  });
  assert.equal(emptyFilterIsIgnored.length, 5);

  const combined = filterRows(RECORDS, {
    search: 'alpha',
    fields: ['title', 'source'],
    filters: [{ field: 'status', value: 'en_attente' }]
  });
  assert.equal(combined.length, 1);
  assert.equal(combined[0].id, 5);
});

test('filterRows supporte un prédicat personnalisé', () => {
  const resolved = filterRows(
    [{ resolved: true }, { resolved: false }],
    { filters: [{ field: 'resolved', value: 'open', test: (row, value) => value === 'open' ? !row.resolved : row.resolved }] }
  );
  assert.equal(resolved.length, 1);
  assert.equal(resolved[0].resolved, false);
});

test('compareValues renvoie null dès qu’une valeur est vide', () => {
  assert.ok(compareValues(5, 10) < 0);
  assert.ok(compareValues('10', '9') > 0, '10 doit venir après 9');
  assert.ok(compareValues('abc', 'abd') < 0);
  assert.equal(compareValues(null, 1), null);
  assert.equal(compareValues(1, null), null);
  assert.equal(compareValues(null, undefined), 0);
});

test('sortRows place les valeurs vides en fin dans les deux sens', () => {
  const source = RECORDS.slice();
  const desc = sortRows(source, { field: 'value', dir: 'desc' });
  assert.equal(source[0].id, 1, 'la source ne doit pas être mutée');
  assert.deepEqual(desc.map((r) => r.id), [4, 1, 2, 3, 5], 'la valeur nulle reste en fin en descendant');

  const asc = sortRows(RECORDS, { field: 'value' });
  assert.deepEqual(asc.map((r) => r.id), [3, 2, 1, 4, 5], 'la valeur nulle reste en fin en montant');

  const byTitle = sortRows(RECORDS, { field: 'title' });
  assert.deepEqual(byTitle.map((r) => r.title), ['Alpha bis', 'Client Alpha', 'Commande Gamma', 'Dossier Beta', 'Équipe Delta']);

  // Deux lignes à égalité : l'ordre d'origine est conservé
  const stable = sortRows([{ k: 1, id: 'a' }, { k: 1, id: 'b' }], { field: 'k' });
  assert.deepEqual(stable.map((r) => r.id), ['a', 'b']);

  assert.equal(sortRows(RECORDS).length, 5, 'sans champ, le tri est neutre');
});

test('paginate découpe, borne la page et expose les bornes', () => {
  const page = paginate(RECORDS, { page: 1, pageSize: 2 });
  assert.equal(page.rows.length, 2);
  assert.equal(page.page, 1);
  assert.equal(page.pages, 3);
  assert.equal(page.from, 1);
  assert.equal(page.to, 2);
  assert.equal(page.total, 5);

  const last = paginate(RECORDS, { page: 99, pageSize: 2 });
  assert.equal(last.page, 3, 'la page est bornée au nombre de pages');
  assert.equal(last.rows.length, 1);

  const below = paginate(RECORDS, { page: 0, pageSize: 2 });
  assert.equal(below.page, 1);

  const empty = paginate([], { page: 1, pageSize: 10 });
  assert.equal(empty.pages, 1);
  assert.equal(empty.from, 0);
  assert.equal(empty.to, 0);

  const guarded = paginate(RECORDS, { page: 1, pageSize: 0 });
  assert.equal(guarded.pageSize, 10, 'une taille nulle retombe sur la valeur par défaut');
});

test('buildView enchaîne filtres, tri et pagination', () => {
  const view = buildView(RECORDS, {
    search: 'alpha',
    fields: ['source', 'title'],
    sortField: 'title',
    sortDir: 'asc',
    page: 1,
    pageSize: 2
  });

  assert.equal(view.filteredTotal, 2);
  assert.equal(view.sortedTotal, 2);
  assert.equal(view.total, 2);
  assert.equal(view.pages, 1);
  assert.deepEqual(view.rows.map((r) => r.title), ['Alpha bis', 'Client Alpha']);
});

test('createState fournit des valeurs par défaut cohérentes', () => {
  const state = createState();
  assert.equal(state.search, '');
  assert.equal(state.sortField, null);
  assert.equal(state.sortDir, 'asc');
  assert.equal(state.page, 1);
  assert.deepEqual(state.filters, {});
  assert.equal(createState({ pageSize: 50 }).pageSize, 50);
});

test('debounce ne déclenche qu’une fois', async () => {
  let calls = 0;
  const fn = debounce(() => { calls += 1; }, 10);
  fn(); fn(); fn();
  await new Promise((resolve) => setTimeout(resolve, 40));
  assert.equal(calls, 1);
});
