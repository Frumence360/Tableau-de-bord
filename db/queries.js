/**
 * Requêtes PostgreSQL. Toutes les fonctions sont asynchrones (pg utilise
 * des promesses) — server.js les appelle avec await.
 */

const pool = require('./index');
const { buildWorkIndicators } = require('./indicators');

// ─── Stats ────────────────────────────────────────────────────────────────────

async function getStats() {
  const { rows } = await pool.query('SELECT * FROM stats');
  const out = {};
  for (const r of rows) {
    out[r.key] = { value: Number(r.value), deltaPct: Number(r.delta_pct) };
    if (r.currency) out[r.key].currency = r.currency;
  }
  return out;
}

// ─── Visites ──────────────────────────────────────────────────────────────────

async function getVisits(range) {
  const days = range === '7d' ? 7 : range === '90d' ? 90 : 30;
  const { rows } = await pool.query(
    'SELECT date, count FROM daily_visits ORDER BY date DESC LIMIT $1',
    [days]
  );
  const ordered = rows.reverse();
  const labels = ordered.map((r) =>
    new Date(r.date).toLocaleDateString('fr-FR', { day: '2-digit', month: 'short' })
  );
  const values = ordered.map((r) => r.count);
  const total = values.reduce((a, b) => a + b, 0);
  const first = values[0] || 0;
  const last = values[values.length - 1] || 0;
  const deltaPct = first ? Math.round(((last - first) / first) * 100) : 0;
  return { range, labels, values, total, deltaPct };
}

// ─── Sources de trafic ────────────────────────────────────────────────────────

async function getTrafficSources() {
  const { rows } = await pool.query(
    'SELECT label, pct, color FROM traffic_sources ORDER BY sort_order'
  );
  return rows.map((r) => ({ label: r.label, pct: Number(r.pct), color: r.color }));
}

// ─── Pays ─────────────────────────────────────────────────────────────────────

async function getCountries() {
  const { rows } = await pool.query(
    'SELECT code, label, pct FROM countries ORDER BY sort_order'
  );
  return rows.map((r) => ({ code: r.code, label: r.label, pct: Number(r.pct) }));
}

// ─── Projets ──────────────────────────────────────────────────────────────────

async function getProjects() {
  const { rows } = await pool.query(
    `SELECT id, title, status, date, thumb_gradient AS "thumbGradient"
     FROM projects ORDER BY date DESC`
  );
  return rows;
}

async function addProject({ title, status, date, thumbGradient }) {
  const gradient = thumbGradient || 'linear-gradient(135deg,#2a5fb0,#173a70)';
  const { rows } = await pool.query(
    `INSERT INTO projects (title, status, date, thumb_gradient)
     VALUES ($1, $2, $3, $4)
     RETURNING id, title, status, date, thumb_gradient AS "thumbGradient"`,
    [title, status, date, gradient]
  );
  return rows[0];
}

async function deleteProject(id) {
  const { rowCount } = await pool.query('DELETE FROM projects WHERE id = $1', [id]);
  return rowCount > 0;
}

function validateProjectPayload(project = {}) {
  const title = String(project.title ?? '').trim();
  const status = String(project.status ?? '').trim();
  const date = String(project.date ?? '').trim();
  const allowedStatus = ['En cours', 'Livré'];

  if (!title) return { valid: false, error: 'Titre du projet requis.' };
  if (!date) return { valid: false, error: 'Date du projet requise.' };
  if (!allowedStatus.includes(status)) {
    return { valid: false, error: 'Statut du projet invalide.' };
  }

  return {
    valid: true,
    value: {
      title,
      status,
      date,
      thumbGradient: project.thumbGradient || null
    }
  };
}

async function updateProject(id, { title, status, date, thumbGradient } = {}) {
  const validation = validateProjectPayload({ title, status, date, thumbGradient });
  if (!validation.valid) return { error: validation.error };

  const { rows } = await pool.query(
    `UPDATE projects
     SET title = $1, status = $2, date = $3, thumb_gradient = $4
     WHERE id = $5
     RETURNING id, title, status, date, thumb_gradient AS "thumbGradient"`,
    [validation.value.title, validation.value.status, validation.value.date,
      validation.value.thumbGradient || 'linear-gradient(135deg,#2a5fb0,#173a70)', id]
  );

  return rows[0] || null;
}

// ─── Clients ──────────────────────────────────────────────────────────────────

async function getClients() {
  const { rows } = await pool.query(
    'SELECT id, name, company, email, site, status FROM clients ORDER BY created_at DESC'
  );
  return rows;
}

// ─── Commandes ────────────────────────────────────────────────────────────────

