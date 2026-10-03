import type {
  CanonicalDraft,
  ConnectorAdapter,
  InboundEnvelope,
  ProviderFieldValue,
  ProviderMeta,
  ResolvedCredential,
  VerificationResult,
} from './connector-adapter.js';

/**
 * The `pabbly_bridge` adapter (UC-2; was `pabbly-adapter.ts` before the adapter boundary existed).
 * Pure: no DB, no network, no clock.
 *
 * No real production Pabbly payload sample exists in this repository yet
 * (`docs/integrations/samples/` is empty). This adapter is therefore the documented `generic_json`
 * fallback — it flattens one level of the inbound JSON object into a flat provider-field map,
 * exactly like any other `generic_json` source, and extracts a record id / timestamp from the small
 * set of key names Pabbly-relayed providers (IndiaMART, Justdial, …) typically use. It is
 * deliberately NOT a hard-coded parser for one payload shape — see ADR 0032 for the exact scope of
 * this simplification and how a tenant can override field names via `lead_sources.field_mapping`.
 *
 * This phase's parse() behavior is UNCHANGED from the pre-UC-2 implementation — moved, not rewritten
 * (UC-0's contract suite proves this at the HTTP/SQL level). `verify()` is a no-op: Pabbly has no
 * provider-specific signature or transport verification today; the connector's bearer secret is
 * checked entirely by the existing authentication layer before an adapter is ever resolved.
 * `validate()` is intentionally omitted — Pabbly has no provider-specific structural rule, and
 * generic lead validation (identity presence, custom-field coercion) stays in `IngestionService`.
 */
export class PabblyAdapter implements ConnectorAdapter {
  readonly provider = 'pabbly_bridge';
  readonly version = 1;
  readonly meta: ProviderMeta = {
    provider: 'pabbly_bridge',
    displayName: 'Pabbly',
    description:
      'Generic JSON relay (Pabbly Connect, or any tool that can POST JSON with a bearer secret).',
    capabilities: ['inbound_webhook', 'field_mapping'],
  };

  private static readonly RECORD_ID_KEYS = [
    'provider_record_id',
    'record_id',
    'lead_id',
    'leadId',
    'id',
    'uid',
  ];
  private static readonly TIMESTAMP_KEYS = [
    'provider_timestamp',
    'timestamp',
    'created_at',
    'createdAt',
    'date',
  ];

  verify(_envelope: InboundEnvelope, _credential: ResolvedCredential): VerificationResult {
    return { verified: true };
  }

  parse(envelope: InboundEnvelope): CanonicalDraft {
    const providerFields = flattenOneLevel(envelope.rawBody);
    return {
      providerFields,
      providerRecordId: pickFirstString(providerFields, PabblyAdapter.RECORD_ID_KEYS),
      providerTimestamp: pickFirstString(providerFields, PabblyAdapter.TIMESTAMP_KEYS),
    };
  }
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
