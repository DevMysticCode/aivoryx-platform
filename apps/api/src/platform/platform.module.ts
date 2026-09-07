import { Module } from '@nestjs/common';
import { PlatformController } from './platform.controller.js';
import { PlatformService } from './platform.service.js';

/**
 * Aivoryx platform administration (Phase 13, ADR 0042). Consumes the global
 * `EntitlementsModule` + `AuditModule`; depends on no business module. The
 * `@PlatformAdmin()` guard on every route keeps this surface off-limits to
 * tenant users.
 */
@Module({
  controllers: [PlatformController],
  providers: [PlatformService],
})
export class PlatformModule {}
