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
