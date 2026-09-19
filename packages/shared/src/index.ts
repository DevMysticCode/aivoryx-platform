export { CORRELATION_ID_HEADER, CORRELATION_ID_PREFIX } from './http/headers.js';
export { ERROR_CODES, type ErrorCode, errorCodeMeta, isErrorCode } from './errors/error-codes.js';
export { AppError, type AppErrorOptions } from './errors/app-error.js';
export { buildErrorResponse, type ErrorResponseBody } from './errors/error-response.js';
export {
  PERMISSION_DEFINITIONS,
  PERMISSION_KEYS,
  PLATFORM_ROLE_KEYS,
  isPermissionKey,
  describePermission,
  type PermissionDefinition,
  type PermissionDescriptor,
  type PermissionKey,
  type PlatformRoleKey,
} from './security/permissions.js';
export {
  MODULE_DEFINITIONS,
  MODULE_KEYS,
  getModule,
  isModuleKey,
  moduleForPermission,
  permissionsForModule,
  moduleDependencyClosure,
  modulesDependingOn,
  validateEnable,
  validateDisable,
  type ModuleKey,
  type ModuleCategory,
  type ModuleDefinition,
  type EntitlementValidationResult,
  type DisableValidationResult,
} from './modules/catalogue.js';
export {
  TENANT_STATUSES,
  isTenantStatus,
  canTransitionTenantStatus,
  nextTenantStatuses,
  type TenantStatus,
} from './tenancy/lifecycle.js';
export {
  SOLUTION_DEFINITIONS,
  isSolutionKey,
  getSolution,
  validateModuleSet,
  type SolutionDefinition,
  type SolutionKey,
  type ModuleSetValidationResult,
} from './tenancy/solutions.js';
export {
  PLAN_DEFINITIONS,
  isPlanKey,
  getPlan,
  assertPlanCatalogueConsistent,
  type PlanDefinition,
  type PlanKey,
} from './tenancy/plans.js';
export {
  THEME_PRESET_KEYS,
  THEME_PRESETS,
  AIVORYX_BRAND,
  MIN_TEXT_CONTRAST,
  MAX_LIGHT_SHIFT,
  isThemePresetKey,
  getThemePreset,
  resolveThemeColors,
  deriveTheme,
  buildThemeCss,
  documentAccent,
  contrastRatio,
  isHexColor,
  type ThemePresetKey,
  type ThemePreset,
  type ThemeColors,
  type ThemeReport,
  type DerivedTheme,
  type ModeTokens,
} from './theme/index.js';
export {
  DEFAULT_PLATFORM_NAME,
  hasTheme,
  resolveBranding,
  type AssetRef,
  type BrandSource,
  type LogoVariant,
  type PlatformBrandingLike,
  type ResolvedBranding,
  type Surface,
  type TenantBrandingLike,
} from './branding/resolve.js';
