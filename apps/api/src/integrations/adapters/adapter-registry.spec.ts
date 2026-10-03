import { describe, expect, it } from 'vitest';
import { AppError } from '@aivoryx/shared';
import { AdapterRegistry } from './adapter-registry.js';
import type { ConnectorAdapter, InboundEnvelope } from './connector-adapter.js';

function fakeAdapter(provider: string, version = 1): ConnectorAdapter {
  return {
    provider,
    version,
    meta: { provider, displayName: provider, description: provider, capabilities: [] },
    verify: () => ({ verified: true }),
    parse: (_envelope: InboundEnvelope) => ({
      providerFields: {},
      providerRecordId: null,
      providerTimestamp: null,
    }),
  };
}

describe('AdapterRegistry', () => {
  it('registers and resolves a known provider + version (pabbly_bridge v1)', () => {
    const registry = new AdapterRegistry();
    const adapter = fakeAdapter('pabbly_bridge', 1);
    registry.register(adapter);
    expect(registry.resolve('pabbly_bridge', 1)).toBe(adapter);
  });

  it('defaults to version 1 when no version is given — every unversioned existing row still resolves', () => {
    const registry = new AdapterRegistry();
    const adapter = fakeAdapter('pabbly_bridge', 1);
    registry.register(adapter);
    expect(registry.resolve('pabbly_bridge')).toBe(adapter);
  });

  it('an unknown provider throws AppError(ADAPTER_NOT_FOUND) with the provider in details', () => {
    const registry = new AdapterRegistry();
    registry.register(fakeAdapter('pabbly_bridge', 1));
    try {
      registry.resolve('does_not_exist', 1);
      expect.unreachable('resolve() should have thrown');
    } catch (err) {
      expect(err).toBeInstanceOf(AppError);
      expect((err as AppError).code).toBe('ADAPTER_NOT_FOUND');
      expect((err as AppError).httpStatus).toBe(500);
      expect((err as AppError).details).toEqual({ provider: 'does_not_exist', version: 1 });
    }
  });

  it('a known provider with an unsupported version throws the same AppError(ADAPTER_NOT_FOUND)', () => {
    const registry = new AdapterRegistry();
    registry.register(fakeAdapter('pabbly_bridge', 1));
    try {
      registry.resolve('pabbly_bridge', 2);
      expect.unreachable('resolve() should have thrown');
    } catch (err) {
      expect(err).toBeInstanceOf(AppError);
      expect((err as AppError).code).toBe('ADAPTER_NOT_FOUND');
      expect((err as AppError).details).toEqual({ provider: 'pabbly_bridge', version: 2 });
    }
  });

  it('registering the same provider + version twice throws, and does not replace the first adapter', () => {
    const registry = new AdapterRegistry();
    const first = fakeAdapter('pabbly_bridge', 1);
    registry.register(first);
    expect(() => registry.register(fakeAdapter('pabbly_bridge', 1))).toThrow(
      /already registered.*pabbly_bridge.*1/i,
    );
    expect(registry.resolve('pabbly_bridge', 1)).toBe(first);
  });

  it('the same provider at two different versions coexists; each resolves to its own adapter', () => {
    const registry = new AdapterRegistry();
    const v1 = fakeAdapter('pabbly_bridge', 1);
    const v2 = fakeAdapter('pabbly_bridge', 2);
    registry.register(v1);
    registry.register(v2);
    expect(registry.resolve('pabbly_bridge', 1)).toBe(v1);
    expect(registry.resolve('pabbly_bridge', 2)).toBe(v2);
  });

  it('multiple different providers resolve independently', () => {
    const registry = new AdapterRegistry();
    const pabbly = fakeAdapter('pabbly_bridge', 1);
    const generic = fakeAdapter('generic_webhook', 1);
    registry.register(pabbly);
    registry.register(generic);
    expect(registry.resolve('pabbly_bridge')).toBe(pabbly);
    expect(registry.resolve('generic_webhook')).toBe(generic);
  });
});
