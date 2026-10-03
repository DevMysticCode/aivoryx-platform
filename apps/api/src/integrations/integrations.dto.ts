import { ApiProperty } from '@nestjs/swagger';
import { schema } from '@aivoryx/db';
import { Type } from 'class-transformer';
import {
  IsIn,
  IsInt,
  IsObject,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
  MinLength,
} from 'class-validator';

const { CANONICAL_EVENT_STATUSES } = schema;

/** Kept in sync with the providers actually registered in `AdapterRegistry` (UC-2/UC-3). The
 *  registry remains the runtime authority — this list only drives request validation/Swagger. */
export const KNOWN_CONNECTOR_TYPES = ['pabbly_bridge', 'meta_lead_ads'] as const;

export class CreateSourceRequestDto {
  @ApiProperty({ maxLength: 60, example: 'website-pabbly' })
  @IsString()
  @MinLength(1)
  @MaxLength(60)
  key!: string;

  @ApiProperty({ maxLength: 200 })
  @IsString()
  @MinLength(1)
  @MaxLength(200)
  name!: string;

  @ApiProperty({
    required: false,
    enum: KNOWN_CONNECTOR_TYPES,
    default: 'pabbly_bridge',
    description: 'Defaults to the bearer-authenticated Pabbly connector.',
  })
  @IsOptional()
  @IsIn(KNOWN_CONNECTOR_TYPES)
  connectorType?: string;

  @ApiProperty({
    required: false,
    type: Object,
    additionalProperties: { type: 'string' },
    description:
      'Provider field -> "canonical:<field>" | "custom:<key>" | "skip" overrides, merged over the built-in defaults.',
  })
  @IsOptional()
  @IsObject()
  fieldMapping?: Record<string, string>;
}

/**
 * Write-only credential update for a signature-style source (UC-3) — e.g. Meta's
 * `{ appSecret, pageAccessToken, verifyToken }`. Deliberately a free-form string map rather than
 * named fields: the shape is provider-specific and the admin API has no reason to know it; the
 * adapter is what reads `credential.data.<field>`.
 */
export class SetSourceCredentialsRequestDto {
  @ApiProperty({
    type: Object,
    additionalProperties: { type: 'string' },
    description: 'Replaces the ENTIRE credential blob. Never returned by any API response.',
  })
  @IsObject()
  data!: Record<string, string>;
}

export class SourceDto {
  @ApiProperty({ format: 'uuid' })
  id!: string;

  @ApiProperty()
  key!: string;

  @ApiProperty()
  name!: string;

  @ApiProperty({ enum: KNOWN_CONNECTOR_TYPES })
  connectorType!: string;

  @ApiProperty({ enum: ['active', 'revoked'] })
  status!: string;

  @ApiProperty({ type: Object, additionalProperties: { type: 'string' } })
  fieldMapping!: Record<string, string>;

  @ApiProperty({
    nullable: true,
    type: String,
    description:
      'The webhook URL segment for a signature-style source (Meta): POST /integrations/webhooks/<publicLookupKey>. Null for a bearer-style source (Pabbly), which uses `key` + a connector secret instead.',
  })
  publicLookupKey!: string | null;

  @ApiProperty({ description: 'Whether a recoverable credential blob is configured.' })
  hasCredentials!: boolean;

  @ApiProperty({ format: 'date-time' })
  createdAt!: string;

  @ApiProperty({ format: 'date-time' })
  updatedAt!: string;
}

/**
 * Updates ONLY `name` and/or `fieldMapping` (UC-4). `key` and `connectorType` are deliberately
 * absent as fields — `forbidNonWhitelisted` on the global `ValidationPipe` means sending either
 * rejects the whole request with a 400, rather than silently ignoring it.
 */
export class UpdateSourceRequestDto {
  @ApiProperty({ required: false, maxLength: 200 })
  @IsOptional()
  @IsString()
  @MinLength(1)
  @MaxLength(200)
  name?: string;

  @ApiProperty({
    required: false,
    type: Object,
    additionalProperties: { type: 'string' },
    description:
      'Replaces the ENTIRE override dictionary. Each value must be "skip", "canonical:<field>" or "custom:<key>".',
  })
  @IsOptional()
  @IsObject()
  fieldMapping?: Record<string, string>;
}

export class SourceSecretHandoffDto {
  @ApiProperty({
    description:
      'One-time connector secret. Returned ONLY here (create / rotate); send it to Pabbly as the ' +
      '"Authorization: Bearer <secret>" header. Never returned again.',
  })
  secret!: string;
}

export class CreateSourceResponseDto {
  @ApiProperty({ type: SourceDto })
  source!: SourceDto;

  @ApiProperty({ type: SourceSecretHandoffDto })
  credential!: SourceSecretHandoffDto;
}

export class CanonicalEventDto {
  @ApiProperty({ format: 'uuid' })
  id!: string;

  @ApiProperty({ format: 'uuid' })
  rawEventId!: string;

  @ApiProperty({ format: 'uuid' })
  sourceId!: string;

  @ApiProperty()
  status!: string;

  @ApiProperty({ nullable: true, type: String, format: 'uuid' })
  leadId!: string | null;

  @ApiProperty({ nullable: true, type: String })
  dedupeOutcome!: string | null;

  @ApiProperty()
  processingAttempts!: number;

  @ApiProperty({ nullable: true, type: String })
  lastErrorCode!: string | null;

  @ApiProperty({ nullable: true, type: String })
  lastErrorMessage!: string | null;

