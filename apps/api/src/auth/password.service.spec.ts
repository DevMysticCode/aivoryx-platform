import { describe, expect, it } from 'vitest';
import type { ServerEnv } from '@aivoryx/config';
import { PasswordService } from './password.service.js';

function makeService(overrides: Partial<ServerEnv> = {}): PasswordService {
  return new PasswordService({
    ARGON2_MEMORY_KIB: 19_456,
    ARGON2_TIME_COST: 2,
    ARGON2_PARALLELISM: 1,
    ...overrides,
  } as ServerEnv);
}

describe('PasswordService', () => {
  const svc = makeService();

  it('produces an Argon2id PHC string, never the plaintext', async () => {
    const hash = await svc.hash('correct horse battery staple');
    expect(hash.startsWith('$argon2id$')).toBe(true);
    expect(hash).not.toContain('correct horse battery staple');
    expect(hash).toMatch(/\$m=19456,t=2,p=1\$/);
  });

  it('verifies the right password and rejects the wrong one', async () => {
    const hash = await svc.hash('s3cret-passphrase');
    await expect(svc.verify(hash, 's3cret-passphrase')).resolves.toBe(true);
    await expect(svc.verify(hash, 's3cret-passphras')).resolves.toBe(false);
    await expect(svc.verify(hash, '')).resolves.toBe(false);
  });

  it('returns false (does not throw) for a malformed hash', async () => {
    await expect(svc.verify('not-a-hash', 'whatever')).resolves.toBe(false);
    await expect(svc.verify('', 'whatever')).resolves.toBe(false);
  });

  it('salts each hash — same password hashes differently', async () => {
    const a = await svc.hash('same-password');
    const b = await svc.hash('same-password');
    expect(a).not.toBe(b);
    await expect(svc.verify(a, 'same-password')).resolves.toBe(true);
    await expect(svc.verify(b, 'same-password')).resolves.toBe(true);
  });

  it('flags a hash made with weaker parameters for rehash', async () => {
    const weak = makeService({ ARGON2_MEMORY_KIB: 8_192 });
    const weakHash = await weak.hash('pw');
    // current (stronger) service wants it rehashed
    expect(svc.needsRehash(weakHash)).toBe(true);
    // its own hash is fine
    const currentHash = await svc.hash('pw');
    expect(svc.needsRehash(currentHash)).toBe(false);
    // garbage always needs rehash
    expect(svc.needsRehash('$2b$10$abcdefghijklmnopqrstuv')).toBe(true);
  });
});
