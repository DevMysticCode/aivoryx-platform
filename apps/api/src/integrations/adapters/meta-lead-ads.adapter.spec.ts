import { createHmac } from 'node:crypto';
import { describe, expect, it, vi } from 'vitest';
import { HydrationError } from './connector-adapter.js';
import { MetaLeadAdsAdapter } from './meta-lead-ads.adapter.js';
import type { MetaGraphClient } from '../graph/meta-graph-client.js';

const APP_SECRET = 'test-app-secret';
const sign = (bodyBuf: Buffer, secret = APP_SECRET) =>
  `sha256=${createHmac('sha256', secret).update(bodyBuf).digest('hex')}`;

const leadgenBody = (overrides: Partial<Record<string, unknown>> = {}) => ({
  object: 'page',
  entry: [
    {
      id: '111',
      time: 1700000000,
      changes: [
        {
          field: 'leadgen',
          value: {
            leadgen_id: 'LEAD-1',
            page_id: '111',
            form_id: '222',
            ad_id: '333',
            created_time: 1700000000,
            ...overrides,
          },
        },
      ],
    },
  ],
});

function envelope(bodyObj: unknown, headerSignature?: string) {
  const bytes = Buffer.from(JSON.stringify(bodyObj), 'utf8');
  const headers: Record<string, string> = {};
  if (headerSignature) headers['x-hub-signature-256'] = headerSignature;
  return { rawBody: bodyObj, rawBytes: bytes, headers };
}

describe('MetaLeadAdsAdapter identity', () => {
  it('declares provider "meta_lead_ads", version 1', () => {
    const adapter = new MetaLeadAdsAdapter();
    expect(adapter.provider).toBe('meta_lead_ads');
    expect(adapter.version).toBe(1);
    expect(adapter.meta.provider).toBe('meta_lead_ads');
  });
});

describe('MetaLeadAdsAdapter.verify — X-Hub-Signature-256', () => {
  const adapter = new MetaLeadAdsAdapter();
  const credential = { data: { appSecret: APP_SECRET } };

  it('accepts a valid signature over the exact raw bytes', () => {
    const body = leadgenBody();
    const bytes = Buffer.from(JSON.stringify(body), 'utf8');
    const result = adapter.verify(envelope(body, sign(bytes)), credential);
    expect(result).toEqual({ verified: true });
  });

  it('rejects a missing signature header', () => {
    const result = adapter.verify(envelope(leadgenBody()), credential);
    expect(result.verified).toBe(false);
    expect(result.reason).toBe('SIGNATURE_MISSING');
  });

  it('rejects a malformed signature header (no sha256= prefix, wrong length, non-hex)', () => {
    for (const bad of ['not-a-signature', 'sha256=zz', 'sha1=' + 'a'.repeat(64)]) {
      const result = adapter.verify(envelope(leadgenBody(), bad), credential);
      expect(result.verified).toBe(false);
      expect(result.reason).toMatch(/SIGNATURE_(MISSING|MALFORMED)/);
    }
  });

  it('rejects an invalid (wrong-secret) signature', () => {
    const body = leadgenBody();
    const bytes = Buffer.from(JSON.stringify(body), 'utf8');
    const wrongSig = sign(bytes, 'a-different-secret');
    const result = adapter.verify(envelope(body, wrongSig), credential);
    expect(result).toEqual({ verified: false, reason: 'SIGNATURE_INVALID' });
  });

  it('rejects when the body was modified after signing (signature no longer matches)', () => {
    const original = leadgenBody();
    const originalBytes = Buffer.from(JSON.stringify(original), 'utf8');
    const validSignatureForOriginal = sign(originalBytes);
    const tampered = leadgenBody({ leadgen_id: 'ATTACKER-SUBSTITUTED' });
    const result = adapter.verify(envelope(tampered, validSignatureForOriginal), credential);
    expect(result).toEqual({ verified: false, reason: 'SIGNATURE_INVALID' });
  });

  it('rejects when the SAME JSON is represented with different whitespace (signature is byte-exact)', () => {
    const body = leadgenBody();
    const compactBytes = Buffer.from(JSON.stringify(body), 'utf8');
    const signatureForCompact = sign(compactBytes);
    const prettyBytes = Buffer.from(JSON.stringify(body, null, 2), 'utf8');
    const result = adapter.verify(
      {
        rawBody: body,
        rawBytes: prettyBytes,
        headers: { 'x-hub-signature-256': signatureForCompact },
      },
      credential,
    );
    expect(result).toEqual({ verified: false, reason: 'SIGNATURE_INVALID' });
  });

  it('fails closed with no app secret configured, even with a well-formed signature', () => {
    const body = leadgenBody();
    const bytes = Buffer.from(JSON.stringify(body), 'utf8');
    const result = adapter.verify(envelope(body, sign(bytes)), { data: {} });
    expect(result).toEqual({ verified: false, reason: 'CREDENTIAL_NOT_CONFIGURED' });
  });

  it('fails closed when rawBytes is unavailable, never silently "verified"', () => {
    const body = leadgenBody();
    const bytes = Buffer.from(JSON.stringify(body), 'utf8');
    const result = adapter.verify(
      { rawBody: body, headers: { 'x-hub-signature-256': sign(bytes) } },
      credential,
    );
    expect(result.verified).toBe(false);
  });
});

