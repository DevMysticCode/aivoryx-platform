import {
  Body,
  Controller,
  Delete,
  Get,
  Header,
  HttpCode,
  Post,
  Put,
  Query,
  StreamableFile,
  UploadedFile,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import {
  ApiForbiddenResponse,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
  ApiUnauthorizedResponse,
} from '@nestjs/swagger';
import { AppError } from '@aivoryx/shared';
import { AuthOnly, RequirePermission, Security } from '../security/security.decorators.js';
import type { SecurityContext } from '../security/security-context.js';
import { ApiErrorDto } from '../auth/auth.dto.js';
import { scope } from '../supply/common.js';
import { schema } from '@aivoryx/db';
import { CompanyProfileService } from './company-profile.service.js';
import { TenantLogoService } from './tenant-logo.service.js';
import {
  BrandingDto,
  CompanyProfileDto,
  LOGO_KINDS,
  LogoKindQueryDto,
  UpdateCompanyProfileDto,
} from './settings.dto.js';

type LogoKind = schema.TenantAssetRow['kind'];
const asKind = (q?: string): LogoKind =>
  (LOGO_KINDS as readonly string[]).includes(q ?? '') ? (q as LogoKind) : 'logo';

/**
 * Workspace company profile & branding (Phase 10, ADR 0039). Editing requires
 * `settings.company.*`; consuming branding (the compact `/branding` payload and
 * the authenticated logo stream) requires only an active session, so the app
 * shell can render tenant identity for every member.
 */
@ApiTags('settings')
@ApiUnauthorizedResponse({ type: ApiErrorDto })
@ApiForbiddenResponse({ type: ApiErrorDto })
@Controller('settings')
export class SettingsController {
  constructor(
    private readonly profiles: CompanyProfileService,
    private readonly logos: TenantLogoService,
  ) {}

  @Get('company')
  @RequirePermission('settings.company.read')
  @ApiOperation({ operationId: 'getCompanyProfile', summary: 'The workspace company profile.' })
  @ApiOkResponse({ type: CompanyProfileDto })
  getCompany(@Security() ctx: SecurityContext) {
    return this.profiles.get(scope(ctx));
  }

  @Put('company')
  @HttpCode(200)
  @RequirePermission('settings.company.update')
  @ApiOperation({ operationId: 'updateCompanyProfile', summary: 'Edit the company profile.' })
  @ApiOkResponse({ type: CompanyProfileDto })
  updateCompany(@Security() ctx: SecurityContext, @Body() body: UpdateCompanyProfileDto) {
    return this.profiles.update(scope(ctx), body);
  }

  @Get('branding')
  @AuthOnly()
  @ApiOperation({
    operationId: 'getBranding',
    summary: 'Compact tenant branding for the app shell (no permission required).',
  })
  @ApiOkResponse({ type: BrandingDto })
  getBranding(@Security() ctx: SecurityContext) {
    const s = scope(ctx);
    return this.profiles.getBranding({ tenantId: s.tenantId, userId: s.userId });
  }

  @Post('company/logo')
  @HttpCode(200)
  @RequirePermission('settings.company.update')
  @UseInterceptors(FileInterceptor('file'))
  @ApiOperation({ operationId: 'uploadTenantLogo', summary: 'Upload a logo / favicon.' })
  async uploadLogo(
    @Security() ctx: SecurityContext,
    @Query() query: LogoKindQueryDto,
    @UploadedFile() file: Express.Multer.File,
  ) {
    if (!file) throw new AppError('LOGO_INVALID', { details: { reason: 'no_file' } });
    await this.logos.upload(scope(ctx), asKind(query.kind), {
      buffer: file.buffer,
      contentType: file.mimetype,
      originalFilename: file.originalname,
      size: file.size,
    });
    return this.profiles.get(scope(ctx));
  }

  @Delete('company/logo')
  @HttpCode(200)
  @RequirePermission('settings.company.update')
  @ApiOperation({ operationId: 'removeTenantLogo', summary: 'Remove a logo / favicon.' })
  async removeLogo(@Security() ctx: SecurityContext, @Query() query: LogoKindQueryDto) {
    await this.logos.remove(scope(ctx), asKind(query.kind));
    return this.profiles.get(scope(ctx));
  }

  @Get('company/logo')
  @AuthOnly()
  @Header('Cache-Control', 'private, max-age=60')
  @ApiOperation({
    operationId: 'getTenantLogo',
    summary: 'Stream the active workspace’s logo (no permission required).',
  })
  async getLogo(@Security() ctx: SecurityContext, @Query() query: LogoKindQueryDto) {
    const s = scope(ctx);
    const obj = await this.logos.read(
      { tenantId: s.tenantId, userId: s.userId },
      asKind(query.kind),
    );
    if (!obj) throw new AppError('LOGO_NOT_FOUND', { details: { kind: asKind(query.kind) } });
    return new StreamableFile(obj.body, { type: obj.contentType });
  }
}
