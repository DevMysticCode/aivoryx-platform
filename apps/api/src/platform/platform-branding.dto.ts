import { ApiProperty } from '@nestjs/swagger';
import { IsIn, IsOptional, IsString, Matches, MaxLength } from 'class-validator';
import { THEME_PRESET_KEYS } from '@aivoryx/shared';

const HEX = /^#[0-9a-fA-F]{6}$/;

export const PLATFORM_ASSET_KINDS = [
  'logo_light',
  'logo_dark',
  'mark',
  'favicon',
  'login_logo',
  'apple_touch',
  'pwa_192',
  'pwa_512',
] as const;
export type PlatformAssetKind = (typeof PLATFORM_ASSET_KINDS)[number];

export class PlatformAssetKindQueryDto {
  @ApiProperty({ enum: PLATFORM_ASSET_KINDS })
  @IsIn(PLATFORM_ASSET_KINDS as unknown as string[])
  kind!: string;
}

export class PlatformBrandingDto {
  @ApiProperty({ nullable: true, type: String }) platformName!: string | null;
  @ApiProperty({ nullable: true, type: String }) tagline!: string | null;
  @ApiProperty({ nullable: true, type: String, enum: THEME_PRESET_KEYS })
  themePreset!: string | null;
  @ApiProperty({ nullable: true, type: String }) primaryColor!: string | null;
  @ApiProperty({ nullable: true, type: String }) secondaryColor!: string | null;
  @ApiProperty({ nullable: true, type: String }) accentColor!: string | null;
  @ApiProperty({ nullable: true, type: String }) loginHeading!: string | null;
  @ApiProperty({ nullable: true, type: String }) loginText!: string | null;
  @ApiProperty() hasLogoLight!: boolean;
  @ApiProperty() hasLogoDark!: boolean;
  @ApiProperty() hasMark!: boolean;
  @ApiProperty() hasFavicon!: boolean;
  @ApiProperty() hasLoginLogo!: boolean;
  @ApiProperty() hasAppleTouch!: boolean;
  @ApiProperty() hasPwa192!: boolean;
  @ApiProperty() hasPwa512!: boolean;
  @ApiProperty({ nullable: true, type: String, format: 'date-time' }) updatedAt!: string | null;
  @ApiProperty({ description: 'Cache-busting token; changes on any branding or asset change.' })
  version!: string;
}

export class UpdatePlatformBrandingDto {
  @ApiProperty({ required: false, maxLength: 80, description: 'Empty string clears.' })
  @IsOptional()
  @IsString()
  @MaxLength(80)
  platformName?: string;
  @ApiProperty({ required: false, maxLength: 160, description: 'Empty string clears.' })
  @IsOptional()
  @IsString()
  @MaxLength(160)
  tagline?: string;
  @ApiProperty({ required: false, enum: THEME_PRESET_KEYS })
  @IsOptional()
  @IsIn(THEME_PRESET_KEYS as unknown as string[])
  themePreset?: string;
  @ApiProperty({ required: false, example: '#1E40AF' })
  @IsOptional()
  @Matches(HEX, { message: 'primaryColor must be a 6-digit hex value such as #1E40AF' })
  primaryColor?: string;
  @ApiProperty({ required: false, example: '#231D45' })
  @IsOptional()
  @Matches(HEX, { message: 'secondaryColor must be a 6-digit hex value such as #231D45' })
  secondaryColor?: string;
  @ApiProperty({ required: false, example: '#0EA5E9' })
  @IsOptional()
  @Matches(HEX, { message: 'accentColor must be a 6-digit hex value such as #0EA5E9' })
  accentColor?: string;
  @ApiProperty({ required: false, maxLength: 80, description: 'Empty string clears.' })
  @IsOptional()
  @IsString()
  @MaxLength(80)
  loginHeading?: string;
  @ApiProperty({ required: false, maxLength: 240, description: 'Empty string clears.' })
  @IsOptional()
  @IsString()
  @MaxLength(240)
  loginText?: string;
}

export class PublicPlatformAssetFlagsDto {
  @ApiProperty() logoLight!: boolean;
  @ApiProperty() logoDark!: boolean;
  @ApiProperty() mark!: boolean;
  @ApiProperty() favicon!: boolean;
  @ApiProperty() loginLogo!: boolean;
  @ApiProperty() appleTouch!: boolean;
  @ApiProperty() pwa192!: boolean;
  @ApiProperty() pwa512!: boolean;
}

/** Everything the public/pre-auth surface may learn about platform branding. */
export class PublicPlatformBrandingDto {
  @ApiProperty() name!: string;
  @ApiProperty({ nullable: true, type: String }) tagline!: string | null;
  @ApiProperty({ nullable: true, type: String, enum: THEME_PRESET_KEYS })
  themePreset!: string | null;
  @ApiProperty({ nullable: true, type: String }) primaryColor!: string | null;
  @ApiProperty({ nullable: true, type: String }) secondaryColor!: string | null;
  @ApiProperty({ nullable: true, type: String }) accentColor!: string | null;
  @ApiProperty({ nullable: true, type: String }) loginHeading!: string | null;
  @ApiProperty({ nullable: true, type: String }) loginText!: string | null;
  @ApiProperty({ type: PublicPlatformAssetFlagsDto }) assets!: PublicPlatformAssetFlagsDto;
  @ApiProperty({ description: 'Cache-busting token (updatedAt ms; "0" when unconfigured).' })
  version!: string;
}
