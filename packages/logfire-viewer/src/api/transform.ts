import type { ApiLog, ApiSpan, LogRow, SpanRow } from '../types.js'

function nsToMs(ns: bigint | number | null | undefined): number {
  if (ns == null) return 0
  if (typeof ns === 'number') return Math.trunc(ns / 1_000_000)
  return Number(ns / 1_000_000n)
}

function parseJson<T>(s: string | null | undefined, fallback: T): T {
  if (!s) return fallback
  try {
    return JSON.parse(s) as T
  } catch {
    return fallback
  }
}

export function rowToApiSpan(row: SpanRow): ApiSpan {
  const tagsArr = row.logfire_tags ? parseJson<unknown>(row.logfire_tags, null) : null
  return {
    trace_id: row.trace_id,
    span_id: row.span_id,
    parent_span_id: row.parent_span_id,
    name: row.name,
    start_time_ms: nsToMs(row.start_time_ns),
    end_time_ms: nsToMs(row.end_time_ns),
    duration_ms: nsToMs(row.duration_ns),
    status_code: row.status_code,
    status_message: row.status_message,
    kind: row.kind,
    service_name: row.service_name,
    service_version: row.service_version,
    scope_name: row.scope_name,
    logfire_msg: row.logfire_msg,
    logfire_level_num: row.logfire_level_num,
    logfire_span_type: row.logfire_span_type,
    logfire_tags: Array.isArray(tagsArr) ? (tagsArr as string[]) : null,
    attributes: parseJson(row.attributes_json, {}),
    resource_attributes: parseJson(row.resource_attributes_json, {}),
    events: row.events_json ? parseJson<unknown[]>(row.events_json, []) : null,
    links: row.links_json ? parseJson<unknown[]>(row.links_json, []) : null,
  }
}

export function rowToApiLog(row: LogRow): ApiLog {
  return {
    trace_id: row.trace_id,
    span_id: row.span_id,
    time_ms: nsToMs(row.time_unix_ns),
    severity_number: row.severity_number,
    severity_text: row.severity_text,
    body: row.body,
    service_name: row.service_name,
    scope_name: row.scope_name,
    logfire_level_num: row.logfire_level_num,
    attributes: parseJson(row.attributes_json, {}),
    resource_attributes: parseJson(row.resource_attributes_json, {}),
  }
}
