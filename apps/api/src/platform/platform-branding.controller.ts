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
  ApiConsumes,
  ApiForbiddenResponse,
  ApiNotFoundResponse,
  ApiOkResponse,
  ApiOperation,
  ApiQuery,
  ApiTags,
  ApiUnauthorizedResponse,
} from '@nestjs/swagger';
import { AppError } from '@aivoryx/shared';
import { PlatformAdmin, Public, Security } from '../security/security.decorators.js';
import type { SecurityContext } from '../security/security-context.js';
import { ApiErrorDto } from './platform.dto.js';
import { PlatformBrandingService } from './platform-branding.service.js';
import {
  PLATFORM_ASSET_KINDS,
  PlatformAssetKindQueryDto,
  PlatformBrandingDto,
  PublicPlatformBrandingDto,
  UpdatePlatformBrandingDto,
  type PlatformAssetKind,
} from './platform-branding.dto.js';

/**
 * Platform branding administration (Phase 20). Every route is `@PlatformAdmin()`
 * — a tenant admin, whatever their tenant permissions, gets 403.
 */
@ApiTags('platform')
@ApiUnauthorizedResponse({ type: ApiErrorDto })
@ApiForbiddenResponse({ type: ApiErrorDto })
@Controller('platform/branding')
export class PlatformBrandingController {
  constructor(private readonly branding: PlatformBrandingService) {}

  @Get()
  @PlatformAdmin()
  @ApiOperation({ operationId: 'getPlatformBranding', summary: 'The platform branding config.' })
  @ApiOkResponse({ type: PlatformBrandingDto })
  get() {
    return this.branding.getAdmin();
  }

  @Put()
  @HttpCode(200)
  @PlatformAdmin()
  @ApiOperation({ operationId: 'updatePlatformBranding', summary: 'Edit platform branding.' })
  @ApiOkResponse({ type: PlatformBrandingDto })
  update(@Security() ctx: SecurityContext, @Body() body: UpdatePlatformBrandingDto) {
    return this.branding.update(ctx.user.id, body);
  }

  @Post('assets')
  @HttpCode(200)
  @PlatformAdmin()
  @UseInterceptors(FileInterceptor('file'))
  @ApiConsumes('multipart/form-data')
  @ApiOperation({
    operationId: 'uploadPlatformBrandingAsset',
    summary: 'Upload a platform logo / icon.',
  })
  @ApiOkResponse({ type: PlatformBrandingDto })
  upload(
    @Security() ctx: SecurityContext,
    @Query() query: PlatformAssetKindQueryDto,
    @UploadedFile() file: Express.Multer.File,
  ) {
    if (!file) throw new AppError('LOGO_INVALID', { details: { reason: 'no_file' } });
    return this.branding.uploadAsset(ctx.user.id, query.kind as PlatformAssetKind, {
      buffer: file.buffer,
      contentType: file.mimetype,
      originalFilename: file.originalname,
      size: file.size,
    });
  }

  @Delete('assets')
  @HttpCode(200)
  @PlatformAdmin()
  @ApiOperation({
    operationId: 'removePlatformBrandingAsset',
    summary: 'Remove a platform logo / icon.',
  })
  @ApiOkResponse({ type: PlatformBrandingDto })
  remove(@Security() ctx: SecurityContext, @Query() query: PlatformAssetKindQueryDto) {
    return this.branding.removeAsset(ctx.user.id, query.kind as PlatformAssetKind);
  }
}

/**
 * Pre-auth platform branding: the default identity for the login page,
 * favicon/manifest and tenants with no theme or logo. Public, read-only,
 * minimal; never exposes object keys. Kept separate from tenant-scoped code.
 */
@ApiTags('public')
@Controller('public/platform/branding')
export class PublicPlatformBrandingController {
  constructor(private readonly branding: PlatformBrandingService) {}

  @Get()
  @Public()
  @ApiOperation({
    operationId: 'getPublicPlatformBranding',
    summary: 'Safe platform branding (defaults when unconfigured; no authentication).',
  })
  @ApiOkResponse({ type: PublicPlatformBrandingDto })
  get() {
    return this.branding.getPublic();
  }

  @Get('asset')
  @Public()
  @Header('Cache-Control', 'public, max-age=300')
  @ApiOperation({
    operationId: 'getPublicPlatformBrandingAsset',
    summary: 'Stream a platform branding asset.',
  })
  @ApiQuery({ name: 'kind', enum: PLATFORM_ASSET_KINDS })
  @ApiNotFoundResponse({ type: ApiErrorDto, description: 'PLATFORM_ASSET_NOT_FOUND' })
  async asset(@Query('kind') kind?: string) {
    if (!(PLATFORM_ASSET_KINDS as readonly string[]).includes(kind ?? '')) {
      throw new AppError('PLATFORM_ASSET_NOT_FOUND');
    }
    const obj = await this.branding.readAsset(kind as PlatformAssetKind);
    if (!obj) throw new AppError('PLATFORM_ASSET_NOT_FOUND');
    return new StreamableFile(obj.body, { type: obj.contentType });
  }
}
