import { Module } from '@nestjs/common';
import { LocalFilesystemObjectStorageService, OBJECT_STORAGE } from './object-storage.service.js';

/**
 * Object storage (ADR 0015). Only a local-filesystem adapter exists so far
 * (Phase 4, ADR 0033) — swap the `useClass` below for an S3/R2 adapter later
 * without touching any caller, which depends on the `OBJECT_STORAGE` token.
 */
@Module({
  providers: [{ provide: OBJECT_STORAGE, useClass: LocalFilesystemObjectStorageService }],
  exports: [OBJECT_STORAGE],
})
export class StorageModule {}