describe('MetaLeadAdsAdapter.parse', () => {
  const adapter = new MetaLeadAdsAdapter();

  it('extracts leadgen_id as a ProviderReference from a valid event', () => {
    const draft = adapter.parse(envelope(leadgenBody()));
    expect(draft.providerReference).toEqual({
      type: 'leadgen_id',
      id: 'LEAD-1',
      metadata: { pageId: '111', formId: '222', adId: '333' },
    });
    expect(draft.providerRecordId).toBe('LEAD-1');
    expect(draft.providerTimestamp).toBe('1700000000');
    expect(draft.providerFields).toEqual({}); // no field data yet — that's hydrate()'s job
  });

  it('a malformed/unrelated body never throws — returns no reference', () => {
    for (const body of [
      {},
      { object: 'page' },
      { entry: 'not-an-array' },
      null,
      'a string',
      [1, 2],
    ]) {
      const draft = adapter.parse(envelope(body));
      expect(draft.providerReference).toBeUndefined();
      expect(draft.providerRecordId).toBeNull();
    }
  });

  it('an unsupported change field (not "leadgen") produces no reference', () => {
    const body = {
      object: 'page',
      entry: [{ id: '1', changes: [{ field: 'feed', value: { item: 'post' } }] }],
    };
    const draft = adapter.parse(envelope(body));
    expect(draft.providerReference).toBeUndefined();
  });

  it('a leadgen change missing leadgen_id produces no reference', () => {
    const body = {
      object: 'page',
      entry: [{ id: '1', changes: [{ field: 'leadgen', value: { page_id: '111' } }] }],
    };
    const draft = adapter.parse(envelope(body));
    expect(draft.providerReference).toBeUndefined();
  });
});

describe('MetaLeadAdsAdapter.hydrate', () => {
  const credential = { data: { pageAccessToken: 'page-token' }, correlationId: 'AIV-1' };
  const reference = { type: 'leadgen_id', id: 'LEAD-1' };

  it('turns a successful Graph API response into a flat provider-field map', async () => {
    const retrieveLead = vi.fn().mockResolvedValue({
      id: 'LEAD-1',
      createdTime: '2024-01-01T00:00:00Z',
      adId: '333',
      formId: '222',
      fieldData: [
        { name: 'full_name', values: ['Jane Doe'] },
        { name: 'email', values: ['jane@example.test'] },
        { name: 'empty_field', values: [] },
      ],
    });
    const adapter = new MetaLeadAdsAdapter({ retrieveLead } as unknown as MetaGraphClient);
    const draft = await adapter.hydrate(reference, { credential, correlationId: 'AIV-1' });
    expect(draft).toEqual({
      providerFields: { full_name: 'Jane Doe', email: 'jane@example.test' },
      providerRecordId: 'LEAD-1',
      providerTimestamp: '2024-01-01T00:00:00Z',
    });
    expect(retrieveLead).toHaveBeenCalledWith('LEAD-1', 'page-token');
  });

  it('rejects with a typed, non-retryable error when no access token is configured', async () => {
    const adapter = new MetaLeadAdsAdapter({ retrieveLead: vi.fn() } as unknown as MetaGraphClient);
    await expect(
      adapter.hydrate(reference, { credential: { data: {} }, correlationId: 'AIV-1' }),
    ).rejects.toMatchObject({ code: 'PROVIDER_AUTH_FAILED', retryable: false });
  });

  it('propagates a HydrationError from the Graph client unchanged', async () => {
    const err = new HydrationError('PROVIDER_RATE_LIMITED', 'rate limited');
    const adapter = new MetaLeadAdsAdapter({
      retrieveLead: vi.fn().mockRejectedValue(err),
    } as unknown as MetaGraphClient);
    await expect(adapter.hydrate(reference, { credential, correlationId: 'AIV-1' })).rejects.toBe(
      err,
    );
  });
});
