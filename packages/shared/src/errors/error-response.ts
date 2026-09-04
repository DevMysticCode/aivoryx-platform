import { type ErrorCode, errorCodeMeta } from './error-codes.js';

/**
 * The single JSON error envelope every `/api/v1` endpoint returns on failure
 * (CLAUDE.md §8/§9). Never leak stack traces or internal messages here.
 */
export interface ErrorResponseBody {
  error: {
    /** stable machine-readable code, e.g. `VALIDATION_ERROR` */
    code: ErrorCode;
    /** safe, user-facing sentence */
    message: string;
    /** correlation id the user can quote to support, e.g. `AIV-01J...` */
    correlationId: string;
    /** optional structured, safe-to-expose detail (e.g. field errors) */
    details?: Record<string, unknown>;
  };
}

export function buildErrorResponse(params: {
  code: ErrorCode;
  correlationId: string;
  message?: string;
  details?: Record<string, unknown>;
}): ErrorResponseBody {
  return {
    error: {
      code: params.code,
      message: params.message ?? errorCodeMeta(params.code).message,
      correlationId: params.correlationId,
      ...(params.details ? { details: params.details } : {}),
    },
  };
}
