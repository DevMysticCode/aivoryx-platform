import { AsyncLocalStorage } from 'node:async_hooks';
import type { NextFunction, Request, Response } from 'express';

/**
 * Safe, non-secret request metadata for the current HTTP request (Phase 11,
 * ADR 0040) — the client IP, the user-agent string and the request id. Deep
 * services (e.g. the audit log) read it without threading it through every
 * call, the same pattern as the correlation id.
 *
 * ONLY these three fields are captured. Authorization headers, cookies and
 * bodies never enter this store.
 */
export interface RequestMeta {
  ip: string | null;
  userAgent: string | null;
  requestId: string | null;
}

const storage = new AsyncLocalStorage<RequestMeta>();

const MAX_UA = 512;

export function requestMetaRequestHandler(req: Request, res: Response, next: NextFunction): void {
  const ua = req.headers['user-agent'];
  const tagged = req as Request & { id?: string; correlationId?: string };
  const meta: RequestMeta = {
    ip: typeof req.ip === 'string' && req.ip.length > 0 ? req.ip : null,
    userAgent: typeof ua === 'string' && ua.length > 0 ? ua.slice(0, MAX_UA) : null,
    // In this platform the pino request id and the correlation id are the same
    // value; `correlationRequestHandler` runs before this and sets it.
    requestId: tagged.id ?? tagged.correlationId ?? null,
  };
  storage.run(meta, () => next());
}

/** The current request's safe metadata, or `undefined` outside an HTTP request. */
export function getRequestMeta(): RequestMeta | undefined {
  return storage.getStore();
}

/** Bind request metadata for a synthetic scope (tests, background bridges). */
export function runWithRequestMeta<T>(meta: RequestMeta, fn: () => T): T {
  return storage.run(meta, fn);
}
