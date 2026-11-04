import { AppError, isIsoCurrency, DEFAULT_CURRENCY } from '@aivoryx/shared';
import type { Tx } from '@aivoryx/db';
import type { CompanyProfileService } from '../settings/company-profile.service.js';

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

/** Normalise + validate an ISO-4217 currency (server-side; never trusts the client blindly). */
export function normaliseCurrency(value: string | undefined, fallback = DEFAULT_CURRENCY): string {
  const c = (value ?? fallback).trim().toUpperCase();
  if (!isIsoCurrency(c)) {
    throw new AppError('FINANCE_CURRENCY_MISMATCH', {
      message: 'Currency must be a valid ISO-4217 code (e.g. INR, USD, GBP, EUR).',
      details: { currency: value },
    });
  }
  return c;
}

/** The tenant's configured default currency, falling back to INR for tenants
 *  that have never set one — the only place that literal should appear. */
export async function resolveDefaultCurrency(
  tx: Tx,
  tenantId: string,
  profiles: CompanyProfileService,
): Promise<string> {
  const profile = await profiles.loadProfile(tx, tenantId);
  return profile?.defaultCurrency ?? DEFAULT_CURRENCY;
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
