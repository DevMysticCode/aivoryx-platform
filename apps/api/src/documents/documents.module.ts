import { Module } from '@nestjs/common';
import { StorageModule } from '../storage/storage.module.js';
import { SettingsModule } from '../settings/settings.module.js';
import { DocumentPdfService } from './document-pdf.service.js';
import { DocumentRenderService } from './document-render.service.js';

/**
 * Reusable document-generation engine (Phase 10, ADR 0039). Business modules
 * import this for `DocumentPdfService` and pass structured `DocumentDefinition`
 * data + a `DocumentBrandingContext` (from `CompanyProfileService`). PDF
 * technology (pdfmake) is isolated entirely inside `DocumentPdfService`.
 */
@Module({
  imports: [StorageModule, SettingsModule],
  providers: [DocumentPdfService, DocumentRenderService],
  exports: [DocumentPdfService, DocumentRenderService, SettingsModule],
})
export class DocumentsModule {}
