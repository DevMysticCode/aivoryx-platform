import { ApiProperty } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  IsBoolean,
  IsIn,
  IsInt,
  IsNumber,
  IsOptional,
  IsString,
  MaxLength,
  Min,
  MinLength,
} from 'class-validator';

// ---- shared response fragments -------------------------------

export class MilestoneDto {
  @ApiProperty({ format: 'uuid' }) id!: string;
  @ApiProperty() key!: string;
  @ApiProperty() sortOrder!: number;
  @ApiProperty({ enum: ['pending', 'in_progress', 'done', 'skipped', 'blocked'] }) status!: string;
  @ApiProperty({ nullable: true, type: String, format: 'date-time' }) completedAt!: string | null;
  @ApiProperty({ nullable: true, type: String }) completedByName!: string | null;
  @ApiProperty({ nullable: true, type: String }) notes!: string | null;
}

export class ChecklistItemDto {
  @ApiProperty({ format: 'uuid' }) id!: string;
  @ApiProperty({ enum: ['installation', 'qc', 'handover'] }) kind!: string;
  @ApiProperty({ nullable: true, type: String, format: 'uuid' }) inspectionId!: string | null;
  @ApiProperty() label!: string;
  @ApiProperty() sortOrder!: number;
  @ApiProperty() required!: boolean;
  @ApiProperty({ enum: ['pending', 'done', 'na'] }) status!: string;
  @ApiProperty({ nullable: true, type: String, format: 'date-time' }) completedAt!: string | null;
  @ApiProperty({ nullable: true, type: String }) completedByName!: string | null;
  @ApiProperty({ nullable: true, type: String }) notes!: string | null;
}

export class ReadinessDto {
  @ApiProperty({ enum: ['NOT_READY', 'PARTIALLY_READY', 'READY'] }) state!: string;
  @ApiProperty() requiredQty!: string;
  @ApiProperty() allocatedQty!: string;
  @ApiProperty() dispatchedQty!: string;
  @ApiProperty() deliveredQty!: string;
  @ApiProperty() shortLines!: number;
  @ApiProperty() totalLines!: number;
}

export class InstallationDto {
  @ApiProperty({ format: 'uuid' }) id!: string;
  @ApiProperty({ enum: ['UNASSIGNED', 'ASSIGNED', 'IN_PROGRESS', 'COMPLETED', 'CANCELLED'] })
  status!: string;
  @ApiProperty({ nullable: true, type: String, format: 'uuid' }) assignedMembershipId!:
    | string
    | null;
  @ApiProperty({ nullable: true, type: String }) assignedName!: string | null;
  @ApiProperty({ nullable: true, type: String, format: 'date-time' }) assignedAt!: string | null;
  @ApiProperty({ nullable: true, type: String, format: 'date-time' }) startedAt!: string | null;
  @ApiProperty({ nullable: true, type: String, format: 'date-time' }) completedAt!: string | null;
  @ApiProperty({ nullable: true, type: String }) notes!: string | null;
  @ApiProperty({ nullable: true, type: String }) equipmentInstalled!: string | null;
  @ApiProperty({ nullable: true, type: String }) issues!: string | null;
  @ApiProperty() materialOverride!: boolean;
  @ApiProperty({ nullable: true, type: String }) materialOverrideReason!: string | null;
}

export class QcInspectionDto {
  @ApiProperty({ format: 'uuid' }) id!: string;
  @ApiProperty() seq!: number;
  @ApiProperty({ enum: ['PENDING', 'IN_PROGRESS', 'PASSED', 'FAILED'] }) status!: string;
  @ApiProperty({ nullable: true, type: String, format: 'uuid' }) inspectorMembershipId!:
    | string
    | null;
  @ApiProperty({ nullable: true, type: String }) inspectorName!: string | null;
  @ApiProperty({ nullable: true, type: String, format: 'date-time' }) inspectedAt!: string | null;
  @ApiProperty({ nullable: true, type: String }) notes!: string | null;
  @ApiProperty({ nullable: true, type: String }) resultNote!: string | null;
  @ApiProperty({ format: 'date-time' }) createdAt!: string;
}

export class QcInspectionDetailDto extends QcInspectionDto {
  @ApiProperty({ type: [ChecklistItemDto] }) checklist!: ChecklistItemDto[];
}

