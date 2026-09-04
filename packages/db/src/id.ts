import { uuidv7 } from 'uuidv7';

/**
 * Generate a UUIDv7 (ADR 0008). Time-ordered, globally unique, safe to expose.
 * Generated in the application so it does not depend on a specific PostgreSQL
 * version's native `uuidv7()` function.
 */
export function newUuidV7(): string {
  return uuidv7();
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** True for any well-formed UUID string. */
export function isUuid(value: string): boolean {
  return UUID_RE.test(value);
}

/** True only for a version-7 UUID (the 13th hex digit is `7`). */
export function isUuidV7(value: string): boolean {
  return isUuid(value) && value[14] === '7';
}
