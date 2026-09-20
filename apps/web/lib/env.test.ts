import { afterEach, describe, expect, it, vi } from 'vitest';

afterEach(() => {
  vi.unstubAllEnvs();
  vi.resetModules();
});

describe('apiBaseUrl', () => {
  it('defaults to the configured API origin (cross-origin, credentialed CORS)', async () => {
    vi.stubEnv('NEXT_PUBLIC_API_BASE_URL', 'https://api.example.test');
    vi.stubEnv('NEXT_PUBLIC_API_PROXY', '');
    const { apiBaseUrl } = await import('./env');
    expect(apiBaseUrl()).toBe('https://api.example.test');
  });

  it('proxy mode: the browser uses its own origin so the session cookie is first-party', async () => {
    vi.stubEnv('NEXT_PUBLIC_API_BASE_URL', 'https://api.example.test');
    vi.stubEnv('NEXT_PUBLIC_API_PROXY', 'true');
    const { apiBaseUrl, webEnv } = await import('./env');
    expect(apiBaseUrl()).toBe('');
    // server-side fetches still need the real origin
    expect(webEnv.NEXT_PUBLIC_API_BASE_URL).toBe('https://api.example.test');
  });
});
