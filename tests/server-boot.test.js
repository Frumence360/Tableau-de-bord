/**
 * Test de démarrage du serveur
 * ---------------------------
 * Aucun autre test du projet ne charge `server.js` : ils ne couvrent que
 * `db/queries.js`, `db/imports.js` et le HTML. Or une erreur au niveau module
 * (identifiant non déclaré, route mal câblée, import cassé) ne se voit
 * qu'au `require()` — ce fichier est donc ce qui l'attrape.
 *
 * Le serveur écoute sur un port éphémère et le referme immédiatement.
 */
const test = require('node:test');
const assert = require('node:assert/strict');

test('server.js exporte une application Express qui démarre sur un port libre', (t) => {
  // JWT_SECRET est exigé au chargement ; on en fournit un jetable pour le test.
  const previousSecret = process.env.JWT_SECRET;
  const previousPort = process.env.PORT;
  process.env.JWT_SECRET = 'test-secret-boot';

  // Les modules déjà en cache conserveraient l'ancien état : on repart à zéro.
  for (const key of Object.keys(require.cache)) {
    if (key.includes('server.js')) delete require.cache[key];
  }

  let server;
  t.after(() => {
    if (server) server.close();
    if (previousSecret === undefined) delete process.env.JWT_SECRET;
    else process.env.JWT_SECRET = previousSecret;
    if (previousPort === undefined) delete process.env.PORT;
    else process.env.PORT = previousPort;
  });

  // require() lève ici si une constante de middleware n'est pas définie.
  const app = require('../server');
  assert.equal(typeof app, 'function', 'le module doit exporter l’application Express');
  server = app.listen(0); // 0 = port libre attribué par l'OS
  assert.ok(server.address(), 'la socket devrait être liée à un port');
});

test('le limiteur d\'écriture référencé par les routes est bien défini', () => {
  // writeLimiter a été utilisé sur ~10 routes sans être défini : l'API ne
  // démarrait pas. Ce test verrouille le cas.
  const source = require('node:fs').readFileSync(require('node:path').join(__dirname, '../server.js'), 'utf8');
  assert.match(source, /const writeLimiter = rateLimit\(/);
  assert.match(source, /const importLimiter = rateLimit\(/);
  assert.match(source, /const adminLimiter = rateLimit\(/);
});

test('les routes des pièces jointes et leur limite de taille sont configurées', () => {
  const source = require('node:fs').readFileSync(require('node:path').join(__dirname, '../server.js'), 'utf8');
  assert.match(source, /const MAX_RECORD_ATTACHMENT_BYTES = 10 \* 1024 \* 1024/);
  assert.match(source, /\/api\/records\/:id\/attachments\/:attachmentId\/download/);
  assert.match(source, /express\.raw\(\{ type: 'application\/octet-stream', limit: MAX_RECORD_ATTACHMENT_BYTES \}\)/);
});