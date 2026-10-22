import { Global, Module } from '@nestjs/common';
import { AuditController } from './audit.controller.js';
import { AuditQueryService } from './audit.query.service.js';
import { AuditService } from './audit.service.js';
import { PlatformAuditService } from './platform-audit.service.js';

/**
 * Global Audit Log (Phase 11, ADR 0040) + the platform-scoped sibling added
 * in the Production Operations & Customer Launch Readiness milestone.
 *
 * `@Global` so every business module can inject `AuditService` /
 * `PlatformAuditService` and record an audit row inside its own transaction,
 * without a web of module imports. Neither service has dependencies beyond
 * `@aivoryx/db` and the request / correlation context, so this cannot create
 * a cycle. The tenant-audit read side (`AuditQueryService` + controller) is
 * `audit.read`-gated; `PlatformAuditService`'s read side is exposed from
 * `PlatformController` (`@PlatformAdmin()`), not here, since it has no
 * tenant-permission concept.
 */
@Global()
@Module({
  controllers: [AuditController],
  providers: [AuditService, AuditQueryService, PlatformAuditService],
  exports: [AuditService, PlatformAuditService],
})
export class AuditModule {}
