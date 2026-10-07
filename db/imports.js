/**
 * Import de lots CSV / Excel
 * --------------------------
 * Trois étapes exposées par l'API :
 *   1. parseImportFile(buffer, filename)  → décodage du fichier (CSV ou XLSX)
 *   2. buildImportPlan(rows, mapping)     → association des colonnes + validation
 *      + détection des doublons (dans le lot et avec la base)
 *   3. insertImportPlan(client, plan)     → écriture des lignes valides, dans
 *                                          une transaction, en réutilisant les
 *                                          règles de validation existantes.
 *
 * Les fonctions pures (parse / mapping / validation) ne dépendent pas de
 * PostgreSQL : elles sont testables et utilisées par l'aperçu comme par
 * l'import réel, qui revalide toujours côté serveur.
 */

const XLSX = require('xlsx');

const IMPORT_FIELDS = ['source', 'reference', 'title', 'category', 'status', 'quantity', 'value', 'notes'];
const IMPORT_STATUSES = ['en_attente', 'valide', 'incomplet', 'rejete'];

const MAX_ROWS = 5000;
const PREVIEW_ROWS = 50;

// Synonymes usuels pour proposer une association automatique des colonnes.
const FIELD_ALIASES = {
  source: ['source', 'origine', 'fournisseur', 'service', 'canal', 'emetteur', 'src'],
  reference: ['reference', 'ref', 'reference client', 'id', 'identifiant', 'code', 'numero', 'no', 'n°', 'cle'],
  title: ['title', 'titre', 'libelle', 'désignation', 'designation', 'intitule', 'nom', 'description'],
  category: ['category', 'categorie', 'type', 'classe', 'famille', 'rubrique'],
  status: ['status', 'statut', 'etat', 'état', 'state'],
  quantity: ['quantity', 'quantite', 'qte', 'qté', 'nombre', 'nb', 'count', 'volume', 'quantité'],
  value: ['value', 'valeur', 'montant', 'prix', 'tarif', 'amount', 'total', 'somme', 'budget'],
  notes: ['notes', 'note', 'commentaire', 'commentaires', 'observations', 'remarque', 'details', 'détails']
};

const REQUIRED_FIELDS = ['title'];

const FIELD_LABELS = {
  source: 'source', reference: 'référence', title: 'titre', category: 'catégorie',
  status: 'statut', quantity: 'quantité', value: 'valeur', notes: 'notes'
};

