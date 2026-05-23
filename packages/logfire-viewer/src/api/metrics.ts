import { Hono } from 'hono'

import type { AuthVariables } from '../auth/middleware.js'
import { requireProject } from '../auth/middleware.js'
import type { ProjectRegistry } from '../tenancy/registry.js'
import type { MetricPointRow, MetricStreamRow } from '../types.js'

function parseMsOrNull(v: string | null | undefined): bigint | null {
  if (!v) return null
  const n = Number(v)
  if (!Number.isFinite(n)) return null
  return BigInt(Math.trunc(n)) * 1_000_000n
}

export function metricsApi(registry: ProjectRegistry): Hono<{ Variables: AuthVariables }> {
  const app = new Hono<{ Variables: AuthVariables }>()
  app.use('*', requireProject(registry, 'read'))

  app.get('/metrics/streams', (c) => {
    const { db } = c.get('auth')
    const url = new URL(c.req.url)
    const name = url.searchParams.get('name')
    const service = url.searchParams.get('service')
    const where: string[] = []
    const params: Record<string, unknown> = {}
    if (name) {
      where.push('metric_name LIKE @nameLike')
      params.nameLike = `%${name}%`
    }
    if (service) {
      where.push('service_name = @service')
      params.service = service
    }
    const sql = `
      SELECT * FROM metric_streams
      ${where.length ? `WHERE ${where.join(' AND ')}` : ''}
      ORDER BY metric_name ASC
      LIMIT 500
    `
    const rows = db.ro.prepare(sql).all(params) as MetricStreamRow[]
    return c.json({ streams: rows })
  })

  app.get('/metrics/:streamId/series', (c) => {
    const { db } = c.get('auth')
    const streamId = c.req.param('streamId')
    const stream = db.ro
      .prepare('SELECT * FROM metric_streams WHERE stream_id = ?')
      .get(streamId) as MetricStreamRow | undefined
    if (!stream) return c.json({ error: 'unknown stream' }, 404)
    const url = new URL(c.req.url)
    const from = parseMsOrNull(url.searchParams.get('from'))
    const to = parseMsOrNull(url.searchParams.get('to'))
    const where: string[] = ['stream_id = @stream_id']
    const params: Record<string, unknown> = { stream_id: streamId }
    if (from != null) {
      where.push('time_unix_ns >= @from')
      params.from = from
    }
    if (to != null) {
      where.push('time_unix_ns <= @to')
      params.to = to
    }
    const sql = `
      SELECT time_unix_ns, value, histogram_json
      FROM metric_points
      WHERE ${where.join(' AND ')}
      ORDER BY time_unix_ns ASC
      LIMIT 10000
    `
    const rows = db.ro.prepare(sql).all(params) as MetricPointRow[]
    const nsToMs = (ns: bigint | number | null | undefined): number => {
      if (ns == null) return 0
      if (typeof ns === 'number') return Math.trunc(ns / 1_000_000)
      return Number(ns / 1_000_000n)
    }
    const points = rows.map((r) => {
      const time_ms = nsToMs(r.time_unix_ns)
      if (r.histogram_json) {
        try {
          const h = JSON.parse(r.histogram_json) as {
            count: number
            sum: number
            min?: number
            max?: number
          }
          const avg = h.count > 0 ? h.sum / h.count : 0
          return { t: time_ms, v: avg, count: h.count, sum: h.sum, min: h.min, max: h.max }
        } catch {
          return { t: time_ms, v: null }
        }
      }
      return { t: time_ms, v: r.value }
    })
    return c.json({
      kind: stream.kind,
      unit: stream.unit,
      metric_name: stream.metric_name,
      points,
    })
  })

  return app
}
