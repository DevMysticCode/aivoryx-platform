import { Injectable, type NestMiddleware } from '@nestjs/common';
import type { NextFunction, Request, Response } from 'express';
import { CORRELATION_ID_HEADER } from '@aivoryx/shared';
import { normalizeCorrelationId, runWithCorrelationId } from './correlation.js';

/**
 * Assigns every request a correlation id (reusing a valid inbound
 * `x-correlation-id`), echoes it on the response, and runs the rest of the
 * request inside an AsyncLocalStorage context so logs, errors, jobs and events
 * can pick it up without threading it through every call (ADR 0014).
 *
 * Registered as a plain Express handler in `configure-app.ts` so it runs before
 * everything, including the exception filter.
 */
export function correlationRequestHandler(req: Request, res: Response, next: NextFunction): void {
  const header = req.headers[CORRELATION_ID_HEADER];
  const inbound = Array.isArray(header) ? header[0] : header;
  const correlationId = normalizeCorrelationId(inbound);

  res.setHeader(CORRELATION_ID_HEADER, correlationId);
  (req as Request & { correlationId?: string }).correlationId = correlationId;

  runWithCorrelationId(correlationId, () => next());
}

@Injectable()
export class CorrelationMiddleware implements NestMiddleware {
  use(req: Request, res: Response, next: NextFunction): void {
    correlationRequestHandler(req, res, next);
  }
}
