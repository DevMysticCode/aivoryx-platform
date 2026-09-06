import { ApiProperty } from '@nestjs/swagger';
import { IsEmail, IsIn, IsOptional, IsString, Matches, MaxLength } from 'class-validator';

const HEX = /^#[0-9a-fA-F]{6}$/;
const ISO_CURRENCY = /^[A-Z]{3}$/;

// ---- responses -------------------------------------------------

export class CompanyProfileDto {
  @ApiProperty({ description: 'The workspace name (from the tenant record).' })
  workspaceName!: string;

  @ApiProperty({ nullable: true, type: String }) legalName!: string | null;
  @ApiProperty({ nullable: true, type: String }) displayName!: string | null;
  @ApiProperty({ nullable: true, type: String }) email!: string | null;
  @ApiProperty({ nullable: true, type: String }) phone!: string | null;
  @ApiProperty({ nullable: true, type: String }) website!: string | null;
  @ApiProperty({ nullable: true, type: String }) addressLine!: string | null;
  @ApiProperty({ nullable: true, type: String }) city!: string | null;
  @ApiProperty({ nullable: true, type: String }) region!: string | null;
  @ApiProperty({ nullable: true, type: String }) country!: string | null;
  @ApiProperty({ nullable: true, type: String }) postalCode!: string | null;
  @ApiProperty({ nullable: true, type: String }) taxRegistrationLabel!: string | null;
  @ApiProperty({ nullable: true, type: String }) taxRegistrationNumber!: string | null;
  @ApiProperty({ nullable: true, type: String }) documentFooter!: string | null;
  @ApiProperty({ nullable: true, type: String }) timezone!: string | null;
  @ApiProperty({ nullable: true, type: String }) defaultCurrency!: string | null;
  @ApiProperty({ nullable: true, type: String, example: '#1E40AF' }) primaryColor!: string | null;
  @ApiProperty({ nullable: true, type: String, example: '#0EA5E9' }) accentColor!: string | null;

  @ApiProperty({ description: 'True when a primary logo is configured.' }) hasLogo!: boolean;
  @ApiProperty() hasLightLogo!: boolean;
  @ApiProperty() hasDarkLogo!: boolean;
  @ApiProperty() hasFavicon!: boolean;

  @ApiProperty({ format: 'date-time', nullable: true, type: String }) updatedAt!: string | null;
}

/** The compact branding the app shell + `/auth/me` need — no permission to consume. */
export class BrandingDto {
  @ApiProperty() displayName!: string;
  @ApiProperty({ nullable: true, type: String }) primaryColor!: string | null;
  @ApiProperty({ nullable: true, type: String }) accentColor!: string | null;
  @ApiProperty() hasLogo!: boolean;
}

export class OnboardingStepDto {
  @ApiProperty() key!: string;
  @ApiProperty() title!: string;
  @ApiProperty() description!: string;
  @ApiProperty() done!: boolean;
  @ApiProperty({
    nullable: true,
    type: String,
    description: 'App path to complete this step, if the caller can access it.',
  })
  href!: string | null;
}

export class OnboardingDto {
  @ApiProperty() workspaceName!: string;
  @ApiProperty({ description: 'True once every visible step is done.' }) complete!: boolean;
  @ApiProperty({ description: 'True once an admin has dismissed the checklist.' })
  dismissed!: boolean;
  @ApiProperty({ description: 'True when the checklist should be shown to this user right now.' })
  show!: boolean;
  @ApiProperty({ type: [OnboardingStepDto] }) steps!: OnboardingStepDto[];
}

// ---- request -------------------------------------------------

export class UpdateCompanyProfileDto {
  @ApiProperty({ required: false }) @IsOptional() @IsString() @MaxLength(200) legalName?: string;
  @ApiProperty({ required: false }) @IsOptional() @IsString() @MaxLength(200) displayName?: string;
  @ApiProperty({ required: false }) @IsOptional() @IsEmail() @MaxLength(200) email?: string;
  @ApiProperty({ required: false }) @IsOptional() @IsString() @MaxLength(50) phone?: string;
  @ApiProperty({ required: false }) @IsOptional() @IsString() @MaxLength(200) website?: string;
  @ApiProperty({ required: false }) @IsOptional() @IsString() @MaxLength(300) addressLine?: string;
  @ApiProperty({ required: false }) @IsOptional() @IsString() @MaxLength(120) city?: string;
  @ApiProperty({ required: false }) @IsOptional() @IsString() @MaxLength(120) region?: string;
  @ApiProperty({ required: false }) @IsOptional() @IsString() @MaxLength(120) country?: string;
  @ApiProperty({ required: false }) @IsOptional() @IsString() @MaxLength(30) postalCode?: string;
  @ApiProperty({ required: false })
  @IsOptional()
  @IsString()
  @MaxLength(40)
  taxRegistrationLabel?: string;
  @ApiProperty({ required: false })
  @IsOptional()
  @IsString()
  @MaxLength(80)
  taxRegistrationNumber?: string;
  @ApiProperty({ required: false })
  @IsOptional()
  @IsString()
  @MaxLength(500)
  documentFooter?: string;
  @ApiProperty({ required: false, example: 'Asia/Kolkata' })
  @IsOptional()
  @IsString()
  @MaxLength(60)
  timezone?: string;
  @ApiProperty({ required: false, example: 'INR' })
  @IsOptional()
  @Matches(ISO_CURRENCY, { message: 'defaultCurrency must be a 3-letter ISO code' })
  defaultCurrency?: string;
  @ApiProperty({ required: false, example: '#1E40AF' })
  @IsOptional()
  @Matches(HEX, { message: 'primaryColor must be a 6-digit hex value such as #1E40AF' })
  primaryColor?: string;
  @ApiProperty({ required: false, example: '#0EA5E9' })
  @IsOptional()
  @Matches(HEX, { message: 'accentColor must be a 6-digit hex value such as #0EA5E9' })
  accentColor?: string;
}

export const LOGO_KINDS = ['logo', 'logo_light', 'logo_dark', 'favicon'] as const;

export class LogoKindQueryDto {
  @ApiProperty({ required: false, enum: LOGO_KINDS })
  @IsOptional()
  @IsIn(LOGO_KINDS as unknown as string[])
  kind?: string;
}
