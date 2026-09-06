import { describe, expect, it } from 'vitest';
import {
  REDACTED,
  buildChanges,
  isSensitiveKey,
  sanitizeChanges,
  sanitizeMetadata,
} from './audit.redaction.js';

/**
 * Phase 11 (ADR 0040) — audit payloads must never carry secrets or unbounded
 * blobs. Redaction is the backstop for every `metadata` / `changes` value.
 */
describe('audit redaction', () => {
  it('recognises sensitive key names', () => {
    for (const k of [
      'password',
      'passwordHash',
      'sessionToken',
      'apiKey',
      'api_key',
      'connectorSecret',
      'authorization',
      'smtpUrl',
      'refreshToken',
      'rawPayload',
      'webhookBody',
    ]) {
      expect(isSensitiveKey(k), k).toBe(true);
    }
    for (const k of ['status', 'amount', 'invoiceId', 'name', 'quantity']) {
      expect(isSensitiveKey(k), k).toBe(false);
    }
  });

  it('drops sensitive keys anywhere in the object tree', () => {
    const out = sanitizeMetadata({
      email: 'a@b.test',
      password: 'hunter2',
      nested: { secret: 'x', ok: 1, session_token: 'y' },
    });
    expect(out.password).toBe(REDACTED);
    expect((out.nested as Record<string, unknown>).secret).toBe(REDACTED);
    expect((out.nested as Record<string, unknown>).session_token).toBe(REDACTED);
    expect((out.nested as Record<string, unknown>).ok).toBe(1);
    expect(out.email).toBe('a@b.test');
  });

  it('truncates long strings and bounds arrays / depth', () => {
    const out = sanitizeMetadata({
      big: 'x'.repeat(5000),
      list: Array.from({ length: 200 }, (_, i) => i),
    });
    expect((out.big as string).length).toBeLessThan(2100);
    expect((out.big as string).endsWith('[truncated]')).toBe(true);
    expect((out.list as unknown[]).length).toBeLessThanOrEqual(51);
  });

  it('strips values that cannot be safely serialised', () => {
    const out = sanitizeMetadata({
      fn: () => 1,
      sym: Symbol('x'),
      when: new Date('2026-01-01T00:00:00.000Z'),
      big: 10n,
    } as Record<string, unknown>);
    expect('fn' in out).toBe(false);
    expect('sym' in out).toBe(false);
    expect(out.when).toBe('2026-01-01T00:00:00.000Z');
    expect(out.big).toBe('10');
  });

  it('buildChanges only inspects approved fields and only emits real diffs', () => {
    const before = { status: 'DRAFT', total: '100.00', secretToken: 'a' };
    const after = { status: 'SENT', total: '100.00', secretToken: 'b' };
    const changes = buildChanges(before, after, ['status', 'total', 'secretToken']);
    expect(changes).toEqual({ status: { from: 'DRAFT', to: 'SENT' } });
  });

  it('buildChanges returns null when nothing approved changed', () => {
    expect(buildChanges({ a: 1 }, { a: 1 }, ['a'])).toBeNull();
  });

  it('sanitizeChanges redacts a sensitive field key and cleans values', () => {
    const out = sanitizeChanges({
      status: { from: 'A', to: 'B' },
      apiSecret: { from: 'x', to: 'y' },
    });
    expect(out).toEqual({ status: { from: 'A', to: 'B' } });
  });
});
