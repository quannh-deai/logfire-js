import { createHash } from 'node:crypto'

import {
  ATTRIBUTES_LEVEL_KEY,
  ATTRIBUTES_MESSAGE_KEY,
  ATTRIBUTES_MESSAGE_TEMPLATE_KEY,
  ATTRIBUTES_SPAN_TYPE_KEY,
  ATTRIBUTES_TAGS_KEY,
  DEPLOYMENT_ENVIRONMENT,
  SERVICE_NAME,
  SERVICE_VERSION,
} from '../constants.js'
import type { LogRow, MetricPointRow, MetricStreamRow, SpanRow } from '../types.js'
import type {
  IExportLogsServiceRequest,
  IExportMetricsServiceRequest,
  IExportTraceServiceRequest,
} from './proto-types.js'

// ---------------------------------------------------------------------------
// Shared helpers
// ---------------------------------------------------------------------------

/** Render a span/trace ID as lowercase hex regardless of wire encoding. */
export function idToHex(id: unknown): string {
  if (id == null) return ''
  if (typeof id === 'string') return id.toLowerCase()
  if (id instanceof Uint8Array) return Buffer.from(id).toString('hex')
  if (Array.isArray(id)) return Buffer.from(id as number[]).toString('hex')
  // Some serializers wrap bytes as { type: 'Buffer', data: [...] }
  if (typeof id === 'object' && id && 'data' in (id as Record<string, unknown>)) {
    const data = (id as { data: number[] }).data
    if (Array.isArray(data)) return Buffer.from(data).toString('hex')
  }
  return String(id).toLowerCase()
}

/** Normalize an OTLP timestamp into nanoseconds (bigint). */
export function timeToNs(time: unknown): bigint {
  if (time == null) return 0n
  if (typeof time === 'bigint') return time
  if (typeof time === 'number') {
    // OTel JS sometimes emits ms-like numbers in JSON serializer; assume ns when > 1e15.
    if (time > 1e15) return BigInt(Math.trunc(time))
    if (time > 1e12) return BigInt(Math.trunc(time)) * 1_000_000n
    return BigInt(Math.trunc(time))
  }
  if (typeof time === 'string') {
    if (/^\d+$/.test(time)) return BigInt(time)
    // ISO date?
    const parsed = Date.parse(time)
    if (!Number.isNaN(parsed)) return BigInt(parsed) * 1_000_000n
    return 0n
  }
  if (Array.isArray(time) && time.length === 2) {
    const [sec, nano] = time as [number, number]
    return BigInt(sec) * 1_000_000_000n + BigInt(nano)
  }
  // Proto Long-ish: { low, high, unsigned } or { seconds, nanos }
  if (typeof time === 'object') {
    const t = time as Record<string, unknown>
    if (typeof t.seconds !== 'undefined' || typeof t.nanos !== 'undefined') {
      const sec = BigInt(Number(t.seconds ?? 0))
      const nano = BigInt(Number(t.nanos ?? 0))
      return sec * 1_000_000_000n + nano
    }
    if (typeof t.low === 'number' && typeof t.high === 'number') {
      // Bitwise unsigned 64-bit reconstruction
      const low = BigInt(t.low >>> 0)
      const high = BigInt(t.high >>> 0)
      return (high << 32n) | low
    }
  }
  return 0n
}

/** Convert an OTLP `AnyValue` to a plain JS value for storage. */
function anyValueToPlain(v: unknown): unknown {
  if (v == null) return null
  if (typeof v !== 'object') return v
  const av = v as Record<string, unknown>
  if ('stringValue' in av) return av.stringValue ?? ''
  if ('boolValue' in av) return Boolean(av.boolValue)
  if ('intValue' in av) {
    const iv = av.intValue
    if (typeof iv === 'bigint') return Number(iv)
    return typeof iv === 'string' ? Number(iv) : iv
  }
  if ('doubleValue' in av) return av.doubleValue
  if ('bytesValue' in av) {
    const b = av.bytesValue
    if (b instanceof Uint8Array) return Buffer.from(b).toString('base64')
    return b
  }
  if ('arrayValue' in av) {
    const arr = (av.arrayValue as { values?: unknown[] })?.values ?? []
    return arr.map(anyValueToPlain)
  }
  if ('kvlistValue' in av) {
    const kvs = (av.kvlistValue as { values?: { key: string; value: unknown }[] })?.values ?? []
    const out: Record<string, unknown> = {}
    for (const kv of kvs) out[kv.key] = anyValueToPlain(kv.value)
    return out
  }
  // Already plain?
  return v
}

