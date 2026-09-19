import { ApiProperty } from '@nestjs/swagger';
import { THEME_PRESET_KEYS } from '@aivoryx/shared';

/** Everything the pre-auth login page may learn about a workspace - nothing else. */
export class PublicLoginBrandingDto {
  @ApiProperty() slug!: string;
  @ApiProperty() displayName!: string;
  @ApiProperty({ nullable: true, type: String, enum: THEME_PRESET_KEYS })
  themePreset!: string | null;
  @ApiProperty({ nullable: true, type: String }) primaryColor!: string | null;
  @ApiProperty({ nullable: true, type: String }) secondaryColor!: string | null;
  @ApiProperty({ nullable: true, type: String }) accentColor!: string | null;
  @ApiProperty({ nullable: true, type: String }) welcomeMessage!: string | null;
  @ApiProperty({ nullable: true, type: String }) description!: string | null;
  @ApiProperty() showPoweredBy!: boolean;
  @ApiProperty({ description: 'A login logo or the primary logo exists.' }) hasLogo!: boolean;
}
