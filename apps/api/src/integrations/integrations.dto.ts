import { ApiProperty } from '@nestjs/swagger';
import { IsIn, IsObject, IsOptional, IsString, MaxLength, MinLength } from 'class-validator';

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

  @ApiProperty({ type: Object, additionalProperties: true })
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
