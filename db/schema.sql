-- Schéma PostgreSQL du dashboard Frumence Maintenance

CREATE TABLE IF NOT EXISTS users (
  id SERIAL PRIMARY KEY,
  username TEXT UNIQUE NOT NULL,
  password_hash TEXT NOT NULL,
  token_version INTEGER NOT NULL DEFAULT 1,
  is_active BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE IF NOT EXISTS stats (
  key TEXT PRIMARY KEY,
  label TEXT NOT NULL,
  value NUMERIC NOT NULL,
  currency TEXT,
  delta_pct NUMERIC NOT NULL
);

CREATE TABLE IF NOT EXISTS traffic_sources (
  id SERIAL PRIMARY KEY,
  label TEXT NOT NULL,
  pct NUMERIC NOT NULL,
  color TEXT NOT NULL,
  sort_order INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS countries (
  id SERIAL PRIMARY KEY,
  code TEXT,
  label TEXT NOT NULL,
  pct NUMERIC NOT NULL,
  sort_order INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS projects (
  id SERIAL PRIMARY KEY,
  title TEXT NOT NULL,
  status TEXT NOT NULL,
  date DATE NOT NULL,
  thumb_gradient TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS daily_visits (
  date DATE PRIMARY KEY,
  count INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS clients (
  id SERIAL PRIMARY KEY,
  name TEXT NOT NULL,
  company TEXT,
  email TEXT,
  site TEXT,
  status TEXT NOT NULL DEFAULT 'Actif',
  created_at TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE IF NOT EXISTS orders (
  id SERIAL PRIMARY KEY,
  ref TEXT NOT NULL,
  client_name TEXT NOT NULL,
  item TEXT NOT NULL,
  amount NUMERIC NOT NULL,
  status TEXT NOT NULL DEFAULT 'En attente',
  date DATE NOT NULL
);

CREATE TABLE IF NOT EXISTS messages (
  id SERIAL PRIMARY KEY,
  sender TEXT NOT NULL,
  subject TEXT NOT NULL,
  body TEXT NOT NULL,
  is_read BOOLEAN NOT NULL DEFAULT false,
  created_at TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE IF NOT EXISTS data_records (
  id SERIAL PRIMARY KEY,
  source TEXT NOT NULL,
  reference TEXT,
  title TEXT NOT NULL,
  category TEXT,
  status TEXT NOT NULL DEFAULT 'en_attente',
  quantity INTEGER DEFAULT 0,
  value NUMERIC,
  notes TEXT,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE IF NOT EXISTS record_attachments (
  id SERIAL PRIMARY KEY,
  record_id INTEGER NOT NULL REFERENCES data_records(id) ON DELETE CASCADE,
  file_name TEXT NOT NULL,
  content BYTEA NOT NULL,
  file_size INTEGER NOT NULL,
  uploaded_by TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_record_attachments_record_id
  ON record_attachments (record_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_data_records_source_reference_ci
  ON data_records (LOWER(BTRIM(source)), LOWER(BTRIM(reference)))
  WHERE reference IS NOT NULL;

CREATE TABLE IF NOT EXISTS validation_issues (
  id SERIAL PRIMARY KEY,
  record_id INTEGER NOT NULL REFERENCES data_records(id) ON DELETE CASCADE,
  issue_type TEXT NOT NULL,
  issue_message TEXT NOT NULL,
  severity TEXT NOT NULL DEFAULT 'warning',
  created_at TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE IF NOT EXISTS validation_rules (
  id SMALLINT PRIMARY KEY DEFAULT 1 CHECK (id = 1),
  require_category BOOLEAN NOT NULL DEFAULT true,
  detect_duplicate_references BOOLEAN NOT NULL DEFAULT true,
  reject_negative_quantity BOOLEAN NOT NULL DEFAULT true,
  reject_negative_value BOOLEAN NOT NULL DEFAULT true,
  max_notes_length INTEGER NOT NULL DEFAULT 300 CHECK (max_notes_length BETWEEN 1 AND 5000),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

INSERT INTO validation_rules (id) VALUES (1) ON CONFLICT (id) DO NOTHING;

CREATE TABLE IF NOT EXISTS data_corrections (
  id SERIAL PRIMARY KEY,
  record_id INTEGER NOT NULL REFERENCES data_records(id) ON DELETE CASCADE,
  corrected_by TEXT NOT NULL DEFAULT 'system',
  field_name TEXT,
  old_value TEXT,
  new_value TEXT,
  reason TEXT,
  created_at TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE IF NOT EXISTS data_archives (
  id SERIAL PRIMARY KEY,
  record_id INTEGER NOT NULL REFERENCES data_records(id) ON DELETE CASCADE,
  archive_code TEXT NOT NULL UNIQUE,
  classification TEXT NOT NULL DEFAULT 'interne',
  confidentiality TEXT NOT NULL DEFAULT 'interne',
  retention_years INTEGER NOT NULL DEFAULT 3,
  archived_by TEXT NOT NULL DEFAULT 'system',
  reason TEXT,
  archived_at TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE IF NOT EXISTS user_roles (
  id SERIAL PRIMARY KEY,
  user_id INTEGER NOT NULL UNIQUE REFERENCES users(id) ON DELETE CASCADE,
  role TEXT NOT NULL DEFAULT 'capturer',
  created_at TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE IF NOT EXISTS audit_logs (
  id SERIAL PRIMARY KEY,
  user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
  username TEXT,
  action TEXT NOT NULL,
  entity TEXT,
  details JSONB,
  created_at TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE IF NOT EXISTS export_tokens (
  token_hash TEXT PRIMARY KEY,
  user_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
  username TEXT NOT NULL,
  expires_at TIMESTAMPTZ NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS export_tokens_expires_at_idx ON export_tokens(expires_at);

CREATE TABLE IF NOT EXISTS import_sessions (
  token TEXT PRIMARY KEY,
  payload JSONB NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS import_sessions_created_at_idx ON import_sessions(created_at);
