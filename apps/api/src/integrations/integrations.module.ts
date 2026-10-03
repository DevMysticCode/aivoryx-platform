import { Module } from '@nestjs/common';
import type { ServerEnv } from '@aivoryx/config';
import { SERVER_ENV } from '../config/config.module.js';
import { AdminModule } from '../admin/admin.module.js';
import { AdapterRegistry } from './adapters/adapter-registry.js';
import { MetaLeadAdsAdapter } from './adapters/meta-lead-ads.adapter.js';
import { PabblyAdapter } from './adapters/pabbly.adapter.js';
import { ConnectorCredentialsService } from './credentials/connector-credentials.service.js';
import { MetaGraphClient } from './graph/meta-graph-client.js';
import { IngestionService } from './ingestion.service.js';
import { IntegrationsAdminController } from './integrations-admin.controller.js';
import { WEBHOOK_RATE_LIMITER, TokenBucketRateLimiter } from './rate-limiter.js';
import { RawEventRetentionService } from './raw-event-retention.service.js';
import { SourcesService } from './sources.service.js';
import { WebhookController } from './webhook.controller.js';

/**
 * Inbound integration engine (Phase 3, ADR 0032). Imports `AdminModule` to
 * reuse its `OutboxService` — deliberately not a second outbox mechanism.
 * Depends on `@aivoryx/db` + the CRM module's pure/query helpers only; the CRM
 * module has no dependency back on this one.
 */
@Module({
  imports: [AdminModule],
  controllers: [WebhookController, IntegrationsAdminController],
  providers: [
    SourcesService,
    IngestionService,
    RawEventRetentionService,
    ConnectorCredentialsService,
    // Real DI providers (not `new`'d inline) specifically so a test can `overrideProvider` the
    // Graph API client with a fake — nothing else about the adapter architecture needs this; Pabbly
    // has no external dependency to override, so it stays a plain `new PabblyAdapter()` below.
    // `useFactory` (not a bare class) for MetaGraphClient: its constructor's own default parameters
    // (`fetch`, a timeout) are plain values, not DI tokens — Nest must not try to resolve them.
    { provide: MetaGraphClient, useFactory: () => new MetaGraphClient() },
    MetaLeadAdsAdapter,
    {
      // Registration happens here, once, at module construction — the registry itself never
      // references PabblyAdapter/MetaLeadAdsAdapter directly; this factory is what wires provider
      // to adapter (UC-2/UC-3).
      provide: AdapterRegistry,
      inject: [MetaLeadAdsAdapter],
      useFactory: (meta: MetaLeadAdsAdapter) => {
        const registry = new AdapterRegistry();
        registry.register(new PabblyAdapter());
        registry.register(meta);
        return registry;
      },
    },
    {
      // In-process token bucket behind the RateLimiter interface; swap this provider to change
      // the implementation (e.g. Redis) without touching ingestion code.
      provide: WEBHOOK_RATE_LIMITER,
      inject: [SERVER_ENV],
      useFactory: (env: ServerEnv) =>
        new TokenBucketRateLimiter({
          capacity: env.WEBHOOK_RATE_LIMIT_MAX,
          windowSeconds: env.WEBHOOK_RATE_LIMIT_WINDOW_SECONDS,
        }),
    },
  ],
  exports: [SourcesService, IngestionService, RawEventRetentionService],
})
export class IntegrationsModule {}
