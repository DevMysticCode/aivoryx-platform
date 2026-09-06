import { AppError } from '@aivoryx/shared';

export {
  scope,
  pageBounds,
  isUniqueViolation,
  type Paged,
  type TenantScope,
} from '../supply/common.js';

/** Map a PostgreSQL check-constraint violation (23514) to a stable code. */
export function isCheckViolation(err: unknown): boolean {
  return typeof err === 'object' && err !== null && (err as { code?: string }).code === '23514';
}

const ISO_CURRENCY = /^[A-Z]{3}$/;

/** Normalise + validate a 3-letter ISO currency (server-side; never trusts the client blindly). */
export function normaliseCurrency(value: string | undefined, fallback = 'INR'): string {
  const c = (value ?? fallback).trim().toUpperCase();
  if (!ISO_CURRENCY.test(c)) {
    throw new AppError('FINANCE_CURRENCY_MISMATCH', {
      message: 'Currency must be a 3-letter ISO code (e.g. INR, USD, GBP, EUR).',
      details: { currency: value },
    });
  }
  return c;
}

/** Wrap a RangeError from the money guards into the stable finance error code. */
export function guardMoney<T>(fn: () => T): T {
  try {
    return fn();
  } catch (err) {
    if (err instanceof RangeError) {
      throw new AppError('FINANCE_INVALID_AMOUNT', { details: { reason: err.message } });
    }
    throw err;
  }
}
