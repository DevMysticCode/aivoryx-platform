import { Global, Injectable, Module, type OnApplicationShutdown } from '@nestjs/common';
import { Logger } from '@nestjs/common';
import { type Database, closeDb, getDb } from '@aivoryx/db';
import { isOpenApiGeneration } from '../runtime.js';

export const DATABASE = Symbol('DATABASE');

@Injectable()
class DbLifecycle implements OnApplicationShutdown {
  private readonly logger = new Logger('Database');

  async onApplicationShutdown(): Promise<void> {
    if (!isOpenApiGeneration()) {
      await closeDb();
      this.logger.log('database pool closed');
    }
  }
}

/**
 * Exposes the Drizzle handle via DI and closes the pool on shutdown.
 * The pool connects lazily, so importing this module does not require a DB.
 */
@Global()
@Module({
  providers: [
    {
      provide: DATABASE,
      useFactory: (): Database | null => (isOpenApiGeneration() ? null : getDb().db),
    },
    DbLifecycle,
  ],
  exports: [DATABASE],
})
export class DbModule {}
