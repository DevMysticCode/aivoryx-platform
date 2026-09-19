import { randomUUID } from 'node:crypto';
import { Inject, Injectable, Logger } from '@nestjs/common';
import { eq } from 'drizzle-orm';
import { getDb, schema, withAppTransaction } from '@aivoryx/db';
import { AppError, deriveTheme, isThemePresetKey, resolveThemeColors } from '@aivoryx/shared';
import { OBJECT_STORAGE, type ObjectStorageService } from '../storage/object-storage.service.js';
import { getCorrelationId } from '../observability/correlation.js';
import {
  validateLogoFile,
  type LogoFileInput,
  type LogoShapeRules,
} from '../settings/tenant-logo.service.js';
import type {
  PlatformAssetKind,
  PlatformBrandingDto,
  PublicPlatformBrandingDto,
  UpdatePlatformBrandingDto,
} from './platform-branding.dto.js';

const { platformBranding, platformAssets } = schema;

export const DEFAULT_PLATFORM_NAME = 'Aivoryx';

/** Extra shape rules per platform asset kind, layered on the shared logo validator. */
const SHAPE_RULES: Partial<Record<PlatformAssetKind, LogoShapeRules>> = {
  pwa_192: { aspect: 'square', minSide: 192 },
  pwa_512: { aspect: 'square', minSide: 512 },
  apple_touch: { aspect: 'square', minSide: 180 },
  favicon: { aspect: 'squareish' },
  mark: { aspect: 'squareish' },
};

/**
 * Platform (Aivoryx-level) branding (Phase 20). GLOBAL singleton config +
 * assets, writable only by Platform Admins (enforced by `@PlatformAdmin()` on
 * the controller) and readable pre-auth through a minimal DTO. Uses its own
 * tables and the `platform/branding/…` object-key namespace; it never touches
 * `tenant_assets`.
 *
 * Audit: the audit log is tenant-scoped (`tenant_id` NOT NULL) and a global
 * setting has no tenant, so platform branding changes are recorded as a
 * structured, correlation-tagged log line plus `updated_by_user_id` on the row.
 */
@Injectable()
export class PlatformBrandingService {
  private readonly logger = new Logger('PlatformBranding');

  constructor(@Inject(OBJECT_STORAGE) private readonly storage: ObjectStorageService) {}

  private async load() {
    return withAppTransaction(getDb(), async (tx) => {
      const [row] = await tx.select().from(platformBranding).limit(1);
      const assets = await tx
        .select({ kind: platformAssets.kind, updatedAt: platformAssets.updatedAt })
        .from(platformAssets);
      return { row: row ?? null, assets };
    });
  }

  private versionOf(row: { updatedAt: Date } | null, assets: { updatedAt: Date }[]): string {
    const all = [row?.updatedAt, ...assets.map((a) => a.updatedAt)].filter((d): d is Date => !!d);
    return all.length ? String(Math.max(...all.map((d) => d.getTime()))) : '0';
  }

  async getAdmin(): Promise<PlatformBrandingDto> {
    const { row, assets } = await this.load();
    const kinds = new Set<string>(assets.map((a) => a.kind));
    return {
      platformName: row?.platformName ?? null,
      tagline: row?.tagline ?? null,
      themePreset: row?.themePreset ?? null,
      primaryColor: row?.primaryColor ?? null,
      secondaryColor: row?.secondaryColor ?? null,
      accentColor: row?.accentColor ?? null,
      loginHeading: row?.loginHeading ?? null,
      loginText: row?.loginText ?? null,
      hasLogoLight: kinds.has('logo_light'),
      hasLogoDark: kinds.has('logo_dark'),
      hasMark: kinds.has('mark'),
      hasFavicon: kinds.has('favicon'),
      hasLoginLogo: kinds.has('login_logo'),
      hasAppleTouch: kinds.has('apple_touch'),
      hasPwa192: kinds.has('pwa_192'),
      hasPwa512: kinds.has('pwa_512'),
      updatedAt: row?.updatedAt.toISOString() ?? null,
      version: this.versionOf(row, assets),
    };
  }

  async getPublic(): Promise<PublicPlatformBrandingDto> {
    const { row, assets } = await this.load();
    const kinds = new Set<string>(assets.map((a) => a.kind));
    return {
      name: row?.platformName?.trim() || DEFAULT_PLATFORM_NAME,
      tagline: row?.tagline ?? null,
      themePreset: row?.themePreset ?? null,
      primaryColor: row?.primaryColor ?? null,
      secondaryColor: row?.secondaryColor ?? null,
      accentColor: row?.accentColor ?? null,
      loginHeading: row?.loginHeading ?? null,
      loginText: row?.loginText ?? null,
      assets: {
        logoLight: kinds.has('logo_light'),
        logoDark: kinds.has('logo_dark'),
        mark: kinds.has('mark'),
        favicon: kinds.has('favicon'),
        loginLogo: kinds.has('login_logo'),
        appleTouch: kinds.has('apple_touch'),
        pwa192: kinds.has('pwa_192'),
        pwa512: kinds.has('pwa_512'),
      },
      version: this.versionOf(row, assets),
    };
  }

