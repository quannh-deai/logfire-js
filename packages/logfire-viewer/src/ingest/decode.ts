// We need to deserialize OTLP *requests* (the receiver side), but
// `@opentelemetry/otlp-transformer` only exports request *serializers* and
// response deserializers as public API. The internal `generated/root` module
// holds the protobufjs message classes with .decode/.encode in both
// directions, so we reach into it.
//
// This deep import is the same protobufjs root that the transformer uses
// internally, so it tracks the wire format the official exporters produce.
// If the package layout ever changes, this single file is the only place
// that needs to update.

import otlpRoot from '@opentelemetry/otlp-transformer/build/src/generated/root.js'

import type {
  IExportLogsServiceRequest,
  IExportMetricsServiceRequest,
  IExportTraceServiceRequest,
} from './proto-types.js'

type ProtoMessage<T> = {
  decode(buf: Uint8Array): T
  encode(message: T): { finish(): Uint8Array }
}

const root = otlpRoot as unknown as {
  opentelemetry: {
    proto: {
      collector: {
        trace: { v1: { ExportTraceServiceRequest: ProtoMessage<IExportTraceServiceRequest>; ExportTraceServiceResponse: ProtoMessage<unknown> } }
        logs: { v1: { ExportLogsServiceRequest: ProtoMessage<IExportLogsServiceRequest>; ExportLogsServiceResponse: ProtoMessage<unknown> } }
        metrics: { v1: { ExportMetricsServiceRequest: ProtoMessage<IExportMetricsServiceRequest>; ExportMetricsServiceResponse: ProtoMessage<unknown> } }
      }
    }
  }
}

const TraceRequestT = root.opentelemetry.proto.collector.trace.v1.ExportTraceServiceRequest
const TraceResponseT = root.opentelemetry.proto.collector.trace.v1.ExportTraceServiceResponse
const LogsRequestT = root.opentelemetry.proto.collector.logs.v1.ExportLogsServiceRequest
const LogsResponseT = root.opentelemetry.proto.collector.logs.v1.ExportLogsServiceResponse
const MetricsRequestT = root.opentelemetry.proto.collector.metrics.v1.ExportMetricsServiceRequest
const MetricsResponseT = root.opentelemetry.proto.collector.metrics.v1.ExportMetricsServiceResponse

export type Wire = 'protobuf' | 'json'

export function detectWire(contentType: string | null | undefined): Wire {
  const ct = (contentType ?? '').toLowerCase()
  if (ct.includes('json')) return 'json'
  return 'protobuf'
}

function decodeJson<T>(buf: Uint8Array): T {
  return JSON.parse(new TextDecoder().decode(buf)) as T
}

export function decodeTraces(buf: Uint8Array, wire: Wire): IExportTraceServiceRequest {
  if (wire === 'json') return decodeJson<IExportTraceServiceRequest>(buf)
  return TraceRequestT.decode(buf)
}

export function decodeLogs(buf: Uint8Array, wire: Wire): IExportLogsServiceRequest {
  if (wire === 'json') return decodeJson<IExportLogsServiceRequest>(buf)
  return LogsRequestT.decode(buf)
}

export function decodeMetrics(buf: Uint8Array, wire: Wire): IExportMetricsServiceRequest {
  if (wire === 'json') return decodeJson<IExportMetricsServiceRequest>(buf)
  return MetricsRequestT.decode(buf)
}

function encodeJson(value: unknown): Uint8Array {
  return new TextEncoder().encode(JSON.stringify(value))
}

export function emptyTraceResponse(wire: Wire): Uint8Array {
  const empty = { partialSuccess: { rejectedSpans: 0, errorMessage: '' } }
  if (wire === 'json') return encodeJson(empty)
  return TraceResponseT.encode(empty).finish()
}

export function emptyLogsResponse(wire: Wire): Uint8Array {
  const empty = { partialSuccess: { rejectedLogRecords: 0, errorMessage: '' } }
  if (wire === 'json') return encodeJson(empty)
  return LogsResponseT.encode(empty).finish()
}

export function emptyMetricsResponse(wire: Wire): Uint8Array {
  const empty = { partialSuccess: { rejectedDataPoints: 0, errorMessage: '' } }
  if (wire === 'json') return encodeJson(empty)
  return MetricsResponseT.encode(empty).finish()
}
