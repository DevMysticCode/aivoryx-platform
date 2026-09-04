import {
  type CallHandler,
  type ExecutionContext,
  Injectable,
  type NestInterceptor,
} from '@nestjs/common';
import type { Request } from 'express';
import { Observable } from 'rxjs';
import { runWithSecurityContext, type SecurityContext } from './security-context.js';

/**
 * Runs each handler inside the request's `SecurityContext` AsyncLocalStorage, so
 * deep services and log enrichment can call `getSecurityContext()` without it
 * being threaded through every signature. Controllers still get it explicitly
 * via the param decorators; this is the ambient fallback.
 */
@Injectable()
export class SecurityContextInterceptor implements NestInterceptor {
  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    const req = context
      .switchToHttp()
      .getRequest<Request & { securityContext?: SecurityContext }>();
    const sc = req.securityContext;
    if (!sc) return next.handle();

    return new Observable((subscriber) => {
      runWithSecurityContext(sc, () => {
        next.handle().subscribe({
          next: (value) => subscriber.next(value),
          error: (err: unknown) => subscriber.error(err),
          complete: () => subscriber.complete(),
        });
      });
    });
  }
}
