/** IANA timezone names and ISO-4217 currency codes this platform accepts, derived from the
 *  runtime's own ICU data rather than a vendored list — isomorphic across Node and browsers.
 *  `IANA_TIMEZONES` is for populating a picker's options (a curated, canonical list is fine
 *  there) — NOT for validation: `Intl.supportedValuesOf('timeZone')` only returns canonical
 *  zone names, excluding legitimate, still-valid aliases such as "Asia/Kolkata" (canonical:
 *  "Asia/Calcutta"), which `Intl.DateTimeFormat` itself happily accepts. Use `isIanaTimezone`
 *  for validation — it asks the runtime directly, so it accepts every name the runtime (and
 *  every date it later formats) actually understands, aliases included. */
export const IANA_TIMEZONES: readonly string[] = Intl.supportedValuesOf('timeZone');
export const ISO_CURRENCIES: readonly string[] = Intl.supportedValuesOf('currency');

export function isIanaTimezone(value: string): boolean {
  try {
    new Intl.DateTimeFormat(undefined, { timeZone: value });
    return true;
  } catch {
    return false;
  }
}

export function isIsoCurrency(value: string): boolean {
  return ISO_CURRENCIES.includes(value);
}

/** Fallback used when a tenant has not configured a timezone — nothing reads this today,
 *  so UTC is a safe, unambiguous default rather than inheriting server-local time. */
export const DEFAULT_TIMEZONE = 'UTC';
/** Fallback used when a tenant has not configured a default currency — matches the
 *  literal 'INR' every write path already hardcoded before this setting was wired up. */
export const DEFAULT_CURRENCY = 'INR';
