/**
 * Redaction & safe-serialisation for audit metadata / changes (Phase 11,
 * ADR 0040).
 *
 * Audit records must never carry secrets or unbounded blobs. Callers are
 * expected to pass small, intentional payloads (ids, statuses, codes, amounts),
 * but this is the backstop: every value written to `metadata` / `changes` goes
 * through `sanitizeMetadata` first, which
 *   - drops any key whose name looks sensitive (password, token, secret, …),
 *   - truncates long strings,
 *   - bounds object depth and array length,
 *   - strips values that cannot be safely serialised (functions, bigint, …).
 */

/** Key names that must never appear in an audit payload, matched case-insensitively. */
const SENSITIVE_KEY = new RegExp(
  [
    'pass(word)?',
    'secret',
    'token',
    'hash',
    'credential',
    'authorization',
    'auth[_-]?header',
    'api[_-]?key',
    'cookie',
    'session',
    'bearer',
    'refresh[_-]?token',
    'access[_-]?token',
    'private[_-]?key',
    'signature',
    'smtp',
    'webhook',
    'raw[_-]?payload',
    'payload[_-]?body',
    'otp',
    'pin',
  ].join('|'),
  'i',
);

export const REDACTED = '[redacted]';
const MAX_STRING = 2_000;
const MAX_DEPTH = 6;
const MAX_ARRAY = 50;
const MAX_KEYS = 100;

export function isSensitiveKey(key: string): boolean {
  return SENSITIVE_KEY.test(key);
}

function sanitizeValue(value: unknown, depth: number): unknown {
  if (value === null || value === undefined) return null;

  const t = typeof value;
  if (t === 'string') {
    const s = value as string;
    return s.length > MAX_STRING ? `${s.slice(0, MAX_STRING)}… [truncated]` : s;
  }
  if (t === 'number') return Number.isFinite(value) ? value : null;
  if (t === 'boolean') return value;
  if (t === 'bigint') return `${(value as bigint).toString()}`;
  if (t === 'function' || t === 'symbol') return undefined;

  if (value instanceof Date) return value.toISOString();

  if (Array.isArray(value)) {
    if (depth >= MAX_DEPTH) return '[nested]';
    const out = value
      .slice(0, MAX_ARRAY)
      .map((v) => sanitizeValue(v, depth + 1))
      .filter((v) => v !== undefined);
    if (value.length > MAX_ARRAY) out.push(`… (+${value.length - MAX_ARRAY} more)`);
    return out;
  }

  if (t === 'object') {
    if (depth >= MAX_DEPTH) return '[nested]';
    const src = value as Record<string, unknown>;
    const out: Record<string, unknown> = {};
    let count = 0;
    for (const key of Object.keys(src)) {
      if (count >= MAX_KEYS) break;
      count += 1;
      if (isSensitiveKey(key)) {
        out[key] = REDACTED;
        continue;
      }
      const clean = sanitizeValue(src[key], depth + 1);
      if (clean !== undefined) out[key] = clean;
    }
    return out;
  }

  return undefined;
}

/** Sanitise a metadata object for storage. Always returns a plain object. */
export function sanitizeMetadata(
  input: Record<string, unknown> | undefined,
): Record<string, unknown> {
  if (!input) return {};
  const clean = sanitizeValue(input, 0);
  return clean && typeof clean === 'object' && !Array.isArray(clean)
    ? (clean as Record<string, unknown>)
    : {};
}

export interface FieldChange {
  from: unknown;
  to: unknown;
}

export type AuditChanges = Record<string, FieldChange>;

/**
 * Build a safe `{ field: { from, to } }` diff for an APPROVED list of fields
 * only. Fields not in `fields` are never inspected. Values are sanitised and a
 * field is emitted only when it actually changed.
 */
export function buildChanges<T extends Record<string, unknown>>(
  before: Partial<T> | null | undefined,
  after: Partial<T> | null | undefined,
  fields: readonly (keyof T & string)[],
): AuditChanges | null {
  const out: AuditChanges = {};
  for (const field of fields) {
    if (isSensitiveKey(field)) continue;
    const from = before ? before[field] : undefined;
    const to = after ? after[field] : undefined;
    if (serialise(from) === serialise(to)) continue;
    out[field] = {
      from: sanitizeValue(from ?? null, 1),
      to: sanitizeValue(to ?? null, 1),
    };
  }
  return Object.keys(out).length > 0 ? out : null;
}

/** Sanitise a caller-supplied `changes` object (already `{field:{from,to}}` shape). */
export function sanitizeChanges(input: AuditChanges | null | undefined): AuditChanges | null {
  if (!input) return null;
  const out: AuditChanges = {};
  for (const key of Object.keys(input)) {
    if (isSensitiveKey(key)) continue;
    const entry = input[key];
    if (!entry || typeof entry !== 'object') continue;
    out[key] = {
      from: sanitizeValue(entry.from ?? null, 1),
      to: sanitizeValue(entry.to ?? null, 1),
    };
  }
  return Object.keys(out).length > 0 ? out : null;
}

function serialise(v: unknown): string {
  try {
    return JSON.stringify(v ?? null);
  } catch {
    return String(v);
  }
}
