import { loadAuth } from './auth'

type Json = Record<string, unknown> | unknown[] | string | number | boolean | null

function authHeader(useAdmin = false): Record<string, string> {
  const { token, adminToken } = loadAuth()
  const t = useAdmin ? adminToken : token
  return t ? { authorization: t } : {}
}

async function request<T>(
  path: string,
  init: RequestInit & { admin?: boolean } = {},
): Promise<T> {
  const { admin, headers, ...rest } = init
  const r = await fetch(path, {
    ...rest,
    headers: {
      ...(headers ?? {}),
      ...authHeader(admin),
    },
  })
  if (!r.ok) {
    let detail: string
    try {
      const body = (await r.json()) as { error?: string }
      detail = body.error ?? r.statusText
    } catch {
      detail = r.statusText
    }
    throw new Error(`${r.status} ${detail}`)
  }
  if (r.status === 204) return undefined as T
  return (await r.json()) as T
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

export interface SpansResponse {
  rows: ApiSpan[]
  total: number
}

export interface LogsResponse {
  rows: ApiLog[]
  total: number
}

export interface TraceResponse {
  traceId: string
  spans: ApiSpan[]
  rootSpanId: string | null
}

export interface StatsResponse {
  totals: { spans: number; traces: number; logs: number }
  byLevel: { level: number | null; count: number }[]
  byService: { service: string | null; count: number }[]
  slowest: {
    trace_id: string
    span_id: string
    name: string
    service_name: string | null
    duration_ms: number
    start_time_ms: number
  }[]
  errorCount: number
  errorRate: number
}

export interface MetricStream {
  stream_id: string
  metric_name: string
  unit: string | null
  kind: string
  service_name: string | null
  attributes_json: string
}

export interface MetricSeries {
  metric_name: string
  unit: string | null
  kind: string
  points: { t: number; v: number | null; count?: number; sum?: number }[]
}

export interface QueryResponse {
  columns: string[]
  rows: unknown[][]
  truncated?: boolean
}

export interface AdminProject {
  id: string
  slug: string
  name: string
  db_path: string
  retention_days: number
  retention_max_rows: number
  sampling_rate: number
  rate_limit_rps: number | null
  rate_limit_burst: number | null
  created_at_ns: number
}

export interface AdminToken {
  id: string
  project_id: string
  name: string
  token_prefix: string
  scopes: string
  created_at_ms: number
  last_used_at_ms: number | null
}

export interface AdminCreateProjectInput {
  slug: string
  name?: string
  retention_days?: number
  retention_max_rows?: number
  sampling_rate?: number
  rate_limit_rps?: number | null
  rate_limit_burst?: number | null
}

function qs(params: Record<string, string | number | undefined | null>): string {
  const u = new URLSearchParams()
  for (const [k, v] of Object.entries(params)) {
    if (v == null || v === '') continue
    u.set(k, String(v))
  }
  const s = u.toString()
  return s ? `?${s}` : ''
}

export const api = {
  listSpans(params: {
    service?: string
    level?: number | null
    q?: string
    from?: number | null
    to?: number | null
    traceId?: string
    limit?: number
    offset?: number
  }): Promise<SpansResponse> {
    return request(`/api/spans${qs(params)}`)
  },
  getTrace(traceId: string): Promise<TraceResponse> {
    return request(`/api/traces/${traceId}`)
  },
  listLogs(params: {
    service?: string
    level?: number | null
    q?: string
    from?: number | null
    to?: number | null
    traceId?: string
    limit?: number
    offset?: number
  }): Promise<LogsResponse> {
    return request(`/api/logs${qs(params)}`)
  },
  listMetricStreams(params: { name?: string; service?: string } = {}): Promise<{ streams: MetricStream[] }> {
    return request(`/api/metrics/streams${qs(params)}`)
  },
  getMetricSeries(streamId: string, params: { from?: number; to?: number } = {}): Promise<MetricSeries> {
    return request(`/api/metrics/${streamId}/series${qs(params)}`)
  },
  stats(params: { from?: number | null; to?: number | null } = {}): Promise<StatsResponse> {
    return request(`/api/stats${qs(params)}`)
  },
  query(sql: string, params: unknown[] = []): Promise<QueryResponse> {
    return request('/api/query', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ sql, params }),
    })
  },
  admin: {
    listProjects(): Promise<{ projects: AdminProject[] }> {
      return request('/api/admin/projects', { admin: true })
    },
    createProject(input: AdminCreateProjectInput): Promise<{ project: AdminProject }> {
      return request('/api/admin/projects', {
        method: 'POST',
        admin: true,
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(input),
      })
    },
    updateProject(id: string, patch: Partial<AdminCreateProjectInput>): Promise<{ project: AdminProject }> {
      return request(`/api/admin/projects/${id}`, {
        method: 'PATCH',
        admin: true,
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(patch),
      })
    },
    deleteProject(id: string, purge: boolean): Promise<{ ok: true }> {
      return request(`/api/admin/projects/${id}${purge ? '?purge=1' : ''}`, {
        method: 'DELETE',
        admin: true,
      })
    },
    listTokens(projectId: string): Promise<{ tokens: AdminToken[] }> {
      return request(`/api/admin/projects/${projectId}/tokens`, { admin: true })
    },
    createToken(projectId: string, name: string, scopes: string): Promise<{ token: AdminToken & { plaintext: string } }> {
      return request(`/api/admin/projects/${projectId}/tokens`, {
        method: 'POST',
        admin: true,
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ name, scopes }),
      })
    },
    revokeToken(tokenId: string): Promise<{ ok: true }> {
      return request(`/api/admin/tokens/${tokenId}`, {
        method: 'DELETE',
        admin: true,
      })
    },
    getSettings(): Promise<{ settings: Record<string, string> }> {
      return request('/api/admin/settings', { admin: true })
    },
    updateSettings(patch: Record<string, string | number>): Promise<{ settings: Record<string, string> }> {
      return request('/api/admin/settings', {
        method: 'PATCH',
        admin: true,
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(patch),
      })
    },
  },
}

export function streamSpans(onBatch: (spans: ApiSpan[]) => void): () => void {
  return openSse('/api/stream/spans', 'spans', onBatch)
}

export function streamLogs(onBatch: (logs: ApiLog[]) => void): () => void {
  return openSse('/api/stream/logs', 'logs', onBatch)
}

function openSse<T>(path: string, event: string, onBatch: (batch: T) => void): () => void {
  // EventSource cannot send auth headers, so embed the token as a query param.
  const { token } = loadAuth()
  const url = `${path}?token=${encodeURIComponent(token ?? '')}`
  const es = new EventSource(url, { withCredentials: false })
  const listener = (e: MessageEvent): void => {
    try {
      onBatch(JSON.parse(e.data as string) as T)
    } catch {
      // ignore parse errors
    }
  }
  es.addEventListener(event, listener as EventListener)
  return () => {
    es.removeEventListener(event, listener as EventListener)
    es.close()
  }
}

export type { Json }
