import type { components, operations, paths } from './generated/schema.js';

export type { paths, operations, components };

/** Convenience aliases for the response bodies used by the web client. */
export type HealthReport = components['schemas']['HealthReportDto'];
export type LivenessReport = components['schemas']['LivenessReportDto'];
export type DependencyHealth = components['schemas']['DependencyHealthDto'];

// Phase 2 — security boundary (auth / session / tenant / admin).
export type LoginRequest = components['schemas']['LoginRequestDto'];
export type LoginResponse = components['schemas']['LoginResponseDto'];
export type MeResponse = components['schemas']['MeResponseDto'];
export type SwitchTenantRequest = components['schemas']['SwitchTenantRequestDto'];
export type SwitchTenantResponse = components['schemas']['SwitchTenantResponseDto'];
export type LogoutResponse = components['schemas']['LogoutResponseDto'];
export type MembershipSummary = components['schemas']['MembershipSummaryDto'];
export type ActiveContext = components['schemas']['ActiveContextDto'];
export type AuthUser = components['schemas']['AuthUserDto'];
export type AdminMembership = components['schemas']['AdminMembershipDto'];
export type AdminRole = components['schemas']['AdminRoleDto'];
export type CataloguePermission = components['schemas']['CataloguePermissionDto'];

/**
 * The standard error envelope returned by every `/api/v1` endpoint on failure.
 * It is documented on the auth/admin operations (`ApiErrorDto`) and mirrors
 * `@aivoryx/shared`'s `ErrorResponseBody`, which the API's exception filter
 * produces.
 */
export type ApiError = components['schemas']['ApiErrorDto'];
export type { ErrorResponseBody as ApiErrorResponse } from '@aivoryx/shared';

/** All versioned API routes are served under this prefix (ADR 0005). */
export const API_V1_PREFIX = '/api/v1';
