import { sql } from 'drizzle-orm';
import {
  check,
  foreignKey,
  index,
  integer,
  pgEnum,
  pgTable,
  text,
  timestamp,
  unique,
  uuid,
} from 'drizzle-orm/pg-core';
import { newUuidV7 } from '../id.js';
import { tenants, userTenantMemberships } from './identity.js';

/**
 * Tenant Company Profile, Branding & Onboarding (Phase 10, ADR 0039).
 *
 * White-label configuration that a tenant owns: their company identity, brand
 * colours, logos/favicon and document footer, plus a tiny onboarding-dismissal
 * flag. Built ON the existing platform — this does NOT create a second tenant
 * entity, it extends `tenants` with three tenant-owned 1:1/1:few tables. Binary
 * images live in the Phase 4 object storage (only an opaque key is stored
 * here). Branding affects the app shell, customer-facing documents and
 * notification-email presentation — never security, tenancy or permission
 * semantics.
 */

const entityTimestamps = {
  createdAt: timestamp('created_at', { withTimezone: true })
    .notNull()
    .default(sql`now()`),
  updatedAt: timestamp('updated_at', { withTimezone: true })
    .notNull()
    .default(sql`now()`)
    .$onUpdate(() => new Date()),
};

/** Which branded image slot an asset fills. */
export const tenantAssetKind = pgEnum('tenant_asset_kind', [
  'logo',
  'logo_light',
  'logo_dark',
  'favicon',
]);

const HEX_COLOR = sql`'^#[0-9a-fA-F]{6}$'`;

// --- tenant_company_profiles (1:1 with tenant) ----------------------

export const tenantCompanyProfiles = pgTable(
  'tenant_company_profiles',
  {
    id: uuid('id')
      .primaryKey()
      .$defaultFn(() => newUuidV7()),
    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenants.id, { onDelete: 'cascade' }),
    /** legal / registered company name */
    legalName: text('legal_name'),
    /** display / trading name shown in the app shell + documents */
    displayName: text('display_name'),
    email: text('email'),
    phone: text('phone'),
    website: text('website'),
    addressLine: text('address_line'),
    city: text('city'),
    region: text('region'),
    country: text('country'),
    postalCode: text('postal_code'),
    /** generic tax-registration label ("GST", "VAT", "Tax ID", …) — not India-specific */
    taxRegistrationLabel: text('tax_registration_label'),
    taxRegistrationNumber: text('tax_registration_number'),
    /** free text shown at the foot of every generated document */
    documentFooter: text('document_footer'),
    /** IANA timezone, e.g. `Asia/Kolkata` */
    timezone: text('timezone'),
    /** 3-letter ISO currency used as the tenant default where a currency is optional */
    defaultCurrency: text('default_currency'),
    /** validated hex, applied as a CSS token — never raw CSS */
    primaryColor: text('primary_color'),
    accentColor: text('accent_color'),
    updatedByMembershipId: uuid('updated_by_membership_id'),
    ...entityTimestamps,
  },
  (t) => [
    unique('tenant_company_profiles_tenant_uq').on(t.tenantId),
    check(
      'tenant_company_profiles_primary_hex',
      sql`"primary_color" is null or "primary_color" ~ ${HEX_COLOR}`,
    ),
    check(
      'tenant_company_profiles_accent_hex',
      sql`"accent_color" is null or "accent_color" ~ ${HEX_COLOR}`,
    ),
    check(
      'tenant_company_profiles_currency_iso',
      sql`"default_currency" is null or "default_currency" ~ '^[A-Z]{3}$'`,
    ),
    foreignKey({
      name: 'tenant_company_profiles_updated_by_fk',
      columns: [t.updatedByMembershipId, t.tenantId],
      foreignColumns: [userTenantMemberships.id, userTenantMemberships.tenantId],
    }).onDelete('set null'),
  ],
);

// --- tenant_assets (logos / favicon; bytes live in object storage) ---

export const tenantAssets = pgTable(
  'tenant_assets',
  {
    id: uuid('id')
      .primaryKey()
      .$defaultFn(() => newUuidV7()),
    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenants.id, { onDelete: 'cascade' }),
    kind: tenantAssetKind('kind').notNull(),
    /** opaque, tenant-namespaced object-storage key — never exposed to clients */
    objectKey: text('object_key').notNull(),
    contentType: text('content_type').notNull(),
    sizeBytes: integer('size_bytes').notNull(),
    width: integer('width'),
    height: integer('height'),
    originalFilename: text('original_filename'),
    uploadedByMembershipId: uuid('uploaded_by_membership_id'),
    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .default(sql`now()`),
    updatedAt: timestamp('updated_at', { withTimezone: true })
      .notNull()
      .default(sql`now()`)
      .$onUpdate(() => new Date()),
  },
  (t) => [
    unique('tenant_assets_tenant_kind_uq').on(t.tenantId, t.kind),
    unique('tenant_assets_object_key_uq').on(t.objectKey),
    index('tenant_assets_tenant_idx').on(t.tenantId),
    check('tenant_assets_size_pos', sql`"size_bytes" > 0`),
    foreignKey({
      name: 'tenant_assets_uploaded_by_fk',
      columns: [t.uploadedByMembershipId, t.tenantId],
      foreignColumns: [userTenantMemberships.id, userTenantMemberships.tenantId],
    }).onDelete('set null'),
  ],
);

// --- tenant_onboarding (dismissal only; steps are derived) -----------

/**
 * The onboarding checklist's *steps* are derived live from existing data
 * (member count, customer count, lead-source count, whether the company
 * profile + a logo exist) — no workflow engine, no arbitrary JSON. The only
 * persisted state is whether an admin has dismissed the checklist.
 */
export const tenantOnboarding = pgTable(
  'tenant_onboarding',
  {
    id: uuid('id')
      .primaryKey()
      .$defaultFn(() => newUuidV7()),
    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenants.id, { onDelete: 'cascade' }),
    dismissedAt: timestamp('dismissed_at', { withTimezone: true }),
    dismissedByMembershipId: uuid('dismissed_by_membership_id'),
    ...entityTimestamps,
  },
  (t) => [
    unique('tenant_onboarding_tenant_uq').on(t.tenantId),
    foreignKey({
      name: 'tenant_onboarding_dismissed_by_fk',
      columns: [t.dismissedByMembershipId, t.tenantId],
      foreignColumns: [userTenantMemberships.id, userTenantMemberships.tenantId],
    }).onDelete('set null'),
  ],
);

// --- row types --------------------------------------------------------

export type TenantCompanyProfileRow = typeof tenantCompanyProfiles.$inferSelect;
export type NewTenantCompanyProfileRow = typeof tenantCompanyProfiles.$inferInsert;
export type TenantAssetRow = typeof tenantAssets.$inferSelect;
export type NewTenantAssetRow = typeof tenantAssets.$inferInsert;
export type TenantOnboardingRow = typeof tenantOnboarding.$inferSelect;
export type NewTenantOnboardingRow = typeof tenantOnboarding.$inferInsert;
