export { CORRELATION_ID_HEADER, CORRELATION_ID_PREFIX } from './http/headers.js';
export { ERROR_CODES, type ErrorCode, errorCodeMeta, isErrorCode } from './errors/error-codes.js';
export { AppError, type AppErrorOptions } from './errors/app-error.js';
export { buildErrorResponse, type ErrorResponseBody } from './errors/error-response.js';
export {
  PERMISSION_DEFINITIONS,
  PERMISSION_KEYS,
  PLATFORM_ROLE_KEYS,
  isPermissionKey,
  type PermissionDefinition,
  type PermissionKey,
  type PlatformRoleKey,
} from './security/permissions.js';
