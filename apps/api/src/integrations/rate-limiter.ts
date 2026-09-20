/**
 * Rate limiting for the public inbound webhook (UC-1).
 *
 * Connector logic depends only on `RateLimiter`. The initial implementation is an
 * in-process token bucket; a distributed (e.g. Redis) implementation can replace it
 * behind the same interface without touching the ingestion code.
 *
 * SCOPE (deliberate): the key is the AUTHENTICATED SOURCE (`source:<sourceId>`), applied
 * after the connector secret has been resolved and before anything is persisted.
 *  - Not the URL source key: it is public and guessable, so an unauthenticated caller could drain
 *    a real source's bucket and lock its legitimate traffic out.
 *  - Not the client IP: the API has no trusted-proxy configuration, so behind Render/Vercel
 *    `req.ip` is the proxy's address, shared by every tenant; an IP bucket would let one caller
 *    throttle everyone. Forwarded-for headers are not trusted. Introduce IP scoping together with a
 *    trusted-proxy setting, not before.
 */

export interface RateLimitDecision {
  allowed: boolean;
  /** configured burst capacity */
  limit: number;
  /** whole tokens left after this decision */
  remaining: number;
  /** when `allowed` is false: whole seconds until one request would be allowed (>= 1) */
  retryAfterSeconds: number;
}

export interface RateLimiter {
  /** Try to consume one unit for `key`. Never throws. */
  consume(key: string): RateLimitDecision;
}

/** DI token for the webhook rate limiter. */
export const WEBHOOK_RATE_LIMITER = Symbol('WEBHOOK_RATE_LIMITER');

export interface TokenBucketOptions {
  /** bucket capacity = the burst size */
  capacity: number;
  /** seconds for an empty bucket to refill completely (sustained rate = capacity / windowSeconds) */
  windowSeconds: number;
  /** injectable clock (ms) — tests advance it instead of using fake timers */
  now?: () => number;
  /** upper bound on tracked keys, to bound memory (idle full buckets are evicted first) */
  maxKeys?: number;
}

interface Bucket {
  tokens: number;
  updatedAt: number;
}

export class TokenBucketRateLimiter implements RateLimiter {
  private readonly buckets = new Map<string, Bucket>();
  private readonly capacity: number;
  private readonly refillPerMs: number;
  private readonly now: () => number;
  private readonly maxKeys: number;

  constructor(options: TokenBucketOptions) {
    if (!(options.capacity >= 1)) throw new Error('capacity must be >= 1');
    if (!(options.windowSeconds > 0)) throw new Error('windowSeconds must be > 0');
    this.capacity = Math.floor(options.capacity);
    this.refillPerMs = this.capacity / (options.windowSeconds * 1000);
    this.now = options.now ?? Date.now;
    this.maxKeys = options.maxKeys ?? 10_000;
  }

  consume(key: string): RateLimitDecision {
    const now = this.now();
    let bucket = this.buckets.get(key);
    if (!bucket) {
      if (this.buckets.size >= this.maxKeys) this.evict(now);
      bucket = { tokens: this.capacity, updatedAt: now };
      this.buckets.set(key, bucket);
    } else {
      bucket.tokens = Math.min(
        this.capacity,
        bucket.tokens + Math.max(0, now - bucket.updatedAt) * this.refillPerMs,
      );
      bucket.updatedAt = now;
    }

    if (bucket.tokens >= 1) {
      bucket.tokens -= 1;
      return {
        allowed: true,
        limit: this.capacity,
        remaining: Math.floor(bucket.tokens),
        retryAfterSeconds: 0,
      };
    }
    const msUntilToken = (1 - bucket.tokens) / this.refillPerMs;
    return {
      allowed: false,
      limit: this.capacity,
      remaining: 0,
      retryAfterSeconds: Math.max(1, Math.ceil(msUntilToken / 1000)),
    };
  }

  /** Drop buckets that have refilled completely (equivalent to never having been seen). */
  private evict(now: number): void {
    for (const [k, b] of this.buckets) {
      const tokens = b.tokens + Math.max(0, now - b.updatedAt) * this.refillPerMs;
      if (tokens >= this.capacity) this.buckets.delete(k);
    }
    // still full of active buckets: drop the oldest-inserted to stay bounded
    if (this.buckets.size >= this.maxKeys) {
      const oldest = this.buckets.keys().next();
      if (!oldest.done) this.buckets.delete(oldest.value);
    }
  }

  /** for tests / diagnostics */
  size(): number {
    return this.buckets.size;
  }
}
