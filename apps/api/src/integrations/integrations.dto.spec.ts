import { describe, expect, it } from 'vitest';
import { AdapterRegistry } from './adapters/adapter-registry.js';
import { MetaLeadAdsAdapter } from './adapters/meta-lead-ads.adapter.js';
import { PabblyAdapter } from './adapters/pabbly.adapter.js';
import { KNOWN_CONNECTOR_TYPES } from './integrations.dto.js';

/**
 * `KNOWN_CONNECTOR_TYPES` (DTO validation / Swagger) and the real `AdapterRegistry` (runtime
 * authority) are two independently-maintained lists by design (UC-2's comment on the const
 * explains why: request validation must work without booting the DI container). UC-4 adds this
 * test so the two can never silently drift apart — exactly the registration this module's factory
 * performs (`integrations.module.ts`), built directly here with no DI/DB dependency.
 */
describe('KNOWN_CONNECTOR_TYPES stays in sync with the real AdapterRegistry', () => {
  it('contains exactly the providers actually registered at runtime — no more, no fewer', () => {
    const registry = new AdapterRegistry();
    registry.register(new PabblyAdapter());
    registry.register(new MetaLeadAdsAdapter());

    const registered = new Set(registry.list().map((a) => a.provider));
    const declared = new Set(KNOWN_CONNECTOR_TYPES as readonly string[]);

    expect(declared).toEqual(registered);
  });
});