export class DefectDto {
  @ApiProperty({ format: 'uuid' }) id!: string;
  @ApiProperty({ nullable: true, type: String, format: 'uuid' }) inspectionId!: string | null;
  @ApiProperty() description!: string;
  @ApiProperty({ enum: ['low', 'medium', 'high', 'critical'] }) severity!: string;
  @ApiProperty({ enum: ['OPEN', 'IN_PROGRESS', 'RESOLVED', 'VERIFIED'] }) status!: string;
  @ApiProperty({ nullable: true, type: String, format: 'uuid' }) assignedMembershipId!:
    | string
    | null;
  @ApiProperty({ nullable: true, type: String }) assignedName!: string | null;
  @ApiProperty({ nullable: true, type: String }) resolutionNote!: string | null;
  @ApiProperty({ nullable: true, type: String, format: 'date-time' }) resolvedAt!: string | null;
  @ApiProperty({ nullable: true, type: String, format: 'date-time' }) verifiedAt!: string | null;
  @ApiProperty({ format: 'date-time' }) createdAt!: string;
}

export class NetMeteringDto {
  @ApiProperty({ format: 'uuid' }) id!: string;
  @ApiProperty({
    enum: [
      'NOT_STARTED',
      'DOCUMENTS_PENDING',
      'SUBMITTED',
      'UNDER_REVIEW',
      'APPROVED',
      'REJECTED',
      'COMPLETED',
    ],
  })
  status!: string;
  @ApiProperty() notRequired!: boolean;
  @ApiProperty({ nullable: true, type: String }) referenceNumber!: string | null;
  @ApiProperty({ nullable: true, type: String, format: 'date-time' }) submittedAt!: string | null;
  @ApiProperty({ nullable: true, type: String, format: 'date-time' }) approvedAt!: string | null;
  @ApiProperty({ nullable: true, type: String }) notes!: string | null;
}

export class HandoverDto {
  @ApiProperty({ format: 'uuid' }) id!: string;
  @ApiProperty({ enum: ['PENDING', 'READY', 'COMPLETED'] }) status!: string;
  @ApiProperty({ nullable: true, type: String }) notes!: string | null;
  @ApiProperty() customerAcknowledged!: boolean;
  @ApiProperty({ nullable: true, type: String }) acknowledgedByName!: string | null;
  @ApiProperty({ nullable: true, type: String, format: 'date-time' }) handoverAt!: string | null;
}

export class ExecutionActivityDto {
  @ApiProperty({ format: 'uuid' }) id!: string;
  @ApiProperty() type!: string;
  @ApiProperty({ nullable: true, type: String }) actorName!: string | null;
  @ApiProperty({ type: Object, additionalProperties: true }) payload!: Record<string, unknown>;
  @ApiProperty({ format: 'date-time' }) createdAt!: string;
}

export class ExecutionAttachmentDto {
  @ApiProperty({ format: 'uuid' }) id!: string;
  @ApiProperty({ format: 'uuid' }) projectId!: string;
  @ApiProperty({ enum: ['installation', 'qc', 'defect', 'net_metering', 'handover'] })
  entityKind!: string;
  @ApiProperty({ format: 'uuid' }) entityId!: string;
  @ApiProperty({ nullable: true, type: String }) originalFilename!: string | null;
  @ApiProperty() contentType!: string;
  @ApiProperty() fileSize!: number;
  @ApiProperty({ format: 'date-time' }) createdAt!: string;
}

export class ExecutionProgressDto {
  @ApiProperty({ description: 'materials readiness, 0-100' }) materials!: number;
  @ApiProperty({ description: 'installation checklist done, 0-100' }) installation!: number;
  @ApiProperty({ description: 'QC (0 pending, 100 passed)' }) qc!: number;
  @ApiProperty({ description: 'net metering, 0-100' }) netMetering!: number;
  @ApiProperty({ description: 'handover, 0-100' }) handover!: number;
  @ApiProperty({ description: 'overall milestones done, 0-100' }) overall!: number;
}

export class ExecutionViewDto {
  @ApiProperty({ format: 'uuid' }) projectId!: string;
  @ApiProperty() projectNumber!: string;
  @ApiProperty() projectStatus!: string;
  @ApiProperty({ format: 'uuid' }) leadId!: string;
  @ApiProperty({ nullable: true, type: String }) leadName!: string | null;
  @ApiProperty({ nullable: true, type: String, format: 'uuid' }) customerId!: string | null;
  @ApiProperty({ nullable: true, type: String }) customerName!: string | null;
  @ApiProperty() executionStarted!: boolean;
  @ApiProperty({ type: ReadinessDto }) readiness!: ReadinessDto;
  @ApiProperty({ type: [MilestoneDto] }) milestones!: MilestoneDto[];
  @ApiProperty({ nullable: true, type: InstallationDto }) installation!: InstallationDto | null;
  @ApiProperty({ type: [ChecklistItemDto] }) installationChecklist!: ChecklistItemDto[];
  @ApiProperty({ type: [QcInspectionDto] }) qcInspections!: QcInspectionDto[];
  @ApiProperty({ type: [DefectDto] }) defects!: DefectDto[];
  @ApiProperty({ nullable: true, type: NetMeteringDto }) netMetering!: NetMeteringDto | null;
  @ApiProperty({ nullable: true, type: HandoverDto }) handover!: HandoverDto | null;
  @ApiProperty({ type: [ChecklistItemDto] }) handoverChecklist!: ChecklistItemDto[];
  @ApiProperty({ type: ExecutionProgressDto }) progress!: ExecutionProgressDto;
  @ApiProperty({ type: [String] }) completionMissing!: string[];
  @ApiProperty() canComplete!: boolean;
}

