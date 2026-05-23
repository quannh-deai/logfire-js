import { Hono } from 'hono'

import type { AuthVariables } from '../auth/middleware.js'
import { requireProject } from '../auth/middleware.js'
import type { ProjectRegistry } from '../tenancy/registry.js'

function parseMsOrNull(v: string | null | undefined): bigint | null {
  if (!v) return null
  const n = Number(v)
  if (!Number.isFinite(n)) return null
  return BigInt(Math.trunc(n)) * 1_000_000n
}

function nsToMs(ns: bigint | number | null | undefined): number {
  if (ns == null) return 0
  if (typeof ns === 'number') return Math.trunc(ns / 1_000_000)
  return Number(ns / 1_000_000n)
}

export function statsApi(registry: ProjectRegistry): Hono<{ Variables: AuthVariables }> {
  const app = new Hono<{ Variables: AuthVariables }>()
  app.use('*', requireProject(registry, 'read'))

  app.get('/stats', (c) => {
    const { db } = c.get('auth')
    const url = new URL(c.req.url)
    const from = parseMsOrNull(url.searchParams.get('from'))
    const to = parseMsOrNull(url.searchParams.get('to'))
    const where: string[] = []
    const params: Record<string, unknown> = {}
    if (from != null) {
      where.push('start_time_ns >= @from')
      params.from = from
    }
    if (to != null) {
      where.push('start_time_ns <= @to')
      params.to = to
    }
    const whereSql = where.length ? `WHERE ${where.join(' AND ')}` : ''

    const totals = db.ro
      .prepare(`SELECT COUNT(*) AS spans, COUNT(DISTINCT trace_id) AS traces FROM spans ${whereSql}`)
      .get(params) as { spans: number; traces: number }

    const byLevel = db.ro
      .prepare(
        `SELECT logfire_level_num AS level, COUNT(*) AS n FROM spans ${whereSql} GROUP BY logfire_level_num ORDER BY level ASC`,
      )
      .all(params) as { level: number | null; n: number }[]

    const byService = db.ro
      .prepare(
        `SELECT service_name AS service, COUNT(*) AS n FROM spans ${whereSql} GROUP BY service_name ORDER BY n DESC LIMIT 10`,
      )
      .all(params) as { service: string | null; n: number }[]

    const slowest = db.ro
      .prepare(
        `SELECT trace_id, span_id, name, service_name, duration_ns, start_time_ns
         FROM spans ${whereSql}
         ORDER BY duration_ns DESC LIMIT 10`,
      )
      .all(params) as {
      trace_id: string
      span_id: string
      name: string
      service_name: string | null
      duration_ns: bigint
      start_time_ns: bigint
    }[]

    const errorRow = db.ro
      .prepare(
        `SELECT
           SUM(CASE WHEN status_code = 2 OR logfire_level_num >= 17 THEN 1 ELSE 0 END) AS errors,
           COUNT(*) AS total
         FROM spans ${whereSql}`,
      )
      .get(params) as { errors: number | null; total: number }
    const errorRate =
      errorRow.total > 0 ? (errorRow.errors ?? 0) / errorRow.total : 0

    const logWhere: string[] = []
    const logParams: Record<string, unknown> = {}
    if (from != null) {
      logWhere.push('time_unix_ns >= @from')
      logParams.from = from
    }
    if (to != null) {
      logWhere.push('time_unix_ns <= @to')
      logParams.to = to
    }
    const logWhereSql = logWhere.length ? `WHERE ${logWhere.join(' AND ')}` : ''
    const logTotals = db.ro
      .prepare(`SELECT COUNT(*) AS n FROM logs ${logWhereSql}`)
      .get(logParams) as { n: number }

    return c.json({
      totals: { spans: totals.spans, traces: totals.traces, logs: logTotals.n },
      byLevel: byLevel.map((r) => ({ level: r.level, count: r.n })),
      byService: byService.map((r) => ({ service: r.service, count: r.n })),
      slowest: slowest.map((r) => ({
        trace_id: r.trace_id,
        span_id: r.span_id,
        name: r.name,
        service_name: r.service_name,
        duration_ms: nsToMs(r.duration_ns),
        start_time_ms: nsToMs(r.start_time_ns),
      })),
      errorCount: errorRow.errors ?? 0,
      errorRate,
    })
  })

  return app
}
