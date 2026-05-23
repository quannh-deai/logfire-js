PRAGMA journal_mode = WAL;
PRAGMA synchronous = NORMAL;
PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS projects (
  id                 TEXT PRIMARY KEY,
  slug               TEXT NOT NULL UNIQUE,
  name               TEXT NOT NULL,
  db_path            TEXT NOT NULL,
  retention_days     INTEGER NOT NULL DEFAULT 30,
  retention_max_rows INTEGER NOT NULL DEFAULT 5000000,
  sampling_rate      REAL NOT NULL DEFAULT 1.0,
  rate_limit_rps     INTEGER,
  rate_limit_burst   INTEGER,
  created_at_ns      INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS tokens (
  id              TEXT PRIMARY KEY,
  project_id      TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  name            TEXT NOT NULL,
  token_hash      TEXT NOT NULL UNIQUE,
  token_prefix    TEXT NOT NULL,
  scopes          TEXT NOT NULL DEFAULT 'write',
  created_at_ns   INTEGER NOT NULL,
  last_used_at_ns INTEGER,
  revoked_at_ns   INTEGER
);

CREATE INDEX IF NOT EXISTS idx_tokens_project
  ON tokens(project_id) WHERE revoked_at_ns IS NULL;

CREATE TABLE IF NOT EXISTS settings (
  key   TEXT PRIMARY KEY,
  value TEXT NOT NULL
);