export class FieldProjectDto {
  @ApiProperty({ format: 'uuid' }) projectId!: string;
  @ApiProperty() projectNumber!: string;
  @ApiProperty({ nullable: true, type: String }) customerName!: string | null;
  @ApiProperty({ nullable: true, type: String }) siteCity!: string | null;
  @ApiProperty({ enum: ['UNASSIGNED', 'ASSIGNED', 'IN_PROGRESS', 'COMPLETED', 'CANCELLED'] })
  installationStatus!: string;
  @ApiProperty({ enum: ['NOT_READY', 'PARTIALLY_READY', 'READY'] }) readinessState!: string;
  @ApiProperty() openDefects!: number;
}

// ---- request bodies ---------------------------------------

export class CompleteMilestoneDto {
  @ApiProperty({ required: false, maxLength: 1000 })
  @IsOptional()
  @IsString()
  @MaxLength(1000)
  notes?: string;
}

export class AssignInstallationDto {
  @ApiProperty({ format: 'uuid', description: 'Field-agent membership id.' })
  @IsString()
  membershipId!: string;

  @ApiProperty({ required: false, format: 'uuid' })
  @IsOptional()
  @IsString()
  visitId?: string;
}

export class MaterialOverrideDto {
  @ApiProperty({ maxLength: 500 })
  @IsString()
  @MinLength(1)
  @MaxLength(500)
  reason!: string;
}

export class GeoPointDto {
  @ApiProperty() @IsNumber() lat!: number;
  @ApiProperty() @IsNumber() lng!: number;
}

export class StartInstallationDto {
  @ApiProperty({ required: false, type: GeoPointDto })
  @IsOptional()
  @Type(() => GeoPointDto)
  location?: GeoPointDto;
}

export class CompleteInstallationDto {
  @ApiProperty({ required: false, maxLength: 4000 })
  @IsOptional()
  @IsString()
  @MaxLength(4000)
  notes?: string;

  @ApiProperty({ required: false, maxLength: 2000 })
  @IsOptional()
  @IsString()
  @MaxLength(2000)
  equipmentInstalled?: string;

  @ApiProperty({ required: false, maxLength: 2000 })
  @IsOptional()
  @IsString()
  @MaxLength(2000)
  issues?: string;

  @ApiProperty({ required: false, type: GeoPointDto })
  @IsOptional()
  @Type(() => GeoPointDto)
  location?: GeoPointDto;
}

export class ToggleChecklistItemDto {
  @ApiProperty({ enum: ['pending', 'done', 'na'] })
  @IsIn(['pending', 'done', 'na'])
  status!: 'pending' | 'done' | 'na';

  @ApiProperty({ required: false, maxLength: 1000 })
  @IsOptional()
  @IsString()
  @MaxLength(1000)
  notes?: string;
}

export class AddChecklistItemDto {
  @ApiProperty({ enum: ['installation', 'qc', 'handover'] })
  @IsIn(['installation', 'qc', 'handover'])
  kind!: 'installation' | 'qc' | 'handover';

  @ApiProperty({ maxLength: 300 })
  @IsString()
  @MinLength(1)
  @MaxLength(300)
  label!: string;

  @ApiProperty({ required: false })
  @IsOptional()
  @IsBoolean()
  required?: boolean;

  @ApiProperty({
    required: false,
    format: 'uuid',
    description: 'For a QC-inspection checklist item.',
  })
  @IsOptional()
  @IsString()
  inspectionId?: string;
}

export class UpsertTemplateDto {
  @ApiProperty({ enum: ['installation', 'qc', 'handover'] })
  @IsIn(['installation', 'qc', 'handover'])
  kind!: 'installation' | 'qc' | 'handover';

  @ApiProperty({ maxLength: 300 })
  @IsString()
  @MinLength(1)
  @MaxLength(300)
  label!: string;

