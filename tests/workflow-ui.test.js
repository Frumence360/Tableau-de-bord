const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const html = fs.readFileSync(path.join(__dirname, '../public/index.html'), 'utf8');
// Depuis l'extraction du script inline (bloqué par le CSP), la logique
// applicative vit dans public/app.js : les assertions de comportement
// s'appliquent à ce fichier, les assertions de structure au HTML.
const appJs = fs.readFileSync(path.join(__dirname, '../public/app.js'), 'utf8');
const editorHtml = fs.readFileSync(path.join(__dirname, '../public/editor.html'), 'utf8');
const editorJs = fs.readFileSync(path.join(__dirname, '../public/editor.js'), 'utf8');
const source = `${html}\n${appJs}\n${editorHtml}\n${editorJs}`;

test('le script applicatif est externe, car le CSP interdit unsafe-inline', () => {
  // Un script inline dans le HTML rendait le dashboard entièrement inerte :
  // le navigateur le bloquait silencieusement (aucun listener, fetchJson undefined).
  assert.match(html, /<script src="app\.js"><\/script>/);
  assert.doesNotMatch(html, /<script>[\s\S]*?<\/script>/);
  assert.ok(appJs.length > 1000, 'app.js doit contenir la logique applicative');
});

test('the record action button does not mix edit and fix behaviors', () => {
  assert.doesNotMatch(source, /anomaly-fix-btn\s+record-edit-btn/);
  assert.match(source, /class="[^"]*record-edit-btn[^"]*"/);
});

test('Saisie draft and submit buttons are wired to storage and the records API', () => {
  assert.match(source, /id="saveEntryDraftBtn"/);
  assert.match(source, /getElementById\('saveEntryDraftBtn'\)\.addEventListener\('click'/);
  assert.match(source, /localStorage\.setItem\(entryDraftStorageKey\(\)/);
  assert.match(source, /id="submitEntryBtn"/);
  assert.match(source, /getElementById\('submitEntryBtn'\)\.addEventListener\('click'/);
  assert.match(source, /apiFetch\(`\$\{API_BASE\}\/api\/records`/);
  assert.match(source, /status: 'en_attente'/);
});

test('document tools launch the supplied editor and attach uploaded files to records', () => {
  assert.match(html, /id="entryDocumentChoiceOverlay"/);
  assert.match(html, /id="entryChooseWordModel"/);
  assert.match(html, /id="entryChooseFile"/);
  assert.match(html, /id="entryAttachmentInput" type="file" hidden/);
  assert.match(editorHtml, /<link rel="stylesheet" href="editor\.css">/);
  assert.match(editorHtml, /<script src="editor\.js"><\/script>/);
  assert.match(editorHtml, /id="saveDocx"/);
  assert.match(editorHtml, /id="savePdf"/);
  assert.match(editorHtml, /id="insertEntry" hidden/);
  assert.match(appJs, /window\.open\(API_BASE \+ '\/editor\.html\?mode=entry', '_blank'\)/);
  assert.match(appJs, /event\.origin !== API_BASE \|\| event\.source !== editorWindow/);
  assert.match(appJs, /frumence-editor-result/);
  assert.match(editorJs, /event\.source!==window\.opener/);
  assert.match(editorJs, /frumence-editor-ready/);
  assert.match(editorJs, /page\.innerText/);
  assert.match(appJs, /\/api\/records\/\$\{recordId\}\/attachments/);
  assert.match(appJs, /X-File-Name/);
  assert.match(appJs, /entry-attachment-download/);
});

test('dashboard and document editor provide mobile layouts and usable navigation', () => {
  assert.match(html, /@media \(max-width:820px\)[\s\S]*?\.sidebar\{display:block/);
  assert.match(html, /nav\{flex-direction:row[\s\S]*?overflow-x:auto/);
  assert.match(html, /\.data-table\{display:block;max-width:100%;overflow-x:auto/);
  assert.match(html, /canvas\{max-width:100%;?\}/);
  assert.match(html, /@media \(max-width:560px\)[\s\S]*?\.stats\{grid-template-columns:minmax\(0,1fr\)/);
  assert.match(editorHtml, /name="viewport"/);
  const editorCss = fs.readFileSync(path.join(__dirname, '../public/editor.css'), 'utf8');
  assert.match(editorCss, /@media\(max-width:600px\)/);
  assert.match(editorCss, /\.status\{[^}]*flex-wrap:wrap/);
});

test('remaining operational tabs use live API data and connected actions', () => {
  assert.match(html, /data-view="data"/);
  assert.match(html, /data-validation-filter="en_attente"/);
  // Les anomalies sont chargées via fetchIssuesPage, qui passe par fetchPagedList
  // : la pagination et les filtres sont désormais gérés côté serveur.
  assert.match(source, /function fetchIssuesPage\(params\) \{ return fetchPagedList\('\/api\/validation\/issues', params\); \}/);
  assert.match(source, /async function fetchPagedList\(path, params = \{\}\)/);
  assert.match(source, /apiFetch\(`\$\{API_BASE\}\/api\/records\/\$\{button\.dataset\.recordId\}\/status`/);
  assert.match(source, /async function loadAnomaliesView\(\)/);
  assert.match(source, /documentSearch'\)\.addEventListener\('input', applyDocumentFilters/);
  assert.match(source, /reportsCsvBtn'\)\.addEventListener\('click'/);
  // L'export passe désormais par un token à usage unique, jamais par un <a href> sur
  // une route protégée par JWT (le header Authorization ne part pas avec un lien).
  assert.match(source, /apiFetch\(`\$\{API_BASE\}\/api\/exports\/token`, \{ method: 'POST' \}\)/);
  assert.match(source, /\/api\/exports\/data\.csv\?token=/);
  assert.doesNotMatch(source, /apiFetch\(`\$\{API_BASE\}\/api\/reports\/data\/export\.csv`\)/);
  assert.doesNotMatch(source, /42 anomalies|Exporter Excel|Enregistrer les préférences/);
});
