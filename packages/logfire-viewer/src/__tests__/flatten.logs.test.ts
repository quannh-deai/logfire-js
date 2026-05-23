import { describe, expect, test } from 'vitest'

import { ATTRIBUTES_LEVEL_KEY, SERVICE_NAME } from '../constants.js'
import { flattenLogs } from '../ingest/flatten.js'

describe('flattenLogs', () => {
  test('extracts severity, body, and logfire level', () => {
    const req = {
      resourceLogs: [
        {
          resource: {
            attributes: [{ key: SERVICE_NAME, value: { stringValue: 'svc' } }],
          },
          scopeLogs: [
            {
              scope: { name: 'lib' },
              logRecords: [
                {
                  timeUnixNano: '2000000000',
                  observedTimeUnixNano: '2000001000',
                  severityNumber: 17,
                  severityText: 'ERROR',
                  body: { stringValue: 'boom' },
                  traceId: '0'.repeat(32),
                  spanId: '1'.repeat(16),
                  attributes: [{ key: ATTRIBUTES_LEVEL_KEY, value: { intValue: 17 } }],
                },
              ],
            },
          ],
        },
      ],
    }
    const rows = flattenLogs(req)
    expect(rows).toHaveLength(1)
    const r = rows[0]!
    expect(r.service_name).toBe('svc')
    expect(r.scope_name).toBe('lib')
    expect(r.severity_number).toBe(17)
    expect(r.severity_text).toBe('ERROR')
    expect(r.body).toBe('boom')
    expect(r.logfire_level_num).toBe(17)
    expect(r.trace_id).toBe('0'.repeat(32))
    expect(r.time_unix_ns).toBe(2_000_000_000n)
  })

  test('serializes nested AnyValue body to JSON', () => {
    const req = {
      resourceLogs: [
        {
          resource: { attributes: [] },
          scopeLogs: [
            {
              scope: { name: 'x' },
              logRecords: [
                {
                  timeUnixNano: 0,
                  body: {
                    kvlistValue: {
                      values: [
                        { key: 'a', value: { stringValue: 'b' } },
                        { key: 'n', value: { intValue: 42 } },
                      ],
                    },
                  },
                  attributes: [],
                },
              ],
            },
          ],
        },
      ],
    }
    const rows = flattenLogs(req)
    expect(JSON.parse(rows[0]!.body ?? '{}')).toEqual({ a: 'b', n: 42 })
  })
})
