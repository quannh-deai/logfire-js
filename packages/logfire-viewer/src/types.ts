export interface SpanRow {
  trace_id: string
  span_id: string
  parent_span_id: string | null
  name: string
  start_time_ns: bigint
  end_time_ns: bigint
  duration_ns: bigint
  status_code: number
  status_message: string | null
  kind: number
  service_name: string | null
  service_version: string | null
  deployment_environment: string | null
  scope_name: string | null
  scope_version: string | null
  logfire_msg: string | null
  logfire_level_num: number | null
  logfire_span_type: string | null
  logfire_msg_template: string | null
  logfire_tags: string | null
  attributes_json: string
  resource_attributes_json: string
  scope_attributes_json: string | null
  events_json: string | null
  links_json: string | null
  dropped_attributes_count: number
  dropped_events_count: number
  dropped_links_count: number
  received_at_ns: bigint
}

export interface LogRow {
  trace_id: string | null
  span_id: string | null
  time_unix_ns: bigint
  observed_time_unix_ns: bigint | null
  severity_number: number | null
  severity_text: string | null
  body: string | null
  service_name: string | null
  scope_name: string | null
  logfire_level_num: number | null
  attributes_json: string
  resource_attributes_json: string
  received_at_ns: bigint
}

export interface MetricStreamRow {
  stream_id: string
  metric_name: string
  description: string | null
  unit: string | null
  kind: 'sum' | 'gauge' | 'histogram' | 'exphist' | 'summary'
  monotonic: number | null
  aggregation_temp: number | null
  service_name: string | null
  scope_name: string | null
  attributes_json: string
  resource_attributes_json: string
}

export interface MetricPointRow {
  stream_id: string
  time_unix_ns: bigint
  start_unix_ns: bigint | null
  value: number | null
  histogram_json: string | null
}

export interface Project {
  id: string
  slug: string
  name: string
  db_path: string
  retention_days: number
  retention_max_rows: number
  sampling_rate: number
  rate_limit_rps: number | null
  rate_limit_burst: number | null
  created_at_ns: bigint
}

export interface Token {
  id: string
  project_id: string
  name: string
  token_hash: string
  token_prefix: string
  scopes: string
  created_at_ns: bigint
  last_used_at_ns: bigint | null
  revoked_at_ns: bigint | null
}

export type TokenScope = 'read' | 'write' | 'admin'

export interface ViewerOptions {
  dataDir?: string
  port?: number
  grpcPort?: number
  host?: string
  enableGrpc?: boolean
  enableRetention?: boolean
  retentionIntervalMs?: number
  maxRps?: number
}

export interface ResolvedViewerOptions {
  dataDir: string
  port: number
  grpcPort: number
  host: string
  enableGrpc: boolean
  enableRetention: boolean
  retentionIntervalMs: number
  maxRps: number
}

export interface ViewerHandle {
  httpUrl: string
  grpcUrl: string | null
  close(): Promise<void>
}

export interface ApiSpan {
  trace_id: string
  span_id: string
  parent_span_id: string | null
  name: string
  start_time_ms: number
  end_time_ms: number
  duration_ms: number
  status_code: number
  status_message: string | null
  kind: number
  service_name: string | null
  service_version: string | null
  scope_name: string | null
  logfire_msg: string | null
  logfire_level_num: number | null
  logfire_span_type: string | null
  logfire_tags: string[] | null
  attributes: Record<string, unknown>
  resource_attributes: Record<string, unknown>
  events: unknown[] | null
  links: unknown[] | null
}

export interface ApiLog {
  trace_id: string | null
  span_id: string | null
  time_ms: number
  severity_number: number | null
  severity_text: string | null
  body: string | null
  service_name: string | null
  scope_name: string | null
  logfire_level_num: number | null
  attributes: Record<string, unknown>
  resource_attributes: Record<string, unknown>
}
