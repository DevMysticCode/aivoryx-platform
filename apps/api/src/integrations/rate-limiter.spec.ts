import { describe, expect, it } from 'vitest';
import { TokenBucketRateLimiter } from './rate-limiter.js';

/** a manually advanced clock, so no test uses fake timers or real waiting */
function clock(start = 1_000_000) {
  let t = start;
  return { now: () => t, advance: (ms: number) => void (t += ms) };
}

describe('TokenBucketRateLimiter', () => {
  it('allows up to the capacity, then rejects', () => {
    const c = clock();
    const rl = new TokenBucketRateLimiter({ capacity: 3, windowSeconds: 60, now: c.now });
    const results = [1, 2, 3, 4].map(() => rl.consume('k'));
    expect(results.map((r) => r.allowed)).toEqual([true, true, true, false]);
    expect(results.map((r) => r.remaining)).toEqual([2, 1, 0, 0]);
    expect(results[3]!.limit).toBe(3);
  });

  it('a request exactly at the limit is allowed; the next one is not', () => {
    const rl = new TokenBucketRateLimiter({ capacity: 2, windowSeconds: 60, now: clock().now });
    expect(rl.consume('k').allowed).toBe(true);
    expect(rl.consume('k').allowed).toBe(true); // 2nd of 2 = at the limit
    expect(rl.consume('k').allowed).toBe(false); // 3rd = over
  });

  it('reports a whole-second Retry-After of at least 1', () => {
    const c = clock();
    const rl = new TokenBucketRateLimiter({ capacity: 1, windowSeconds: 60, now: c.now });
    rl.consume('k');
    const denied = rl.consume('k');
    expect(denied.allowed).toBe(false);
    expect(Number.isInteger(denied.retryAfterSeconds)).toBe(true);
    expect(denied.retryAfterSeconds).toBe(60); // refill 1 token / 60s
    c.advance(59_000);
    expect(rl.consume('k').retryAfterSeconds).toBe(1);
  });

  it('keys are independent buckets', () => {
    const rl = new TokenBucketRateLimiter({ capacity: 1, windowSeconds: 60, now: clock().now });
    expect(rl.consume('source:a').allowed).toBe(true);
    expect(rl.consume('source:a').allowed).toBe(false);
    expect(rl.consume('source:b').allowed).toBe(true); // not shared with a
  });

  it('refills over time and traffic resumes once the window has passed', () => {
    const c = clock();
    const rl = new TokenBucketRateLimiter({ capacity: 3, windowSeconds: 30, now: c.now });
    for (let i = 0; i < 3; i++) rl.consume('k');
    expect(rl.consume('k').allowed).toBe(false);
    c.advance(10_000); // 3 tokens / 30s => one token per 10s
    expect(rl.consume('k').allowed).toBe(true);
    expect(rl.consume('k').allowed).toBe(false);
    c.advance(30_000); // full window: back to full capacity, never above it
    const after = [1, 2, 3, 4].map(() => rl.consume('k').allowed);
    expect(after).toEqual([true, true, true, false]);
  });

  it('a clock that goes backwards never grants extra tokens', () => {
    const c = clock();
    const rl = new TokenBucketRateLimiter({ capacity: 1, windowSeconds: 60, now: c.now });
    rl.consume('k');
    c.advance(-5_000);
    expect(rl.consume('k').allowed).toBe(false);
  });

  it('bounds memory: never tracks more than maxKeys', () => {
    const rl = new TokenBucketRateLimiter({
      capacity: 5,
      windowSeconds: 60,
      now: clock().now,
      maxKeys: 10,
    });
    for (let i = 0; i < 100; i++) rl.consume(`k${i}`);
    expect(rl.size()).toBeLessThanOrEqual(10);
  });

  it('rejects an invalid configuration instead of silently misbehaving', () => {
    expect(() => new TokenBucketRateLimiter({ capacity: 0, windowSeconds: 60 })).toThrow();
    expect(() => new TokenBucketRateLimiter({ capacity: 5, windowSeconds: 0 })).toThrow();
  });
});
