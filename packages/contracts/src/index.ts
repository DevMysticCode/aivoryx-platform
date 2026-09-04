import type { components, operations, paths } from './generated/schema.js';

export type { paths, operations, components };

/** Convenience aliases for the response bodies used by the web client. */
export type HealthReport = components['schemas']['HealthReportDto'];
export type LivenessReport = components['schemas']['LivenessReportDto'];
export type DependencyHealth = components['schemas']['DependencyHealthDto'];

/**
 * The standard error envelope. Not part of the generated schema yet (no
 * endpoint documents a 4xx body in Phase 1); it mirrors `@aivoryx/shared`'s
 * `ErrorResponseBody`, which the API's exception filter produces.
 */
export type { ErrorResponseBody as ApiErrorResponse } from '@aivoryx/shared';

/** All versioned API routes are served under this prefix (ADR 0005). */
export const API_V1_PREFIX = '/api/v1';
