import { Injectable } from '@nestjs/common';
import { HydrationError } from '../adapters/connector-adapter.js';

const GRAPH_API_HOST = 'https://graph.facebook.com';
const GRAPH_API_VERSION = 'v21.0';
const DEFAULT_TIMEOUT_MS = 8_000;

export interface MetaLeadFieldDatum {
  readonly name: string;
  readonly values: readonly string[];
}

export interface MetaLeadRecord {
  readonly id: string;
  readonly createdTime: string | null;
  readonly adId: string | null;
  readonly formId: string | null;
  readonly fieldData: readonly MetaLeadFieldDatum[];
}

/** Minimal shape of the `fetch` function this client needs — lets tests inject a fake without a
 *  real network stack. Node's global `fetch` already satisfies it; no HTTP client dependency added. */
export type FetchLike = (
  url: string,
  init: { signal: AbortSignal },
) => Promise<{ status: number; json(): Promise<unknown> }>;

/**
 * Isolates every Meta Graph API detail behind one small client (UC-3, ADR 0049). Host and path are
 * FIXED — `retrieveLead` takes only a `leadgenId`, never an arbitrary URL, so there is no SSRF
 * surface here: nothing caller-controlled ever becomes part of the request's scheme or host.
 *
 * Knows nothing about CRM, tenants, or the ingestion pipeline — it returns a plain
 * `MetaLeadRecord` or throws a classified `HydrationError`; the adapter (not this client) turns
 * that into a `CanonicalDraft`.
 */
@Injectable()
export class MetaGraphClient {
  constructor(
    private readonly fetchImpl: FetchLike = fetch as unknown as FetchLike,
    private readonly timeoutMs: number = DEFAULT_TIMEOUT_MS,
  ) {}

  async retrieveLead(leadgenId: string, accessToken: string): Promise<MetaLeadRecord> {
    const url =
      `${GRAPH_API_HOST}/${GRAPH_API_VERSION}/${encodeURIComponent(leadgenId)}` +
      `?access_token=${encodeURIComponent(accessToken)}` +
      `&fields=${encodeURIComponent('id,created_time,ad_id,form_id,field_data')}`;

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);
    let res: { status: number; json(): Promise<unknown> };
    try {
      res = await this.fetchImpl(url, { signal: controller.signal });
    } catch (err) {
      // never log `url` (it carries the access token) or the raw error
      if ((err as { name?: string })?.name === 'AbortError') {
        throw new HydrationError('PROVIDER_TIMEOUT', 'Meta Graph API request timed out.');
      }
      throw new HydrationError('PROVIDER_UNAVAILABLE', 'Could not reach the Meta Graph API.');
    } finally {
      clearTimeout(timer);
    }

    if (res.status === 401) {
      throw new HydrationError('PROVIDER_AUTH_FAILED', 'Meta rejected the access token.');
    }
    if (res.status === 403) {
      throw new HydrationError(
        'PROVIDER_PERMISSION_DENIED',
        'The access token does not have permission to read this lead.',
      );
    }
    if (res.status === 404) {
      throw new HydrationError(
        'PROVIDER_RECORD_NOT_FOUND',
        'The lead no longer exists or has expired on Meta.',
      );
    }
    if (res.status === 429) {
      throw new HydrationError('PROVIDER_RATE_LIMITED', 'Meta rate-limited this request.');
    }
    if (res.status >= 500) {
      throw new HydrationError(
        'PROVIDER_UNAVAILABLE',
        `Meta returned a server error (${res.status}).`,
      );
    }
    if (res.status !== 200) {
      throw new HydrationError(
        'PROVIDER_RESPONSE_INVALID',
        `Meta returned an unexpected status (${res.status}).`,
      );
    }

    let body: unknown;
    try {
      body = await res.json();
    } catch {
      throw new HydrationError(
        'PROVIDER_RESPONSE_INVALID',
        'Meta returned a response that was not valid JSON.',
      );
    }
    return parseLeadRecord(body);
  }
}

function parseLeadRecord(body: unknown): MetaLeadRecord {
  if (typeof body !== 'object' || body === null || Array.isArray(body)) {
    throw new HydrationError(
      'PROVIDER_RESPONSE_INVALID',
      'Meta returned a lead response with an unexpected shape.',
    );
  }
  const b = body as Record<string, unknown>;
  if (typeof b.id !== 'string') {
    throw new HydrationError(
      'PROVIDER_RESPONSE_INVALID',
      'Meta returned a lead response without an id.',
    );
  }
  const fieldData = Array.isArray(b.field_data)
    ? b.field_data
        .filter(
          (f): f is { name: string; values: string[] } =>
            typeof f === 'object' &&
            f !== null &&
            typeof (f as Record<string, unknown>).name === 'string',
        )
        .map((f) => ({
          name: f.name,
          values: Array.isArray(f.values) ? f.values.map((v) => String(v)) : [],
        }))
    : [];
  return {
    id: b.id,
    createdTime: typeof b.created_time === 'string' ? b.created_time : null,
    adId: typeof b.ad_id === 'string' ? b.ad_id : null,
    formId: typeof b.form_id === 'string' ? b.form_id : null,
    fieldData,
  };
}
