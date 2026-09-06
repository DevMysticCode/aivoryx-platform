import { Global, Module } from '@nestjs/common';
import { AuditController } from './audit.controller.js';
import { AuditQueryService } from './audit.query.service.js';
import { AuditService } from './audit.service.js';

/**
 * Global Audit Log (Phase 11, ADR 0040).
 *
 * `@Global` so every business module can inject `AuditService` and record an
 * audit row inside its own transaction, without a web of module imports. The
 * service itself has no dependencies beyond `@aivoryx/db` and the request /
 * correlation context, so this cannot create a cycle. The read side
 * (`AuditQueryService` + controller) is `audit.read`-gated.
 */
@Global()
@Module({
  controllers: [AuditController],
  providers: [AuditService, AuditQueryService],
  exports: [AuditService],
})
export class AuditModule {}
