import { describe, expect, it } from 'vitest';
import {
  extractBearerSecret,
  generateConnectorSecret,
  hashConnectorSecret,
} from './connector-token.js';

/** UC-0 characterization: freezes the observable behaviour of connector credentials. */
describe('connector secrets', () => {
  it('generates a long, URL-safe, unique secret each time', () => {
    const a = generateConnectorSecret();
    const b = generateConnectorSecret();
    expect(a).not.toBe(b);
    expect(a).toMatch(/^[A-Za-z0-9_-]+$/);
    expect(a.length).toBeGreaterThanOrEqual(43); // 256 bits, base64url
  });

  it('hashes to a deterministic hex SHA-256 that is not the secret itself', () => {
    const s = 'example-secret-value';
    const h = hashConnectorSecret(s);
    expect(h).toMatch(/^[0-9a-f]{64}$/);
    expect(hashConnectorSecret(s)).toBe(h);
    expect(hashConnectorSecret(`${s}x`)).not.toBe(h);
    expect(h).not.toContain(s);
  });
});

describe('extractBearerSecret', () => {
  it.each([
    ['Bearer abc123', 'abc123'],
    ['bearer abc123', 'abc123'],
    ['BEARER abc123', 'abc123'],
    ['Bearer    abc123', 'abc123'],
    ['  Bearer abc123  ', 'abc123'],
  ])('accepts %j', (header, secret) => {
    expect(extractBearerSecret(header)).toBe(secret);
  });

  it.each([
    [undefined],
    [''],
    ['Bearer'],
    ['Bearer '],
    ['Basic abc123'],
    ['abc123'],
    ['Bearer a b'],
    ['Token abc123'],
  ])('rejects %j', (header) => {
    expect(extractBearerSecret(header as string | undefined)).toBeNull();
  });
});
