/**
 * The `pabbly_bridge` adapter (docs/architecture/PABBLY-BRIDGE.md,
 * CONNECTORS-AND-ADAPTERS.md). Pure function: no DB, no network, no clock.
 *
 * No real production Pabbly payload sample exists in this repository yet
 * (`docs/integrations/samples/` is empty). This adapter is therefore the
 * documented `generic_json` fallback — it flattens one level of the inbound
 * JSON object into a flat provider-field map, exactly like any other
 * `generic_json` source, and extracts a record id / timestamp from the small
 * set of key names Pabbly-relayed providers (IndiaMART, Justdial, …)
 * typically use. It is deliberately NOT a hard-coded parser for one payload
 * shape — see ADR 0032 for the exact scope of this simplification and how a
 * tenant can override field names via `lead_sources.field_mapping`.
 */

export type ProviderFieldValue = string | number | boolean | null;

export interface ProviderDraft {
  providerFields: Record<string, ProviderFieldValue>;
  providerRecordId: string | null;
  providerTimestamp: string | null;
}

const RECORD_ID_KEYS = ['provider_record_id', 'record_id', 'lead_id', 'leadId', 'id', 'uid'];
const TIMESTAMP_KEYS = ['provider_timestamp', 'timestamp', 'created_at', 'createdAt', 'date'];

export function parsePabblyPayload(rawBody: unknown): ProviderDraft {
  const providerFields = flattenOneLevel(rawBody);
  return {
    providerFields,
    providerRecordId: pickFirstString(providerFields, RECORD_ID_KEYS),
    providerTimestamp: pickFirstString(providerFields, TIMESTAMP_KEYS),
  };
}

function flattenOneLevel(value: unknown): Record<string, ProviderFieldValue> {
  if (!isPlainObject(value)) return {};
  const out: Record<string, ProviderFieldValue> = {};
  for (const [key, val] of Object.entries(value)) {
    if (isPlainObject(val)) {
      for (const [nestedKey, nestedVal] of Object.entries(val)) {
        out[`${key}.${nestedKey}`] = toScalar(nestedVal);
      }
    } else {
      out[key] = toScalar(val);
    }
  }
  return out;
}

function toScalar(value: unknown): ProviderFieldValue {
  if (
    value === null ||
    typeof value === 'string' ||
    typeof value === 'number' ||
    typeof value === 'boolean'
  ) {
    return value;
  }
  return JSON.stringify(value);
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function pickFirstString(
  fields: Record<string, ProviderFieldValue>,
  keys: string[],
): string | null {
  for (const key of keys) {
    const val = fields[key];
    if (val !== undefined && val !== null && String(val).trim().length > 0) return String(val);
  }
  return null;
}
