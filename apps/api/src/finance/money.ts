import { dec, formatDec, parseDec } from '../supply/decimal.js';

/**
 * Finance money math (Phase 9, ADR 0038). Reuses the Phase 5 fixed-point
 * decimal helpers (`../supply/decimal.js`) — values are decimal strings, never
 * JS floats, so PostgreSQL NUMERIC round-trips are exact and there is no
 * `0.1 + 0.2` style error for authoritative money.
 *
 * Every component is rounded to 2 decimal places at the point it is computed,
 * so the numbers a user sees always add up:
 *
 *   gross    = round(quantity × unit_price)
 *   discount = discount_type = PERCENT ? round(gross × discount_value/100)
 *                                      : round(discount_value)
 *   taxable  = max(0, gross − discount)
 *   tax      = round(taxable × tax_rate)
 *   total    = taxable + tax                 (exact — two 2dp values)
 *
 * Invoice totals are the plain sums of the per-line components, keeping the
 * identity  grand_total = subtotal − discount_total + tax_total  exact.
 */

const SCALE_FACTOR = 1_000_000n; // 10^6, matches decimal.ts SCALE
const HUNDRED = 100n * SCALE_FACTOR;

export type LineDiscountType = 'AMOUNT' | 'PERCENT';

export interface InvoiceLineInput {
  quantity: string;
  unitPrice: string;
  discountType: LineDiscountType;
  discountValue: string;
  taxRate: string;
}

export interface InvoiceLineAmounts {
  lineSubtotal: string;
  lineDiscount: string;
  lineTaxable: string;
  lineTax: string;
  lineTotal: string;
}

export interface InvoiceTotals {
  subtotal: string;
  discountTotal: string;
  taxTotal: string;
  grandTotal: string;
}

/** Round a scaled (10^6) bigint to a 2dp decimal string, then back to a scaled
 *  bigint — so downstream arithmetic stays on already-rounded values. */
function round2(scaled: bigint): { str: string; scaled: bigint } {
  const str = formatDec(scaled, 2);
  return { str, scaled: parseDec(str) };
}

function componentsFor(line: InvoiceLineInput): {
  grossScaled: bigint;
  discountScaled: bigint;
  taxableScaled: bigint;
  taxScaled: bigint;
  amounts: InvoiceLineAmounts;
} {
  const gross = round2(dec.mul(line.quantity, line.unitPrice));
  const discountRaw =
    line.discountType === 'PERCENT'
      ? (gross.scaled * parseDec(line.discountValue)) / HUNDRED
      : parseDec(line.discountValue);
  let discount = round2(discountRaw);
  // never discount more than the line is worth
  if (discount.scaled > gross.scaled) discount = round2(gross.scaled);
  let taxableScaled = gross.scaled - discount.scaled;
  if (taxableScaled < 0n) taxableScaled = 0n;
  const taxable = round2(taxableScaled);
  const tax = round2((taxable.scaled * parseDec(line.taxRate)) / SCALE_FACTOR);
  return {
    grossScaled: gross.scaled,
    discountScaled: discount.scaled,
    taxableScaled: taxable.scaled,
    taxScaled: tax.scaled,
    amounts: {
      lineSubtotal: gross.str,
      lineDiscount: discount.str,
      lineTaxable: taxable.str,
      lineTax: tax.str,
      lineTotal: formatDec(taxable.scaled + tax.scaled, 2),
    },
  };
}

/** Amounts for a single line, all at 2 decimal places. */
export function lineAmounts(line: InvoiceLineInput): InvoiceLineAmounts {
  return componentsFor(line).amounts;
}

/** Roll a set of lines up into invoice-level totals, all at 2 decimal places. */
export function invoiceTotals(lines: InvoiceLineInput[]): InvoiceTotals {
  let subtotal = 0n;
  let discountTotal = 0n;
  let taxTotal = 0n;
  let grandTotal = 0n;
  for (const line of lines) {
    const c = componentsFor(line);
    subtotal += c.grossScaled;
    discountTotal += c.discountScaled;
    taxTotal += c.taxScaled;
    grandTotal += c.taxableScaled + c.taxScaled;
  }
  return {
    subtotal: formatDec(subtotal, 2),
    discountTotal: formatDec(discountTotal, 2),
    taxTotal: formatDec(taxTotal, 2),
    grandTotal: formatDec(grandTotal, 2),
  };
}

// --- balance math (all inputs/outputs are 2dp money strings) --------

/** outstanding = grand_total − amount_paid − amount_credited, floored at 0. */
export function invoiceOutstanding(
  grandTotal: string,
  amountPaid: string,
  amountCredited: string,
): string {
  const v = parseDec(grandTotal) - parseDec(amountPaid) - parseDec(amountCredited);
  return formatDec(v < 0n ? 0n : v, 2);
}

/** unallocated = payment amount − allocated, floored at 0. */
export function paymentUnallocated(amount: string, allocated: string): string {
  const v = parseDec(amount) - parseDec(allocated);
  return formatDec(v < 0n ? 0n : v, 2);
}

export function sumMoney(values: string[]): string {
  return formatDec(
    values.reduce((acc, v) => acc + parseDec(v), 0n),
    2,
  );
}

/** Strict, positive 2dp money guard. Rejects NaN / non-decimal / ≤ 0 / > cap. */
export function assertPositiveMoney(value: string, cap = '999999999999.99'): string {
  let scaled: bigint;
  try {
    scaled = parseDec(value);
  } catch {
    throw new RangeError(`not a valid amount: ${JSON.stringify(value)}`);
  }
  if (scaled <= 0n) throw new RangeError('amount must be greater than zero');
  if (scaled > parseDec(cap)) throw new RangeError('amount is too large');
  return formatDec(scaled, 2);
}

/** Non-negative 2dp money guard (allows zero). */
export function assertNonNegativeMoney(value: string, cap = '999999999999.99'): string {
  let scaled: bigint;
  try {
    scaled = parseDec(value);
  } catch {
    throw new RangeError(`not a valid amount: ${JSON.stringify(value)}`);
  }
  if (scaled < 0n) throw new RangeError('amount must not be negative');
  if (scaled > parseDec(cap)) throw new RangeError('amount is too large');
  return formatDec(scaled, 2);
}

export { dec, formatDec, parseDec };
