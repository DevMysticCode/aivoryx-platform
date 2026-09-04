import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { generateSessionToken, hashSessionToken, tokenHashEquals } from './session-token.js';

describe('session tokens', () => {
  it('generates a high-entropy URL-safe token', () => {
    const token = generateSessionToken();
    // 32 random bytes, base64url => 43 chars, no padding, url-safe alphabet
    expect(token).toMatch(/^[A-Za-z0-9_-]{43}$/);
    const many = new Set(Array.from({ length: 500 }, () => generateSessionToken()));
    expect(many.size).toBe(500);
  });

  it('stores only a SHA-256 hash, never the raw token', () => {
    const token = generateSessionToken();
    const hash = hashSessionToken(token);
    expect(hash).toMatch(/^[0-9a-f]{64}$/);
    expect(hash).not.toBe(token);
    expect(hash).toBe(createHash('sha256').update(token).digest('hex'));
  });

  it('is deterministic and collision-free across tokens', () => {
    const t = generateSessionToken();
    expect(hashSessionToken(t)).toBe(hashSessionToken(t));
    expect(hashSessionToken(generateSessionToken())).not.toBe(
      hashSessionToken(generateSessionToken()),
    );
  });

  it('compares hashes in constant time', () => {
    const a = hashSessionToken('a');
    expect(tokenHashEquals(a, a)).toBe(true);
    expect(tokenHashEquals(a, hashSessionToken('b'))).toBe(false);
    expect(tokenHashEquals(a, 'short')).toBe(false);
  });
});
