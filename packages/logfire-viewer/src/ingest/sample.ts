import { createHash } from 'node:crypto'

import type { LogRow, MetricPointRow, SpanRow } from '../types.js'

function traceIdToUnit(traceId: string): number {
  if (!traceId) return Math.random()
  const buf = createHash('sha256').update(traceId).digest()
  // Use the top 53 bits to fit a JS double safely.
  const hi = buf.readUInt32BE(0)
  const lo = buf.readUInt32BE(4) >>> 11
  return (hi * 2 ** 21 + lo) / 2 ** 53
}

export function sampleSpans(rows: SpanRow[], rate: number): SpanRow[] {
  if (rate >= 1) return rows
  if (rate <= 0) return []
  // Trace-scoped decision: group by trace_id so all spans share the fate.
  const decisions = new Map<string, boolean>()
  return rows.filter((r) => {
    let keep = decisions.get(r.trace_id)
    if (keep === undefined) {
      keep = traceIdToUnit(r.trace_id) < rate
      decisions.set(r.trace_id, keep)
    }
    return keep
  })
}

export function sampleLogs(rows: LogRow[], rate: number): LogRow[] {
  if (rate >= 1) return rows
  if (rate <= 0) return []
  return rows.filter(() => Math.random() < rate)
}

export function sampleMetricPoints(rows: MetricPointRow[], rate: number): MetricPointRow[] {
  if (rate >= 1) return rows
  if (rate <= 0) return []
  return rows.filter(() => Math.random() < rate)
}
