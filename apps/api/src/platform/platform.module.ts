import { Module } from '@nestjs/common';
import { StorageModule } from '../storage/storage.module.js';
import { AdminModule } from '../admin/admin.module.js';
import {
  PlatformBrandingController,
  PublicPlatformBrandingController,
} from './platform-branding.controller.js';
import { PlatformBrandingService } from './platform-branding.service.js';
import { PlatformController } from './platform.controller.js';
import { PlatformService } from './platform.service.js';
import { TenantProvisioningService } from './tenant-provisioning.service.js';

/**
 * Aivoryx platform administration (Phase 13/14, ADR 0042). Consumes the
 * global `EntitlementsModule` + `AuditModule`, and `AdminModule` for
 * `InvitationService` (identity, not a business module) — never a business
 * module (CRM/HR/Field/Finance/EPC/Supply). The `@PlatformAdmin()` guard on
 * every route keeps this surface off-limits to tenant users.
 */
@Module({
  imports: [AdminModule, StorageModule],
  controllers: [PlatformController, PlatformBrandingController, PublicPlatformBrandingController],
  providers: [PlatformBrandingService, PlatformService, TenantProvisioningService],
})
export class PlatformModule {}
