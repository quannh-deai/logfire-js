// Minimal structural types mirroring the OTLP `IExport*ServiceRequest`
// definitions used internally by `@opentelemetry/otlp-transformer`. We
// declare them here rather than depend on the transformer's private types,
// since those are not part of the package's public API surface.
//
// The shapes match the protobuf wire definitions; treat all `Uint8Array | string`
// id fields as "bytes on protobuf, hex string on JSON".

export interface IKeyValue {
  key: string
  value: unknown
}

export interface IResource {
  attributes?: IKeyValue[]
  droppedAttributesCount?: number
}

export interface IInstrumentationScope {
  name?: string
  version?: string
  attributes?: IKeyValue[]
  droppedAttributesCount?: number
}

export interface ISpan {
  traceId: Uint8Array | string
  spanId: Uint8Array | string
  parentSpanId?: Uint8Array | string
  name: string
  kind?: number
  startTimeUnixNano?: bigint | number | string | [number, number]
  endTimeUnixNano?: bigint | number | string | [number, number]
  attributes?: IKeyValue[]
  droppedAttributesCount?: number
  events?: unknown[]
  droppedEventsCount?: number
  links?: unknown[]
  droppedLinksCount?: number
  status?: { code?: number; message?: string }
}

export interface IScopeSpans {
  scope?: IInstrumentationScope
  spans?: ISpan[]
  schemaUrl?: string
}

export interface IResourceSpans {
  resource?: IResource
  scopeSpans?: IScopeSpans[]
  schemaUrl?: string
}

export interface IExportTraceServiceRequest {
  resourceSpans?: IResourceSpans[]
}

export interface ILogRecord {
  timeUnixNano?: bigint | number | string
  observedTimeUnixNano?: bigint | number | string
  severityNumber?: number
  severityText?: string
  body?: unknown
  attributes?: IKeyValue[]
  droppedAttributesCount?: number
  flags?: number
  traceId?: Uint8Array | string
  spanId?: Uint8Array | string
}

export interface IScopeLogs {
  scope?: IInstrumentationScope
  logRecords?: ILogRecord[]
  schemaUrl?: string
}

export interface IResourceLogs {
  resource?: IResource
  scopeLogs?: IScopeLogs[]
  schemaUrl?: string
}

export interface IExportLogsServiceRequest {
  resourceLogs?: IResourceLogs[]
}

export interface IMetric {
  name: string
  description?: string
  unit?: string
  sum?: unknown
  gauge?: unknown
  histogram?: unknown
  exponentialHistogram?: unknown
  summary?: unknown
}

export interface IScopeMetrics {
  scope?: IInstrumentationScope
  metrics?: IMetric[]
  schemaUrl?: string
}

export interface IResourceMetrics {
  resource?: IResource
  scopeMetrics?: IScopeMetrics[]
  schemaUrl?: string
}

export interface IExportMetricsServiceRequest {
  resourceMetrics?: IResourceMetrics[]
}