/** Convert an OTLP KeyValue[] into a flat object. */
export function attrsToObject(
  attrs: { key: string; value: unknown }[] | undefined | null,
): Record<string, unknown> {
  const out: Record<string, unknown> = {}
  if (!attrs) return out
  for (const kv of attrs) {
    if (!kv?.key) continue
    out[kv.key] = anyValueToPlain(kv.value)
  }
  return out
}

function stringOrNull(v: unknown): string | null {
  if (v == null) return null
  if (typeof v === 'string') return v
  return String(v)
}

function numOrNull(v: unknown): number | null {
  if (v == null) return null
  const n = typeof v === 'number' ? v : Number(v)
  return Number.isFinite(n) ? n : null
}

// ---------------------------------------------------------------------------
// Spans
// ---------------------------------------------------------------------------

export function flattenTraces(
  req: IExportTraceServiceRequest | { resourceSpans?: unknown[] } | null | undefined,
  receivedAtNs: bigint = BigInt(Date.now()) * 1_000_000n,
): SpanRow[] {
  const out: SpanRow[] = []
  if (!req?.resourceSpans) return out
  for (const rs of req.resourceSpans as Record<string, unknown>[]) {
    const resource = rs.resource as { attributes?: { key: string; value: unknown }[] } | undefined
    const resAttrs = attrsToObject(resource?.attributes)
    const serviceName = stringOrNull(resAttrs[SERVICE_NAME])
    const serviceVersion = stringOrNull(resAttrs[SERVICE_VERSION])
    const deployment = stringOrNull(resAttrs[DEPLOYMENT_ENVIRONMENT])

    const scopeSpansList =
      (rs.scopeSpans as Record<string, unknown>[] | undefined) ??
      (rs.instrumentationLibrarySpans as Record<string, unknown>[] | undefined) ??
      []

    for (const ss of scopeSpansList) {
      const scope = ss.scope as
        | { name?: string; version?: string; attributes?: { key: string; value: unknown }[] }
        | undefined
      const scopeAttrs = attrsToObject(scope?.attributes)
      const spans = (ss.spans as Record<string, unknown>[] | undefined) ?? []

      for (const sp of spans) {
        const attrs = attrsToObject(
          sp.attributes as { key: string; value: unknown }[] | undefined,
        )
        const start = timeToNs(sp.startTimeUnixNano)
        const end = timeToNs(sp.endTimeUnixNano)
        const traceId = idToHex(sp.traceId)
        const spanId = idToHex(sp.spanId)
        const parent = sp.parentSpanId ? idToHex(sp.parentSpanId) : null

        const levelNum = numOrNull(attrs[ATTRIBUTES_LEVEL_KEY])
        const spanType = stringOrNull(attrs[ATTRIBUTES_SPAN_TYPE_KEY])
        const msgTemplate = stringOrNull(attrs[ATTRIBUTES_MESSAGE_TEMPLATE_KEY])
        const msg = stringOrNull(attrs[ATTRIBUTES_MESSAGE_KEY]) ?? (sp.name as string)
        const tagsRaw = attrs[ATTRIBUTES_TAGS_KEY]
        const tags = tagsRaw == null ? null : JSON.stringify(tagsRaw)

        // Strip the promoted keys from attrs_json to avoid duplication.
        const remaining: Record<string, unknown> = { ...attrs }
        delete remaining[ATTRIBUTES_LEVEL_KEY]
        delete remaining[ATTRIBUTES_SPAN_TYPE_KEY]
        delete remaining[ATTRIBUTES_MESSAGE_TEMPLATE_KEY]
        delete remaining[ATTRIBUTES_MESSAGE_KEY]
        delete remaining[ATTRIBUTES_TAGS_KEY]

        const status = (sp.status as { code?: number; message?: string } | undefined) ?? {}
        const events = ((sp.events as unknown[]) ?? []).map((ev) => {
          const e = ev as Record<string, unknown>
          return {
            name: e.name,
            time_unix_ns: timeToNs(e.timeUnixNano).toString(),
            attributes: attrsToObject(
              e.attributes as { key: string; value: unknown }[] | undefined,
            ),
          }
        })
        const links = ((sp.links as unknown[]) ?? []).map((lk) => {
          const l = lk as Record<string, unknown>
          return {
            trace_id: idToHex(l.traceId),
            span_id: idToHex(l.spanId),
            attributes: attrsToObject(
              l.attributes as { key: string; value: unknown }[] | undefined,
            ),
          }
        })

        out.push({
          trace_id: traceId,
          span_id: spanId,
          parent_span_id: parent || null,
          name: (sp.name as string) ?? '',
          start_time_ns: start,
          end_time_ns: end,
          duration_ns: end > start ? end - start : 0n,
          status_code: Number(status.code ?? 0),
          status_message: stringOrNull(status.message),
          kind: Number(sp.kind ?? 0),
          service_name: serviceName,
          service_version: serviceVersion,
          deployment_environment: deployment,
          scope_name: scope?.name ?? null,
          scope_version: scope?.version ?? null,
          logfire_msg: msg,
          logfire_level_num: levelNum,
          logfire_span_type: spanType,
          logfire_msg_template: msgTemplate,
          logfire_tags: tags,
          attributes_json: JSON.stringify(remaining),
          resource_attributes_json: JSON.stringify(resAttrs),
          scope_attributes_json:
            Object.keys(scopeAttrs).length > 0 ? JSON.stringify(scopeAttrs) : null,
          events_json: events.length > 0 ? JSON.stringify(events) : null,
          links_json: links.length > 0 ? JSON.stringify(links) : null,
          dropped_attributes_count: Number(sp.droppedAttributesCount ?? 0),
          dropped_events_count: Number(sp.droppedEventsCount ?? 0),
          dropped_links_count: Number(sp.droppedLinksCount ?? 0),
          received_at_ns: receivedAtNs,
        })
      }
    }
  }
  return out
}

