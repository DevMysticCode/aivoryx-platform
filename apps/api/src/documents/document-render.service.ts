import { Inject, Injectable } from '@nestjs/common';
import { getDb, withTenantContext } from '@aivoryx/db';
import type { TenantScope } from '../supply/common.js';
import { CompanyProfileService } from '../settings/company-profile.service.js';
import { OBJECT_STORAGE, type ObjectStorageService } from '../storage/object-storage.service.js';
import { readCustomerLogo } from '../commercial/customer-logo.service.js';
import { DocumentPdfService } from './document-pdf.service.js';
import { documentFilename, type DocumentDefinition } from './document.types.js';

/**
 * The single entry point business modules use to produce a branded PDF
 * (Phase 10, ADR 0039): resolve the tenant's document branding (company
 * details + colours + logo bytes, tenant-scoped) and hand it, with the
 * caller's structured `DocumentDefinition`, to `DocumentPdfService`. PDF
 * technology stays isolated inside that service.
 */
@Injectable()
export class DocumentRenderService {
  constructor(
    private readonly pdf: DocumentPdfService,
    private readonly profiles: CompanyProfileService,
    @Inject(OBJECT_STORAGE) private readonly storage: ObjectStorageService,
  ) {}

  /** Render `def` as a PDF using the active tenant's branding. */
  async render(
    scope: TenantScope,
    def: DocumentDefinition,
  ): Promise<{ filename: string; body: Buffer }> {
    const branding = await withTenantContext(getDb(), scope, async (tx) => {
      const b = await this.profiles.getDocumentBranding(tx, scope.tenantId, (key) =>
        this.storage.getObject(key),
      );
      // The customer logo is read ONLY when the tenant enables it AND the
      // document names a customer. A storage/DB hiccup never fails the render.
      let customerLogo: { body: Buffer; contentType: string } | null = null;
      if (b.showCustomerLogo && def.party?.customerId) {
        customerLogo = await readCustomerLogo(
          tx,
          scope.tenantId,
          def.party.customerId,
          this.storage,
        ).catch(() => null);
      }
      return { ...b, customerLogo };
    });
    const body = await this.pdf.render(def, branding);
    return { filename: documentFilename(def.documentNumber), body };
  }
}
