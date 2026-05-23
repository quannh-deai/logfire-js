import { Hono } from 'hono'

import type { AuthVariables } from '../auth/middleware.js'
import { requireProject } from '../auth/middleware.js'
import type { ProjectRegistry } from '../tenancy/registry.js'
import type { LogRow } from '../types.js'
import { rowToApiLog } from './transform.js'

const FTS_SAFE = /^[a-z0-9_*"\s-]+$/i

function parseMsOrNull(v: string | null | undefined): bigint | null {
  if (!v) return null
  const n = Number(v)
  if (!Number.isFinite(n)) return null
  return BigInt(Math.trunc(n)) * 1_000_000n
}

export function logsApi(registry: ProjectRegistry): Hono<{ Variables: AuthVariables }> {
  const app = new Hono<{ Variables: AuthVariables }>()
  app.use('*', requireProject(registry, 'read'))

  app.get('/logs', (c) => {
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
      where.push('time_unix_ns >= @from')
      params.from = from
    }
    if (to != null) {
      where.push('time_unix_ns <= @to')
      params.to = to
    }
    if (q) {
      if (FTS_SAFE.test(q)) {
        where.push('id IN (SELECT rowid FROM logs_fts WHERE logs_fts MATCH @q)')
        params.q = q
      } else {
        where.push('(body LIKE @qlike OR attributes_json LIKE @qlike)')
        params.qlike = `%${q}%`
      }
    }
    const whereSql = where.length > 0 ? `WHERE ${where.join(' AND ')}` : ''
    const sql = `
      SELECT * FROM logs
      ${whereSql}
      ORDER BY time_unix_ns DESC
      LIMIT @limit OFFSET @offset
    `
    params.limit = limit
    params.offset = offset
    const rows = db.ro.prepare(sql).all(params) as LogRow[]
    const { n } = db.ro
      .prepare(`SELECT COUNT(*) AS n FROM logs ${whereSql}`)
      .get(params) as { n: number }
    return c.json({ rows: rows.map(rowToApiLog), total: n })
  })

  return app
}
