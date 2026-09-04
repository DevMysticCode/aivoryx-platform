import { describe, expect, it } from 'vitest';
import { isUuid, isUuidV7, newUuidV7 } from './id.js';

describe('UUIDv7 helpers', () => {
  it('generates well-formed version-7 UUIDs', () => {
    for (let i = 0; i < 100; i += 1) {
      const id = newUuidV7();
      expect(isUuid(id)).toBe(true);
      expect(isUuidV7(id)).toBe(true);
      expect(id[14]).toBe('7');
    }
  });

  it('generates time-ordered values', () => {
    const a = newUuidV7();
    const b = newUuidV7();
    expect(a < b || a === b).toBe(true);
  });

  it('rejects non-v7 UUIDs', () => {
    expect(isUuidV7('00000000-0000-4000-8000-000000000000')).toBe(false);
    expect(isUuid('not-a-uuid')).toBe(false);
  });
});
