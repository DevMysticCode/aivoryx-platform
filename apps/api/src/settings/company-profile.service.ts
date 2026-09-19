import { Injectable } from '@nestjs/common';
import { and, eq, inArray } from 'drizzle-orm';
import { getDb, schema, withTenantContext, type Tx } from '@aivoryx/db';
import {
  AppError,
  deriveTheme,
  documentAccent,
  isThemePresetKey,
  resolveThemeColors,
} from '@aivoryx/shared';
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
  /** print-safe accent (>= 4.5:1 on white) for rules / titles on documents */
  accentColor: string;
  /** tenant flag: may the customer's own logo appear on their documents */
  showCustomerLogo: boolean;
  documentFooter: string | null;
  /** the effective logo: the document-specific one when mode is `separate` and it exists */
  logo: { body: Buffer; contentType: string } | null;
}

/** Which asset kinds to try (in order) for a document logo. Pure - unit tested. */
export function documentLogoKinds(
  mode: string | null | undefined,
): Array<'logo_document' | 'logo'> {
  return mode === 'separate' ? ['logo_document', 'logo'] : ['logo'];
}

/** Print-safe document accent: the dedicated colour, else the primary, else the default. */
export function resolveDocumentAccent(
  documentAccentColor: string | null | undefined,
  primaryColor: string | null | undefined,
): string {
  return documentAccent(documentAccentColor ?? primaryColor);
}

const BRANDING_KEYS = [
  'themePreset',
  'primaryColor',
  'secondaryColor',
  'accentColor',
  'documentAccentColor',
  'documentLogoMode',
  'documentShowCustomerLogo',
  'loginWelcome',
  'loginDescription',
  'loginShowPoweredBy',
] as const;

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
      const before = await this.loadProfile(tx, scope.tenantId);

      const namedPreset =
        patch.themePreset !== undefined &&
        patch.themePreset !== 'custom' &&
        isThemePresetKey(patch.themePreset);
      if (namedPreset) {
        // a named preset defines the effective colours; stray hexes are ignored
        set.themePreset = patch.themePreset;
      } else {
        const hex = (v: string | undefined) => (v === undefined ? undefined : v.toLowerCase());
        const primary = hex(patch.primaryColor);
        const secondary = hex(patch.secondaryColor);
        const accent = hex(patch.accentColor);
        if (primary !== undefined) set.primaryColor = primary;
        if (secondary !== undefined) set.secondaryColor = secondary;
        if (accent !== undefined) set.accentColor = accent;
        if (patch.themePreset === 'custom' || primary !== undefined) {
          set.themePreset = 'custom';
          const derived = deriveTheme(
            resolveThemeColors({
              preset: 'custom',
              primary: primary ?? before?.primaryColor,
              secondary: secondary ?? before?.secondaryColor,
              accent: accent ?? before?.accentColor,
            }),
          );
          if (!derived.report.ok) {
            throw new AppError('BRANDING_COLOR_LOW_CONTRAST', {
              details: {
                suggestedPrimary: derived.report.suggestedPrimary,
                problems: derived.report.problems,
              },
            });
          }
        }
      }
      if (patch.documentAccentColor !== undefined) {
        set.documentAccentColor = patch.documentAccentColor.toLowerCase();
      }
      for (const key of ['loginWelcome', 'loginDescription'] as const) {
        if (patch[key] !== undefined) set[key] = patch[key].trim() || null;
      }
      if (patch.loginShowPoweredBy !== undefined) set.loginShowPoweredBy = patch.loginShowPoweredBy;
      if (patch.documentLogoMode !== undefined) set.documentLogoMode = patch.documentLogoMode;
      if (patch.documentShowCustomerLogo !== undefined) {
        set.documentShowCustomerLogo = patch.documentShowCustomerLogo;
      }

      await tx
        .insert(tenantCompanyProfiles)
        .values({ tenantId: scope.tenantId, ...set })
        .onConflictDoUpdate({
          target: tenantCompanyProfiles.tenantId,
          set: { ...set, updatedAt: new Date() },
        });

      const brandingFields = BRANDING_KEYS.filter((k) => k in set);
      const companyFields = Object.keys(set).filter(
        (k) => k !== 'updatedByMembershipId' && !(BRANDING_KEYS as readonly string[]).includes(k),
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
      const kinds = await this.assetKinds(tx, scope.tenantId);
      return {
        displayName: profile?.displayName?.trim() || tenant?.name || 'Workspace',
        themePreset: profile?.themePreset ?? null,
        primaryColor: profile?.primaryColor ?? null,
        secondaryColor: profile?.secondaryColor ?? null,
        accentColor: profile?.accentColor ?? null,
        hasLogo: kinds.has('logo'),
        hasLightLogo: kinds.has('logo_light'),
        hasDarkLogo: kinds.has('logo_dark'),
        hasCompactLogo: kinds.has('logo_compact'),
        hasLoginLogo: kinds.has('logo_login'),
        hasFavicon: kinds.has('favicon'),
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
    const wanted = documentLogoKinds(p?.documentLogoMode);
    const logoRows = await tx
      .select({ kind: tenantAssets.kind, objectKey: tenantAssets.objectKey })
      .from(tenantAssets)
      .where(and(eq(tenantAssets.tenantId, tenantId), inArray(tenantAssets.kind, wanted)));
    // first available kind in preference order (document logo, then company logo)
    const logoRow = wanted
      .map((k) => logoRows.find((r) => r.kind === k))
      .find((r) => r !== undefined);
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
      accentColor: resolveDocumentAccent(p?.documentAccentColor, p?.primaryColor),
      showCustomerLogo: p?.documentShowCustomerLogo ?? false,
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
      themePreset: p?.themePreset ?? null,
      secondaryColor: p?.secondaryColor ?? null,
      documentAccentColor: p?.documentAccentColor ?? null,
      documentLogoMode: p?.documentLogoMode ?? 'company',
      documentShowCustomerLogo: p?.documentShowCustomerLogo ?? false,
      loginWelcome: p?.loginWelcome ?? null,
      loginDescription: p?.loginDescription ?? null,
      loginShowPoweredBy: p?.loginShowPoweredBy ?? true,
      hasLogo: kinds.has('logo'),
      hasLightLogo: kinds.has('logo_light'),
      hasDarkLogo: kinds.has('logo_dark'),
      hasCompactLogo: kinds.has('logo_compact'),
      hasLoginLogo: kinds.has('logo_login'),
      hasDocumentLogo: kinds.has('logo_document'),
      hasFavicon: kinds.has('favicon'),
      updatedAt: p?.updatedAt ? p.updatedAt.toISOString() : null,
    };
  }
}
