import { describe, expect, it } from 'vitest';
import { AppError } from './app-error.js';
import { buildErrorResponse } from './error-response.js';
import { errorCodeMeta, isErrorCode } from './error-codes.js';

describe('error infrastructure', () => {
  it('maps a code to its default status and message', () => {
    const err = new AppError('NOT_FOUND');
    expect(err.httpStatus).toBe(404);
    expect(err.message).toBe(errorCodeMeta('NOT_FOUND').message);
    expect(AppError.isAppError(err)).toBe(true);
  });

  it('allows overriding status and message', () => {
    const err = new AppError('VALIDATION_ERROR', {
      message: 'Email is required',
      details: { field: 'email' },
    });
    expect(err.code).toBe('VALIDATION_ERROR');
    expect(err.message).toBe('Email is required');
    expect(err.details).toEqual({ field: 'email' });
  });

  it('builds the standard error envelope', () => {
    const body = buildErrorResponse({
      code: 'AUTH_FORBIDDEN',
      correlationId: 'AIV-TEST',
      details: { permission: 'crm.lead.read' },
    });
    expect(body).toEqual({
      error: {
        code: 'AUTH_FORBIDDEN',
        message: errorCodeMeta('AUTH_FORBIDDEN').message,
        correlationId: 'AIV-TEST',
        details: { permission: 'crm.lead.read' },
      },
    });
  });

  it('recognises known codes only', () => {
    expect(isErrorCode('NOT_FOUND')).toBe(true);
    expect(isErrorCode('NOPE')).toBe(false);
  });

  it('carries the Phase 2 auth/tenancy codes with the right statuses', () => {
    expect(errorCodeMeta('AUTH_UNAUTHENTICATED').httpStatus).toBe(401);
    expect(errorCodeMeta('AUTH_INVALID_CREDENTIALS').httpStatus).toBe(401);
    expect(errorCodeMeta('AUTH_SESSION_EXPIRED').httpStatus).toBe(401);
    expect(errorCodeMeta('AUTH_SESSION_REVOKED').httpStatus).toBe(401);
    expect(errorCodeMeta('AUTH_FORBIDDEN').httpStatus).toBe(403);
    expect(errorCodeMeta('AUTH_NO_ACTIVE_TENANT').httpStatus).toBe(403);
    expect(errorCodeMeta('AUTH_MEMBERSHIP_INVALID').httpStatus).toBe(403);
    expect(errorCodeMeta('AUTH_MEMBERSHIP_SUSPENDED').httpStatus).toBe(403);
    expect(errorCodeMeta('TENANT_SUSPENDED').httpStatus).toBe(403);
  });

  it('gives the same response for unknown user and wrong password (no enumeration)', () => {
    // one code, one message — the login flow uses it for both cases
    expect(errorCodeMeta('AUTH_INVALID_CREDENTIALS').message).not.toMatch(/user|account|exist/i);
  });
});
