import { Injectable } from '@nestjs/common';
import { AppError } from '@aivoryx/shared';
import type { ConnectorAdapter } from './connector-adapter.js';

/**
 * Universal Connector UC-2 — resolves `provider + version` to a `ConnectorAdapter`. Pure
 * provider -> adapter lookup: no business logic, no CRM import, no tenant knowledge, no database
 * access. `IngestionService` is its only caller.
 *
 * Key is `${provider}:${version}` (ADR 0049). No `adapter_version` column exists on `lead_sources`
 * (and UC-2 adds none), so every current row resolves with the DEFAULT version, 1 — `resolve()`'s
 * second parameter defaults to `1` for exactly that reason. This keeps every existing Pabbly record
 * working unchanged while leaving room for a second, explicitly-versioned adapter later (at which
 * point a persisted `adapter_version` column becomes meaningful and callers pass it explicitly).
 *
 * Registration happens once, in `IntegrationsModule`'s factory — the registry itself never
 * constructs or knows about `PabblyAdapter`; the module is what wires provider to adapter.
 */
@Injectable()
export class AdapterRegistry {
  private readonly adapters = new Map<string, ConnectorAdapter>();

  /** Throws if an adapter is already registered for this exact provider + version. */
  register(adapter: ConnectorAdapter): void {
    const key = AdapterRegistry.key(adapter.provider, adapter.version);
    if (this.adapters.has(key)) {
      throw new Error(
        `An adapter is already registered for provider "${adapter.provider}" version ${adapter.version}.`,
      );
    }
    this.adapters.set(key, adapter);
  }

  /**
   * Resolve by provider + version. `version` defaults to 1 because no persisted row carries a
   * version today — every existing `lead_sources.connector_type = 'pabbly_bridge'` row implicitly
   * means "pabbly_bridge, version 1".
   *
   *  - unknown provider -> `AppError('ADAPTER_NOT_FOUND')`
   *  - known provider, unsupported version -> the SAME `AppError('ADAPTER_NOT_FOUND')` (from the
   *    caller's point of view both are "no adapter exists for what this row asked for"; the error
   *    `details` distinguish provider from version for diagnostics without a second error code).
   */
  resolve(provider: string, version = 1): ConnectorAdapter {
    const adapter = this.adapters.get(AdapterRegistry.key(provider, version));
    if (!adapter) {
      throw new AppError('ADAPTER_NOT_FOUND', { details: { provider, version } });
    }
    return adapter;
  }

  private static key(provider: string, version: number): string {
    return `${provider}:${version}`;
  }
}
