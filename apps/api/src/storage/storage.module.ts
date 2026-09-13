import { Module } from '@nestjs/common';
import { type ServerEnv } from '@aivoryx/config';
import { SERVER_ENV } from '../config/config.module.js';
import {
  LocalFilesystemObjectStorageService,
  OBJECT_STORAGE,
  type ObjectStorageService,
} from './object-storage.service.js';
import { S3ObjectStorageService } from './s3-object-storage.service.js';

/**
 * The single authoritative object-storage provider decision (deployment
 * hardening). Every caller depends only on the `OBJECT_STORAGE` token and the
 * `ObjectStorageService` interface, never on `OBJECT_STORAGE_PROVIDER`
 * directly, so no business module ever branches on which provider is active.
 * Pure and exported so provider selection is unit-testable without booting
 * Nest's DI container.
 *
 *   OBJECT_STORAGE_PROVIDER=local (default) -> LocalFilesystemObjectStorageService
 *   OBJECT_STORAGE_PROVIDER=s3              -> S3ObjectStorageService (any
 *                                              S3-compatible endpoint —
 *                                              Cloudflare R2 is the first
 *                                              target, not a special case)
 *
 * Only the selected adapter is ever constructed — this instantiates the
 * winning class directly rather than registering both as Nest providers, so
 * the S3 client (and its credentials) are never even built in local dev.
 */
export function selectObjectStorageProvider(env: ServerEnv): ObjectStorageService {
  return env.OBJECT_STORAGE_PROVIDER === 's3'
    ? new S3ObjectStorageService(env)
    : new LocalFilesystemObjectStorageService(env);
}

/** ADR 0015; S3/R2 adapter added for deployment hardening — see
 *  `selectObjectStorageProvider` above for the actual selection logic. */
@Module({
  providers: [
    {
      provide: OBJECT_STORAGE,
      inject: [SERVER_ENV],
      useFactory: selectObjectStorageProvider,
    },
  ],
  exports: [OBJECT_STORAGE],
})
export class StorageModule {}
