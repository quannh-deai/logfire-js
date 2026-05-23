import { describe, expect, test } from 'vitest'

import { SERVICE_NAME } from '../constants.js'
import { flattenMetrics } from '../ingest/flatten.js'

describe('flattenMetrics', () => {
  test('flattens sum metric points and emits a stream', () => {
    const req = {
      resourceMetrics: [
        {
          resource: { attributes: [{ key: SERVICE_NAME, value: { stringValue: 'svc' } }] },
          scopeMetrics: [
            {
              scope: { name: 'meter' },
              metrics: [
                {
                  name: 'requests_total',
                  description: 'request counter',
                  unit: '1',
                  sum: {
                    isMonotonic: true,
                    aggregationTemporality: 2,
                    dataPoints: [
                      {
                        timeUnixNano: '1000000000',
                        startTimeUnixNano: '0',
                        asInt: 42,
                        attributes: [{ key: 'route', value: { stringValue: '/api' } }],
                      },
                    ],
                  },
                },
              ],
            },
          ],
        },
      ],
    }
    const { streams, points } = flattenMetrics(req)
    expect(streams).toHaveLength(1)
    expect(streams[0]!.kind).toBe('sum')
    expect(streams[0]!.metric_name).toBe('requests_total')
    expect(streams[0]!.monotonic).toBe(1)
    expect(streams[0]!.service_name).toBe('svc')
    expect(points).toHaveLength(1)
    expect(points[0]!.stream_id).toBe(streams[0]!.stream_id)
    expect(points[0]!.value).toBe(42)
    expect(points[0]!.time_unix_ns).toBe(1_000_000_000n)
  })

  test('flattens histogram with buckets', () => {
    const req = {
      resourceMetrics: [
        {
          resource: { attributes: [] },
          scopeMetrics: [
            {
              scope: { name: 'meter' },
              metrics: [
                {
                  name: 'latency',
                  unit: 'ms',
                  histogram: {
                    aggregationTemporality: 2,
                    dataPoints: [
                      {
                        timeUnixNano: '1',
                        count: 10,
                        sum: 250,
                        bucketCounts: [1, 4, 5],
                        explicitBounds: [10, 100],
                        attributes: [],
                      },
                    ],
                  },
                },
              ],
            },
          ],
        },
      ],
    }
    const { streams, points } = flattenMetrics(req)
    expect(streams[0]!.kind).toBe('histogram')
    expect(points[0]!.histogram_json).toBeTruthy()
    const h = JSON.parse(points[0]!.histogram_json!) as Record<string, unknown>
    expect(h.count).toBe(10)
    expect(h.sum).toBe(250)
    expect(h.bucket_counts).toEqual([1, 4, 5])
    expect(h.explicit_bounds).toEqual([10, 100])
  })
})
