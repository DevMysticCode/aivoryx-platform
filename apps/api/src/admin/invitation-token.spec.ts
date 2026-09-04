import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { generateInvitationToken, hashInvitationToken } from './invitation-token.js';

describe('invitation tokens (ADR 0030)', () => {
  it('generates a high-entropy URL-safe token', () => {
    const token = generateInvitationToken();
    // 32 random bytes, base64url => 43 chars, no padding, url-safe alphabet
    expect(token).toMatch(/^[A-Za-z0-9_-]{43}$/);
    const many = new Set(Array.from({ length: 500 }, () => generateInvitationToken()));
    expect(many.size).toBe(500);
  });

  it('hashes with SHA-256 (hex) — never returns the raw token', () => {
    const token = generateInvitationToken();
    const hash = hashInvitationToken(token);
    expect(hash).toMatch(/^[0-9a-f]{64}$/);
    expect(hash).not.toBe(token);
    expect(hash).toBe(createHash('sha256').update(token, 'utf8').digest('hex'));
  });

  it('is deterministic and collision-free across tokens', () => {
    const t = generateInvitationToken();
    expect(hashInvitationToken(t)).toBe(hashInvitationToken(t));
    expect(hashInvitationToken(generateInvitationToken())).not.toBe(
      hashInvitationToken(generateInvitationToken()),
    );
  });
});