  async update(
    actorUserId: string,
    patch: UpdatePlatformBrandingDto,
  ): Promise<PlatformBrandingDto> {
    const changed: string[] = [];
    await withAppTransaction(getDb(), async (tx) => {
      const [before] = await tx.select().from(platformBranding).limit(1);
      const set: Partial<typeof platformBranding.$inferInsert> = {
        updatedByUserId: actorUserId,
      };
      for (const key of ['platformName', 'tagline', 'loginHeading', 'loginText'] as const) {
        const v = patch[key];
        if (v !== undefined) set[key] = v.trim() || null;
      }

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

      changed.push(...Object.keys(set).filter((k) => k !== 'updatedByUserId'));
      await tx
        .insert(platformBranding)
        .values({ singleton: true, ...set })
        .onConflictDoUpdate({
          target: platformBranding.singleton,
          set: { ...set, updatedAt: new Date() },
        });
    });
    this.auditLog('platform.branding.updated', actorUserId, { fields: changed });
    return this.getAdmin();
  }

  async uploadAsset(
    actorUserId: string,
    kind: PlatformAssetKind,
    file: LogoFileInput,
  ): Promise<PlatformBrandingDto> {
    const meta = validateLogoFile(file, SHAPE_RULES[kind]);
    const ext = meta.format === 'image/png' ? 'png' : meta.format === 'image/jpeg' ? 'jpg' : 'webp';
    const key = `platform/branding/${kind}/${randomUUID()}.${ext}`;

    const previousKey = await withAppTransaction(getDb(), async (tx) => {
      const [existing] = await tx
        .select({ objectKey: platformAssets.objectKey })
        .from(platformAssets)
        .where(eq(platformAssets.kind, kind))
        .limit(1);
      await this.storage.putObject({ key, body: file.buffer, contentType: meta.format });
      const values = {
        objectKey: key,
        contentType: meta.format,
        sizeBytes: file.buffer.length,
        width: meta.width,
        height: meta.height,
        originalFilename: file.originalFilename?.slice(0, 200) ?? null,
      };
      await tx
        .insert(platformAssets)
        .values({ kind, ...values })
        .onConflictDoUpdate({
          target: platformAssets.kind,
          set: { ...values, updatedAt: new Date() },
        });
      return existing?.objectKey ?? null;
    });
    // best-effort cleanup of the previous object (the DB row is authoritative)
    if (previousKey && previousKey !== key) {
      await this.storage.deleteObject(previousKey).catch(() => undefined);
    }
    this.auditLog('platform.branding.asset_updated', actorUserId, {
      kind,
      operation: previousKey ? 'replaced' : 'added',
      contentType: meta.format,
      width: meta.width,
      height: meta.height,
    });
    return this.getAdmin();
  }

  async removeAsset(actorUserId: string, kind: PlatformAssetKind): Promise<PlatformBrandingDto> {
    const key = await withAppTransaction(getDb(), async (tx) => {
      const [row] = await tx
        .select({ objectKey: platformAssets.objectKey })
        .from(platformAssets)
        .where(eq(platformAssets.kind, kind))
        .limit(1);
      if (!row) throw new AppError('PLATFORM_ASSET_NOT_FOUND', { details: { kind } });
      await tx.delete(platformAssets).where(eq(platformAssets.kind, kind));
      return row.objectKey;
    });
    await this.storage.deleteObject(key).catch(() => undefined);
    this.auditLog('platform.branding.asset_updated', actorUserId, { kind, operation: 'removed' });
    return this.getAdmin();
  }

  /** Public stream. Returns null (=> generic 404) when absent / not a safe image type. */
  async readAsset(kind: PlatformAssetKind): Promise<{ body: Buffer; contentType: string } | null> {
    const row = await withAppTransaction(getDb(), async (tx) => {
      const [r] = await tx
        .select({ objectKey: platformAssets.objectKey, contentType: platformAssets.contentType })
        .from(platformAssets)
        .where(eq(platformAssets.kind, kind))
        .limit(1);
      return r ?? null;
    });
    if (!row) return null;
    const obj = await this.storage.getObject(row.objectKey);
    const type = (obj?.contentType || row.contentType).toLowerCase();
    if (!obj || !/^image\/(png|jpeg|webp)$/.test(type)) return null;
    return { body: obj.body, contentType: type };
  }

  private auditLog(action: string, actorUserId: string, metadata: Record<string, unknown>) {
    this.logger.log(
      JSON.stringify({
        module: 'platform',
        action,
        actorUserId,
        correlationId: getCorrelationId() ?? null,
        ...metadata,
      }),
    );
  }
}
