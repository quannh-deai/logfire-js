PRAGMA journal_mode = WAL;
PRAGMA synchronous = NORMAL;
PRAGMA auto_vacuum = INCREMENTAL;

CREATE TABLE IF NOT EXISTS spans (
  trace_id                  TEXT NOT NULL,
  span_id                   TEXT NOT NULL,
  parent_span_id            TEXT,
  name                      TEXT NOT NULL,
  start_time_ns             INTEGER NOT NULL,
  end_time_ns               INTEGER NOT NULL,
  duration_ns               INTEGER NOT NULL,
  status_code               INTEGER NOT NULL DEFAULT 0,
  status_message            TEXT,
  kind                      INTEGER NOT NULL DEFAULT 0,
  service_name              TEXT,
  service_version           TEXT,
  deployment_environment    TEXT,
  scope_name                TEXT,
  scope_version             TEXT,
  logfire_msg               TEXT,
  logfire_level_num         INTEGER,
  logfire_span_type         TEXT,
  logfire_msg_template      TEXT,
  logfire_tags              TEXT,
  attributes_json           TEXT NOT NULL DEFAULT '{}',
  resource_attributes_json  TEXT NOT NULL DEFAULT '{}',
  scope_attributes_json     TEXT,
  events_json               TEXT,
  links_json                TEXT,
  dropped_attributes_count  INTEGER NOT NULL DEFAULT 0,
  dropped_events_count      INTEGER NOT NULL DEFAULT 0,
  dropped_links_count       INTEGER NOT NULL DEFAULT 0,
  received_at_ns            INTEGER NOT NULL,
  PRIMARY KEY (trace_id, span_id)
);
CREATE INDEX IF NOT EXISTS idx_spans_start         ON spans(start_time_ns DESC);
CREATE INDEX IF NOT EXISTS idx_spans_trace         ON spans(trace_id, start_time_ns);
CREATE INDEX IF NOT EXISTS idx_spans_service_start ON spans(service_name, start_time_ns DESC);
CREATE INDEX IF NOT EXISTS idx_spans_level_start   ON spans(logfire_level_num, start_time_ns DESC);
CREATE INDEX IF NOT EXISTS idx_spans_parent        ON spans(parent_span_id);

CREATE TABLE IF NOT EXISTS logs (
  id                        INTEGER PRIMARY KEY,
  trace_id                  TEXT,
  span_id                   TEXT,
  time_unix_ns              INTEGER NOT NULL,
  observed_time_unix_ns     INTEGER,
  severity_number           INTEGER,
  severity_text             TEXT,
  body                      TEXT,
  service_name              TEXT,
  scope_name                TEXT,
  logfire_level_num         INTEGER,
  attributes_json           TEXT NOT NULL DEFAULT '{}',
  resource_attributes_json  TEXT NOT NULL DEFAULT '{}',
  received_at_ns            INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_logs_time    ON logs(time_unix_ns DESC);
CREATE INDEX IF NOT EXISTS idx_logs_trace   ON logs(trace_id);
CREATE INDEX IF NOT EXISTS idx_logs_service ON logs(service_name, time_unix_ns DESC);
CREATE INDEX IF NOT EXISTS idx_logs_level   ON logs(logfire_level_num, time_unix_ns DESC);

CREATE TABLE IF NOT EXISTS metric_streams (
  stream_id                TEXT PRIMARY KEY,
  metric_name              TEXT NOT NULL,
  description              TEXT,
  unit                     TEXT,
  kind                     TEXT NOT NULL,
  monotonic                INTEGER,
  aggregation_temp         INTEGER,
  service_name             TEXT,
  scope_name               TEXT,
  attributes_json          TEXT NOT NULL DEFAULT '{}',
  resource_attributes_json TEXT NOT NULL DEFAULT '{}'
);
CREATE INDEX IF NOT EXISTS idx_metric_streams_name ON metric_streams(metric_name);

CREATE TABLE IF NOT EXISTS metric_points (
  stream_id      TEXT NOT NULL REFERENCES metric_streams(stream_id) ON DELETE CASCADE,
  time_unix_ns   INTEGER NOT NULL,
  start_unix_ns  INTEGER,
  value          REAL,
  histogram_json TEXT,
  PRIMARY KEY (stream_id, time_unix_ns)
);
CREATE INDEX IF NOT EXISTS idx_metric_points_time ON metric_points(time_unix_ns DESC);

CREATE VIRTUAL TABLE IF NOT EXISTS spans_fts USING fts5(
  name, logfire_msg, attributes_json,
  content='spans', content_rowid='rowid', tokenize='porter'
);

CREATE VIRTUAL TABLE IF NOT EXISTS logs_fts USING fts5(
  body, attributes_json,
  content='logs', content_rowid='id', tokenize='porter'
);

CREATE TRIGGER IF NOT EXISTS spans_ai AFTER INSERT ON spans BEGIN
  INSERT INTO spans_fts(rowid, name, logfire_msg, attributes_json)
    VALUES (new.rowid, new.name, new.logfire_msg, new.attributes_json);
END;
CREATE TRIGGER IF NOT EXISTS spans_ad AFTER DELETE ON spans BEGIN
  INSERT INTO spans_fts(spans_fts, rowid, name, logfire_msg, attributes_json)
    VALUES ('delete', old.rowid, old.name, old.logfire_msg, old.attributes_json);
END;
CREATE TRIGGER IF NOT EXISTS spans_au AFTER UPDATE ON spans BEGIN
  INSERT INTO spans_fts(spans_fts, rowid, name, logfire_msg, attributes_json)
    VALUES ('delete', old.rowid, old.name, old.logfire_msg, old.attributes_json);
  INSERT INTO spans_fts(rowid, name, logfire_msg, attributes_json)
    VALUES (new.rowid, new.name, new.logfire_msg, new.attributes_json);
END;

CREATE TRIGGER IF NOT EXISTS logs_ai AFTER INSERT ON logs BEGIN
  INSERT INTO logs_fts(rowid, body, attributes_json)
    VALUES (new.id, new.body, new.attributes_json);
END;
CREATE TRIGGER IF NOT EXISTS logs_ad AFTER DELETE ON logs BEGIN
  INSERT INTO logs_fts(logs_fts, rowid, body, attributes_json)
    VALUES ('delete', old.id, old.body, old.attributes_json);
END;