// ---------------------------------------------------------------------------
// Logs
// ---------------------------------------------------------------------------

function bodyToString(body: unknown): string | null {
  if (body == null) return null
  if (typeof body === 'string') return body
  const plain = anyValueToPlain(body)
  if (plain == null) return null
  if (typeof plain === 'string') return plain
  try {
    return JSON.stringify(plain)
  } catch {
    return String(plain)
  }
}

export function flattenLogs(
  req: IExportLogsServiceRequest | { resourceLogs?: unknown[] } | null | undefined,
  receivedAtNs: bigint = BigInt(Date.now()) * 1_000_000n,
): LogRow[] {
  const out: LogRow[] = []
  if (!req?.resourceLogs) return out
  for (const rl of req.resourceLogs as Record<string, unknown>[]) {
    const resource = rl.resource as { attributes?: { key: string; value: unknown }[] } | undefined
    const resAttrs = attrsToObject(resource?.attributes)
    const serviceName = stringOrNull(resAttrs[SERVICE_NAME])

    const scopeLogsList =
      (rl.scopeLogs as Record<string, unknown>[] | undefined) ??
      (rl.instrumentationLibraryLogs as Record<string, unknown>[] | undefined) ??
      []

    for (const sl of scopeLogsList) {
      const scope = sl.scope as { name?: string } | undefined
      const records = (sl.logRecords as Record<string, unknown>[] | undefined) ?? []
      for (const r of records) {
        const attrs = attrsToObject(
          r.attributes as { key: string; value: unknown }[] | undefined,
        )
        out.push({
          trace_id: r.traceId ? idToHex(r.traceId) : null,
          span_id: r.spanId ? idToHex(r.spanId) : null,
          time_unix_ns: timeToNs(r.timeUnixNano),
          observed_time_unix_ns:
            r.observedTimeUnixNano != null ? timeToNs(r.observedTimeUnixNano) : null,
          severity_number: numOrNull(r.severityNumber),
          severity_text: stringOrNull(r.severityText),
          body: bodyToString(r.body),
          service_name: serviceName,
          scope_name: scope?.name ?? null,
          logfire_level_num: numOrNull(attrs[ATTRIBUTES_LEVEL_KEY]),
          attributes_json: JSON.stringify(attrs),
          resource_attributes_json: JSON.stringify(resAttrs),
          received_at_ns: receivedAtNs,
        })
      }
    }
  }
  return out
}

// ---------------------------------------------------------------------------
// Metrics
// ---------------------------------------------------------------------------

export interface FlattenedMetrics {
  streams: MetricStreamRow[]
  points: MetricPointRow[]
}

function fingerprintStream(
  resAttrs: Record<string, unknown>,
  scopeName: string,
  metricName: string,
  pointAttrs: Record<string, unknown>,
): string {
  const sorted = (obj: Record<string, unknown>) =>
    Object.keys(obj)
      .sort()
      .map((k) => `${k}=${JSON.stringify(obj[k])}`)
      .join('|')
  const payload = `${sorted(resAttrs)}\n${scopeName}\n${metricName}\n${sorted(pointAttrs)}`
  return createHash('sha256').update(payload).digest('hex').slice(0, 32)
}

