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
});
