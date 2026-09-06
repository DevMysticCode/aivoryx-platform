import { Injectable } from '@nestjs/common';
import { and, eq } from 'drizzle-orm';
import { getDb, schema, withTenantContext, type Tx } from '@aivoryx/db';
import type { TenantScope } from '../supply/common.js';
import { AuditService, userActor } from '../audit/audit.service.js';
import { buildChanges } from '../audit/audit.redaction.js';
import type { BrandingDto, CompanyProfileDto, UpdateCompanyProfileDto } from './settings.dto.js';

const { tenants, tenantCompanyProfiles, tenantAssets } = schema;

export interface DocumentBranding {
  businessName: string;
  legalName: string | null;
  addressLines: string[];
  taxLine: string | null;
  contactLines: string[];
  primaryColor: string | null;
  documentFooter: string | null;
  logo: { body: Buffer; contentType: string } | null;
}

/**
 * The workspace's company profile & branding (Phase 10, ADR 0039). One row per
 * tenant in `tenant_company_profiles`; logos live in `tenant_assets` (bytes in
 * object storage). Branding is white-label configuration only — it never
 * affects tenancy, security or permission semantics.
 */
@Injectable()
export class CompanyProfileService {
  constructor(private readonly audit: AuditService) {}

  async get(scope: TenantScope): Promise<CompanyProfileDto> {
    return withTenantContext(getDb(), scope, async (tx) => {
      const [tenant] = await tx
        .select({ name: tenants.name })
        .from(tenants)
        .where(eq(tenants.id, scope.tenantId))
        .limit(1);
      const profile = await this.loadProfile(tx, scope.tenantId);
      const kinds = await this.assetKinds(tx, scope.tenantId);
      return this.toDto(tenant?.name ?? 'Workspace', profile, kinds);
    });
  }

  async update(scope: TenantScope, patch: UpdateCompanyProfileDto): Promise<CompanyProfileDto> {
    return withTenantContext(getDb(), scope, async (tx) => {
      const set: Record<string, unknown> = { updatedByMembershipId: scope.actorMembershipId };
      for (const key of [
        'legalName',
        'displayName',
        'email',
        'phone',
        'website',
        'addressLine',
        'city',
        'region',
        'country',
        'postalCode',
        'taxRegistrationLabel',
        'taxRegistrationNumber',
        'documentFooter',
        'timezone',
      ] as const) {
        if (patch[key] !== undefined) set[key] = patch[key]!.trim() || null;
      }
      if (patch.defaultCurrency !== undefined) {
        set.defaultCurrency = patch.defaultCurrency.toUpperCase() || null;
      }
      if (patch.primaryColor !== undefined) set.primaryColor = patch.primaryColor.toLowerCase();
      if (patch.accentColor !== undefined) set.accentColor = patch.accentColor.toLowerCase();

      const before = await this.loadProfile(tx, scope.tenantId);

      await tx
        .insert(tenantCompanyProfiles)
        .values({ tenantId: scope.tenantId, ...set })
        .onConflictDoUpdate({
          target: tenantCompanyProfiles.tenantId,
          set: { ...set, updatedAt: new Date() },
        });

      const brandingFields = (['primaryColor', 'accentColor'] as const).filter((k) => k in set);
      const companyFields = Object.keys(set).filter(
        (k) => k !== 'updatedByMembershipId' && k !== 'primaryColor' && k !== 'accentColor',
      );
      const actor = userActor(scope);
      if (companyFields.length > 0) {
        await this.audit.record(tx, {
          tenantId: scope.tenantId,
          action: 'settings.company.updated',
          entityType: 'company_profile',
          entityId: before?.id ?? null,
          actor,
          metadata: { fields: companyFields },
          changes: buildChanges(before ?? {}, set, companyFields as never),
        });
      }
      if (brandingFields.length > 0) {
        await this.audit.record(tx, {
          tenantId: scope.tenantId,
          action: 'settings.branding.updated',
          entityType: 'company_profile',
          entityId: before?.id ?? null,
          actor,
          changes: buildChanges(before ?? {}, set, brandingFields as never),
        });
      }

      const [tenant] = await tx
        .select({ name: tenants.name })
        .from(tenants)
        .where(eq(tenants.id, scope.tenantId))
        .limit(1);
      const profile = await this.loadProfile(tx, scope.tenantId);
      const kinds = await this.assetKinds(tx, scope.tenantId);
      return this.toDto(tenant?.name ?? 'Workspace', profile, kinds);
    });
  }

