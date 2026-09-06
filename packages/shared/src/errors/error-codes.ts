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

  // procurement, inventory & logistics (Phase 5, ADR 0034)
  PROJECT_NOT_FOUND: {
    httpStatus: 404,
    message: 'That project was not found in this workspace.',
  },
  PROJECT_INVALID_TRANSITION: {
    httpStatus: 409,
    message: 'That status change is not allowed from the project’s current status.',
  },
  PROJECT_MATERIAL_NOT_FOUND: {
    httpStatus: 404,
    message: 'That material line was not found on this project.',
  },
  PRODUCT_NOT_FOUND: {
    httpStatus: 404,
    message: 'That product was not found in this workspace.',
  },
  PRODUCT_IN_USE: {
    httpStatus: 409,
    message: 'That product is referenced elsewhere and cannot be removed.',
  },
  SUPPLIER_NOT_FOUND: {
    httpStatus: 404,
    message: 'That supplier was not found in this workspace.',
  },
  WAREHOUSE_NOT_FOUND: {
    httpStatus: 404,
    message: 'That warehouse was not found in this workspace.',
  },
  UNIT_NOT_FOUND: {
    httpStatus: 404,
    message: 'That unit of measure was not found in this workspace.',
  },
  CATEGORY_NOT_FOUND: {
    httpStatus: 404,
    message: 'That product category was not found in this workspace.',
  },
  DUPLICATE_CODE: {
    httpStatus: 409,
    message: 'That code is already in use in this workspace.',
  },
  INSUFFICIENT_STOCK: {
    httpStatus: 409,
    message: 'There is not enough available stock for this operation.',
  },
  NEGATIVE_STOCK_NOT_ALLOWED: {
    httpStatus: 409,
    message: 'This operation would drive stock negative, which is not permitted.',
  },
  TRANSFER_SAME_WAREHOUSE: {
    httpStatus: 400,
    message: 'A stock transfer needs a different source and destination warehouse.',
  },
  PO_NOT_FOUND: {
    httpStatus: 404,
    message: 'That purchase order was not found in this workspace.',
  },
  PO_INVALID_TRANSITION: {
    httpStatus: 409,
    message: 'That action is not allowed from the purchase order’s current status.',
  },
  PO_OVER_RECEIPT: {
    httpStatus: 409,
    message: 'The received quantity exceeds what was ordered on this line.',
  },
  PO_NOT_APPROVED: {
    httpStatus: 409,
    message: 'The purchase order must be approved before goods can be received.',
  },
  GOODS_RECEIPT_NOT_FOUND: {
    httpStatus: 404,
    message: 'That goods receipt was not found in this workspace.',
  },
  ALLOCATION_EXCEEDS_REQUIREMENT: {
    httpStatus: 409,
    message: 'The allocation exceeds the remaining requirement for this project material.',
  },
  ALLOCATION_EXCEEDS_AVAILABLE_STOCK: {
    httpStatus: 409,
    message: 'The allocation exceeds the available stock in that warehouse.',
  },
  RELEASE_EXCEEDS_ALLOCATED: {
    httpStatus: 409,
    message: 'The release exceeds the quantity currently allocated.',
  },
  DISPATCH_NOT_FOUND: {
    httpStatus: 404,
    message: 'That dispatch was not found in this workspace.',
  },
  DISPATCH_INVALID_STATE: {
    httpStatus: 409,
    message: 'That action is not allowed from the dispatch’s current status.',
  },
  DISPATCH_EXCEEDS_ALLOCATED: {
    httpStatus: 409,
    message: 'The dispatch quantity exceeds the allocated-and-not-yet-dispatched quantity.',
  },
  DELIVERY_INVALID_STATE: {
    httpStatus: 409,
    message: 'Delivery can only be confirmed for a dispatch that has been sent out.',
  },
  DELIVERY_EXCEEDS_DISPATCHED: {
    httpStatus: 409,
    message: 'The delivered quantity exceeds the quantity dispatched.',
  },
  // `ATTACHMENT_NOT_FOUND` / `ATTACHMENT_INVALID` are shared with Phase 4 (above).

  // commercial — customers, quotations & booking (Phase 6, ADR 0035)
  CUSTOMER_NOT_FOUND: {
    httpStatus: 404,
    message: 'That customer was not found in this workspace.',
  },
  QUOTATION_NOT_FOUND: {
    httpStatus: 404,
    message: 'That quotation was not found in this workspace.',
  },
  QUOTATION_INVALID_TRANSITION: {
    httpStatus: 409,
    message: 'That action is not allowed from the quotation’s current status.',
  },
  QUOTATION_IMMUTABLE: {
    httpStatus: 409,
    message:
      'This quotation revision is finalized and can no longer be edited. Create a new revision instead.',
  },
  QUOTATION_REVISION_REQUIRED: {
    httpStatus: 409,
    message: 'A new revision must be created before this quotation can be changed.',
  },
  QUOTATION_NO_LINES: {
    httpStatus: 409,
    message: 'A quotation needs at least one line item before it can be sent.',
  },
  QUOTATION_EXPIRED: {
    httpStatus: 409,
    message: 'This quotation has passed its validity date and can no longer be accepted.',
  },
  QUOTATION_NOT_ACCEPTED: {
    httpStatus: 409,
    message: 'The quotation must be accepted before it can be booked.',
  },
  QUOTATION_ALREADY_BOOKED: {
    httpStatus: 409,
    message: 'This quotation has already been booked.',
  },
  BOOKING_CONFLICT: {
    httpStatus: 409,
    message: 'The project for this booking is not in a state that can be activated.',
  },

  // EPC project execution (Phase 7, ADR 0036)
  EXECUTION_NOT_STARTED: {
    httpStatus: 409,
    message: 'Project execution has not been started for this project.',
  },
  MILESTONE_NOT_FOUND: {
    httpStatus: 404,
    message: 'That execution milestone was not found on this project.',
  },
  CHECKLIST_ITEM_NOT_FOUND: {
    httpStatus: 404,
    message: 'That checklist item was not found.',
  },
  INSTALLATION_NOT_FOUND: {
    httpStatus: 404,
    message: 'No installation record was found for this project.',
  },
  INSTALLATION_INVALID_STATE: {
    httpStatus: 409,
    message: 'That action is not allowed from the installation’s current status.',
  },
  INSTALLATION_NOT_ASSIGNED_TO_YOU: {
    httpStatus: 403,
    message: 'This installation is not assigned to you.',
  },
  INSTALLATION_CHECKLIST_INCOMPLETE: {
    httpStatus: 409,
    message: 'Required installation checklist items are not complete.',
  },
  MATERIAL_NOT_READY: {
    httpStatus: 409,
    message: 'Required materials are not ready and no override is in place.',
  },
  QC_INSPECTION_NOT_FOUND: {
    httpStatus: 404,
    message: 'That QC inspection was not found on this project.',
  },
  QC_INVALID_STATE: {
    httpStatus: 409,
    message: 'That action is not allowed from the inspection’s current status.',
  },
  QC_CHECKLIST_INCOMPLETE: {
    httpStatus: 409,
    message: 'Required QC checks are not complete.',
  },
  QC_BLOCKING_DEFECTS: {
    httpStatus: 409,
    message: 'This project has unresolved defects that block QC from passing.',
  },
  QC_NOT_PASSED: {
    httpStatus: 409,
    message: 'QC has not been passed for this project.',
  },
  DEFECT_NOT_FOUND: {
    httpStatus: 404,
    message: 'That defect was not found on this project.',
  },
  DEFECT_INVALID_STATE: {
    httpStatus: 409,
    message: 'That status change is not allowed from the defect’s current status.',
  },
  NET_METERING_INVALID_STATE: {
    httpStatus: 409,
    message: 'That net-metering status change is not allowed.',
  },
  HANDOVER_INVALID_STATE: {
    httpStatus: 409,
    message: 'That action is not allowed from the handover’s current status.',
  },
  HANDOVER_NOT_READY: {
    httpStatus: 409,
    message: 'The handover cannot be completed until its prerequisites are met.',
  },
  PROJECT_COMPLETION_BLOCKED: {
    httpStatus: 409,
    message: 'The project cannot be completed until all execution requirements are met.',
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
