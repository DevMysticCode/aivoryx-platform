import { createHmac, timingSafeEqual } from 'node:crypto';
import { Injectable } from '@nestjs/common';
import {
  HydrationError,
  type CanonicalDraft,
  type ConnectorAdapter,
  type HydrationContext,
  type InboundEnvelope,
  type ProviderMeta,
  type ProviderReference,
  type ResolvedCredential,
  type VerificationResult,
} from './connector-adapter.js';
import { MetaGraphClient } from '../graph/meta-graph-client.js';

const LEADGEN_REFERENCE_TYPE = 'leadgen_id';
const SIGNATURE_HEADER = 'x-hub-signature-256';
const SIGNATURE_PREFIX = 'sha256=';

/**
 * The `meta_lead_ads` adapter (UC-3, ADR 0049). Meta's webhook carries only identifiers
 * (`leadgen_id`); the real field data must be retrieved afterward from the Graph API — see
 * `hydrate()`. Pure where Pabbly's adapter is pure (`verify`, `parse`): no DB, no clock, no
 * mutation. `hydrate()` is the one method that performs network I/O, and it is called by
 * `IngestionService` strictly OUTSIDE any open database transaction (see `ingestion.service.ts`).
 */
@Injectable()
export class MetaLeadAdsAdapter implements ConnectorAdapter {
  readonly provider = 'meta_lead_ads';
  readonly version = 1;
  readonly meta: ProviderMeta = {
    provider: 'meta_lead_ads',
    displayName: 'Meta Lead Ads',
    description: 'Facebook and Instagram Lead Ads, via the Meta Graph API webhook + leadgen_id.',
    capabilities: ['inbound_webhook', 'field_mapping'],
  };

  constructor(private readonly graphClient: MetaGraphClient = new MetaGraphClient()) {}

  /**
   * HMAC-SHA256 over the exact raw bytes, using the connector's stored app secret — Meta's
   * `X-Hub-Signature-256` contract. Rejects a missing header, a malformed one (no `sha256=` prefix,
   * not hex, wrong length), and a mismatched one, all via one constant-time comparison path so a
   * missing header and a wrong one aren't distinguishable by timing. No app secret configured ->
   * verification fails closed (never "verified" by default).
   */
  verify(envelope: InboundEnvelope, credential: ResolvedCredential): VerificationResult {
    const appSecret = credential.data.appSecret;
    if (!appSecret) return { verified: false, reason: 'CREDENTIAL_NOT_CONFIGURED' };

    const header = envelope.headers[SIGNATURE_HEADER];
    if (!header || !header.startsWith(SIGNATURE_PREFIX)) {
      return { verified: false, reason: 'SIGNATURE_MISSING' };
    }
    const providedHex = header.slice(SIGNATURE_PREFIX.length);
    if (!/^[0-9a-f]{64}$/i.test(providedHex)) {
      return { verified: false, reason: 'SIGNATURE_MALFORMED' };
    }
    if (!envelope.rawBytes) {
      // no raw bytes to check against -> cannot possibly verify; fail closed, never "verified"
      return { verified: false, reason: 'SIGNATURE_MALFORMED' };
    }

    const expected = createHmac('sha256', appSecret).update(envelope.rawBytes).digest();
    const provided = Buffer.from(providedHex, 'hex');
    const matches = expected.length === provided.length && timingSafeEqual(expected, provided);
    return matches ? { verified: true } : { verified: false, reason: 'SIGNATURE_INVALID' };
  }

  /** Extracts `leadgen_id` from Meta's webhook shape (`entry[].changes[].value`). Never throws on a
   *  malformed or unrelated body — returns a draft with no reference, which fails identity
   *  validation downstream exactly like a Pabbly payload with no phone/email does today. */
  parse(envelope: InboundEnvelope): CanonicalDraft {
    const value = firstLeadgenChange(envelope.rawBody);
    if (!value) {
      return { providerFields: {}, providerRecordId: null, providerTimestamp: null };
    }
    const reference: ProviderReference = {
      type: LEADGEN_REFERENCE_TYPE,
      id: value.leadgen_id,
      metadata: {
        pageId: value.page_id ?? null,
        formId: value.form_id ?? null,
        adId: value.ad_id ?? null,
      },
    };
    return {
      providerFields: {},
      providerRecordId: value.leadgen_id,
      providerTimestamp: value.created_time != null ? String(value.created_time) : null,
      providerReference: reference,
    };
  }

  /** Calls the Meta Graph API for the referenced `leadgen_id` and turns its `field_data` into a
   *  flat provider-field map — the SAME shape Pabbly's `parse()` already produces, so the existing
   *  `mapProviderFields` engine needs no change. Throws `HydrationError` (never a raw fetch error or
   *  the access token) on any failure. */
  async hydrate(reference: ProviderReference, context: HydrationContext): Promise<CanonicalDraft> {
    const accessToken = context.credential.data.pageAccessToken;
    if (!accessToken) {
      throw new HydrationError(
        'PROVIDER_AUTH_FAILED',
        'No Meta page access token is configured for this source.',
      );
    }
    const record = await this.graphClient.retrieveLead(reference.id, accessToken);
    const providerFields: Record<string, string> = {};
    for (const field of record.fieldData) {
      if (field.values.length > 0) providerFields[field.name] = field.values[0]!;
    }
    return {
      providerFields,
      providerRecordId: record.id,
      providerTimestamp: record.createdTime,
    };
  }
}

interface MetaLeadgenValue {
  leadgen_id: string;
  page_id?: string;
  form_id?: string;
  adgroup_id?: string;
  ad_id?: string;
  created_time?: string | number;
}

/** Walks Meta's `{ object, entry: [{ changes: [{ field, value }] }] }` shape and returns the first
 *  `field === 'leadgen'` change's `value`, if the body matches that shape at all. */
function firstLeadgenChange(rawBody: unknown): MetaLeadgenValue | null {
  if (typeof rawBody !== 'object' || rawBody === null) return null;
  const entries = (rawBody as Record<string, unknown>).entry;
  if (!Array.isArray(entries)) return null;
  for (const entry of entries) {
    if (typeof entry !== 'object' || entry === null) continue;
    const changes = (entry as Record<string, unknown>).changes;
    if (!Array.isArray(changes)) continue;
    for (const change of changes) {
      if (typeof change !== 'object' || change === null) continue;
      const c = change as Record<string, unknown>;
      if (c.field !== 'leadgen') continue;
      const value = c.value;
      if (
        typeof value === 'object' &&
        value !== null &&
        typeof (value as Record<string, unknown>).leadgen_id === 'string'
      ) {
        return value as MetaLeadgenValue;
      }
    }
  }
  return null;
}
