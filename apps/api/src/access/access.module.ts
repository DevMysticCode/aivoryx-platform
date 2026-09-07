import { Module } from '@nestjs/common';
import { AccessController } from './access.controller.js';
import { AccessService } from './access.service.js';

/**
 * Tenant-side access configuration (Phase 13, ADR 0042). Profiles, permission
 * sets and effective-access summaries — built on the existing `roles` model
 * (a `kind` column), never a second authorization system. Consumes the global
 * `EntitlementsModule` + `AuditModule`; depends on no business module.
 */
@Module({
  controllers: [AccessController],
  providers: [AccessService],
  exports: [AccessService],
})
export class AccessModule {}
