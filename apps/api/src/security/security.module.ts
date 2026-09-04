import { Module } from '@nestjs/common';
import { APP_GUARD, APP_INTERCEPTOR } from '@nestjs/core';
import { AuthModule } from '../auth/auth.module.js';
import { SecurityContextInterceptor } from './security-context.interceptor.js';
import { SecurityGuard } from './security.guard.js';

/**
 * Registers the global authentication + tenant-context + authorization gate
 * (`SecurityGuard`) and the AsyncLocalStorage binding (`SecurityContextInterceptor`).
 *
 * Every route is protected by default: use `@Public()` for infrastructure
 * endpoints (health, login) and `@AuthOnly()` where a tenant is not required.
 */
@Module({
  imports: [AuthModule],
  providers: [
    { provide: APP_GUARD, useClass: SecurityGuard },
    { provide: APP_INTERCEPTOR, useClass: SecurityContextInterceptor },
  ],
})
export class SecurityModule {}
