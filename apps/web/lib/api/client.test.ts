import { afterEach, describe, expect, it, vi } from 'vitest';
import { ApiError, apiFetch, getHealth } from './client';

afterEach(() => vi.unstubAllGlobals());

function stubFetch(impl: typeof fetch) {
  vi.stubGlobal('fetch', vi.fn(impl));
}

describe('apiFetch', () => {
  it('calls the versioned API URL with credentials and a correlation id', async () => {
    stubFetch(async (input, init) => {
      expect(String(input)).toBe('http://localhost:4000/api/v1/health');
      expect(init?.credentials).toBe('include');
      expect((init?.headers as Record<string, string>)['x-correlation-id']).toMatch(/^AIV-/);
      return new Response(JSON.stringify({ status: 'ok' }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      });
    });

    await expect(getHealth()).resolves.toEqual({ status: 'ok' });
  });

  it('throws a typed ApiError carrying the stable code and reference id', async () => {
    stubFetch(
      async () =>
        new Response(
          JSON.stringify({
            error: { code: 'SERVICE_UNAVAILABLE', message: 'nope', correlationId: 'AIV-XYZ' },
          }),
          { status: 503, headers: { 'content-type': 'application/json' } },
        ),
    );

    await expect(apiFetch('/health')).rejects.toMatchObject({
      status: 503,
      code: 'SERVICE_UNAVAILABLE',
      correlationId: 'AIV-XYZ',
    });
  });

  it('ApiError falls back to a generic code when the body is unparseable', () => {
    const err = new ApiError(500, undefined);
    expect(err.code).toBe('INTERNAL_ERROR');
    expect(err.correlationId).toBeUndefined();
  });
});