  /** Compact branding for the app shell / `/auth/me` — no permission needed. */
  async getBranding(scope: { tenantId: string; userId: string }): Promise<BrandingDto> {
    return withTenantContext(getDb(), scope, async (tx) => {
      const [tenant] = await tx
        .select({ name: tenants.name })
        .from(tenants)
        .where(eq(tenants.id, scope.tenantId))
        .limit(1);
      const profile = await this.loadProfile(tx, scope.tenantId);
      const [logo] = await tx
        .select({ id: tenantAssets.id })
        .from(tenantAssets)
        .where(and(eq(tenantAssets.tenantId, scope.tenantId), eq(tenantAssets.kind, 'logo')))
        .limit(1);
      return {
        displayName: profile?.displayName?.trim() || tenant?.name || 'Workspace',
        primaryColor: profile?.primaryColor ?? null,
        accentColor: profile?.accentColor ?? null,
        hasLogo: !!logo,
      };
    });
  }

  /** Full branding context for generated documents (includes the logo bytes). */
  async getDocumentBranding(
    tx: Tx,
    tenantId: string,
    storageRead: (key: string) => Promise<{ body: Buffer; contentType: string } | null>,
  ): Promise<DocumentBranding> {
    const [tenant] = await tx
      .select({ name: tenants.name })
      .from(tenants)
      .where(eq(tenants.id, tenantId))
      .limit(1);
    const p = await this.loadProfile(tx, tenantId);
    const [logoRow] = await tx
      .select({ objectKey: tenantAssets.objectKey })
      .from(tenantAssets)
      .where(and(eq(tenantAssets.tenantId, tenantId), eq(tenantAssets.kind, 'logo')))
      .limit(1);
    const logo = logoRow ? await storageRead(logoRow.objectKey) : null;

    const businessName =
      p?.displayName?.trim() || p?.legalName?.trim() || tenant?.name || 'Workspace';
    const addressLines = [
      p?.addressLine,
      [p?.city, p?.region, p?.postalCode].filter(Boolean).join(', ') || null,
      p?.country,
    ].filter((x): x is string => !!x && x.trim().length > 0);
    const taxLine =
      p?.taxRegistrationNumber && p.taxRegistrationNumber.trim()
        ? `${p.taxRegistrationLabel?.trim() || 'Tax reg'}: ${p.taxRegistrationNumber.trim()}`
        : null;
    const contactLines = [
      p?.email && `Email: ${p.email}`,
      p?.phone && `Phone: ${p.phone}`,
      p?.website && p.website,
    ].filter((x): x is string => !!x);

    return {
      businessName,
      legalName: p?.legalName ?? null,
      addressLines,
      taxLine,
      contactLines,
      primaryColor: p?.primaryColor ?? null,
      documentFooter: p?.documentFooter ?? null,
      logo: logo && /^image\/(png|jpeg|webp)$/.test(logo.contentType) ? logo : null,
    };
  }

  // ---- helpers ------------------------------------------------

  async loadProfile(tx: Tx, tenantId: string): Promise<schema.TenantCompanyProfileRow | null> {
    const [row] = await tx
      .select()
      .from(tenantCompanyProfiles)
      .where(eq(tenantCompanyProfiles.tenantId, tenantId))
      .limit(1);
    return row ?? null;
  }

  private async assetKinds(tx: Tx, tenantId: string): Promise<Set<string>> {
    const rows = await tx
      .select({ kind: tenantAssets.kind })
      .from(tenantAssets)
      .where(eq(tenantAssets.tenantId, tenantId));
    return new Set(rows.map((r) => r.kind));
  }

  private toDto(
    workspaceName: string,
    p: schema.TenantCompanyProfileRow | null,
    kinds: Set<string>,
  ): CompanyProfileDto {
    return {
      workspaceName,
      legalName: p?.legalName ?? null,
      displayName: p?.displayName ?? null,
      email: p?.email ?? null,
      phone: p?.phone ?? null,
      website: p?.website ?? null,
      addressLine: p?.addressLine ?? null,
      city: p?.city ?? null,
      region: p?.region ?? null,
      country: p?.country ?? null,
      postalCode: p?.postalCode ?? null,
      taxRegistrationLabel: p?.taxRegistrationLabel ?? null,
      taxRegistrationNumber: p?.taxRegistrationNumber ?? null,
      documentFooter: p?.documentFooter ?? null,
      timezone: p?.timezone ?? null,
      defaultCurrency: p?.defaultCurrency ?? null,
      primaryColor: p?.primaryColor ?? null,
      accentColor: p?.accentColor ?? null,
      hasLogo: kinds.has('logo'),
      hasLightLogo: kinds.has('logo_light'),
      hasDarkLogo: kinds.has('logo_dark'),
      hasFavicon: kinds.has('favicon'),
      updatedAt: p?.updatedAt ? p.updatedAt.toISOString() : null,
    };
  }
}
