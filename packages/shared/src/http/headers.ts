/**
 * Cross-cutting HTTP header names shared by the API and the web client.
 * The correlation id ties a browser request to API logs, jobs and events
 * (ADR 0014 / docs/architecture/OBSERVABILITY.md).
 */
export const CORRELATION_ID_HEADER = 'x-correlation-id';

/** Prefix for generated correlation ids, e.g. `AIV-01J...`. */
export const CORRELATION_ID_PREFIX = 'AIV-';
