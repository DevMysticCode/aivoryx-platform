import { Inject, Injectable } from '@nestjs/common';
import { and, eq, inArray } from 'drizzle-orm';
import { getDb, schema, withProgressiveContext, type Tx } from '@aivoryx/db';
import { AppError } from '@aivoryx/shared';
import { OBJECT_STORAGE, type ObjectStorageService } from '../storage/object-storage.service.js';
import type { PublicLoginBrandingDto } from './public-branding.dto.js';

const { tenants, tenantCompanyProfiles, tenantAssets } = schema;

export const WORKSPACE_SLUG_RE = /^[a-z0-9][a-z0-9-]{0,62}$/;

/**
 * Pre-auth, tenant-aware login branding. The slug is resolved to an ACTIVE
 * tenant through the additive, SELECT-only `tenants_by_public_slug` RLS policy;
 * the tenant id is then server-derived and used to widen the context so the
 * profile and assets are read through the normal tenant-scoped policies, all in
 * one transaction. It returns a fixed, minimal field set and never influences
 * authentication. Every failure mode (malformed / unknown / non-active / no
 * logo) is the same generic `WORKSPACE_NOT_FOUND`.
 */
@Injectable()
export class PublicBrandingService {
  constructor(@Inject(OBJECT_STORAGE) private readonly storage: ObjectStorageService) {}

  async getLoginBranding(slug: string): Promise<PublicLoginBrandingDto> {
    return this.resolve(slug, async (tx, tenant) => {
      const [p] = await tx
        .select()
        .from(tenantCompanyProfiles)
        .where(eq(tenantCompanyProfiles.tenantId, tenant.id))
        .limit(1);
      const kinds = await tx
        .select({ kind: tenantAssets.kind })
        .from(tenantAssets)
        .where(
          and(
            eq(tenantAssets.tenantId, tenant.id),
            inArray(tenantAssets.kind, ['logo_login', 'logo']),
          ),
        );
      return {
        slug: tenant.slug,
        displayName: p?.displayName?.trim() || tenant.name,
        themePreset: p?.themePreset ?? null,
        primaryColor: p?.primaryColor ?? null,
        secondaryColor: p?.secondaryColor ?? null,
        accentColor: p?.accentColor ?? null,
        welcomeMessage: p?.loginWelcome ?? null,
        description: p?.loginDescription ?? null,
        showPoweredBy: p?.loginShowPoweredBy ?? true,
        hasLogo: kinds.length > 0,
      };
    });
  }

  async getLoginLogo(slug: string): Promise<{ body: Buffer; contentType: string }> {
    const found = await this.resolve(slug, async (tx, tenant) => {
      const rows = await tx
        .select({
          kind: tenantAssets.kind,
          objectKey: tenantAssets.objectKey,
          contentType: tenantAssets.contentType,
        })
        .from(tenantAssets)
        .where(
          and(
            eq(tenantAssets.tenantId, tenant.id),
            inArray(tenantAssets.kind, ['logo_login', 'logo']),
          ),
        );
      return (
        rows.find((r) => r.kind === 'logo_login') ?? rows.find((r) => r.kind === 'logo') ?? null
      );
    });
    if (!found) throw notFound();
    const obj = await this.storage.getObject(found.objectKey);
    const type = (obj?.contentType || found.contentType).toLowerCase();
    if (!obj || !/^image\/(png|jpeg|webp)$/.test(type)) throw notFound();
    return { body: obj.body, contentType: type };
  }

  private async resolve<T>(
    slug: string,
    fn: (tx: Tx, tenant: { id: string; slug: string; name: string }) => Promise<T>,
  ): Promise<T> {
    if (!WORKSPACE_SLUG_RE.test(slug)) throw notFound();
    return withProgressiveContext(getDb(), async (tx, setContext) => {
      await setContext({ workspaceSlug: slug });
      const [tenant] = await tx
        .select({ id: tenants.id, slug: tenants.slug, name: tenants.name })
        .from(tenants)
        .where(eq(tenants.slug, slug))
        .limit(1);
      if (!tenant) throw notFound();
      // widen with the SERVER-derived tenant id (never client-supplied)
      await setContext({ tenantId: tenant.id });
      return fn(tx, tenant);
    });
  }
}

const notFound = () => new AppError('WORKSPACE_NOT_FOUND');
