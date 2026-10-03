import { describe, expect, it } from 'vitest';
import { hashRawBody } from './raw-hash.js';

/** UC-0 characterization: the exact-redelivery hash that backs `raw_events` idempotency. */
describe('hashRawBody', () => {
  it('is a hex SHA-256 and deterministic', () => {
    const h = hashRawBody({ a: 1 });
    expect(h).toMatch(/^[0-9a-f]{64}$/);
    expect(hashRawBody({ a: 1 })).toBe(h);
  });

  it('ignores object key order at every depth', () => {
    expect(hashRawBody({ a: 1, b: { c: 2, d: 3 } })).toBe(hashRawBody({ b: { d: 3, c: 2 }, a: 1 }));
  });

  it('is sensitive to values, array order and types', () => {
    expect(hashRawBody({ a: 1 })).not.toBe(hashRawBody({ a: 2 }));
    expect(hashRawBody({ a: [1, 2] })).not.toBe(hashRawBody({ a: [2, 1] }));
    expect(hashRawBody({ a: 1 })).not.toBe(hashRawBody({ a: '1' }));
    expect(hashRawBody({ a: null })).not.toBe(hashRawBody({}));
  });
});
