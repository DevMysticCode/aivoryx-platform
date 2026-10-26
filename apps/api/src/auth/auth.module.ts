import { Module } from '@nestjs/common';
import type { ServerEnv } from '@aivoryx/config';
import { TokenBucketRateLimiter } from '../integrations/rate-limiter.js';
import { SERVER_ENV } from '../config/config.module.js';
import { EmailModule } from '../notifications/email/email.module.js';
import { SettingsModule } from '../settings/settings.module.js';
import { AuthController } from './auth.controller.js';
import { AuthService, AUTH_LOGIN_RATE_LIMITER } from './auth.service.js';
import { PasswordResetService, PASSWORD_RESET_RATE_LIMITER } from './password-reset.service.js';
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
  imports: [SettingsModule, EmailModule],
  controllers: [AuthController],
  providers: [
    PasswordService,
    SessionService,
    RbacService,
    AuthService,
    PasswordResetService,
    {
      // In-process token bucket behind the same `RateLimiter` interface the webhook
      // ingestion path already uses — reused, not reimplemented.
      provide: AUTH_LOGIN_RATE_LIMITER,
      inject: [SERVER_ENV],
      useFactory: (env: ServerEnv) =>
        new TokenBucketRateLimiter({
          capacity: env.LOGIN_RATE_LIMIT_MAX,
          windowSeconds: env.LOGIN_RATE_LIMIT_WINDOW_SECONDS,
        }),
    },
    {
      provide: PASSWORD_RESET_RATE_LIMITER,
      inject: [SERVER_ENV],
      useFactory: (env: ServerEnv) =>
        new TokenBucketRateLimiter({
          capacity: env.PASSWORD_RESET_RATE_LIMIT_MAX,
          windowSeconds: env.PASSWORD_RESET_RATE_LIMIT_WINDOW_SECONDS,
        }),
    },
  ],
  exports: [PasswordService, SessionService, RbacService, AuthService],
})
export class AuthModule {}
