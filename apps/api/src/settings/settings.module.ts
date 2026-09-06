import { Module } from '@nestjs/common';
import { StorageModule } from '../storage/storage.module.js';
import { CompanyProfileService } from './company-profile.service.js';
import { TenantLogoService } from './tenant-logo.service.js';
import { OnboardingService } from './onboarding.service.js';
import { SettingsController } from './settings.controller.js';
import { OnboardingController } from './onboarding.controller.js';

/**
 * Platform Experience — tenant company profile, branding & onboarding
 * (Phase 10, ADR 0039). Reuses the Phase 4 object storage for logos; branding
 * is white-label configuration only. `CompanyProfileService` +
 * `TenantLogoService` are exported so `/auth/me`, the document engine and the
 * notification engine can consume tenant branding without a permission.
 */
@Module({
  imports: [StorageModule],
  controllers: [SettingsController, OnboardingController],
  providers: [CompanyProfileService, TenantLogoService, OnboardingService],
  exports: [CompanyProfileService, TenantLogoService],
})
export class SettingsModule {}