async function getOrders() {
  const { rows } = await pool.query(
    `SELECT id, ref, client_name AS "clientName", item, amount, status, date
     FROM orders ORDER BY date DESC`
  );
  return rows;
}

// ─── Messages ─────────────────────────────────────────────────────────────────

async function getMessages() {
  const { rows } = await pool.query(
    `SELECT id, sender, subject, body, is_read AS "isRead", created_at AS "createdAt"
     FROM messages ORDER BY created_at DESC`
  );
  return rows;
}

async function markAllMessagesRead() {
  await pool.query('UPDATE messages SET is_read = true WHERE is_read = false');
}

// ─── Données capturées ──────────────────────────────────────────────────────

/** Normalise page/limit : page >= 1, limit entre 1 et 200 (defaut 50). */
function safeLimit(limit) {
  const parsed = Number.parseInt(limit, 10);
  return Number.isFinite(parsed) && parsed > 0 ? Math.min(parsed, 200) : 50;
}

function safePage(page) {
  const parsed = Number.parseInt(page, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 1;
}

/** Construit le WHERE commun aux fiches + anomalies, à partir des filtres. */
function buildRecordFilters({ status, source, category, search } = {}) {
  const conditions = [];
  const params = [];

  const add = (sql, value) => {
    params.push(value);
    conditions.push(sql.replace('$?', `$${params.length}`));
  };

  if (status) add('dr.status = $?', String(status).trim().toLowerCase());
  if (source) add('LOWER(dr.source) = LOWER($?)', String(source).trim());
  if (category) add('LOWER(dr.category) = LOWER($?)', String(category).trim());
  if (search) {
    // Un meme parametre est reutilise trois fois : on l'ajoute une seule fois.
    params.push(`%${String(search).trim()}%`);
    const idx = params.length;
    conditions.push(`(dr.title ILIKE $${idx} OR dr.reference ILIKE $${idx} OR dr.notes ILIKE $${idx})`);
  }
  return { where: conditions.length ? `WHERE ${conditions.join(' AND ')}` : '', params };
}

async function getRecordsPage(filters = {}) {
  const page = safePage(filters.page);
  const limit = safeLimit(filters.limit);
  const { where, params } = buildRecordFilters(filters);

  const countResult = await pool.query(
    `SELECT COUNT(*)::int AS total FROM data_records dr ${where}`,
    params
  );
  const total = countResult.rows[0].total;
  const offset = (page - 1) * limit;

  const { rows } = await pool.query(
    `SELECT dr.id, dr.source, dr.reference, dr.title, dr.category, dr.status,
            dr.quantity, dr.value, dr.notes,
            dr.created_at AS "createdAt", dr.updated_at AS "updatedAt"
     FROM data_records dr
     ${where}
     ORDER BY dr.created_at DESC, dr.id DESC
     LIMIT $${params.length + 1} OFFSET $${params.length + 2}`,
    [...params, limit, offset]
  );

  return {
    items: rows.map((r) => ({
      ...r,
      quantity: Number(r.quantity || 0),
      value: r.value === null ? null : Number(r.value)
    })),
    page,
    limit,
    total,
    totalPages: Math.max(1, Math.ceil(total / limit))
  };
}

async function getValidationIssuesPage(filters = {}) {
  const page = safePage(filters.page);
  const limit = safeLimit(filters.limit);

  const conditions = [];
  const params = [];
  const add = (sql, value) => {
    params.push(value);
    conditions.push(sql.replace('$?', `$${params.length}`));
  };
  if (filters.status) add('dr.status = $?', String(filters.status).trim().toLowerCase());
  if (filters.source) add('LOWER(dr.source) = LOWER($?)', String(filters.source).trim());
  if (filters.severity) add('vi.severity = $?', String(filters.severity).trim().toLowerCase());
  const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';

  const countResult = await pool.query(
    `SELECT COUNT(*)::int AS total FROM validation_issues vi
     JOIN data_records dr ON dr.id = vi.record_id ${where}`,
    params
  );
  const total = countResult.rows[0].total;
  const offset = (page - 1) * limit;

  const { rows } = await pool.query(
    `SELECT vi.id, vi.record_id AS "recordId", vi.issue_type AS "issueType",
            vi.issue_message AS "issueMessage", vi.severity, vi.created_at AS "createdAt",
            dr.title, dr.source, dr.status
     FROM validation_issues vi
     JOIN data_records dr ON dr.id = vi.record_id
     ${where}
     ORDER BY vi.created_at DESC, vi.id DESC
     LIMIT $${params.length + 1} OFFSET $${params.length + 2}`,
    [...params, limit, offset]
  );

  return {
    items: rows,
    page,
    limit,
    total,
    totalPages: Math.max(1, Math.ceil(total / limit))
  };
}

async function getRecords() {
  const { rows } = await pool.query(
    `SELECT id, source, reference, title, category, status, quantity, value, notes,
            created_at AS "createdAt", updated_at AS "updatedAt"
     FROM data_records
     ORDER BY created_at DESC`
  );
  return rows.map((r) => ({
    ...r,
    quantity: Number(r.quantity || 0),
    value: r.value === null ? null : Number(r.value)
  }));
}

const DEFAULT_VALIDATION_RULES = {
  requireCategory: true,
  detectDuplicateReferences: true,
  rejectNegativeQuantity: true,
  rejectNegativeValue: true,
  maxNotesLength: 300
};

async function getValidationRules() {
  const { rows } = await pool.query(
    `SELECT require_category AS "requireCategory",
            detect_duplicate_references AS "detectDuplicateReferences",
            reject_negative_quantity AS "rejectNegativeQuantity",
            reject_negative_value AS "rejectNegativeValue",
            max_notes_length AS "maxNotesLength"
     FROM validation_rules WHERE id = 1`
  );
  return rows[0] || { ...DEFAULT_VALIDATION_RULES };
}

async function updateValidationRules(rules) {
  const { rows } = await pool.query(
    `UPDATE validation_rules
     SET require_category = $1,
         detect_duplicate_references = $2,
         reject_negative_quantity = $3,
         reject_negative_value = $4,
         max_notes_length = $5,
         updated_at = now()
     WHERE id = 1
     RETURNING require_category AS "requireCategory",
               detect_duplicate_references AS "detectDuplicateReferences",
               reject_negative_quantity AS "rejectNegativeQuantity",
               reject_negative_value AS "rejectNegativeValue",
               max_notes_length AS "maxNotesLength"`,
    [rules.requireCategory, rules.detectDuplicateReferences, rules.rejectNegativeQuantity,
      rules.rejectNegativeValue, rules.maxNotesLength]
  );
  return rows[0];
}

function evaluateRecordValidation(
  { source, reference, title, category, status, quantity, value, notes },
  rules = DEFAULT_VALIDATION_RULES,
  { duplicateFound = false } = {}
) {
  const issues = [];

  if (!source || !String(source).trim()) {
    issues.push({ issueType: 'missing_source', message: 'La source est manquante.' });
  }

  if (!title || !String(title).trim()) {
    issues.push({ issueType: 'missing_title', message: 'Le titre est obligatoire.' });
  }

  if (rules.requireCategory && (!category || !String(category).trim())) {
    issues.push({ issueType: 'missing_category', message: 'La catégorie est absente.' });
  }

  if (rules.rejectNegativeQuantity && Number(quantity || 0) < 0) {
    issues.push({ issueType: 'invalid_quantity', message: 'La quantité ne peut pas être négative.' });
  }

  if (rules.rejectNegativeValue && value !== undefined && value !== null && value !== '' && Number(value) < 0) {
    issues.push({ issueType: 'invalid_value', message: 'La valeur ne peut pas être négative.' });
  }

  if (notes && String(notes).trim().length > rules.maxNotesLength) {
    issues.push({ issueType: 'long_notes', message: `Les notes dépassent ${rules.maxNotesLength} caractères.` });
  }

  if (duplicateFound) {
    issues.push({ issueType: 'duplicate_reference', message: 'Cette référence existe déjà pour cette source.' });
  }

  const allowedStatuses = ['en_attente', 'valide', 'incomplet', 'rejete'];
  if (status && !allowedStatuses.includes(status)) {
    issues.push({ issueType: 'invalid_status', message: 'Le statut fourni n’est pas valide.' });
  }

  let finalStatus = 'valide';
  if (issues.some((i) => ['duplicate_reference', 'invalid_quantity', 'invalid_value', 'invalid_status'].includes(i.issueType))) {
    finalStatus = 'rejete';
  } else if (issues.some((i) => ['missing_source', 'missing_title', 'missing_category'].includes(i.issueType))) {
    finalStatus = 'incomplet';
  } else if (issues.length === 0) {
    finalStatus = status || 'valide';
  } else {
    finalStatus = 'incomplet';
  }

  return { issues, finalStatus };
}

async function addRecord({ source, reference, title, category, status, quantity, value, notes }) {
  const payload = {
    source: String(source || 'manuel').trim(),
    reference: reference ? String(reference).trim() || null : null,
    title: String(title || 'Nouvelle donnée').trim(),
    category: category ? String(category).trim() || null : null,
    status: status || 'en_attente',
    quantity: Number(quantity || 0),
    value: value === undefined || value === null || value === '' ? null : Number(value),
    notes: notes ? String(notes).trim() || null : null
  };
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const { rows: rulesRows } = await client.query(
      `SELECT require_category AS "requireCategory",
              detect_duplicate_references AS "detectDuplicateReferences",
              reject_negative_quantity AS "rejectNegativeQuantity",
              reject_negative_value AS "rejectNegativeValue",
              max_notes_length AS "maxNotesLength"
       FROM validation_rules WHERE id = 1`
    );
    const rules = rulesRows[0] || DEFAULT_VALIDATION_RULES;
    let duplicateFound = false;
    const normalizedReference = payload.reference && payload.reference.toLocaleLowerCase('en-US');
    const normalizedSource = payload.source.toLocaleLowerCase('en-US');
    if (rules.detectDuplicateReferences && normalizedReference) {
      const duplicateKey = JSON.stringify([normalizedSource, normalizedReference]);
      await client.query(
        `SELECT pg_advisory_xact_lock(hashtext('data-record-reference'), hashtext($1))`,
        [duplicateKey]
      );
      const { rows: duplicateRows } = await client.query(
        `SELECT EXISTS (
           SELECT 1 FROM data_records
           WHERE LOWER(BTRIM(source)) = $1 AND LOWER(BTRIM(reference)) = $2
         ) AS duplicate`,
        [normalizedSource, normalizedReference]
      );
      duplicateFound = duplicateRows[0].duplicate;
    }

    const { issues, finalStatus } = evaluateRecordValidation(payload, rules, { duplicateFound });
    const { rows } = await client.query(
      `INSERT INTO data_records (source, reference, title, category, status, quantity, value, notes)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
       RETURNING id, source, reference, title, category, status, quantity, value, notes,
                 created_at AS "createdAt", updated_at AS "updatedAt"`,
      [payload.source, payload.reference, payload.title, payload.category, finalStatus,
        payload.quantity, payload.value, payload.notes]
    );

    const record = rows[0];
    for (const issue of issues) {
      const severity = ['missing_source', 'missing_title', 'missing_category', 'duplicate_reference'].includes(issue.issueType)
        ? 'error'
        : 'warning';
      await client.query(
        `INSERT INTO validation_issues (record_id, issue_type, issue_message, severity)
         VALUES ($1, $2, $3, $4)`,
        [record.id, issue.issueType, issue.message, severity]
      );
    }
    await client.query('COMMIT');
    return { ...record, validationIssues: issues, status: finalStatus };
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

async function addRecordAttachment({ recordId, fileName, content, uploadedBy }) {
  const { rows } = await pool.query(
    `INSERT INTO record_attachments (record_id, file_name, content, file_size, uploaded_by)
     VALUES ($1, $2, $3, $4, $5)
     RETURNING id, record_id AS "recordId", file_name AS "fileName",
               file_size AS "fileSize", created_at AS "createdAt"`,
    [recordId, fileName, content, content.length, uploadedBy]
  );
  return rows[0];
}

async function getRecordAttachments(recordId) {
  const { rows } = await pool.query(
    `SELECT id, record_id AS "recordId", file_name AS "fileName",
            file_size AS "fileSize", created_at AS "createdAt"
     FROM record_attachments WHERE record_id = $1 ORDER BY created_at DESC`,
    [recordId]
  );
  return rows;
}

async function getRecordAttachment(recordId, attachmentId) {
  const { rows } = await pool.query(
    `SELECT id, record_id AS "recordId", file_name AS "fileName", content, file_size AS "fileSize"
     FROM record_attachments WHERE record_id = $1 AND id = $2`,
    [recordId, attachmentId]
  );
  return rows[0] || null;
}

async function getValidationIssues() {
  const { rows } = await pool.query(
    `SELECT vi.id, vi.record_id AS "recordId", vi.issue_type AS "issueType",
            vi.issue_message AS "issueMessage", vi.severity, vi.created_at AS "createdAt",
            dr.title, dr.source, dr.status
     FROM validation_issues vi
     JOIN data_records dr ON dr.id = vi.record_id
     ORDER BY vi.created_at DESC`
  );
  return rows;
}

async function updateRecordStatus(id, status, { correctedBy, reason } = {}) {
  const allowed = ['en_attente', 'valide', 'incomplet', 'rejete'];
  if (!allowed.includes(status)) {
    throw new Error('Statut invalide');
  }

  const result = await updateRecord(id, { status }, { correctedBy, reason, canValidateStatus: true });
  if (!result) return null;
  if (result.error) throw new Error('Statut invalide');
  return { id: result.record.id, status: result.record.status };
}

const EDITABLE_RECORD_FIELDS = ['source', 'reference', 'title', 'category', 'quantity', 'value', 'notes'];
const RECORD_STATUSES = ['en_attente', 'valide', 'incomplet', 'rejete'];

function normalizeRecordPayload(input = {}, base = {}) {
  const current = { ...base, ...input };
  return {
    source: current.source === undefined ? undefined : String(current.source || 'manuel').trim(),
    reference: current.reference ? String(current.reference).trim() || null : null,
    title: current.title === undefined ? undefined : String(current.title || '').trim(),
    category: current.category ? String(current.category).trim() || null : null,
    quantity: current.quantity === undefined || current.quantity === null || current.quantity === ''
      ? undefined
      : Number(current.quantity),
    value: current.value === undefined || current.value === null || current.value === ''
      ? null
      : Number(current.value),
    notes: current.notes ? String(current.notes).trim() || null : null
  };
}

function sameValue(a, b) {
  if (a === null || a === undefined || a === '') return b === null || b === undefined || b === '';
  if (b === null || b === undefined || b === '') return a === null || a === undefined || a === '';
  return String(a) === String(b);
}

/**
 * Met à jour une fiche (champs + statut) et journalise chaque champ modifié
 * dans data_corrections avec l'avant/après et l'auteur. Les anomalies de
 * validation sont recalculées : les anciennes issues de la fiche sont
 * remplacées par celles correspondant à l'état corrigé.
 */
async function updateRecord(id, patch = {}, { correctedBy, reason, canValidateStatus = false } = {}) {
  const author = correctedBy || 'system';

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    const { rows: existingRows } = await client.query(
      `SELECT id, source, reference, title, category, status, quantity, value, notes
       FROM data_records WHERE id = $1 FOR UPDATE`,
      [id]
    );
    const existing = existingRows[0];
    if (!existing) {
      await client.query('ROLLBACK');
      return null;
    }

    const payload = normalizeRecordPayload(patch, existing);

    const requestedStatus = patch.status === undefined ? undefined : String(patch.status || '').trim();
    if (requestedStatus !== undefined && !RECORD_STATUSES.includes(requestedStatus)) {
      await client.query('ROLLBACK');
      return { error: 'invalid_status' };
    }
    if (payload.quantity !== undefined && !Number.isInteger(payload.quantity)) {
      await client.query('ROLLBACK');
      return { error: 'invalid_quantity' };
    }
    if (payload.value !== null && payload.value !== undefined && !Number.isFinite(payload.value)) {
      await client.query('ROLLBACK');
      return { error: 'invalid_value' };
    }

    // Détection de doublon sur (source, reference) en excluant la fiche courante
    const nextSource = payload.source === undefined ? existing.source : payload.source;
    const nextReference = payload.reference === undefined ? existing.reference : payload.reference;
    const { rows: rulesRows } = await client.query(
      `SELECT require_category AS "requireCategory",
              detect_duplicate_references AS "detectDuplicateReferences",
              reject_negative_quantity AS "rejectNegativeQuantity",
              reject_negative_value AS "rejectNegativeValue",
              max_notes_length AS "maxNotesLength"
       FROM validation_rules WHERE id = 1`
    );
    const rules = rulesRows[0] || DEFAULT_VALIDATION_RULES;
    let duplicateFound = false;
    if (rules.detectDuplicateReferences && nextReference) {
      const duplicateKey = JSON.stringify([nextSource.toLocaleLowerCase('en-US'), nextReference.toLocaleLowerCase('en-US')]);
      await client.query(
        `SELECT pg_advisory_xact_lock(hashtext('data-record-reference'), hashtext($1))`,
        [duplicateKey]
      );
      const { rows: duplicateRows } = await client.query(
        `SELECT EXISTS (
           SELECT 1 FROM data_records
           WHERE id <> $3
             AND LOWER(BTRIM(source)) = LOWER(BTRIM($1))
             AND LOWER(BTRIM(reference)) = LOWER(BTRIM($2))
         ) AS duplicate`,
        [nextSource, nextReference, id]
      );
      duplicateFound = duplicateRows[0].duplicate;
    }

    const candidate = {
      source: nextSource,
      reference: nextReference,
      title: payload.title === undefined ? existing.title : payload.title,
      category: payload.category === undefined ? existing.category : payload.category,
      quantity: payload.quantity === undefined ? existing.quantity : payload.quantity,
      value: payload.value === undefined ? existing.value : payload.value,
      notes: payload.notes === undefined ? existing.notes : payload.notes
    };
    const { issues, finalStatus } = evaluateRecordValidation(
      { ...candidate, status: requestedStatus },
      rules,
      { duplicateFound }
    );

    // Champs réellement modifiés → historique avant/après
    const changes = [];
    for (const field of EDITABLE_RECORD_FIELDS) {
      if (payload[field] === undefined) continue;
      if (!sameValue(existing[field], payload[field])) {
        changes.push({
          fieldName: field,
          oldValue: existing[field],
          newValue: payload[field]
        });
      }
    }

    const nextStatus = requestedStatus !== undefined
      ? requestedStatus
      : (canValidateStatus || finalStatus !== 'valide' ? finalStatus : existing.status);
    if (!sameValue(existing.status, nextStatus)) {
      changes.push({ fieldName: 'status', oldValue: existing.status, newValue: nextStatus });
    }

    const { rows: updatedRows } = await client.query(
      `UPDATE data_records
       SET source = $1, reference = $2, title = $3, category = $4, status = $5,
           quantity = $6, value = $7, notes = $8, updated_at = now()
       WHERE id = $9
       RETURNING id, source, reference, title, category, status, quantity, value, notes,
                 created_at AS "createdAt", updated_at AS "updatedAt"`,
      [
        nextSource,
        nextReference,
        candidate.title,
        candidate.category,
        nextStatus,
        candidate.quantity,
        candidate.value,
        candidate.notes,
        id
      ]
    );
    const record = updatedRows[0];

    for (const change of changes) {
      await client.query(
        `INSERT INTO data_corrections (record_id, corrected_by, field_name, old_value, new_value, reason)
         VALUES ($1, $2, $3, $4, $5, $6)`,
        [
          id,
          author,
          change.fieldName,
          change.oldValue === null || change.oldValue === undefined ? null : String(change.oldValue),
          change.newValue === null || change.newValue === undefined ? null : String(change.newValue),
          reason || null
        ]
      );
    }

    // On recharge les anomalies de la fiche avec l'état corrigé
    await client.query('DELETE FROM validation_issues WHERE record_id = $1', [id]);
    for (const issue of issues) {
      const severity = ['missing_source', 'missing_title', 'missing_category', 'duplicate_reference'].includes(issue.issueType)
        ? 'error'
        : 'warning';
      await client.query(
        `INSERT INTO validation_issues (record_id, issue_type, issue_message, severity)
         VALUES ($1, $2, $3, $4)`,
        [id, issue.issueType, issue.message, severity]
      );
    }

    await client.query('COMMIT');
    return {
      record: {
        ...record,
        quantity: Number(record.quantity || 0),
        value: record.value === null ? null : Number(record.value)
      },
      changes,
      validationIssues: issues
    };
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

async function addCorrection({ recordId, correctedBy, fieldName, oldValue, newValue, reason }) {
  const { rows } = await pool.query(
    `INSERT INTO data_corrections (record_id, corrected_by, field_name, old_value, new_value, reason)
     VALUES ($1, $2, $3, $4, $5, $6)
     RETURNING id, record_id AS "recordId", corrected_by AS "correctedBy",
               field_name AS "fieldName", old_value AS "oldValue",
               new_value AS "newValue", reason, created_at AS "createdAt"`,
    [
      recordId,
      correctedBy || 'system',
      fieldName || null,
      oldValue === undefined ? null : String(oldValue),
      newValue === undefined ? null : String(newValue),
      reason || null
    ]
  );
  return rows[0];
}

async function getCorrections() {
  const { rows } = await pool.query(
    `SELECT dc.id, dc.record_id AS "recordId", dc.corrected_by AS "correctedBy",
            dc.field_name AS "fieldName", dc.old_value AS "oldValue",
            dc.new_value AS "newValue", dc.reason, dc.created_at AS "createdAt",
            dr.title, dr.source
     FROM data_corrections dc
     JOIN data_records dr ON dr.id = dc.record_id
     ORDER BY dc.created_at DESC`
  );
  return rows;
}

async function archiveRecord({ recordId, archiveCode, classification, confidentiality, retentionYears, archivedBy, reason }) {
  const found = await pool.query('SELECT id FROM data_records WHERE id = $1', [recordId]);
  if (found.rowCount === 0) {
    return null;
  }

  const classificationValue = ['interne', 'externe', 'reglementaire', 'confidentielle'].includes(classification)
    ? classification
    : 'interne';
  const confidentialityValue = ['public', 'interne', 'confidentiel', 'strict'].includes(confidentiality)
    ? confidentiality
    : 'interne';
  const retentionValue = Number(retentionYears || 3);
  const finalCode = (archiveCode || `ARCH-${Date.now()}`).trim() || `ARCH-${Date.now()}`;

  const { rows } = await pool.query(
    `INSERT INTO data_archives (record_id, archive_code, classification, confidentiality, retention_years, archived_by, reason)
     VALUES ($1, $2, $3, $4, $5, $6, $7)
     RETURNING id, record_id AS "recordId", archive_code AS "archiveCode",
               classification, confidentiality, retention_years AS "retentionYears",
               archived_by AS "archivedBy", reason, archived_at AS "archivedAt"`,
    [recordId, finalCode, classificationValue, confidentialityValue, retentionValue, archivedBy || 'system', reason || null]
  );

  return rows[0];
}

async function getArchives() {
  const { rows } = await pool.query(
    `SELECT da.id, da.record_id AS "recordId", da.archive_code AS "archiveCode",
            da.classification, da.confidentiality, da.retention_years AS "retentionYears",
            da.archived_by AS "archivedBy", da.reason, da.archived_at AS "archivedAt",
            dr.title, dr.source, dr.status
     FROM data_archives da
     JOIN data_records dr ON dr.id = da.record_id
     ORDER BY da.archived_at DESC`
  );
  return rows;
}

/**
 * Indicateurs de pilotage du travail réel : collecte, anomalies, validation,
 * archivage. Agrège les quatre familles de données en une seule lecture
 * parallèle, puis délègue le calcul à db/indicators.js (fonction pure).
 */
async function getWorkIndicators(range = '30d') {
  const [records, issues, corrections, archives] = await Promise.all([
    getRecords(),
    getValidationIssues(),
    getCorrections(),
    getArchives()
  ]);
  return buildWorkIndicators(records, issues, corrections, archives, { range });
}

function buildDataReport(records = [], archives = []) {
  const archivedIds = new Set((archives || []).map((item) => Number(item.record_id ?? item.recordId)));
  const byStatus = { en_attente: 0, valide: 0, incomplet: 0, rejete: 0 };
  const byCategory = {};
  const bySource = {};
  let totalValue = 0;

  for (const record of records || []) {
    const status = record.status || 'en_attente';
    const category = record.category || 'general';
    const source = record.source || 'inconnu';

    byStatus[status] = (byStatus[status] || 0) + 1;
    byCategory[category] = (byCategory[category] || 0) + 1;
    bySource[source] = (bySource[source] || 0) + 1;
    totalValue += Number(record.value || 0);
  }

  return {
    total: (records || []).length,
    archivedRecords: [...archivedIds].filter((id) => Number.isFinite(id)).length,
    byStatus,
    categoryBreakdown: byCategory,
    sourceBreakdown: bySource,
    totalValue,
    averageValue: (records || []).length ? totalValue / (records || []).length : 0
  };
}

function generateRecordsCsv(records = []) {
  const header = ['source', 'reference', 'title', 'category', 'status', 'quantity', 'value'];
  const rows = records.map((record) => [
    record.source || '',
    record.reference || '',
    record.title || '',
    record.category || '',
    record.status || 'en_attente',
    Number(record.quantity || 0),
    record.value == null ? '' : Number(record.value)
  ]);

  const escapeCsv = (value) => {
    const stringValue = String(value ?? '');
    return /[",\n]/.test(stringValue)
      ? `"${stringValue.replace(/"/g, '""')}"`
      : stringValue;
  };

  return [header, ...rows].map((line) => line.map(escapeCsv).join(',')).join('\n');
}

function getRolePermissions(role = 'capturer') {
  const permissions = {
    admin: ['read', 'write', 'validate', 'archive', 'export', 'manage_users'],
    manager: ['read', 'write', 'validate', 'archive', 'export'],
    capturer: ['read', 'write'],
    viewer: ['read']
  };
  return permissions[role] || permissions.capturer;
}

function buildAuditSummary(logs = []) {
  const summary = {};
  for (const item of logs) {
    const action = item && item.action ? item.action : 'unknown';
    summary[action] = (summary[action] || 0) + 1;
  }
  return summary;
}

async function addAuditLog({ userId, username, action, entity, details }) {
  await pool.query(
    `INSERT INTO audit_logs (user_id, username, action, entity, details)
     VALUES ($1, $2, $3, $4, $5)`,
    [userId || null, username || null, action || 'unknown', entity || null, details ? JSON.stringify(details) : null]
  );
}

async function getAuditLogs() {
  const { rows } = await pool.query(
    `SELECT id, user_id AS "userId", username, action, entity, details, created_at AS "createdAt"
     FROM audit_logs ORDER BY created_at DESC LIMIT 100`
  );
  return rows;
}

async function withUserAdminLock(operation) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query('SELECT pg_advisory_xact_lock(20260926, 1)');
    const result = await operation(client);
    await client.query('COMMIT');
    return result;
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

async function countActiveAdmins(client) {
  const { rows } = await client.query(
    `SELECT COUNT(*)::integer AS count
     FROM users u
     LEFT JOIN user_roles ur ON ur.user_id = u.id
     WHERE u.is_active AND COALESCE(ur.role, 'capturer') = 'admin'`
  );
  return rows[0].count;
}

async function setUserRole(userId, role) {
  const allowed = ['admin', 'manager', 'capturer', 'viewer'];
  if (!allowed.includes(role)) return { error: 'invalid_role' };

  return withUserAdminLock(async (client) => {
    const { rows: users } = await client.query(
      `SELECT u.id, u.username, u.is_active, COALESCE(ur.role, 'capturer') AS role
       FROM users u LEFT JOIN user_roles ur ON ur.user_id = u.id
       WHERE u.id = $1 FOR UPDATE OF u`,
      [userId]
    );
    const user = users[0];
    if (!user) return null;
    if (user.is_active && user.role === 'admin' && role !== 'admin' && await countActiveAdmins(client) <= 1) {
      return { error: 'last_admin' };
    }

    const { rows } = await client.query(
      `INSERT INTO user_roles (user_id, role) VALUES ($1, $2)
       ON CONFLICT (user_id) DO UPDATE SET role = EXCLUDED.role
       RETURNING user_id AS "userId", role`,
      [userId, role]
    );
    return rows[0];
  });
}

async function getUserRole(userId) {
  const { rows } = await pool.query(
    `SELECT role FROM user_roles WHERE user_id = $1`,
    [userId]
  );
  return rows[0] ? rows[0].role : 'capturer';
}

async function getUsers() {
  const { rows } = await pool.query(
    `SELECT u.id, u.username, u.is_active AS "isActive", COALESCE(ur.role, 'capturer') AS role
     FROM users u
     LEFT JOIN user_roles ur ON ur.user_id = u.id
     ORDER BY u.id ASC`
  );
  return rows;
}

async function addUser({ username, passwordHash, role }) {
  const { rows } = await pool.query(
    `WITH created_user AS (
       INSERT INTO users (username, password_hash)
       VALUES ($1, $2)
       RETURNING id, username
     ), created_role AS (
       INSERT INTO user_roles (user_id, role)
       SELECT id, $3 FROM created_user
       RETURNING user_id, role
     )
     SELECT created_user.id, created_user.username, created_role.role
     FROM created_user
     JOIN created_role ON created_role.user_id = created_user.id`,
    [username, passwordHash, role]
  );
  return rows[0];
}

async function resetUserPassword(userId, passwordHash) {
  const { rows } = await pool.query(
    `UPDATE users SET password_hash = $1, token_version = token_version + 1
     WHERE id = $2 RETURNING id, username`,
    [passwordHash, userId]
  );
  return rows[0];
}

async function setUserActive(userId, isActive) {
  return withUserAdminLock(async (client) => {
    const { rows: users } = await client.query(
      `SELECT u.id, u.username, u.is_active, COALESCE(ur.role, 'capturer') AS role
       FROM users u LEFT JOIN user_roles ur ON ur.user_id = u.id
       WHERE u.id = $1 FOR UPDATE OF u`,
      [userId]
    );
    const user = users[0];
    if (!user) return null;
    if (!isActive && user.is_active && user.role === 'admin' && await countActiveAdmins(client) <= 1) {
      return { error: 'last_admin' };
    }
    const { rows } = await client.query(
      `UPDATE users SET is_active = $1, token_version = token_version + 1
       WHERE id = $2 AND is_active IS DISTINCT FROM $1
       RETURNING id, username, is_active AS "isActive"`,
      [isActive, userId]
    );
    return rows[0] || { id: user.id, username: user.username, isActive: user.is_active };
  });
}

// ─── Exports ──────────────────────────────────────────────────────────────────

module.exports = {
  getStats,
  getVisits,
  getTrafficSources,
  getCountries,
  getProjects,
  addProject,
  deleteProject,
  validateProjectPayload,
  updateProject,
  getClients,
  getOrders,
  getMessages,
  markAllMessagesRead,
  getRecords,
  getRecordsPage,
  getValidationIssuesPage,
  addRecord,
  addRecordAttachment,
  getRecordAttachments,
  getRecordAttachment,
  getValidationIssues,
  evaluateRecordValidation,
  getValidationRules,
  updateValidationRules,
  updateRecordStatus,
  updateRecord,
  addCorrection,
  getCorrections,
  archiveRecord,
  getArchives,
  getWorkIndicators,
  buildDataReport,
  generateRecordsCsv,
  getRolePermissions,
  buildAuditSummary,
  addAuditLog,
  getAuditLogs,
  setUserRole,
  getUserRole,
  getUsers,
  addUser,
  resetUserPassword,
  setUserActive
};
