import { dec, formatDec, parseDec } from '../supply/decimal.js';

/**
 * Quotation money math (Phase 6, ADR 0035). Reuses the Phase 5 fixed-point
 * decimal helpers (`../supply/decimal.js`) — values are decimal strings, never
 * JS floats, so PostgreSQL NUMERIC round-trips are exact.
 *
 * Every component is rounded to 2 decimal places at the point it is computed,
 * so the numbers a user sees always add up:
 *
 *   gross  = round(quantity × unit_price)
 *   net    = max(0, gross − discount)
 *   tax    = round(net × tax_rate)
 *   total  = net + tax                    (exact — two 2dp values)
 *
 * Quotation totals are the plain sums of the per-line components, which keeps
 * the identity  total = subtotal − discount_total + tax_total  exact.
 */

export interface QuoteLineInput {
  quantity: string;
  unitPrice: string;
  discount: string;
  taxRate: string;
}

export interface QuoteLineAmounts {
  lineNet: string;
  lineTax: string;
  lineTotal: string;
}

export interface QuoteTotals {
  subtotal: string;
  discountTotal: string;
  taxTotal: string;
  total: string;
}

const SCALE_FACTOR = 1_000_000n; // 10^6, matches decimal.ts SCALE

/** Round a scaled (10^6) bigint to a 2dp decimal string, then back to a scaled
 *  bigint — so downstream arithmetic stays on already-rounded values. */
function round2(scaled: bigint): { str: string; scaled: bigint } {
  const str = formatDec(scaled, 2);
  return { str, scaled: parseDec(str) };
}

function componentsFor(line: QuoteLineInput): {
  grossStr: string;
  grossScaled: bigint;
  discountStr: string;
  discountScaled: bigint;
  netStr: string;
  netScaled: bigint;
  taxStr: string;
  taxScaled: bigint;
  totalStr: string;
} {
  const gross = round2(dec.mul(line.quantity, line.unitPrice));
  const discount = round2(parseDec(line.discount));
  let netScaled = gross.scaled - discount.scaled;
  if (netScaled < 0n) netScaled = 0n;
  const net = round2(netScaled);
  const tax = round2((net.scaled * parseDec(line.taxRate)) / SCALE_FACTOR);
  return {
    grossStr: gross.str,
    grossScaled: gross.scaled,
    discountStr: discount.str,
    discountScaled: discount.scaled,
    netStr: net.str,
    netScaled: net.scaled,
    taxStr: tax.str,
    taxScaled: tax.scaled,
    totalStr: formatDec(net.scaled + tax.scaled, 2),
  };
}

/** Amounts for a single line, all at 2 decimal places. */
export function lineAmounts(line: QuoteLineInput): QuoteLineAmounts {
  const c = componentsFor(line);
  return { lineNet: c.netStr, lineTax: c.taxStr, lineTotal: c.totalStr };
}

/** Roll a set of lines up into quotation-level totals, all at 2 decimal places. */
export function quoteTotals(lines: QuoteLineInput[]): QuoteTotals {
  let subtotal = 0n;
  let discountTotal = 0n;
  let taxTotal = 0n;
  let total = 0n;
  for (const line of lines) {
    const c = componentsFor(line);
    subtotal += c.grossScaled;
    discountTotal += c.discountScaled;
    taxTotal += c.taxScaled;
    total += c.netScaled + c.taxScaled;
  }
  return {
    subtotal: formatDec(subtotal, 2),
    discountTotal: formatDec(discountTotal, 2),
    taxTotal: formatDec(taxTotal, 2),
    total: formatDec(total, 2),
  };
}
