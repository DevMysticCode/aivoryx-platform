import type { components, operations, paths } from './generated/schema.js';

export type { paths, operations, components };

/** Convenience aliases for the response bodies used by the web client. */
export type HealthReport = components['schemas']['HealthReportDto'];
export type LivenessReport = components['schemas']['LivenessReportDto'];
export type DependencyHealth = components['schemas']['DependencyHealthDto'];

// Phase 2 — security boundary (auth / session / tenant / admin).
export type LoginRequest = components['schemas']['LoginRequestDto'];
export type LoginResponse = components['schemas']['LoginResponseDto'];
export type MeResponse = components['schemas']['MeResponseDto'];
export type SwitchTenantRequest = components['schemas']['SwitchTenantRequestDto'];
export type SwitchTenantResponse = components['schemas']['SwitchTenantResponseDto'];
export type LogoutResponse = components['schemas']['LogoutResponseDto'];
export type MembershipSummary = components['schemas']['MembershipSummaryDto'];
export type ActiveContext = components['schemas']['ActiveContextDto'];
export type AuthUser = components['schemas']['AuthUserDto'];
export type AdminRole = components['schemas']['AdminRoleDto'];
export type CataloguePermission = components['schemas']['CataloguePermissionDto'];

// Phase 2 — tenant administration & user lifecycle (ADR 0030).
export type Tenant = components['schemas']['TenantDto'];
export type UpdateTenantRequest = components['schemas']['UpdateTenantRequestDto'];
export type Member = components['schemas']['MemberDto'];
export type MemberRole = components['schemas']['MemberRoleDto'];
export type InviteMemberRequest = components['schemas']['InviteMemberRequestDto'];
export type InviteMemberResponse = components['schemas']['InviteMemberResponseDto'];
export type UpdateMemberRequest = components['schemas']['UpdateMemberRequestDto'];
export type AssignRoleRequest = components['schemas']['AssignRoleRequestDto'];
export type AcceptInvitationRequest = components['schemas']['AcceptInvitationRequestDto'];
export type AcceptInvitationResponse = components['schemas']['AcceptInvitationResponseDto'];

// Phase 3 — CRM core (ADR 0031).
export type Lead = components['schemas']['LeadDto'];
export type LeadAssignee = components['schemas']['LeadAssigneeDto'];
export type LeadContactRequest = components['schemas']['LeadContactDto'];
export type LeadListResponse = components['schemas']['LeadListResponseDto'];
export type AssignLeadRequest = components['schemas']['AssignLeadRequestDto'];
export type LeadStatusRequest = components['schemas']['LeadStatusRequestDto'];
export type QualifyLeadRequest = components['schemas']['QualifyLeadRequestDto'];
export type CallAttemptRequest = components['schemas']['CallAttemptRequestDto'];
export type LeadActivity = components['schemas']['LeadActivityDto'];
export type CreateNoteRequest = components['schemas']['CreateNoteRequestDto'];
export type Note = components['schemas']['NoteDto'];
export type CreateFollowupRequest = components['schemas']['CreateFollowupRequestDto'];
export type CompleteFollowupRequest = components['schemas']['CompleteFollowupRequestDto'];
export type RescheduleFollowupRequest = components['schemas']['RescheduleFollowupRequestDto'];
export type Followup = components['schemas']['FollowupDto'];
export type CreateCustomFieldRequest = components['schemas']['CreateCustomFieldRequestDto'];
export type CustomFieldDefinition = components['schemas']['CustomFieldDefinitionDto'];

// Phase 3 — inbound integration engine (ADR 0032).
export type CreateSourceRequest = components['schemas']['CreateSourceRequestDto'];
export type CreateSourceResponse = components['schemas']['CreateSourceResponseDto'];
export type Source = components['schemas']['SourceDto'];
export type SourceSecretHandoff = components['schemas']['SourceSecretHandoffDto'];
export type CanonicalEvent = components['schemas']['CanonicalEventDto'];
export type IngestAcceptedResponse = components['schemas']['IngestAcceptedResponseDto'];

// Phase 4 — field operations: visits, GPS, survey, attachments (ADR 0033).
export type FieldAgent = components['schemas']['FieldAgentDto'];
export type DesignateFieldAgentRequest = components['schemas']['DesignateFieldAgentRequestDto'];
export type Visit = components['schemas']['VisitDto'];
export type VisitAssignee = components['schemas']['VisitAssigneeDto'];
export type VisitListResponse = components['schemas']['VisitListResponseDto'];
export type ScheduleVisitRequest = components['schemas']['ScheduleVisitRequestDto'];
export type AssignVisitRequest = components['schemas']['AssignVisitRequestDto'];
export type RescheduleVisitRequest = components['schemas']['RescheduleVisitRequestDto'];
export type CancelVisitRequest = components['schemas']['CancelVisitRequestDto'];
export type GeoPointRequest = components['schemas']['GeoPointRequestDto'];
export type CheckOutRequest = components['schemas']['CheckOutRequestDto'];
export type SubmitSurveyRequest = components['schemas']['SubmitSurveyRequestDto'];
export type SurveyFieldValue = components['schemas']['SurveyFieldValueDto'];
export type VisitActivity = components['schemas']['VisitActivityDto'];
export type CreateVisitNoteRequest = components['schemas']['CreateVisitNoteRequestDto'];
export type VisitNote = components['schemas']['VisitNoteDto'];
export type VisitAttachment = components['schemas']['VisitAttachmentDto'];

/**
 * The standard error envelope returned by every `/api/v1` endpoint on failure.
 * It is documented on the auth/admin operations (`ApiErrorDto`) and mirrors
 * `@aivoryx/shared`'s `ErrorResponseBody`, which the API's exception filter
 * produces.
 */
export type ApiError = components['schemas']['ApiErrorDto'];
export type { ErrorResponseBody as ApiErrorResponse } from '@aivoryx/shared';

/** All versioned API routes are served under this prefix (ADR 0005). */
export const API_V1_PREFIX = '/api/v1';
