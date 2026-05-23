interface Bucket {
  tokens: number
  lastRefillMs: number
  rate: number
  burst: number
}

export interface RateLimitResult {
  allowed: boolean
  retryAfterSec?: number
}

export class TokenBucketLimiter {
  private buckets = new Map<string, Bucket>()
  private globalBucket: Bucket | null = null

  constructor(globalRps?: number | null) {
    if (globalRps && globalRps > 0 && Number.isFinite(globalRps)) {
      this.globalBucket = {
        tokens: globalRps,
        lastRefillMs: Date.now(),
        rate: globalRps,
        burst: globalRps,
      }
    }
  }

  /**
   * Consume `n` tokens from the (key, perTokenRate, perTokenBurst) bucket
   * AND the global bucket. Returns whether the operation is allowed.
   */
  take(
    key: string,
    rate: number | null | undefined,
    burst: number | null | undefined,
    n: number,
  ): RateLimitResult {
    const now = Date.now()
    if (this.globalBucket) {
      this.refill(this.globalBucket, now)
      if (this.globalBucket.tokens < n) {
        return {
          allowed: false,
          retryAfterSec: Math.max(
            1,
            Math.ceil((n - this.globalBucket.tokens) / this.globalBucket.rate),
          ),
        }
      }
    }
    if (rate && rate > 0) {
      let b = this.buckets.get(key)
      if (!b) {
        b = {
          tokens: burst ?? rate,
          lastRefillMs: now,
          rate,
          burst: burst ?? rate,
        }
        this.buckets.set(key, b)
      } else if (b.rate !== rate || b.burst !== (burst ?? rate)) {
        b.rate = rate
        b.burst = burst ?? rate
        b.tokens = Math.min(b.tokens, b.burst)
      }
      this.refill(b, now)
      if (b.tokens < n) {
        return { allowed: false, retryAfterSec: Math.max(1, Math.ceil((n - b.tokens) / b.rate)) }
      }
      b.tokens -= n
    }
    if (this.globalBucket) this.globalBucket.tokens -= n
    return { allowed: true }
  }

  private refill(b: Bucket, now: number): void {
    const elapsed = (now - b.lastRefillMs) / 1000
    if (elapsed > 0) {
      b.tokens = Math.min(b.burst, b.tokens + elapsed * b.rate)
      b.lastRefillMs = now
    }
  }
}
