import { describe, expect, it } from 'vitest';
import { AppError } from '@aivoryx/shared';
import { EmailSendError } from './email/email-provider.js';
import { classifyFailure, failureCodeFor, shouldRetry } from './retry.js';

describe('delivery retry classification', () => {
  it('treats an explicitly retryable provider error as transient', () => {
    expect(classifyFailure(new EmailSendError('temp', true))).toBe('transient');
  });

  it('treats an explicitly non-retryable provider error as permanent', () => {
    expect(classifyFailure(new EmailSendError('bounce', false, 'EMAIL_BOUNCED'))).toBe('permanent');
  });

  it('treats template / channel / provider-config AppErrors as permanent', () => {
    expect(classifyFailure(new AppError('NOTIFICATION_TEMPLATE_INVALID'))).toBe('permanent');
    expect(classifyFailure(new AppError('NOTIFICATION_CHANNEL_UNAVAILABLE'))).toBe('permanent');
    expect(classifyFailure(new AppError('EMAIL_PROVIDER_NOT_CONFIGURED'))).toBe('permanent');
  });

  it('treats socket errors as transient', () => {
    expect(classifyFailure({ code: 'ETIMEDOUT' })).toBe('transient');
    expect(classifyFailure({ code: 'ECONNRESET' })).toBe('transient');
  });

  it('defaults unknown errors to transient (retry within the cap, never drop silently)', () => {
    expect(classifyFailure(new Error('mystery'))).toBe('transient');
  });

  it('shouldRetry respects the attempt budget and only retries transient failures', () => {
    expect(shouldRetry(1, 5, 'transient')).toBe(true);
    expect(shouldRetry(5, 5, 'transient')).toBe(false);
    expect(shouldRetry(1, 5, 'permanent')).toBe(false);
  });

  it('derives a short, safe failure code', () => {
    expect(failureCodeFor(new AppError('NOTIFICATION_TEMPLATE_INVALID'))).toBe(
      'NOTIFICATION_TEMPLATE_INVALID',
    );
    expect(failureCodeFor(new EmailSendError('x', true, 'EMAIL_PROVIDER_TEMPORARY'))).toBe(
      'EMAIL_PROVIDER_TEMPORARY',
    );
    expect(failureCodeFor({})).toBe('DELIVERY_ERROR');
  });
});
