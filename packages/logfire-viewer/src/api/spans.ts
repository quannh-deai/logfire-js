import { Hono } from 'hono'

import type { AuthVariables } from '../auth/middleware.js'
import { requireProject } from '../auth/middleware.js'
import type { ProjectRegistry } from '../tenancy/registry.js'
import type { SpanRow } from '../types.js'
import { rowToApiSpan } from './transform.js'

const FTS_SAFE = /^[a-z0-9_*"\s-]+$/i

function isFtsQuery(q: string): boolean {
  return FTS_SAFE.test(q) && q.trim().length > 0
}

function parseMsOrNull(v: string | null | undefined): bigint | null {
  if (!v) return null
  const n = Number(v)
  if (!Number.isFinite(n)) return null
  return BigInt(Math.trunc(n)) * 1_000_000n
}

export function spansApi(registry: ProjectRegistry): Hono<{ Variables: AuthVariables }> {
  const app = new Hono<{ Variables: AuthVariables }>()
  app.use('*', requireProject(registry, 'read'))

  app.get('/spans', (c) => {
    const { db } = c.get('auth')
    const url = new URL(c.req.url)
    const service = url.searchParams.get('service')
    const minLevel = url.searchParams.get('level')
    const traceId = url.searchParams.get('traceId')
    const q = url.searchParams.get('q') ?? ''
    const from = parseMsOrNull(url.searchParams.get('from'))
    const to = parseMsOrNull(url.searchParams.get('to'))
    const limit = Math.min(1000, Math.max(1, Number(url.searchParams.get('limit') ?? 100)))
    const offset = Math.max(0, Number(url.searchParams.get('offset') ?? 0))

    const where: string[] = []
    const params: Record<string, unknown> = {}
    if (service) {
      where.push('service_name = @service')
      params.service = service
    }
    if (minLevel != null && minLevel !== '') {
      where.push('logfire_level_num >= @level')
      params.level = Number(minLevel)
    }
    if (traceId) {
      where.push('trace_id = @traceId')
      params.traceId = traceId.toLowerCase()
    }
    if (from != null) {
      where.push('start_time_ns >= @from')
      params.from = from
    }
    if (to != null) {
      where.push('start_time_ns <= @to')
      params.to = to
    }
    if (q) {
      if (isFtsQuery(q)) {
        where.push(
          'rowid IN (SELECT rowid FROM spans_fts WHERE spans_fts MATCH @q)',
        )
        params.q = q
      } else {
        where.push(
          '(name LIKE @qlike OR logfire_msg LIKE @qlike OR attributes_json LIKE @qlike)',
        )
        params.qlike = `%${q}%`
      }
    }

    const whereSql = where.length > 0 ? `WHERE ${where.join(' AND ')}` : ''
    const sql = `
      SELECT * FROM spans
      ${whereSql}
      ORDER BY start_time_ns DESC
      LIMIT @limit OFFSET @offset
    `
    const countSql = `SELECT COUNT(*) AS n FROM spans ${whereSql}`
    params.limit = limit
    params.offset = offset

    const rows = db.ro.prepare(sql).all(params) as SpanRow[]
    const { n } = db.ro.prepare(countSql).get(params) as { n: number }
    return c.json({ rows: rows.map(rowToApiSpan), total: n })
  })

  app.get('/traces/:traceId', (c) => {
    const { db } = c.get('auth')
    const traceId = c.req.param('traceId').toLowerCase()
    const rows = db.ro
      .prepare('SELECT * FROM spans WHERE trace_id = ? ORDER BY start_time_ns ASC')
      .all(traceId) as SpanRow[]
    const apiSpans = rows.map(rowToApiSpan)
    const spanIds = new Set(apiSpans.map((s) => s.span_id))
    const root = apiSpans.find(
      (s) => !s.parent_span_id || !spanIds.has(s.parent_span_id),
    )
    return c.json({
      traceId,
      spans: apiSpans,
      rootSpanId: root?.span_id ?? null,
    })
  })

  return app
}
