import { describe, expect, test } from 'vitest'

import { ATTRIBUTES_LEVEL_KEY, ATTRIBUTES_TAGS_KEY, SERVICE_NAME } from '../constants.js'
import { flattenTraces } from '../ingest/flatten.js'

function kv(key: string, value: unknown): { key: string; value: { stringValue?: string; intValue?: number; arrayValue?: { values: unknown[] } } } {
  if (typeof value === 'string') return { key, value: { stringValue: value } }
  if (typeof value === 'number') return { key, value: { intValue: value } }
  if (Array.isArray(value)) {
    return {
      key,
      value: {
        arrayValue: { values: value.map((v) => (typeof v === 'string' ? { stringValue: v } : { intValue: v as number })) },
      },
    }
  }
  return { key, value: { stringValue: String(value) } }
}

describe('flattenTraces', () => {
  test('extracts logfire-specific attributes into dedicated columns', () => {
    const traceIdHex = '0123456789abcdef0123456789abcdef'
    const spanIdHex = '0011223344556677'
    const req = {
      resourceSpans: [
        {
          resource: {
            attributes: [kv(SERVICE_NAME, 'my-svc'), kv('host.name', 'box-1')],
          },
          scopeSpans: [
            {
              scope: { name: 'my-scope', version: '1.0' },
              spans: [
                {
                  traceId: traceIdHex,
                  spanId: spanIdHex,
                  parentSpanId: '',
                  name: 'hello',
                  kind: 1,
                  startTimeUnixNano: '1000000000',
                  endTimeUnixNano: '1500000000',
                  status: { code: 1 },
                  attributes: [
                    kv(ATTRIBUTES_LEVEL_KEY, 9),
                    kv(ATTRIBUTES_TAGS_KEY, ['t1', 't2']),
                    kv('user_id', 'u-1'),
                  ],
                },
              ],
            },
          ],
        },
      ],
    }
    const rows = flattenTraces(req)
    expect(rows).toHaveLength(1)
    const r = rows[0]!
    expect(r.trace_id).toBe(traceIdHex)
    expect(r.span_id).toBe(spanIdHex)
    expect(r.parent_span_id).toBeNull()
    expect(r.service_name).toBe('my-svc')
    expect(r.scope_name).toBe('my-scope')
    expect(r.scope_version).toBe('1.0')
    expect(r.logfire_level_num).toBe(9)
    expect(r.logfire_tags).toBe(JSON.stringify(['t1', 't2']))
    expect(r.logfire_msg).toBe('hello')
    expect(JSON.parse(r.attributes_json)).toEqual({ user_id: 'u-1' })
    expect(JSON.parse(r.resource_attributes_json)).toEqual({
      'service.name': 'my-svc',
      'host.name': 'box-1',
    })
    expect(r.start_time_ns).toBe(1_000_000_000n)
    expect(r.end_time_ns).toBe(1_500_000_000n)
    expect(r.duration_ns).toBe(500_000_000n)
  })

  test('handles Uint8Array trace/span IDs and parent linking', () => {
    const traceBytes = Buffer.from('aa'.repeat(16), 'hex')
    const spanBytes = Buffer.from('bb'.repeat(8), 'hex')
    const parentBytes = Buffer.from('cc'.repeat(8), 'hex')
    const req = {
      resourceSpans: [
        {
          resource: { attributes: [] },
          scopeSpans: [
            {
              scope: { name: 'x' },
              spans: [
                {
                  traceId: traceBytes,
                  spanId: spanBytes,
                  parentSpanId: parentBytes,
                  name: 'child',
                  kind: 0,
                  startTimeUnixNano: 0,
                  endTimeUnixNano: 0,
                  attributes: [],
                },
              ],
            },
          ],
        },
      ],
    }
    const rows = flattenTraces(req)
    expect(rows[0]!.trace_id).toBe('aa'.repeat(16))
    expect(rows[0]!.span_id).toBe('bb'.repeat(8))
    expect(rows[0]!.parent_span_id).toBe('cc'.repeat(8))
  })

  test('returns empty for missing/empty payloads', () => {
    expect(flattenTraces({})).toEqual([])
    expect(flattenTraces({ resourceSpans: [] })).toEqual([])
    expect(flattenTraces(null)).toEqual([])
  })
})
