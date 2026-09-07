import { Global, Module } from '@nestjs/common';
import { EntitlementService } from './entitlement.service.js';
import { PlatformAdminService } from './platform-admin.service.js';

/**
 * The platform-owned authorization boundary (Phase 13, ADR 0042):
 * `EntitlementService` (is a module enabled for a tenant?) and
 * `PlatformAdminService` (is this user an Aivoryx platform admin?).
 *
 * `@Global` so the security guard and any module can inject these without
 * import wiring — mirroring `AuditModule`. This module depends only on
 * `@aivoryx/db`, `@aivoryx/shared` and `AuditService`; it must NEVER import a
 * business module (CRM/HR/Field/…).
 */
@Global()
@Module({
  providers: [EntitlementService, PlatformAdminService],
  exports: [EntitlementService, PlatformAdminService],
})
export class EntitlementsModule {}
