/**
 * Stable, machine-readable error codes (ADR 0014, CLAUDE.md §8/§9).
 *
 * Rules:
 *  - codes are `SCREAMING_SNAKE_CASE`, prefixed by area
 *  - a code never changes meaning once shipped
 *  - every code maps to an HTTP status and a safe, user-facing message
 *  - business/domain codes are added by their module in later phases; this
 *    registry only holds the platform-foundation codes.
 */
export const ERROR_CODES = {
  // generic
  INTERNAL_ERROR: {
    httpStatus: 500,
    message: 'Something went wrong on our side. The team has been notified.',
  },
  VALIDATION_ERROR: {
    httpStatus: 400,
    message: 'The request contains invalid or missing fields.',
  },
  NOT_FOUND: {
    httpStatus: 404,
    message: 'The requested resource was not found.',
  },
  METHOD_NOT_ALLOWED: {
    httpStatus: 405,
    message: 'That action is not supported on this resource.',
  },
  RATE_LIMITED: {
    httpStatus: 429,
    message: 'Too many requests. Please slow down and try again shortly.',
  },
  SERVICE_UNAVAILABLE: {
    httpStatus: 503,
    message: 'A dependency is temporarily unavailable. Please try again shortly.',
  },

  // auth & tenancy (Phase 2 Task 2 — security boundary)
  AUTH_UNAUTHENTICATED: {
    httpStatus: 401,
    message: 'You need to sign in to continue.',
  },
  AUTH_INVALID_CREDENTIALS: {
    // Same code + message for "unknown user" and "wrong password" — no account enumeration.
    httpStatus: 401,
    message: 'The email or password is incorrect.',
  },
  AUTH_SESSION_EXPIRED: {
    httpStatus: 401,
    message: 'Your session has expired. Please sign in again.',
  },
  AUTH_SESSION_REVOKED: {
    httpStatus: 401,
    message: 'Your session is no longer valid. Please sign in again.',
  },
  AUTH_FORBIDDEN: {
    httpStatus: 403,
    message: 'You do not have permission to perform this action.',
  },
  AUTH_NO_ACTIVE_TENANT: {
    httpStatus: 403,
    message: 'Select a workspace to continue.',
  },
  AUTH_MEMBERSHIP_INVALID: {
    // "not found" and "belongs to another user" collapse to one response — no id probing.
    httpStatus: 403,
    message: 'That workspace is not available to you.',
  },
  AUTH_MEMBERSHIP_SUSPENDED: {
    httpStatus: 403,
    message: 'Your access to that workspace is suspended.',
  },
  TENANT_SUSPENDED: {
    httpStatus: 403,
    message: 'This workspace is suspended.',
  },

  // tenant administration & user lifecycle (Phase 2 Task 3 — ADR 0030)
  MEMBER_NOT_FOUND: {
    httpStatus: 404,
    message: 'That member was not found in this workspace.',
  },
  MEMBER_ALREADY_EXISTS: {
    httpStatus: 409,
    message: 'That person is already a member of this workspace.',
  },
  ROLE_NOT_FOUND: {
    httpStatus: 404,
    message: 'That role does not exist in this workspace.',
  },
  TENANT_LAST_ADMIN: {
    // guards against removing / suspending / de-admining the final usable TENANT_ADMIN
    httpStatus: 409,
    message: 'A workspace must keep at least one active administrator.',
  },
  INVITATION_INVALID: {
    // unknown token, or a token not bound to the membership/tenant it claims
    httpStatus: 400,
    message: 'This invitation link is not valid.',
  },
  INVITATION_EXPIRED: {
    httpStatus: 410,
    message: 'This invitation has expired.',
  },
  INVITATION_REVOKED: {
    httpStatus: 410,
    message: 'This invitation has been revoked.',
  },
  INVITATION_ALREADY_USED: {
    httpStatus: 409,
    message: 'This invitation has already been used.',
  },
  INVITATION_PASSWORD_REQUIRED: {
    httpStatus: 400,
    message: 'Choose a password to finish setting up your account.',
  },

  // CRM core — leads, activities, follow-ups, custom fields (Phase 3, ADR 0031)
  LEAD_NOT_FOUND: {
    httpStatus: 404,
    message: 'That lead was not found in this workspace.',
  },
  LEAD_INVALID_TRANSITION: {
    httpStatus: 409,
    message: 'That status change is not allowed from the lead’s current status.',
  },
  LEAD_ASSIGNEE_INVALID: {
    httpStatus: 400,
    message: 'That person is not a member of this workspace and cannot be assigned this lead.',
  },
  NOTE_NOT_FOUND: {
    httpStatus: 404,
    message: 'That note was not found on this lead.',
  },
  NOTE_FORBIDDEN: {
    httpStatus: 403,
    message: 'You can only edit or delete your own notes.',
  },
  FOLLOWUP_NOT_FOUND: {
    httpStatus: 404,
    message: 'That follow-up was not found on this lead.',
  },
  FOLLOWUP_ALREADY_COMPLETED: {
    httpStatus: 409,
    message: 'That follow-up has already been completed.',
  },
  CUSTOM_FIELD_NOT_FOUND: {
    httpStatus: 404,
    message: 'That custom field does not exist in this workspace.',
  },
  CUSTOM_FIELD_INVALID_VALUE: {
    httpStatus: 400,
    message: 'That value is not valid for this custom field.',
  },

  // inbound integration engine — Pabbly connector (Phase 3, ADR 0032)
  SOURCE_NOT_FOUND: {
    httpStatus: 404,
    message: 'That lead source was not found in this workspace.',
  },
  CONNECTOR_INVALID: {
    // unknown secret, or a secret/URL source-key mismatch — no enumeration detail
    httpStatus: 401,
    message: 'This connector credential is not valid.',
  },
  CONNECTOR_REVOKED: {
    httpStatus: 401,
    message: 'This connector has been revoked.',
  },
  EVENT_NOT_FOUND: {
    httpStatus: 404,
    message: 'That inbound event was not found in this workspace.',
  },
  EVENT_NOT_REPLAYABLE: {
    httpStatus: 409,
    message: 'That event is not in a state that can be replayed.',
  },

  // field operations — visits, GPS, survey, attachments (Phase 4, ADR 0033)
  FIELD_AGENT_NOT_FOUND: {
    httpStatus: 404,
    message: 'That person is not a field agent in this workspace.',
  },
  FIELD_AGENT_INACTIVE: {
    httpStatus: 409,
    message: 'That field agent is not currently active.',
  },
  VISIT_NOT_FOUND: {
    httpStatus: 404,
    message: 'That visit was not found in this workspace.',
  },
  VISIT_INVALID_TRANSITION: {
    httpStatus: 409,
    message: 'That status change is not allowed from the visit’s current status.',
  },
  VISIT_NOT_ASSIGNED_TO_YOU: {
    httpStatus: 403,
    message: 'This visit is not assigned to you.',
  },
  VISIT_ALREADY_CHECKED_IN: {
    httpStatus: 409,
    message: 'This visit has already been checked in.',
  },
  VISIT_NOT_CHECKED_IN: {
    httpStatus: 409,
    message: 'Check in before checking out of this visit.',
  },
  VISIT_ALREADY_CHECKED_OUT: {
    httpStatus: 409,
    message: 'This visit has already been checked out.',
  },
  VISIT_INCOMPLETE: {
    httpStatus: 409,
    message:
      'This visit cannot be completed yet — finish check-in, the required survey fields, and check-out first.',
  },
  VISIT_LOCATION_REQUIRED: {
    httpStatus: 400,
    message: 'Location could not be captured. Enable location access and try again.',
  },
  ATTACHMENT_NOT_FOUND: {
    httpStatus: 404,
    message: 'That attachment was not found on this visit.',
  },
  ATTACHMENT_INVALID: {
    httpStatus: 400,
    message: 'That file could not be uploaded.',
  },

  // health / infra
  HEALTHCHECK_FAILED: {
    httpStatus: 503,
    message: 'A health check failed.',
  },
} as const;

export type ErrorCode = keyof typeof ERROR_CODES;

export function errorCodeMeta(code: ErrorCode): { httpStatus: number; message: string } {
  return ERROR_CODES[code];
}

export function isErrorCode(value: unknown): value is ErrorCode {
  return typeof value === 'string' && value in ERROR_CODES;
}
