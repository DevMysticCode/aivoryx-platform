/**
 * Fixed-point decimal helpers for HR money math (Phase 12, ADR 0041).
 *
 * These use the SAME convention as the Phase 9 helpers in
 * `apps/api/src/supply/decimal.ts` (decimal strings in, BigInt scaled by
 * 10^6 internally, exact PostgreSQL NUMERIC round-trips, never a JS float).
 * They are copied here — not imported from `supply/` — so the HR domain carries
 * no dependency on another business module and stays independently extractable
 * (ADR 0041 §1). Only the two functions HR needs are reproduced.
 */
const SCALE = 6;
const SCALE_FACTOR = 10n ** BigInt(SCALE);

/** Parse a decimal string (or plain integer string) to a scaled BigInt. */
export function parseDec(value: string): bigint {
  const trimmed = value.trim();
  if (!/^-?\d+(\.\d+)?$/.test(trimmed)) {
    throw new Error(`Not a decimal: ${JSON.stringify(value)}`);
  }
  const neg = trimmed.startsWith('-');
  const parts = (neg ? trimmed.slice(1) : trimmed).split('.');
  const intPart = parts[0] || '0';
  const fracPartRaw = parts[1] ?? '';
  const fracPart = (fracPartRaw + '0'.repeat(SCALE)).slice(0, SCALE);
  const scaled = BigInt(intPart) * SCALE_FACTOR + BigInt(fracPart || '0');
  return neg ? -scaled : scaled;
}

/** Format a scaled BigInt back to a decimal string with `dp` fraction digits (rounded half-up). */
export function formatDec(scaled: bigint, dp: number): string {
  const neg = scaled < 0n;
  let abs = neg ? -scaled : scaled;
  if (dp < SCALE) {
    const drop = 10n ** BigInt(SCALE - dp);
    const remainder = abs % drop;
    abs = abs / drop;
    if (remainder * 2n >= drop) abs += 1n;
  } else if (dp > SCALE) {
    abs = abs * 10n ** BigInt(dp - SCALE);
  }
  const factor = 10n ** BigInt(dp);
  const intPart = abs / factor;
  const fracPart = (abs % factor).toString().padStart(dp, '0');
  const body = dp > 0 ? `${intPart}.${fracPart}` : `${intPart}`;
  return neg && abs !== 0n ? `-${body}` : body;
}