/** Normalise un en-tête pour le rapprochement (minuscules, sans accents ni séparateurs). */
function normalizeHeader(header) {
  return String(header ?? '')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

/**
 * Devine l'association colonne → champ à partir des en-têtes.
 * Retourne un objet { nomColonne: champ } ou null si la colonne est ignorée.
 */
function suggestMapping(headers = []) {
  const mapping = {};
  const used = new Set();
  for (const header of headers) {
    const normalized = normalizeHeader(header);
    if (!normalized) {
      mapping[header] = null;
      continue;
    }
    const field = IMPORT_FIELDS.find((f) => FIELD_ALIASES[f].some((alias) => {
      const a = normalizeHeader(alias);
      return normalized === a || normalized.endsWith(` ${a}`) || normalized.startsWith(`${a} `);
    }));
    if (field && !used.has(field)) {
      mapping[header] = field;
      used.add(field);
    } else {
      mapping[header] = null;
    }
  }
  return mapping;
}

function parseCsv(text) {
  // Détection simple du séparateur (virgule, point-virgule ou tabulation).
  const firstLine = String(text).split(/\r?\n/, 1)[0] || '';
  const counts = {
    ',': (firstLine.match(/,/g) || []).length,
    ';': (firstLine.match(/;/g) || []).length,
    '\t': (firstLine.match(/\t/g) || []).length
  };
  const delimiter = Object.entries(counts).sort((a, b) => b[1] - a[1])[0][0];
  const workbook = XLSX.read(text, { type: 'string', FS: delimiter, raw: false });
  return XLSX.utils.sheet_to_json(workbook.Sheets[workbook.SheetNames[0]], {
    header: 1,
    defval: '',
    blankrows: false,
    raw: false
  });
}

/**
 * Décode un fichier CSV/XLSX en tableau d'objets { en-tête: valeur }.
 * Le BOM UTF-8 et les séparateurs français (1 234,56) sont gérés.
 */
function parseImportFile(buffer, filename = '') {
  if (!Buffer.isBuffer(buffer) || buffer.length === 0) {
    throw Object.assign(new Error('Fichier vide.'), { status: 400 });
  }
  if (buffer.length > 10 * 1024 * 1024) {
    throw Object.assign(new Error('Fichier trop volumineux (10 Mo maximum).'), { status: 413 });
  }

  const isExcel = /\.(xlsx|xls|xlsm|ods)$/i.test(filename);
  let matrix;
  try {
    if (isExcel) {
      const workbook = XLSX.read(buffer, { type: 'buffer', cellDates: false });
      const sheetName = workbook.SheetNames[0];
      if (!sheetName) throw new Error('Classeur vide.');
      matrix = XLSX.utils.sheet_to_json(workbook.Sheets[sheetName], {
        header: 1, defval: '', blankrows: false, raw: false
      });
    } else {
      matrix = parseCsv(buffer.toString('utf8').replace(/^/, ''));
    }
  } catch (err) {
    throw Object.assign(new Error(`Lecture du fichier impossible : ${err.message}`), { status: 400 });
  }

  if (!matrix.length) {
    throw Object.assign(new Error('Le fichier ne contient aucune donnée.'), { status: 400 });
  }

  const rawHeaders = matrix[0].map((h, i) => {
    const name = String(h ?? '').trim();
    return name || `colonne_${i + 1}`;
  });
  // En-têtes dupliqués : on suffixe pour ne pas perdre de colonnes.
  const headers = rawHeaders.map((name, i) =>
    rawHeaders.indexOf(name) === i ? name : `${name} (${i + 1})`
  );

  const rows = matrix.slice(1)
    .filter((cells) => cells.some((cell) => String(cell ?? '').trim() !== ''))
    .map((cells) => {
      const row = {};
      headers.forEach((name, i) => { row[name] = String(cells[i] ?? '').trim(); });
      return row;
    });

  if (!rows.length) {
    throw Object.assign(new Error('Le fichier ne contient aucune ligne de données.'), { status: 400 });
  }
  if (rows.length > MAX_ROWS) {
    throw Object.assign(
      new Error(`Lot trop volumineux : ${rows.length} lignes (maximum ${MAX_ROWS}).`),
      { status: 413 }
    );
  }

  return { headers, rows, totalRows: rows.length, truncated: rows.length > PREVIEW_ROWS };
}

/** Convertit une valeur texte en nombre en tolérant les espaces et la virgule décimale. */
function parseNumber(raw) {
  if (raw === undefined || raw === null || String(raw).trim() === '') return null;
  const cleaned = String(raw)
    .replace(/[\s\u00a0\u202f]/g, '')
    .replace(/[^\d,.\-]/g, '');
  if (cleaned === '' || cleaned === '-') return NaN;
  // "1 234,56" → 1234.56 ; "1,234.56" → 1234.56 ; "1234" → 1234
  const lastComma = cleaned.lastIndexOf(',');
  const lastDot = cleaned.lastIndexOf('.');
  let normalized;
  if (lastComma > -1 && lastComma > lastDot) {
    normalized = cleaned.replace(/\./g, '').replace(',', '.');
  } else if (lastDot > -1 && lastComma === -1) {
    normalized = cleaned;
  } else {
    normalized = cleaned.replace(/,/g, '');
  }
  return Number(normalized);
}

const STATUS_ALIASES = {
  valide: 'valide', valid: 'valide', validé: 'valide', validee: 'valide', ok: 'valide', '1': 'valide', true: 'valide',
  en_attente: 'en_attente', 'en attente': 'en_attente', attente: 'en_attente', pending: 'en_attente', '0': 'en_attente', false: 'en_attente',
  incomplet: 'incomplet', incomplete: 'incomplet', 'a completer': 'incomplet', 'à compléter': 'incomplet', partiel: 'incomplet',
  rejete: 'rejete', rejet: 'rejete', rejete_: 'rejete', rejected: 'rejete', 'à corriger': 'rejete', 'a corriger': 'rejete', ko: 'rejete'
};

function normalizeStatus(raw) {
  if (raw === undefined || raw === null || String(raw).trim() === '') return null;
  const key = normalizeHeader(raw);
  return STATUS_ALIASES[key] || String(raw).trim();
}

/** Projette une ligne brute du fichier vers un objet fiche, selon l'association. */
function projectRow(row, mapping) {
  const out = {};
  for (const [header, field] of Object.entries(mapping)) {
    if (field && IMPORT_FIELDS.includes(field) && out[field] === undefined) {
      out[field] = row[header];
    }
  }
  return out;
}

function keyOf(source, reference) {
  return JSON.stringify([
    String(source || '').trim().toLocaleLowerCase('en-US'),
    String(reference || '').trim().toLocaleLowerCase('en-US')
  ]);
}

/**
 * Construit le plan d'import : projection des lignes, validation, doublons.
 * existingKeys : Set de "source\u0000reference" déjà présents en base.
 */
function buildImportPlan(rows, mapping, { existingKeys = new Set(), rules } = {}) {
  const errors = [];
  const warnings = [];
  const candidates = [];
  const seenInFile = new Map();

  rows.forEach((row, index) => {
    const line = index + 2; // +1 entête, +1 base 1
    const projected = projectRow(row, mapping);

    if (Object.keys(projected).length === 0) {
      errors.push({ line, raw: row, issues: [{ type: 'no_mapping', message: 'Aucune colonne associée pour cette ligne.' }] });
      return;
    }

    const source = String(projected.source ?? '').trim() || 'import';
    const title = String(projected.title ?? '').trim();
    const reference = String(projected.reference ?? '').trim() || null;
    const quantityRaw = parseNumber(projected.quantity);
    const valueRaw = parseNumber(projected.value);
    const maxNotes = (rules && rules.maxNotesLength) || 300;

    const issues = [];
    if (!title) issues.push({ type: 'missing_title', message: 'Le titre est obligatoire.' });
    if (Number.isNaN(quantityRaw)) {
      issues.push({ type: 'invalid_quantity', message: 'La quantité n’est pas un nombre.' });
    }
    if (Number.isNaN(valueRaw)) {
      issues.push({ type: 'invalid_value', message: 'La valeur n’est pas un nombre.' });
    }
    const requestedStatus = normalizeStatus(projected.status);
    if (requestedStatus && !IMPORT_STATUSES.includes(requestedStatus)) {
      issues.push({ type: 'invalid_status', message: `Statut « ${projected.status} » inconnu.` });
    }
    const notes = String(projected.notes ?? '').trim();
    if (notes.length > maxNotes) {
      issues.push({ type: 'long_notes', message: `Les notes dépassent ${maxNotes} caractères.` });
    }

    // Doublons : à l'intérieur du fichier d'abord, puis avec la base
    if (reference) {
      const key = keyOf(source, reference);
      if (seenInFile.has(key)) {
        issues.push({
          type: 'duplicate_reference',
          message: `Doublon dans le fichier (ligne ${seenInFile.get(key).line}).`
        });
      } else {
        seenInFile.set(key, { line, title });
      }
      if (existingKeys.has(key)) {
        issues.push({ type: 'duplicate_reference', message: 'Référence déjà présente en base.' });
      }
    }

    // Erreurs bloquantes : la ligne ne sera pas importée.
    const blocking = issues.some((i) => [
      'missing_title', 'invalid_quantity', 'invalid_value', 'invalid_status',
      'no_mapping', 'duplicate_reference'
    ].includes(i.type));

    if (blocking) {
      errors.push({ line, raw: row, issues });
      return;
    }

    // Avertissements : la ligne est importée mais signalée dans le rapport.
    for (const issue of issues) warnings.push({ line, title, ...issue });

    candidates.push({
      line,
      raw: row,
      record: {
        source,
        reference,
        title,
        category: String(projected.category ?? '').trim() || null,
        quantity: quantityRaw === null || Number.isNaN(quantityRaw) ? 0 : Math.trunc(quantityRaw),
        value: Number.isNaN(valueRaw) ? null : valueRaw,
        notes: notes || null,
        requestedStatus: requestedStatus || null
      }
    });
  });

  const summary = {
    totalRows: rows.length,
    valid: candidates.length,
    errors: errors.length,
    warnings: warnings.length,
    duplicates: errors.filter((e) => e.issues.some((i) => i.type === 'duplicate_reference')).length
  };

  return { rows: candidates, errors, warnings, summary };
}

/** Contrôles de cohérence de l'association des colonnes, avant import. */
function validateMapping(mapping, headers = []) {
  const errors = [];
  const mappedFields = Object.values(mapping || {}).filter(Boolean);

  if (!Object.keys(mapping || {}).length) {
    errors.push('Aucune colonne détectée dans le fichier.');
    return errors;
  }

  const duplicated = mappedFields.filter((f, i) => mappedFields.indexOf(f) !== i);
  if (duplicated.length) {
    errors.push(`Champ « ${duplicated[0]} » associé à plusieurs colonnes.`);
  }

  const missing = REQUIRED_FIELDS.filter((f) => !mappedFields.includes(f));
  if (missing.length) {
    errors.push(`Colonne obligatoire non associée : ${missing.map((f) => FIELD_LABELS[f] || f).join(', ')}.`);
  }

  const unknown = mappedFields.filter((f) => !IMPORT_FIELDS.includes(f));
  if (unknown.length) {
    errors.push(`Champ inconnu : ${unknown.join(', ')}. Champs acceptés : ${IMPORT_FIELDS.join(', ')}.`);
  }

  const knownHeaders = new Set(headers);
  const orphanColumns = Object.keys(mapping).filter((h) => !knownHeaders.has(h));
  if (orphanColumns.length) {
    errors.push(`Colonnes absentes du fichier : ${orphanColumns.join(', ')}.`);
  }

  return errors;
}

/**
 * Écrit les lignes acceptées du plan, dans la transaction du client fourni.
 * Retourne le rapport : importées, ignorées (doublons), erreurs.
 */
async function insertImportPlan(client, plan, { evaluateRecordValidation, DEFAULT_VALIDATION_RULES, defaultStatus = 'en_attente' } = {}) {
  const { rows: ruleRows } = await client.query(
    `SELECT require_category AS "requireCategory",
            detect_duplicate_references AS "detectDuplicateReferences",
            reject_negative_quantity AS "rejectNegativeQuantity",
            reject_negative_value AS "rejectNegativeValue",
            max_notes_length AS "maxNotesLength"
     FROM validation_rules WHERE id = 1`
  );
  const rules = ruleRows[0] || DEFAULT_VALIDATION_RULES;

  const report = { imported: 0, skipped: 0, failed: 0, items: [], issues: [] };

  // Verrou applicatif sur les références : évite deux imports concurrents
  // qui créeraient le même doublon.
  await client.query(`SELECT pg_advisory_xact_lock(hashtext('data-record-reference'), 1)`);

  for (const entry of plan.rows) {
    const record = entry.record;
    if (record.reference) {
      const { rows: dup } = await client.query(
        `SELECT EXISTS (
           SELECT 1 FROM data_records
           WHERE LOWER(BTRIM(source)) = LOWER(BTRIM($1))
             AND LOWER(BTRIM(reference)) = LOWER(BTRIM($2))
         ) AS duplicate`,
        [record.source, record.reference]
      );
      if (dup[0].duplicate) {
        report.skipped += 1;
        report.issues.push({ line: entry.line, title: record.title, type: 'duplicate_reference', message: 'Référence déjà présente en base : ligne ignorée.' });
        continue;
      }
    }

    const { issues, finalStatus } = evaluateRecordValidation(
      { ...record, status: record.requestedStatus || defaultStatus },
      rules,
      { duplicateFound: false }
    );
    // Le statut demandé n'est retenu que si la ligne ne présente aucune
    // anomalie : sinon la règle de validation tranche.
    const status = issues.length ? finalStatus : (record.requestedStatus || finalStatus);

    const { rows: inserted } = await client.query(
      `INSERT INTO data_records (source, reference, title, category, status, quantity, value, notes)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
       RETURNING id, status`,
      [record.source, record.reference, record.title, record.category, status,
        record.quantity, record.value, record.notes]
    );

    for (const issue of issues) {
      const severity = ['missing_source', 'missing_title', 'missing_category', 'duplicate_reference'].includes(issue.type)
        ? 'error'
        : 'warning';
      await client.query(
        `INSERT INTO validation_issues (record_id, issue_type, issue_message, severity)
         VALUES ($1, $2, $3, $4)`,
        [inserted[0].id, issue.type, issue.message, severity]
      );
      report.issues.push({ line: entry.line, title: record.title, ...issue });
    }

    report.imported += 1;
    report.items.push({ line: entry.line, id: inserted[0].id, title: record.title, status: inserted[0].status });
  }

  return report;
}

module.exports = {
  IMPORT_FIELDS,
  IMPORT_STATUSES,
  MAX_ROWS,
  PREVIEW_ROWS,
  normalizeHeader,
  suggestMapping,
  parseImportFile,
  parseNumber,
  normalizeStatus,
  validateMapping,
  buildImportPlan,
  insertImportPlan
};
