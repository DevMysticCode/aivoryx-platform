import { Controller, Get, Header, Param, StreamableFile } from '@nestjs/common';
import { ApiNotFoundResponse, ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger';
import { Public } from '../security/security.decorators.js';
import { ApiErrorDto } from '../auth/auth.dto.js';
import { PublicBrandingService } from './public-branding.service.js';
import { PublicLoginBrandingDto } from './public-branding.dto.js';

/**
 * Pre-auth, tenant-aware login branding (Phase 19). Public, read-only, minimal.
 * Never touches authentication or sessions.
 */
@ApiTags('public')
@Controller('public/workspaces')
export class PublicBrandingController {
  constructor(private readonly branding: PublicBrandingService) {}

  @Get(':slug/login-branding')
  @Public()
  @ApiOperation({
    operationId: 'getPublicLoginBranding',
    summary: 'Safe login-page branding for a workspace slug (no authentication).',
  })
  @ApiOkResponse({ type: PublicLoginBrandingDto })
  @ApiNotFoundResponse({ type: ApiErrorDto, description: 'WORKSPACE_NOT_FOUND' })
  getBranding(@Param('slug') slug: string) {
    return this.branding.getLoginBranding(slug);
  }

  @Get(':slug/login-logo')
  @Public()
  @Header('Cache-Control', 'public, max-age=300')
  @ApiOperation({
    operationId: 'getPublicLoginLogo',
    summary: 'Stream the workspace login logo (falls back to the primary logo).',
  })
  @ApiNotFoundResponse({ type: ApiErrorDto, description: 'WORKSPACE_NOT_FOUND' })
  async getLogo(@Param('slug') slug: string) {
    const obj = await this.branding.getLoginLogo(slug);
    return new StreamableFile(obj.body, { type: obj.contentType });
  }
}
