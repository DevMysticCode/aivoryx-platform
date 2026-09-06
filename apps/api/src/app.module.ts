import { Module } from '@nestjs/common';
import { APP_FILTER } from '@nestjs/core';
import { AppConfigModule } from './config/config.module.js';
import { AppLoggerModule } from './observability/logger.module.js';
import { AllExceptionsFilter } from './errors/all-exceptions.filter.js';
import { DbModule } from './db/db.module.js';
import { RedisModule } from './redis/redis.module.js';
import { QueueModule } from './queue/queue.module.js';
import { HealthModule } from './health/health.module.js';
import { AuthModule } from './auth/auth.module.js';
import { SecurityModule } from './security/security.module.js';
import { AdminModule } from './admin/admin.module.js';
import { CrmModule } from './crm/crm.module.js';
import { IntegrationsModule } from './integrations/integrations.module.js';
import { FieldModule } from './field/field.module.js';
import { SupplyModule } from './supply/supply.module.js';
import { CommercialModule } from './commercial/commercial.module.js';
import { ExecutionModule } from './execution/execution.module.js';
import { NotificationsModule } from './notifications/notifications.module.js';
import { FinanceModule } from './finance/finance.module.js';
import { SettingsModule } from './settings/settings.module.js';
import { DocumentsModule } from './documents/documents.module.js';

/**
 * Composition root.
 *
 * Cross-cutting platform infrastructure + the Phase 2 security boundary
 * (authentication, session lifecycle, tenant context, RLS, RBAC). Business
 * modules (CRM, HR, ...) are added under `src/modules/` in later phases — see
 * `src/modules/README.md`.
 *
 * `SecurityModule` registers the global `APP_GUARD`, so every route is protected
 * unless it opts out with `@Public()` / `@AuthOnly()`.
 *
 * The correlation-id handler is registered as a global Express middleware in
 * `bootstrap/configure-app.ts` (runs before the exception filter).
 */
@Module({
  imports: [
    AppConfigModule,
    AppLoggerModule,
    DbModule,
    RedisModule,
    QueueModule,
    HealthModule,
    AuthModule,
    SecurityModule,
    AdminModule,
    CrmModule,
    IntegrationsModule,
    FieldModule,
    SupplyModule,
    CommercialModule,
    ExecutionModule,
    NotificationsModule,
    FinanceModule,
    SettingsModule,
    DocumentsModule,
  ],
  providers: [{ provide: APP_FILTER, useClass: AllExceptionsFilter }],
})
export class AppModule {}
