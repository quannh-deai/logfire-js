import { describe, expect, test, vi } from 'vitest'

import { TokenBucketLimiter } from '../ratelimit/tokenBucket.js'

describe('TokenBucketLimiter', () => {
  test('per-token bucket allows up to burst then rejects', () => {
    const limiter = new TokenBucketLimiter(null)
    expect(limiter.take('k', 1, 5, 5).allowed).toBe(true)
    expect(limiter.take('k', 1, 5, 1).allowed).toBe(false)
  })

  test('per-token bucket refills over time', () => {
    vi.useFakeTimers()
    try {
      vi.setSystemTime(0)
      const limiter = new TokenBucketLimiter(null)
      expect(limiter.take('k', 10, 10, 10).allowed).toBe(true)
      expect(limiter.take('k', 10, 10, 1).allowed).toBe(false)
      vi.setSystemTime(1000)
      // 10 tokens/sec * 1s = 10 refilled.
      expect(limiter.take('k', 10, 10, 10).allowed).toBe(true)
    } finally {
      vi.useRealTimers()
    }
  })

  test('unlimited (rate=null) always allows', () => {
    const limiter = new TokenBucketLimiter(null)
    for (let i = 0; i < 100; i++) {
      expect(limiter.take('k', null, null, 1000).allowed).toBe(true)
    }
  })

  test('global ceiling rejects regardless of per-token settings', () => {
    const limiter = new TokenBucketLimiter(5)
    expect(limiter.take('k', null, null, 5).allowed).toBe(true)
    expect(limiter.take('k', null, null, 1).allowed).toBe(false)
  })

  test('rate-limited result includes retryAfter', () => {
    const limiter = new TokenBucketLimiter(null)
    limiter.take('k', 1, 1, 1)
    const r = limiter.take('k', 1, 1, 5)
    expect(r.allowed).toBe(false)
    expect(r.retryAfterSec).toBeGreaterThan(0)
  })
})
