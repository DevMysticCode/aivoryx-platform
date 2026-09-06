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

// Phase 5 — procurement, inventory & logistics (ADR 0034).
export type Unit = components['schemas']['UnitDto'];
export type UpsertUnitRequest = components['schemas']['UpsertUnitDto'];
export type Category = components['schemas']['CategoryDto'];
export type UpsertCategoryRequest = components['schemas']['UpsertCategoryDto'];
export type Product = components['schemas']['ProductDto'];
export type ProductList = components['schemas']['ProductListDto'];
export type CreateProductRequest = components['schemas']['CreateProductDto'];
export type UpdateProductRequest = components['schemas']['UpdateProductDto'];
export type Supplier = components['schemas']['SupplierDto'];
export type CreateSupplierRequest = components['schemas']['CreateSupplierDto'];
export type UpdateSupplierRequest = components['schemas']['UpdateSupplierDto'];
export type Warehouse = components['schemas']['WarehouseDto'];
export type CreateWarehouseRequest = components['schemas']['CreateWarehouseDto'];
export type UpdateWarehouseRequest = components['schemas']['UpdateWarehouseDto'];

export type Project = components['schemas']['ProjectDto'];
export type ProjectDetail = components['schemas']['ProjectDetailDto'];
export type ProjectList = components['schemas']['ProjectListDto'];
export type ProjectMaterial = components['schemas']['ProjectMaterialDto'];
export type ProjectActivity = components['schemas']['ProjectActivityDto'];
export type CreateProjectRequest = components['schemas']['CreateProjectDto'];
export type SetProjectStatusRequest = components['schemas']['SetProjectStatusDto'];
export type UpsertMaterialRequest = components['schemas']['UpsertMaterialDto'];
export type UpdateMaterialRequest = components['schemas']['UpdateMaterialDto'];
export type AllocateMaterialRequest = components['schemas']['AllocateMaterialDto'];

export type StockLevel = components['schemas']['StockLevelDto'];
export type StockLevelList = components['schemas']['StockLevelListDto'];
export type StockMovement = components['schemas']['StockMovementDto'];
export type StockMovementList = components['schemas']['StockMovementListDto'];
export type AdjustStockRequest = components['schemas']['AdjustStockDto'];
export type TransferStockRequest = components['schemas']['TransferStockDto'];

export type PurchaseOrder = components['schemas']['PurchaseOrderDto'];
export type PurchaseOrderDetail = components['schemas']['PurchaseOrderDetailDto'];
export type PurchaseOrderList = components['schemas']['PurchaseOrderListDto'];
export type PoLine = components['schemas']['PoLineDto'];
export type GoodsReceipt = components['schemas']['GoodsReceiptDto'];
export type CreatePurchaseOrderRequest = components['schemas']['CreatePurchaseOrderDto'];
export type UpdatePurchaseOrderRequest = components['schemas']['UpdatePurchaseOrderDto'];
export type ReceivePurchaseOrderRequest = components['schemas']['ReceivePurchaseOrderDto'];

export type Dispatch = components['schemas']['DispatchDto'];
export type DispatchDetail = components['schemas']['DispatchDetailDto'];
export type DispatchList = components['schemas']['DispatchListDto'];
export type DispatchLine = components['schemas']['DispatchLineDto'];
export type DispatchAttachment = components['schemas']['DispatchAttachmentDto'];
export type CreateDispatchRequest = components['schemas']['CreateDispatchDto'];
export type UpdateDispatchRequest = components['schemas']['UpdateDispatchDto'];
export type DeliverDispatchRequest = components['schemas']['DeliverDispatchDto'];

// Phase 6 — commercial: customers, quotations & project booking (ADR 0035).
export type Customer = components['schemas']['CustomerDto'];
export type CustomerDetail = components['schemas']['CustomerDetailDto'];
export type CustomerList = components['schemas']['CustomerListDto'];
export type CustomerLink = components['schemas']['CustomerLinkDto'];
export type CreateCustomerRequest = components['schemas']['CreateCustomerDto'];
export type UpdateCustomerRequest = components['schemas']['UpdateCustomerDto'];
export type PromoteLeadRequest = components['schemas']['PromoteLeadDto'];

export type Quotation = components['schemas']['QuotationDto'];
export type QuotationDetail = components['schemas']['QuotationDetailDto'];
export type QuotationList = components['schemas']['QuotationListDto'];
export type QuotationRevision = components['schemas']['QuotationRevisionDto'];
export type QuotationLine = components['schemas']['QuotationLineDto'];
export type QuotationLineInput = components['schemas']['QuotationLineInputDto'];
export type QuotationActivity = components['schemas']['QuotationActivityDto'];
export type QuotationAttachment = components['schemas']['QuotationAttachmentDto'];
export type CreateQuotationRequest = components['schemas']['CreateQuotationDto'];
export type UpdateQuotationRequest = components['schemas']['UpdateQuotationDto'];
export type ReviseQuotationRequest = components['schemas']['ReviseQuotationDto'];
export type AcceptQuotationRequest = components['schemas']['AcceptQuotationDto'];
export type BookQuotationRequest = components['schemas']['BookQuotationDto'];
export type BookingResult = components['schemas']['BookingResultDto'];

// Phase 7 — EPC project execution (ADR 0036).
export type ExecutionView = components['schemas']['ExecutionViewDto'];
export type ExecutionProgress = components['schemas']['ExecutionProgressDto'];
export type Milestone = components['schemas']['MilestoneDto'];
export type ChecklistItem = components['schemas']['ChecklistItemDto'];
export type ChecklistTemplate = components['schemas']['TemplateDto'];
export type Readiness = components['schemas']['ReadinessDto'];
export type Installation = components['schemas']['InstallationDto'];
export type QcInspection = components['schemas']['QcInspectionDto'];
export type QcInspectionDetail = components['schemas']['QcInspectionDetailDto'];
export type Defect = components['schemas']['DefectDto'];
export type NetMetering = components['schemas']['NetMeteringDto'];
export type Handover = components['schemas']['HandoverDto'];
export type ExecutionAttachment = components['schemas']['ExecutionAttachmentDto'];
export type FieldProject = components['schemas']['FieldProjectDto'];
export type ProjectCompletionResult = components['schemas']['ProjectCompletionResultDto'];
export type AssignInstallationRequest = components['schemas']['AssignInstallationDto'];
export type CompleteInstallationRequest = components['schemas']['CompleteInstallationDto'];
export type StartInstallationRequest = components['schemas']['StartInstallationDto'];
export type MaterialOverrideRequest = components['schemas']['MaterialOverrideDto'];
export type ToggleChecklistItemRequest = components['schemas']['ToggleChecklistItemDto'];
export type AddChecklistItemRequest = components['schemas']['AddChecklistItemDto'];
export type UpsertTemplateRequest = components['schemas']['UpsertTemplateDto'];
export type CreateQcInspectionRequest = components['schemas']['CreateQcInspectionDto'];
export type FailQcRequest = components['schemas']['FailQcDto'];
export type CreateDefectRequest = components['schemas']['CreateDefectDto'];
export type UpdateDefectRequest = components['schemas']['UpdateDefectDto'];
export type UpdateNetMeteringRequest = components['schemas']['UpdateNetMeteringDto'];
export type UpdateHandoverRequest = components['schemas']['UpdateHandoverDto'];
export type CompleteMilestoneRequest = components['schemas']['CompleteMilestoneDto'];

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
