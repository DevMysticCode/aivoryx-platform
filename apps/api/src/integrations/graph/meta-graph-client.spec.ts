import { describe, expect, it } from 'vitest';
import { HydrationError } from '../adapters/connector-adapter.js';
import { MetaGraphClient, type FetchLike } from './meta-graph-client.js';

function fakeFetch(impl: FetchLike): FetchLike {
  return impl;
}

describe('MetaGraphClient.retrieveLead', () => {
  it('returns a parsed lead record on success', async () => {
    const fetchImpl = fakeFetch(async () => ({
      status: 200,
      json: async () => ({
        id: 'LEAD-1',
        created_time: '2024-01-01T00:00:00Z',
        ad_id: '333',
        form_id: '222',
        field_data: [{ name: 'email', values: ['a@b.test'] }],
      }),
    }));
    const client = new MetaGraphClient(fetchImpl);
    const record = await client.retrieveLead('LEAD-1', 'token');
    expect(record).toEqual({
      id: 'LEAD-1',
      createdTime: '2024-01-01T00:00:00Z',
      adId: '333',
      formId: '222',
      fieldData: [{ name: 'email', values: ['a@b.test'] }],
    });
  });

  it.each([
    [401, 'PROVIDER_AUTH_FAILED', false],
    [403, 'PROVIDER_PERMISSION_DENIED', false],
    [404, 'PROVIDER_RECORD_NOT_FOUND', false],
    [429, 'PROVIDER_RATE_LIMITED', true],
    [500, 'PROVIDER_UNAVAILABLE', true],
    [503, 'PROVIDER_UNAVAILABLE', true],
    [418, 'PROVIDER_RESPONSE_INVALID', false],
  ])('classifies HTTP %s as %s (retryable=%s)', async (status, code, retryable) => {
    const fetchImpl = fakeFetch(async () => ({ status, json: async () => ({}) }));
    const client = new MetaGraphClient(fetchImpl);
    await expect(client.retrieveLead('LEAD-1', 'token')).rejects.toMatchObject({ code, retryable });
  });

  it('classifies a timeout (AbortError) as PROVIDER_TIMEOUT, retryable', async () => {
    const fetchImpl = fakeFetch(async (_url, init) => {
      return new Promise((_resolve, reject) => {
        init.signal.addEventListener('abort', () => {
          const err = new Error('aborted');
          err.name = 'AbortError';
          reject(err);
        });
      });
    });
    const client = new MetaGraphClient(fetchImpl, 10);
    await expect(client.retrieveLead('LEAD-1', 'token')).rejects.toMatchObject({
      code: 'PROVIDER_TIMEOUT',
      retryable: true,
    });
  });

  it('classifies a network failure as PROVIDER_UNAVAILABLE, retryable', async () => {
    const fetchImpl = fakeFetch(async () => {
      throw new Error('ECONNRESET');
    });
    const client = new MetaGraphClient(fetchImpl);
    await expect(client.retrieveLead('LEAD-1', 'token')).rejects.toMatchObject({
      code: 'PROVIDER_UNAVAILABLE',
      retryable: true,
    });
  });

  it('classifies a malformed (non-JSON-parseable) response as PROVIDER_RESPONSE_INVALID', async () => {
    const fetchImpl = fakeFetch(async () => ({
      status: 200,
      json: async () => {
        throw new SyntaxError('Unexpected token');
      },
    }));
    const client = new MetaGraphClient(fetchImpl);
    await expect(client.retrieveLead('LEAD-1', 'token')).rejects.toMatchObject({
      code: 'PROVIDER_RESPONSE_INVALID',
    });
  });

  it('classifies a 200 response with an unexpected shape as PROVIDER_RESPONSE_INVALID', async () => {
    const fetchImpl = fakeFetch(async () => ({ status: 200, json: async () => ({ no_id: true }) }));
    const client = new MetaGraphClient(fetchImpl);
    await expect(client.retrieveLead('LEAD-1', 'token')).rejects.toMatchObject({
      code: 'PROVIDER_RESPONSE_INVALID',
    });
  });

  it('never calls out to an arbitrary host — the URL is always graph.facebook.com, built from fixed parts', async () => {
    let calledUrl = '';
    const fetchImpl = fakeFetch(async (url) => {
      calledUrl = url;
      return { status: 200, json: async () => ({ id: 'LEAD-1', field_data: [] }) };
    });
    const client = new MetaGraphClient(fetchImpl);
    await client.retrieveLead('LEAD-1', 'secret-token');
    expect(calledUrl.startsWith('https://graph.facebook.com/')).toBe(true);
    // the access token is a query param, not logged — but it SHOULD be present for the real request
    expect(calledUrl).toContain('access_token=secret-token');
  });

  it('a hostile leadgenId cannot redirect the request elsewhere (it is URL-encoded into the path)', async () => {
    let calledUrl = '';
    const fetchImpl = fakeFetch(async (url) => {
      calledUrl = url;
      return { status: 200, json: async () => ({ id: 'x', field_data: [] }) };
    });
    const client = new MetaGraphClient(fetchImpl);
    await client.retrieveLead('../../evil.example.com', 'token');
    expect(calledUrl.startsWith('https://graph.facebook.com/')).toBe(true);
    expect(calledUrl).not.toContain('evil.example.com/');
  });

  it('throws real HydrationError instances (instanceof check holds)', async () => {
    const fetchImpl = fakeFetch(async () => ({ status: 401, json: async () => ({}) }));
    const client = new MetaGraphClient(fetchImpl);
    await expect(client.retrieveLead('LEAD-1', 'token')).rejects.toBeInstanceOf(HydrationError);
  });
});
