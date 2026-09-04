import { type ErrorCode, errorCodeMeta } from './error-codes.js';

export interface AppErrorOptions {
  /** Machine-readable detail for clients (safe to expose). */
  details?: Record<string, unknown>;
  /** Original error, kept for logging only — never serialized to clients. */
  cause?: unknown;
  /** Override the default HTTP status for the code. */
  httpStatus?: number;
  /** Override the default user-facing message for the code. */
  message?: string;
}

/**
 * The one error type the application throws on purpose. The API's exception
 * filter turns it into the standard error response; anything else becomes
 * `INTERNAL_ERROR` with the real cause logged but not exposed.
 */
export class AppError extends Error {
  readonly code: ErrorCode;
  readonly httpStatus: number;
  readonly details?: Record<string, unknown>;
  readonly expose = true;

  constructor(code: ErrorCode, options: AppErrorOptions = {}) {
    const meta = errorCodeMeta(code);
    super(options.message ?? meta.message, { cause: options.cause });
    this.name = 'AppError';
    this.code = code;
    this.httpStatus = options.httpStatus ?? meta.httpStatus;
    this.details = options.details;
    Object.setPrototypeOf(this, AppError.prototype);
  }

  static isAppError(value: unknown): value is AppError {
    return value instanceof AppError;
  }
}
