import { AppError } from '@aivoryx/shared';

/**
 * Retry classification (ADR 0037). Transient failures are retried by BullMQ
 * with exponential backoff up to `maxAttempts`; permanent failures short-circuit
 * straight to `FAILED`. Nothing retries forever.
 */

export type DeliveryFailureClass = 'transient' | 'permanent';

/** Providers may tag a thrown error explicitly. */
export interface ClassifiableError {
  retryable?: boolean;
  code?: string;
}

const PERMANENT_APP_ERROR_CODES = new Set([
  'NOTIFICATION_TEMPLATE_INVALID',
  'NOTIFICATION_CHANNEL_UNAVAILABLE',
  'EMAIL_PROVIDER_NOT_CONFIGURED',
]);

/** Network / socket errors worth another attempt. */
const TRANSIENT_SYSCALL_CODES = new Set([
  'ETIMEDOUT',
  'ECONNRESET',
  'ECONNREFUSED',
  'EAI_AGAIN',
  'ENOTFOUND',
  'EPIPE',
  'ESOCKETTIMEDOUT',
]);

export function classifyFailure(err: unknown): DeliveryFailureClass {
  if (err instanceof AppError) {
    return PERMANENT_APP_ERROR_CODES.has(err.code) ? 'permanent' : 'transient';
  }
  const e = err as ClassifiableError | undefined;
  if (e && typeof e.retryable === 'boolean') {
    return e.retryable ? 'transient' : 'permanent';
  }
  if (e && typeof e.code === 'string' && TRANSIENT_SYSCALL_CODES.has(e.code)) {
    return 'transient';
  }
  // Unknown provider errors: retry within the cap rather than dropping silently.
  return 'transient';
}

/** Whether another attempt should be made given the current attempt count. */
export function shouldRetry(
  attempts: number,
  maxAttempts: number,
  failureClass: DeliveryFailureClass,
): boolean {
  return failureClass === 'transient' && attempts < maxAttempts;
}

/** A short, safe failure code for the delivery record (never the raw message). */
export function failureCodeFor(err: unknown): string {
  if (err instanceof AppError) return err.code;
  const e = err as ClassifiableError | undefined;
  if (e && typeof e.code === 'string') return e.code.slice(0, 64);
  return 'DELIVERY_ERROR';
}
