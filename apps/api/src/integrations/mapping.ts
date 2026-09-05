import type { ProviderFieldValue } from './pabbly-adapter.js';

/**
 * Minimum viable mapping engine (ADR 0032). `docs/architecture/FIELD-MAPPING.md`
 * describes a fully versioned, ordered-rule, per-tenant mapping-profile engine;
 * this phase implements a deliberately smaller equivalent — a flat
 * `providerKey -> "canonical:<field>" | "custom:<field_key>"` dictionary,
 * stored as `lead_sources.field_mapping` and merged over a small built-in
 * default — because no second real provider exists yet to justify the ordered
 * rule engine's versioning/transform machinery. The target vocabulary and the
 * "unknown target fails the mapping stage, unmapped fields are kept, never
 * dropped" rule are preserved exactly.
 */

export const CANONICAL_LEAD_FIELDS = [
  'name',
  'phone',
  'email',
  'addressLine',
  'city',
  'state',
  'postalCode',
  'country',
] as const;
export type CanonicalLeadField = (typeof CANONICAL_LEAD_FIELDS)[number];

/** Built-in defaults for the common key names a JSON-relayed form/lead payload uses. */
export const DEFAULT_FIELD_MAPPING: Record<string, string> = {
  name: 'canonical:name',
  full_name: 'canonical:name',
  fullName: 'canonical:name',
  first_name: 'canonical:name',
  phone: 'canonical:phone',
  phone_number: 'canonical:phone',
  phoneNumber: 'canonical:phone',
  mobile: 'canonical:phone',
  contact_number: 'canonical:phone',
  email: 'canonical:email',
  email_address: 'canonical:email',
  emailAddress: 'canonical:email',
  address: 'canonical:addressLine',
  address_line: 'canonical:addressLine',
  location: 'canonical:addressLine',
  city: 'canonical:city',
  state: 'canonical:state',
  postal_code: 'canonical:postalCode',
  postalCode: 'canonical:postalCode',
  zip: 'canonical:postalCode',
  zipcode: 'canonical:postalCode',
  pincode: 'canonical:postalCode',
  country: 'canonical:country',
};

export interface MappingResult {
  canonical: Partial<Record<CanonicalLeadField, string>>;
  custom: Record<string, ProviderFieldValue>;
  unmapped: Record<string, ProviderFieldValue>;
}

function isCanonicalField(value: string): value is CanonicalLeadField {
  return (CANONICAL_LEAD_FIELDS as readonly string[]).includes(value);
}

/**
 * `sourceOverrides` (from `lead_sources.field_mapping`) wins over the built-in
 * default for the same provider key. A target of `"skip"` explicitly discards
 * a field (kept out of `unmapped` too) — useful for noisy provider metadata.
 */
export function mapProviderFields(
  providerFields: Record<string, ProviderFieldValue>,
  sourceOverrides: Record<string, string> = {},
): MappingResult {
  const merged = { ...DEFAULT_FIELD_MAPPING, ...sourceOverrides };
  const result: MappingResult = { canonical: {}, custom: {}, unmapped: {} };

  for (const [key, rawValue] of Object.entries(providerFields)) {
    const target = merged[key];
    if (!target || target === 'skip') {
      if (target !== 'skip') result.unmapped[key] = rawValue;
      continue;
    }
    if (target.startsWith('canonical:')) {
      const field = target.slice('canonical:'.length);
      if (!isCanonicalField(field)) {
        result.unmapped[key] = rawValue;
        continue;
      }
      if (rawValue !== null && rawValue !== undefined && String(rawValue).length > 0) {
        result.canonical[field] = String(rawValue);
      }
    } else if (target.startsWith('custom:')) {
      const fieldKey = target.slice('custom:'.length);
      result.custom[fieldKey] = rawValue;
    } else {
      result.unmapped[key] = rawValue;
    }
  }

  return result;
}
