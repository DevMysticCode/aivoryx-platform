/**
 * Deterministic, conservative normalization for the two lead dedupe keys
 * (ADR 0031). Pure functions — no locale/country guessing, no fuzzy matching.
 */

/**
 * Strips everything except digits and a leading `+`; `00` prefix is treated as
 * an international-call prefix and rewritten to `+`. Returns `null` for
 * anything too short to be a usable phone number (avoids false-positive
 * dedupe matches on empty/garbage input). Deliberately does NOT assume a
 * default country code — two numbers are the same lead only if their cleaned
 * forms are byte-identical.
 */
export function normalizePhone(raw: string | null | undefined): string | null {
  if (!raw) return null;
  let s = raw.trim();
  if (s.startsWith('00')) s = `+${s.slice(2)}`;
  const hasCountryPrefix = s.startsWith('+');
  const digits = s.replace(/\D/g, '');
  if (digits.length < 7) return null;
  return hasCountryPrefix ? `+${digits}` : digits;
}

/** `trim().toLowerCase()`. Returns `null` for empty input. */
export function normalizeEmail(raw: string | null | undefined): string | null {
  if (!raw) return null;
  const trimmed = raw.trim().toLowerCase();
  return trimmed.length > 0 ? trimmed : null;
}
