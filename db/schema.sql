-- Schéma PostgreSQL du dashboard Frumence Maintenance

CREATE TABLE IF NOT EXISTS users (
  id SERIAL PRIMARY KEY,
  username TEXT UNIQUE NOT NULL,
  password_hash TEXT NOT NULL,
  -- Incrémenté à chaque changement de mot de passe : les tokens JWT émis avant
  -- portent l'ancienne valeur et sont donc rejetés (revue de toutes les sessions).
  token_version INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ DEFAULT now()
);

-- Migration pour les bases déjà créées avant l'ajout de token_version
ALTER TABLE users ADD COLUMN IF NOT EXISTS token_version INTEGER NOT NULL DEFAULT 0;

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