export function flattenMetrics(
  req: IExportMetricsServiceRequest | { resourceMetrics?: unknown[] } | null | undefined,
): FlattenedMetrics {
  const streamsMap = new Map<string, MetricStreamRow>()
  const points: MetricPointRow[] = []
  if (!req?.resourceMetrics) return { streams: [], points }

  for (const rm of req.resourceMetrics as Record<string, unknown>[]) {
    const resource = rm.resource as { attributes?: { key: string; value: unknown }[] } | undefined
    const resAttrs = attrsToObject(resource?.attributes)
    const serviceName = stringOrNull(resAttrs[SERVICE_NAME])

    const scopeMetricsList =
      (rm.scopeMetrics as Record<string, unknown>[] | undefined) ??
      (rm.instrumentationLibraryMetrics as Record<string, unknown>[] | undefined) ??
      []

    for (const sm of scopeMetricsList) {
      const scope = sm.scope as { name?: string } | undefined
      const scopeName = scope?.name ?? ''
      const metrics = (sm.metrics as Record<string, unknown>[] | undefined) ?? []

      for (const m of metrics) {
        const name = (m.name as string) ?? ''
        const description = stringOrNull(m.description)
        const unit = stringOrNull(m.unit)
        const handleDataPoints = (
          kind: MetricStreamRow['kind'],
          dataPoints: Record<string, unknown>[],
          monotonic: number | null,
          aggTemp: number | null,
          isHistogram: boolean,
        ) => {
          for (const dp of dataPoints) {
            const pointAttrs = attrsToObject(
              dp.attributes as { key: string; value: unknown }[] | undefined,
            )
            const fp = fingerprintStream(resAttrs, scopeName, name, pointAttrs)
            if (!streamsMap.has(fp)) {
              streamsMap.set(fp, {
                stream_id: fp,
                metric_name: name,
                description,
                unit,
                kind,
                monotonic,
                aggregation_temp: aggTemp,
                service_name: serviceName,
                scope_name: scopeName || null,
                attributes_json: JSON.stringify(pointAttrs),
                resource_attributes_json: JSON.stringify(resAttrs),
              })
            }
            const time = timeToNs(dp.timeUnixNano)
            const start = dp.startTimeUnixNano != null ? timeToNs(dp.startTimeUnixNano) : null
            let value: number | null = null
            let histogramJson: string | null = null
            if (isHistogram) {
              histogramJson = JSON.stringify({
                count: Number(dp.count ?? 0),
                sum: Number(dp.sum ?? 0),
                bucket_counts:
                  (dp.bucketCounts as (number | bigint)[] | undefined)?.map((n) => Number(n)) ?? [],
                explicit_bounds:
                  (dp.explicitBounds as number[] | undefined) ?? [],
                min: dp.min != null ? Number(dp.min) : undefined,
                max: dp.max != null ? Number(dp.max) : undefined,
              })
            } else {
              const asDouble = dp.asDouble
              const asInt = dp.asInt
              if (asDouble != null) value = Number(asDouble)
              else if (asInt != null) value = Number(asInt)
              else if (dp.value != null) value = Number(dp.value)
            }
            points.push({
              stream_id: fp,
              time_unix_ns: time,
              start_unix_ns: start,
              value,
              histogram_json: histogramJson,
            })
          }
        }

        if (m.sum) {
          const s = m.sum as Record<string, unknown>
          handleDataPoints(
            'sum',
            (s.dataPoints as Record<string, unknown>[]) ?? [],
            s.isMonotonic ? 1 : 0,
            numOrNull(s.aggregationTemporality),
            false,
          )
        } else if (m.gauge) {
          const g = m.gauge as Record<string, unknown>
          handleDataPoints(
            'gauge',
            (g.dataPoints as Record<string, unknown>[]) ?? [],
            null,
            null,
            false,
          )
        } else if (m.histogram) {
          const h = m.histogram as Record<string, unknown>
          handleDataPoints(
            'histogram',
            (h.dataPoints as Record<string, unknown>[]) ?? [],
            null,
            numOrNull(h.aggregationTemporality),
            true,
          )
        } else if (m.exponentialHistogram) {
          const h = m.exponentialHistogram as Record<string, unknown>
          handleDataPoints(
            'exphist',
            (h.dataPoints as Record<string, unknown>[]) ?? [],
            null,
            numOrNull(h.aggregationTemporality),
            true,
          )
        } else if (m.summary) {
          const s = m.summary as Record<string, unknown>
          handleDataPoints(
            'summary',
            (s.dataPoints as Record<string, unknown>[]) ?? [],
            null,
            null,
            true,
          )
        }
      }
    }
  }
  return { streams: [...streamsMap.values()], points }
}
