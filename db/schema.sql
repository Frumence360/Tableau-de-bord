-- Schéma PostgreSQL du dashboard Frumence Maintenance

CREATE TABLE IF NOT EXISTS users (
  id SERIAL PRIMARY KEY,
  username TEXT UNIQUE NOT NULL,
  password_hash TEXT NOT NULL,
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