  @ApiProperty({ format: 'date-time' })
  createdAt!: string;
}

/** Server-side pagination/filter for `GET events` (UC-4) — same `page`/`pageSize` convention as
 *  the audit log API (`audit.dto.ts`). */
export class ListEventsQueryDto {
  @ApiProperty({ required: false, format: 'uuid', description: 'Restrict to one connection.' })
  @IsOptional()
  @IsString()
  sourceId?: string;

  @ApiProperty({
    required: false,
    enum: CANONICAL_EVENT_STATUSES,
    description: 'Restrict to one canonical event status.',
  })
  @IsOptional()
  @IsIn(CANONICAL_EVENT_STATUSES)
  status?: string;

  @ApiProperty({ required: false, minimum: 1, default: 1 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page?: number;

  @ApiProperty({ required: false, minimum: 1, maximum: 100, default: 25 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  pageSize?: number;
}

export class EventListResponseDto {
  @ApiProperty({ type: [CanonicalEventDto] })
  items!: CanonicalEventDto[];

  @ApiProperty()
  total!: number;

  @ApiProperty()
  page!: number;

  @ApiProperty()
  pageSize!: number;
}

export class EventLogEntryDto {
  @ApiProperty({ format: 'uuid' })
  id!: string;

  @ApiProperty({ format: 'uuid' })
  rawEventId!: string;

  @ApiProperty({ nullable: true, type: String, format: 'uuid' })
  canonicalLeadEventId!: string | null;

  @ApiProperty()
  stage!: string;

  @ApiProperty({ nullable: true, type: String })
  fromStatus!: string | null;

  @ApiProperty({ nullable: true, type: String })
  toStatus!: string | null;

  @ApiProperty({ nullable: true, type: String })
  errorCode!: string | null;

  @ApiProperty({ nullable: true, type: String })
  message!: string | null;

  @ApiProperty({ format: 'date-time' })
  createdAt!: string;
}

export class RawEventDto {
  @ApiProperty({ format: 'uuid' })
  id!: string;

  @ApiProperty({ format: 'uuid' })
  sourceId!: string;

  @ApiProperty()
  correlationId!: string;

  @ApiProperty({ format: 'date-time' })
  receivedAt!: string;

  @ApiProperty({
    type: Object,
    description: 'The untouched inbound payload. May contain PII — progressively disclose it.',
  })
  rawBody!: unknown;

  @ApiProperty({ type: Object })
  transportMetadata!: Record<string, unknown>;

  @ApiProperty({ enum: ['RECEIVED', 'PROCESSED', 'FAILED'] })
  status!: string;

  @ApiProperty({ nullable: true, type: String, format: 'date-time' })
  expiresAt!: string | null;

  @ApiProperty({ format: 'date-time' })
  createdAt!: string;
}

/** One canonical event's full detail — the mapped/canonical/custom/unmapped fields, its raw
 *  delivery, and its per-stage processing log (UC-4, typed version of the pre-existing
 *  `GET events/:id` response; the API semantics are unchanged, only the Swagger/TS shape). */
export class CanonicalEventDetailDto extends CanonicalEventDto {
  @ApiProperty()
  idempotencyKey!: string;

  @ApiProperty({ type: Object })
  canonical!: Record<string, unknown>;

  @ApiProperty({ type: Object })
  custom!: Record<string, unknown>;

  @ApiProperty({ type: Object })
  unmapped!: Record<string, unknown>;

  @ApiProperty({ format: 'date-time' })
  updatedAt!: string;
}

export class EventDetailResponseDto {
  @ApiProperty({ type: CanonicalEventDetailDto })
  event!: CanonicalEventDetailDto;

  @ApiProperty({ type: RawEventDto, nullable: true })
  raw!: RawEventDto | null;

  @ApiProperty({ type: [EventLogEntryDto] })
  log!: EventLogEntryDto[];
}

export class ProviderCredentialFieldDto {
  @ApiProperty()
  key!: string;

  @ApiProperty()
  label!: string;

  @ApiProperty({ description: 'Write-only — never render a previously-stored value.' })
  secret!: boolean;
}

/**
 * Safe, server-driven provider catalog entry (UC-4) — the Integration Center renders connector
 * pickers and credential forms from this, never a hardcoded per-provider switch. Never carries a
 * credential value, only field NAMES a credential form should collect.
 */
export class ProviderMetaDto {
  @ApiProperty({ enum: KNOWN_CONNECTOR_TYPES })
  provider!: string;

  @ApiProperty()
  version!: number;

  @ApiProperty()
  displayName!: string;

  @ApiProperty()
  description!: string;

  @ApiProperty({ enum: ['bearer_secret', 'signature'] })
  authMethod!: 'bearer_secret' | 'signature';

  @ApiProperty({ type: [ProviderCredentialFieldDto] })
  credentialFields!: ProviderCredentialFieldDto[];

  @ApiProperty({ type: [String] })
  capabilities!: string[];
}

export class IngestAcceptedResponseDto {
  @ApiProperty()
  accepted!: boolean;

  @ApiProperty()
  status!: string;

  @ApiProperty({ format: 'uuid' })
  rawEventId!: string;

  @ApiProperty({ required: false, format: 'uuid' })
  canonicalEventId?: string;

  @ApiProperty({ required: false, format: 'uuid' })
  leadId?: string;

  @ApiProperty({ required: false })
  dedupeOutcome?: string;

  @ApiProperty({ required: false })
  errorCode?: string;

  @ApiProperty({ required: false })
  errorMessage?: string;
}
