import {
  type ArgumentsHost,
  Catch,
  type ExceptionFilter,
  HttpException,
  HttpStatus,
  Logger,
} from '@nestjs/common';
import type { Request, Response } from 'express';
import { AppError, type ErrorCode, buildErrorResponse } from '@aivoryx/shared';
import { getCorrelationId } from '../observability/correlation.js';

/**
 * Single place where any thrown value becomes the standard error envelope
 * (CLAUDE.md §8/§9). Rules:
 *  - `AppError` -> its code + safe message + details
 *  - `HttpException` -> mapped to the closest stable code
 *  - anything else -> `INTERNAL_ERROR`, real cause logged, never exposed
 * Every response carries the correlation id the user can quote to support.
 */
@Catch()
export class AllExceptionsFilter implements ExceptionFilter {
  private readonly logger = new Logger('ExceptionFilter');

  catch(exception: unknown, host: ArgumentsHost): void {
    const ctx = host.switchToHttp();
    const res = ctx.getResponse<Response>();
    const req = ctx.getRequest<Request>();
    const correlationId = getCorrelationId() ?? 'AIV-UNKNOWN';

    const { status, code, message, details, logAsError, cause } = this.normalize(exception);

    const logPayload = {
      correlationId,
      method: req.method,
      path: req.originalUrl,
      status,
      code,
    };
    if (logAsError) {
      this.logger.error({ ...logPayload, err: cause ?? exception }, `Unhandled: ${code}`);
    } else {
      this.logger.warn(logPayload, `Handled: ${code}`);
    }

    res.status(status).json(buildErrorResponse({ code, correlationId, message, details }));
  }

  private normalize(exception: unknown): {
    status: number;
    code: ErrorCode;
    message?: string;
    details?: Record<string, unknown>;
    logAsError: boolean;
    cause?: unknown;
  } {
    if (AppError.isAppError(exception)) {
      return {
        status: exception.httpStatus,
        code: exception.code,
        message: exception.message,
        details: exception.details,
        logAsError: exception.httpStatus >= 500,
        cause: exception.cause,
      };
    }

    if (exception instanceof HttpException) {
      const status = exception.getStatus();
      const body = exception.getResponse();
      const details =
        typeof body === 'object' && body !== null ? (body as Record<string, unknown>) : undefined;
      return {
        status,
        code: this.mapHttpStatus(status),
        message: undefined,
        details:
          status === HttpStatus.BAD_REQUEST && details && 'message' in details
            ? { validation: details.message }
            : undefined,
        logAsError: status >= 500,
      };
    }

    // Client errors raised by Express middleware (body-parser: 413 entity.too.large, 400 parse
    // failures, ...) are `http-errors` objects: a 4xx `status` and `expose: true`. They are the
    // caller's mistake, not a server fault, so they keep their status instead of becoming a 500.
    const clientError = exception as { status?: unknown; statusCode?: unknown; expose?: unknown };
    const clientStatus =
      typeof clientError?.status === 'number' ? clientError.status : clientError?.statusCode;
    if (
      typeof clientStatus === 'number' &&
      clientStatus >= 400 &&
      clientStatus < 500 &&
      clientError.expose === true
    ) {
      return { status: clientStatus, code: this.mapHttpStatus(clientStatus), logAsError: false };
    }

    return {
      status: HttpStatus.INTERNAL_SERVER_ERROR,
      code: 'INTERNAL_ERROR',
      logAsError: true,
      cause: exception,
    };
  }

  private mapHttpStatus(status: number): ErrorCode {
    const table: Record<number, ErrorCode> = {
      400: 'VALIDATION_ERROR',
      401: 'AUTH_UNAUTHENTICATED',
      403: 'AUTH_FORBIDDEN',
      404: 'NOT_FOUND',
      405: 'METHOD_NOT_ALLOWED',
      413: 'PAYLOAD_TOO_LARGE',
      429: 'RATE_LIMITED',
      503: 'SERVICE_UNAVAILABLE',
    };
    const mapped = table[status];
    if (mapped) return mapped;
    return status >= 500 ? 'INTERNAL_ERROR' : 'VALIDATION_ERROR';
  }
}
