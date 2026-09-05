/**
 * Minimal fixed-point decimal helpers for quantities and money (Phase 5,
 * ADR 0034). Values are decimal strings throughout — never JS floats — so
 * PostgreSQL NUMERIC round-trips are exact. Internally each value is a BigInt
 * scaled by 10^SCALE; SCALE = 6 comfortably covers quantity scale 4, money
 * scale 2, and the intermediate products of line-total math.
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

export const dec = {
  add: (a: string, b: string): bigint => parseDec(a) + parseDec(b),
  sub: (a: string, b: string): bigint => parseDec(a) - parseDec(b),
  /** a * b, result re-scaled back to SCALE */
  mul: (a: string, b: string): bigint => (parseDec(a) * parseDec(b)) / SCALE_FACTOR,
  cmp: (a: string, b: string): -1 | 0 | 1 => {
    const d = parseDec(a) - parseDec(b);
    return d < 0n ? -1 : d > 0n ? 1 : 0;
  },
  gt: (a: string, b: string): boolean => parseDec(a) > parseDec(b),
  gte: (a: string, b: string): boolean => parseDec(a) >= parseDec(b),
  lt: (a: string, b: string): boolean => parseDec(a) < parseDec(b),
  lte: (a: string, b: string): boolean => parseDec(a) <= parseDec(b),
  eq: (a: string, b: string): boolean => parseDec(a) === parseDec(b),
  isPos: (a: string): boolean => parseDec(a) > 0n,
  isNeg: (a: string): boolean => parseDec(a) < 0n,
  isZero: (a: string): boolean => parseDec(a) === 0n,
};

/** Compute a purchase-order line total: (ordered_qty * unit_price) - discount, then + tax. */
export function lineTotal(input: {
  quantity: string;
  unitPrice: string;
  discount: string;
  taxRate: string;
}): { net: string; tax: string; total: string } {
  const gross = dec.mul(input.quantity, input.unitPrice);
  const net = gross - parseDec(input.discount);
  const tax = (net * parseDec(input.taxRate)) / SCALE_FACTOR;
  return {
    net: formatDec(net, 2),
    tax: formatDec(tax, 2),
    total: formatDec(net + tax, 2),
  };
}

/** Sum a column of money strings, returned at 2dp. */
export function sumMoney(values: string[]): string {
  return formatDec(
    values.reduce((acc, v) => acc + parseDec(v), 0n),
    2,
  );
}
