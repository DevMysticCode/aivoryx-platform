import { AsyncLocalStorage } from 'node:async_hooks';

/**
 * Trusted server-side SYSTEM actor context (Phase 11, ADR 0040).
 *
 * Background work (the notification worker, scheduled sweeps, the outbox
 * dispatcher) has no authenticated membership. Wrapping that work in
 * `withSystemAuditActor('notification-worker', fn)` lets `AuditService.record`
 * attribute its audit rows to that subsystem without threading an actor through
 * every method.
 *
 * This is set ONLY here, in server code. No HTTP request path calls it, so a
 * client can never cause `actor_type = SYSTEM`.
 */
export interface SystemAuditActor {
  source: string;
}

const storage = new AsyncLocalStorage<SystemAuditActor>();

/** Known system actor sources — keep this small and stable. */
export type SystemActorSource =
  | 'system'
  | 'notification-worker'
  | 'integration-worker'
  | 'scheduled-job';

export function withSystemAuditActor<T>(source: SystemActorSource, fn: () => T): T {
  return storage.run({ source }, fn);
}

export function currentSystemAuditActor(): SystemAuditActor | undefined {
  return storage.getStore();
}
