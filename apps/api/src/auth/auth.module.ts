import { Module } from '@nestjs/common';
import { SettingsModule } from '../settings/settings.module.js';
import { AuthController } from './auth.controller.js';
import { AuthService } from './auth.service.js';
import { PasswordService } from './password.service.js';
import { RbacService } from './rbac.service.js';
import { SessionService } from './session.service.js';

/**
 * Authentication, session lifecycle and RBAC resolution (ADR 0028 / 0029).
 * Depends only on the global config module; the DB handle is pulled lazily from
 * `@aivoryx/db` inside the services so this module also loads for OpenAPI
 * generation without a database.
 */
@Module({
  imports: [SettingsModule],
  controllers: [AuthController],
  providers: [PasswordService, SessionService, RbacService, AuthService],
  exports: [PasswordService, SessionService, RbacService, AuthService],
})
export class AuthModule {}
