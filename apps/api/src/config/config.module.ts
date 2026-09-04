import { Global, Module } from '@nestjs/common';
import { type ServerEnv, loadServerEnv } from '@aivoryx/config';

/** DI token for the validated server environment. */
export const SERVER_ENV = Symbol('SERVER_ENV');

/**
 * Centralized configuration access (task 17). Nothing in the app reads
 * `process.env` directly — inject `SERVER_ENV` instead. The Zod schema in
 * `@aivoryx/config` is the single validation point and fails fast at boot.
 */
@Global()
@Module({
  providers: [{ provide: SERVER_ENV, useFactory: (): ServerEnv => loadServerEnv() }],
  exports: [SERVER_ENV],
})
export class AppConfigModule {}
