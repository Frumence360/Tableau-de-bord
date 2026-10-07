// Contrôle : tous les sélecteurs utilisés par mountTable doivent exister une
// seule fois dans le HTML, et public/app.js doit rester analysable.
const fs = require('fs');
const path = require('path');

const html = fs.readFileSync(path.join(__dirname, '..', 'public', 'index.html'), 'utf8');

const ids = [
  'recordSearch', 'filterRecordStatus', 'filterRecordCategory', 'filterRecordSource',
  'recordPageSize', 'recordPager', 'recordReset', 'recordCount',
  'anomalySearch', 'filterAnomalyType', 'filterAnomalySeverity', 'filterAnomalyStatus',
  'filterAnomalyRecordStatus', 'anomalyPageSize', 'anomalyPager', 'anomalyReset',
  'correctionSearch', 'correctionPageSize', 'correctionPager',
  'recordRows', 'validationRows', 'correctionRows'
];

let problems = 0;
for (const id of ids) {
  const count = (html.match(new RegExp(`id="${id}"`, 'g')) || []).length;
  if (count !== 1) {
    console.log(`${count === 0 ? 'MANQUANT' : 'DUPLIQUE'} : ${id} (${count})`);
    problems += 1;
  }
}

// L'aperçu de l'import réutilise aussi des éléments : on les vérifie.
for (const id of ['importPreviewTable', 'importMapping', 'importValidation', 'importStep2']) {
  if (!html.includes(`id="${id}"`)) {
    console.log(`MANQUANT : ${id}`);
    problems += 1;
  }
}

// La logique applicative a été extraite dans public/app.js : un script inline
// est bloqué par le CSP du serveur (script-src sans 'unsafe-inline'), ce qui
// rendait le tableau de bord totalement inerte. On contrôle donc que le HTML
// référence bien app.js, qu'aucun script inline ne réapparaisse, et que app.js
// reste analysable.
if (!/<script src="app\.js"><\/script>/.test(html)) {
  console.log('MANQUANT : <script src="app.js"></script>');
  problems += 1;
}

const inline = html.match(/<script>([\s\S]*?)<\/script>/);
if (inline) {
  console.log('REGRESSION : un script inline est revenu dans le HTML (bloque par le CSP)');
  problems += 1;
}

const appJsPath = path.join(__dirname, '..', 'public', 'app.js');
if (!fs.existsSync(appJsPath)) {
  console.log('MANQUANT : public/app.js');
  problems += 1;
} else {
  const appJs = fs.readFileSync(appJsPath, 'utf8');
  try {
    new Function(appJs);
  } catch (err) {
    console.log(`JS INVALIDE (app.js) : ${err.message}`);
    problems += 1;
  }
}

const editorHtmlPath = path.join(__dirname, '..', 'public', 'editor.html');
const editorCssPath = path.join(__dirname, '..', 'public', 'editor.css');
const editorJsPath = path.join(__dirname, '..', 'public', 'editor.js');
for (const [assetPath, label] of [
  [editorHtmlPath, 'public/editor.html'],
  [editorCssPath, 'public/editor.css'],
  [editorJsPath, 'public/editor.js']
]) {
  if (!fs.existsSync(assetPath)) {
    console.log(`MANQUANT : ${label}`);
    problems += 1;
  }
}

if (fs.existsSync(editorHtmlPath)) {
  const editorHtml = fs.readFileSync(editorHtmlPath, 'utf8');
  if (!/<link rel="stylesheet" href="editor\.css">/.test(editorHtml)) {
    console.log('MANQUANT : feuille de style editor.css');
    problems += 1;
  }
  if (!/<script src="editor\.js"><\/script>/.test(editorHtml)) {
    console.log('MANQUANT : script externe editor.js');
    problems += 1;
  }
  if (/<script>[\s\S]*?<\/script>/.test(editorHtml)) {
    console.log('REGRESSION : script inline dans editor.html (bloque par le CSP)');
    problems += 1;
  }
}

if (fs.existsSync(editorJsPath)) {
  const editorJs = fs.readFileSync(editorJsPath, 'utf8');
  try {
    new Function(editorJs);
  } catch (err) {
    console.log(`JS INVALIDE (editor.js) : ${err.message}`);
    problems += 1;
  }
}

console.log(problems === 0 ? '✔ DOM et app.js cohérents' : `✖ ${problems} problème(s)`);
process.exit(problems === 0 ? 0 : 1);
