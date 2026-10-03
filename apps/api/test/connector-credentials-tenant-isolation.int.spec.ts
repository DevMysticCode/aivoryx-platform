import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { INTEGRATION_ENABLED } from './support/env.js';
import { startConnectorHarness, type ConnectorHarness } from './support/connector.js';
import { ConnectorCredentialsService } from '../src/integrations/credentials/connector-credentials.service.js';

/**
 * UC-3 security review follow-up: `ConnectorCredentialsService.get()`/`has()` now filter by
 * `(sourceId, tenantId)` explicitly, not `sourceId` + RLS alone (defense-in-depth, matching
 * `requireSource`'s existing convention). These tests isolate that EXPLICIT filter from RLS by
 * running inside a transaction whose RLS context is tenant A (which would ALLOW the row) while
 * passing tenant B as the method's own `tenantId` argument — proving the application-level check is
 * real, not merely redundant with what RLS already does.
 */
describe.skipIf(!INTEGRATION_ENABLED)(
  'ConnectorCredentialsService — tenant-aware filtering',
  () => {
    let h: ConnectorHarness;
    let service: ConnectorCredentialsService;

    beforeAll(async () => {
      h = await startConnectorHarness();
      service = h.app.get(ConnectorCredentialsService);
    });
    afterAll(async () => h?.close());

    const DATA = { appSecret: 'a-secret', pageAccessToken: 'a-token' };

    it('correct tenant + source: get() returns the real data, has() is true', async () => {
      const cookie = await h.adminCookie();
      const { sourceId } = await h.createMetaSource(cookie, h.uniqueKey('cred-ok'));
      await h.setCredentials(cookie, sourceId, DATA);

      const db = await import('@aivoryx/db');
      const result = await db.withTenantContext(
        db.getDb(),
        { tenantId: h.fx.tenantA, userId: h.fx.admin.userId },
        async (tx) => ({
          data: await service.get(tx, h.fx.tenantA, sourceId),
          has: await service.has(tx, h.fx.tenantA, sourceId),
        }),
      );
      expect(result.data).toEqual(DATA);
      expect(result.has).toBe(true);
    });

    it('wrong tenant + same sourceId: get() returns {} even though RLS alone would allow the row', async () => {
      const cookie = await h.adminCookie();
      const { sourceId } = await h.createMetaSource(cookie, h.uniqueKey('cred-wrong-tenant'));
      await h.setCredentials(cookie, sourceId, DATA);

      const db = await import('@aivoryx/db');
      // RLS context is tenant A (the row's REAL tenant) -- RLS alone would permit reading this row.
      // Passing tenant B as the explicit argument must still yield nothing.
      const data = await db.withTenantContext(
        db.getDb(),
        { tenantId: h.fx.tenantA, userId: h.fx.admin.userId },
        (tx) => service.get(tx, h.fx.tenantB, sourceId),
      );
      expect(data).toEqual({});
    });

    it('wrong tenant cannot detect credential existence through has() either', async () => {
      const cookie = await h.adminCookie();
      const { sourceId } = await h.createMetaSource(cookie, h.uniqueKey('cred-wrong-has'));
      await h.setCredentials(cookie, sourceId, DATA);

      const db = await import('@aivoryx/db');
      const has = await db.withTenantContext(
        db.getDb(),
        { tenantId: h.fx.tenantA, userId: h.fx.admin.userId },
        (tx) => service.has(tx, h.fx.tenantB, sourceId),
      );
      expect(has).toBe(false);
    });

    it('a source with NO credentials configured: get() is {} and has() is false for its own tenant too', async () => {
      const cookie = await h.adminCookie();
      const { sourceId } = await h.createMetaSource(cookie, h.uniqueKey('cred-none'));

      const db = await import('@aivoryx/db');
      const result = await db.withTenantContext(
        db.getDb(),
        { tenantId: h.fx.tenantA, userId: h.fx.admin.userId },
        async (tx) => ({
          data: await service.get(tx, h.fx.tenantA, sourceId),
          has: await service.has(tx, h.fx.tenantA, sourceId),
        }),
      );
      expect(result.data).toEqual({});
      expect(result.has).toBe(false);
    });
  },
);
