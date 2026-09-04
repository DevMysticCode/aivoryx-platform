import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module.js';
import { AdminController } from './admin.controller.js';
import { AdminService } from './admin.service.js';
import { InvitationController } from './invitation.controller.js';
import { InvitationService } from './invitation.service.js';
import { MembersService } from './members.service.js';
import { OutboxService } from './outbox.service.js';
import { TenantService } from './tenant.service.js';

/**
 * Tenant administration & user lifecycle (ADR 0030).
 *
 * Imports `AuthModule` for `PasswordService` (invitation acceptance sets the
 * first password). It does NOT depend on `SecurityModule`; the global
 * `SecurityGuard` protects every non-`@Public()` route here.
 */
@Module({
  imports: [AuthModule],
  controllers: [AdminController, InvitationController],
  providers: [AdminService, TenantService, MembersService, InvitationService, OutboxService],
  exports: [AdminService, TenantService, MembersService, InvitationService, OutboxService],
})
export class AdminModule {}
