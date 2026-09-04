import { AsyncLocalStorage } from 'node:async_hooks';
import { ulid } from 'ulid';
import { CORRELATION_ID_PREFIX } from '@aivoryx/shared';

interface CorrelationStore {
  correlationId: string;
}

const storage = new AsyncLocalStorage<CorrelationStore>();

/** Create a new correlation id, e.g. `AIV-01J9Z8...` (ADR 0014). */
export function newCorrelationId(): string {
  return `${CORRELATION_ID_PREFIX}${ulid()}`;
}

/** Accept an inbound id only if it looks like one of ours; otherwise mint one. */
export function normalizeCorrelationId(inbound: string | undefined): string {
  if (inbound && /^AIV-[0-9A-HJKMNP-TV-Z]{26}$/i.test(inbound)) {
    return inbound;
  }
  return newCorrelationId();
}

export function runWithCorrelationId<T>(correlationId: string, fn: () => T): T {
  return storage.run({ correlationId }, fn);
}

/** The current request/job correlation id, or `undefined` outside a context. */
export function getCorrelationId(): string | undefined {
  return storage.getStore()?.correlationId;
}
