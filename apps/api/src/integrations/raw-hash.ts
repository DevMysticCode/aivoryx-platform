import { createHash } from 'node:crypto';

/**
 * A stable hash of a JSON-parsed inbound body — used to detect an exact
 * redelivery of the same webhook call (ADR 0032). Keys are sorted recursively
 * so semantically-identical JSON with different key order still hashes equal.
 */
export function hashRawBody(body: unknown): string {
  return createHash('sha256').update(stableStringify(body)).digest('hex');
}

function stableStringify(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(',')}]`;
  const keys = Object.keys(value as Record<string, unknown>).sort();
  const entries = keys.map(
    (k) => `${JSON.stringify(k)}:${stableStringify((value as Record<string, unknown>)[k])}`,
  );
  return `{${entries.join(',')}}`;
}
