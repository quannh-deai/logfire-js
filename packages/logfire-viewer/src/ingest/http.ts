import { Hono } from 'hono'

import type { AuthVariables } from '../auth/middleware.js'
import { requireProject } from '../auth/middleware.js'
import { rowToApiLog, rowToApiSpan } from '../api/transform.js'
import type { TokenBucketLimiter } from '../ratelimit/tokenBucket.js'
import type { SseBroker } from '../stream/sse.js'
import type { ProjectRegistry } from '../tenancy/registry.js'

import {
  decodeLogs,
  decodeMetrics,
  decodeTraces,
  detectWire,
  emptyLogsResponse,
  emptyMetricsResponse,
  emptyTraceResponse,
  type Wire,
} from './decode.js'
import { flattenLogs, flattenMetrics, flattenTraces } from './flatten.js'
import { insertLogs, insertMetrics, insertSpans } from './insert.js'
import { sampleLogs, sampleMetricPoints, sampleSpans } from './sample.js'

function ctForWire(wire: Wire): string {
  return wire === 'json' ? 'application/json' : 'application/x-protobuf'
}

function rateLimitedResponse(retryAfterSec: number): Response {
  return new Response(JSON.stringify({ error: 'rate limited' }), {
    status: 429,
    headers: {
      'content-type': 'application/json',
      'retry-after': String(retryAfterSec),
    },
  })
}

export function ingestApi(
  registry: ProjectRegistry,
  broker: SseBroker,
  limiter: TokenBucketLimiter,
): Hono<{ Variables: AuthVariables }> {
  const app = new Hono<{ Variables: AuthVariables }>()
  app.use('*', requireProject(registry, 'write'))

  app.post('/traces', async (c) => {
    const wire = detectWire(c.req.header('content-type'))
    const { project, db, tokenId } = c.get('auth')
    const raw = new Uint8Array(await c.req.arrayBuffer())
    let req
    try {
      req = decodeTraces(raw, wire)
    } catch (err) {
      return c.json({ error: `decode failed: ${(err as Error).message}` }, 400)
    }
    let rows = flattenTraces(req)
    rows = sampleSpans(rows, project.sampling_rate)
    if (rows.length > 0) {
      const rl = limiter.take(
        `${tokenId}:traces`,
        project.rate_limit_rps,
        project.rate_limit_burst,
        rows.length,
      )
      if (!rl.allowed) return rateLimitedResponse(rl.retryAfterSec ?? 1)
      insertSpans(db.rw, rows)
      broker.publishSpans(project.id, rows.slice(0, 100).map(rowToApiSpan))
    }
    return new Response(emptyTraceResponse(wire), {
      headers: { 'content-type': ctForWire(wire) },
    })
  })

  app.post('/logs', async (c) => {
    const wire = detectWire(c.req.header('content-type'))
    const { project, db, tokenId } = c.get('auth')
    const raw = new Uint8Array(await c.req.arrayBuffer())
    let req
    try {
      req = decodeLogs(raw, wire)
    } catch (err) {
      return c.json({ error: `decode failed: ${(err as Error).message}` }, 400)
    }
    let rows = flattenLogs(req)
    rows = sampleLogs(rows, project.sampling_rate)
    if (rows.length > 0) {
      const rl = limiter.take(
        `${tokenId}:logs`,
        project.rate_limit_rps,
        project.rate_limit_burst,
        rows.length,
      )
      if (!rl.allowed) return rateLimitedResponse(rl.retryAfterSec ?? 1)
      insertLogs(db.rw, rows)
      broker.publishLogs(project.id, rows.slice(0, 100).map(rowToApiLog))
    }
    return new Response(emptyLogsResponse(wire), {
      headers: { 'content-type': ctForWire(wire) },
    })
  })

  app.post('/metrics', async (c) => {
    const wire = detectWire(c.req.header('content-type'))
    const { project, db, tokenId } = c.get('auth')
    const raw = new Uint8Array(await c.req.arrayBuffer())
    let req
    try {
      req = decodeMetrics(raw, wire)
    } catch (err) {
      return c.json({ error: `decode failed: ${(err as Error).message}` }, 400)
    }
    const flat = flattenMetrics(req)
    const sampledPoints = sampleMetricPoints(flat.points, project.sampling_rate)
    if (sampledPoints.length > 0) {
      const rl = limiter.take(
        `${tokenId}:metrics`,
        project.rate_limit_rps,
        project.rate_limit_burst,
        sampledPoints.length,
      )
      if (!rl.allowed) return rateLimitedResponse(rl.retryAfterSec ?? 1)
      insertMetrics(db.rw, flat.streams, sampledPoints)
      broker.publishMetrics(
        project.id,
        sampledPoints.slice(0, 100).map((p) => ({
          stream_id: p.stream_id,
          time_ms:
            p.time_unix_ns == null
              ? 0
              : typeof p.time_unix_ns === 'number'
                ? Math.trunc(p.time_unix_ns / 1_000_000)
                : Number(p.time_unix_ns / 1_000_000n),
          value: p.value,
        })),
      )
    }
    return new Response(emptyMetricsResponse(wire), {
      headers: { 'content-type': ctForWire(wire) },
    })
  })

  return app
}
