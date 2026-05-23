import * as grpc from '@grpc/grpc-js'

import { extractToken } from '../auth/middleware.js'
import { rowToApiLog, rowToApiSpan } from '../api/transform.js'
import type { TokenBucketLimiter } from '../ratelimit/tokenBucket.js'
import type { SseBroker } from '../stream/sse.js'
import type { ProjectRegistry } from '../tenancy/registry.js'

import {
  decodeLogs,
  decodeMetrics,
  decodeTraces,
  emptyLogsResponse,
  emptyMetricsResponse,
  emptyTraceResponse,
} from './decode.js'
import { flattenLogs, flattenMetrics, flattenTraces } from './flatten.js'
import { insertLogs, insertMetrics, insertSpans } from './insert.js'
import { sampleLogs, sampleMetricPoints, sampleSpans } from './sample.js'

const identitySerialize = (b: Buffer): Buffer => b
const identityDeserialize = (b: Buffer): Buffer => b

interface RawCall {
  request: Buffer
  metadata: grpc.Metadata
}
type RawCallback = (err: grpc.ServiceError | null, value?: Buffer) => void

function buildMethod(path: string): grpc.MethodDefinition<Buffer, Buffer> {
  return {
    path,
    requestStream: false,
    responseStream: false,
    requestSerialize: identitySerialize,
    requestDeserialize: identityDeserialize,
    responseSerialize: identitySerialize,
    responseDeserialize: identityDeserialize,
    originalName: 'Export',
  }
}

function authMetadata(metadata: grpc.Metadata): string {
  const values = metadata.get('authorization')
  if (values.length === 0) return ''
  const raw = values[0]
  return extractToken(typeof raw === 'string' ? raw : raw.toString('utf8'))
}

function denied(message: string, status: grpc.status): grpc.ServiceError {
  return Object.assign(new Error(message), {
    code: status,
    details: message,
    metadata: new grpc.Metadata(),
  }) as grpc.ServiceError
}

export function buildGrpcServer(
  registry: ProjectRegistry,
  broker: SseBroker,
  limiter: TokenBucketLimiter,
): grpc.Server {
  const server = new grpc.Server()

  const traceService = {
    Export: buildMethod('/opentelemetry.proto.collector.trace.v1.TraceService/Export'),
  }
  const logsService = {
    Export: buildMethod('/opentelemetry.proto.collector.logs.v1.LogsService/Export'),
  }
  const metricsService = {
    Export: buildMethod('/opentelemetry.proto.collector.metrics.v1.MetricsService/Export'),
  }

  const handleTraces: grpc.handleUnaryCall<Buffer, Buffer> = (
    call: RawCall,
    cb: RawCallback,
  ): void => {
    const token = authMetadata(call.metadata)
    const resolved = registry.resolveToken(token)
    if (!resolved) return cb(denied('Invalid token', grpc.status.UNAUTHENTICATED))
    if (!resolved.scopes.has('write') && !resolved.scopes.has('admin')) {
      return cb(denied('Missing write scope', grpc.status.PERMISSION_DENIED))
    }
    try {
      const req = decodeTraces(call.request, 'protobuf')
      let rows = flattenTraces(req)
      rows = sampleSpans(rows, resolved.project.sampling_rate)
      if (rows.length > 0) {
        const rl = limiter.take(
          `${resolved.tokenId}:traces`,
          resolved.project.rate_limit_rps,
          resolved.project.rate_limit_burst,
          rows.length,
        )
        if (!rl.allowed) return cb(denied('rate limited', grpc.status.RESOURCE_EXHAUSTED))
        insertSpans(resolved.db.rw, rows)
        broker.publishSpans(resolved.project.id, rows.slice(0, 100).map(rowToApiSpan))
      }
      cb(null, Buffer.from(emptyTraceResponse('protobuf')))
    } catch (err) {
      cb(denied(`decode failed: ${(err as Error).message}`, grpc.status.INVALID_ARGUMENT))
    }
  }

  const handleLogs: grpc.handleUnaryCall<Buffer, Buffer> = (
    call: RawCall,
    cb: RawCallback,
  ): void => {
    const token = authMetadata(call.metadata)
    const resolved = registry.resolveToken(token)
    if (!resolved) return cb(denied('Invalid token', grpc.status.UNAUTHENTICATED))
    if (!resolved.scopes.has('write') && !resolved.scopes.has('admin')) {
      return cb(denied('Missing write scope', grpc.status.PERMISSION_DENIED))
    }
    try {
      const req = decodeLogs(call.request, 'protobuf')
      let rows = flattenLogs(req)
      rows = sampleLogs(rows, resolved.project.sampling_rate)
      if (rows.length > 0) {
        const rl = limiter.take(
          `${resolved.tokenId}:logs`,
          resolved.project.rate_limit_rps,
          resolved.project.rate_limit_burst,
          rows.length,
        )
        if (!rl.allowed) return cb(denied('rate limited', grpc.status.RESOURCE_EXHAUSTED))
        insertLogs(resolved.db.rw, rows)
        broker.publishLogs(resolved.project.id, rows.slice(0, 100).map(rowToApiLog))
      }
      cb(null, Buffer.from(emptyLogsResponse('protobuf')))
    } catch (err) {
      cb(denied(`decode failed: ${(err as Error).message}`, grpc.status.INVALID_ARGUMENT))
    }
  }

  const handleMetrics: grpc.handleUnaryCall<Buffer, Buffer> = (
    call: RawCall,
    cb: RawCallback,
  ): void => {
    const token = authMetadata(call.metadata)
    const resolved = registry.resolveToken(token)
    if (!resolved) return cb(denied('Invalid token', grpc.status.UNAUTHENTICATED))
    if (!resolved.scopes.has('write') && !resolved.scopes.has('admin')) {
      return cb(denied('Missing write scope', grpc.status.PERMISSION_DENIED))
    }
    try {
      const req = decodeMetrics(call.request, 'protobuf')
      const flat = flattenMetrics(req)
      const points = sampleMetricPoints(flat.points, resolved.project.sampling_rate)
      if (points.length > 0) {
        const rl = limiter.take(
          `${resolved.tokenId}:metrics`,
          resolved.project.rate_limit_rps,
          resolved.project.rate_limit_burst,
          points.length,
        )
        if (!rl.allowed) return cb(denied('rate limited', grpc.status.RESOURCE_EXHAUSTED))
        insertMetrics(resolved.db.rw, flat.streams, points)
      }
      cb(null, Buffer.from(emptyMetricsResponse('protobuf')))
    } catch (err) {
      cb(denied(`decode failed: ${(err as Error).message}`, grpc.status.INVALID_ARGUMENT))
    }
  }

  server.addService(traceService, { Export: handleTraces })
  server.addService(logsService, { Export: handleLogs })
  server.addService(metricsService, { Export: handleMetrics })
  return server
}