  @ApiProperty({ required: false })
  @IsOptional()
  @IsBoolean()
  required?: boolean;

  @ApiProperty({ required: false })
  @IsOptional()
  @IsInt()
  @Min(0)
  sortOrder?: number;

  @ApiProperty({ required: false })
  @IsOptional()
  @IsBoolean()
  isActive?: boolean;
}

export class TemplateDto {
  @ApiProperty({ format: 'uuid' }) id!: string;
  @ApiProperty() kind!: string;
  @ApiProperty() label!: string;
  @ApiProperty() sortOrder!: number;
  @ApiProperty() required!: boolean;
  @ApiProperty() isActive!: boolean;
}

export class CreateQcInspectionDto {
  @ApiProperty({ required: false, format: 'uuid' })
  @IsOptional()
  @IsString()
  inspectorMembershipId?: string;

  @ApiProperty({ required: false, maxLength: 2000 })
  @IsOptional()
  @IsString()
  @MaxLength(2000)
  notes?: string;
}

export class FailQcDto {
  @ApiProperty({ required: false, maxLength: 2000 })
  @IsOptional()
  @IsString()
  @MaxLength(2000)
  resultNote?: string;
}

export class CreateDefectDto {
  @ApiProperty({ maxLength: 2000 })
  @IsString()
  @MinLength(1)
  @MaxLength(2000)
  description!: string;

  @ApiProperty({ required: false, enum: ['low', 'medium', 'high', 'critical'] })
  @IsOptional()
  @IsIn(['low', 'medium', 'high', 'critical'])
  severity?: 'low' | 'medium' | 'high' | 'critical';

  @ApiProperty({ required: false, format: 'uuid' })
  @IsOptional()
  @IsString()
  assignedMembershipId?: string;

  @ApiProperty({ required: false, format: 'uuid' })
  @IsOptional()
  @IsString()
  inspectionId?: string;
}

export class UpdateDefectDto {
  @ApiProperty({ required: false, enum: ['OPEN', 'IN_PROGRESS', 'RESOLVED', 'VERIFIED'] })
  @IsOptional()
  @IsIn(['OPEN', 'IN_PROGRESS', 'RESOLVED', 'VERIFIED'])
  status?: 'OPEN' | 'IN_PROGRESS' | 'RESOLVED' | 'VERIFIED';

  @ApiProperty({ required: false, enum: ['low', 'medium', 'high', 'critical'] })
  @IsOptional()
  @IsIn(['low', 'medium', 'high', 'critical'])
  severity?: 'low' | 'medium' | 'high' | 'critical';

  @ApiProperty({ required: false, format: 'uuid', nullable: true })
  @IsOptional()
  @IsString()
  assignedMembershipId?: string | null;

  @ApiProperty({ required: false, maxLength: 2000 })
  @IsOptional()
  @IsString()
  @MaxLength(2000)
  resolutionNote?: string;
}

const NET_METERING_STATUSES = [
  'NOT_STARTED',
  'DOCUMENTS_PENDING',
  'SUBMITTED',
  'UNDER_REVIEW',
  'APPROVED',
  'REJECTED',
  'COMPLETED',
] as const;

export class UpdateNetMeteringDto {
  @ApiProperty({ required: false, enum: NET_METERING_STATUSES })
  @IsOptional()
  @IsIn(NET_METERING_STATUSES as unknown as string[])
  status?: (typeof NET_METERING_STATUSES)[number];

  @ApiProperty({ required: false })
  @IsOptional()
  @IsBoolean()
  notRequired?: boolean;

  @ApiProperty({ required: false, maxLength: 100 })
  @IsOptional()
  @IsString()
  @MaxLength(100)
  referenceNumber?: string;

  @ApiProperty({ required: false, maxLength: 2000 })
  @IsOptional()
  @IsString()
  @MaxLength(2000)
  notes?: string;
}

export class UpdateHandoverDto {
  @ApiProperty({ required: false, maxLength: 4000 })
  @IsOptional()
  @IsString()
  @MaxLength(4000)
  notes?: string;

  @ApiProperty({ required: false })
  @IsOptional()
  @IsBoolean()
  customerAcknowledged?: boolean;

  @ApiProperty({ required: false, maxLength: 200 })
  @IsOptional()
  @IsString()
  @MaxLength(200)
  acknowledgedByName?: string;
}

export class ProjectCompletionResultDto {
  @ApiProperty() completed!: boolean;
  @ApiProperty() projectStatus!: string;
  @ApiProperty({ type: [String] }) missing!: string[];
}
