import type Database from 'better-sqlite3'

import type { LogRow, MetricPointRow, MetricStreamRow, SpanRow } from '../types.js'

interface BoundStatements {
  spans: Database.Statement
  logs: Database.Statement
  metricStreams: Database.Statement
  metricPoints: Database.Statement
}

const statementsCache = new WeakMap<Database.Database, BoundStatements>()

function getStatements(db: Database.Database): BoundStatements {
  const cached = statementsCache.get(db)
  if (cached) return cached
  const stmts: BoundStatements = {
    spans: db.prepare(`
      INSERT OR REPLACE INTO spans (
        trace_id, span_id, parent_span_id, name,
        start_time_ns, end_time_ns, duration_ns,
        status_code, status_message, kind,
        service_name, service_version, deployment_environment,
        scope_name, scope_version,
        logfire_msg, logfire_level_num, logfire_span_type,
        logfire_msg_template, logfire_tags,
        attributes_json, resource_attributes_json, scope_attributes_json,
        events_json, links_json,
        dropped_attributes_count, dropped_events_count, dropped_links_count,
        received_at_ns
      ) VALUES (
        @trace_id, @span_id, @parent_span_id, @name,
        @start_time_ns, @end_time_ns, @duration_ns,
        @status_code, @status_message, @kind,
        @service_name, @service_version, @deployment_environment,
        @scope_name, @scope_version,
        @logfire_msg, @logfire_level_num, @logfire_span_type,
        @logfire_msg_template, @logfire_tags,
        @attributes_json, @resource_attributes_json, @scope_attributes_json,
        @events_json, @links_json,
        @dropped_attributes_count, @dropped_events_count, @dropped_links_count,
        @received_at_ns
      )
    `),
    logs: db.prepare(`
      INSERT INTO logs (
        trace_id, span_id, time_unix_ns, observed_time_unix_ns,
        severity_number, severity_text, body,
        service_name, scope_name, logfire_level_num,
        attributes_json, resource_attributes_json, received_at_ns
      ) VALUES (
        @trace_id, @span_id, @time_unix_ns, @observed_time_unix_ns,
        @severity_number, @severity_text, @body,
        @service_name, @scope_name, @logfire_level_num,
        @attributes_json, @resource_attributes_json, @received_at_ns
      )
    `),
    metricStreams: db.prepare(`
      INSERT OR REPLACE INTO metric_streams (
        stream_id, metric_name, description, unit, kind,
        monotonic, aggregation_temp, service_name, scope_name,
        attributes_json, resource_attributes_json
      ) VALUES (
        @stream_id, @metric_name, @description, @unit, @kind,
        @monotonic, @aggregation_temp, @service_name, @scope_name,
        @attributes_json, @resource_attributes_json
      )
    `),
    metricPoints: db.prepare(`
      INSERT OR REPLACE INTO metric_points (
        stream_id, time_unix_ns, start_unix_ns, value, histogram_json
      ) VALUES (
        @stream_id, @time_unix_ns, @start_unix_ns, @value, @histogram_json
      )
    `),
  }
  statementsCache.set(db, stmts)
  return stmts
}

export function insertSpans(db: Database.Database, rows: SpanRow[]): number {
  if (rows.length === 0) return 0
  const { spans } = getStatements(db)
  const tx = db.transaction((batch: SpanRow[]) => {
    for (const r of batch) spans.run(r)
  })
  tx(rows)
  return rows.length
}

export function insertLogs(db: Database.Database, rows: LogRow[]): number {
  if (rows.length === 0) return 0
  const { logs } = getStatements(db)
  const tx = db.transaction((batch: LogRow[]) => {
    for (const r of batch) logs.run(r)
  })
  tx(rows)
  return rows.length
}

export function insertMetrics(
  db: Database.Database,
  streams: MetricStreamRow[],
  points: MetricPointRow[],
): number {
  if (streams.length === 0 && points.length === 0) return 0
  const { metricStreams, metricPoints } = getStatements(db)
  const tx = db.transaction(() => {
    for (const s of streams) metricStreams.run(s)
    for (const p of points) metricPoints.run(p)
  })
  tx()
  return points.length
}
