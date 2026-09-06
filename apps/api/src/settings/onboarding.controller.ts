import { Controller, Get, HttpCode, Post } from '@nestjs/common';
import {
  ApiForbiddenResponse,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
  ApiUnauthorizedResponse,
} from '@nestjs/swagger';
import { AuthOnly, RequirePermission, Security } from '../security/security.decorators.js';
import type { SecurityContext } from '../security/security-context.js';
import { ApiErrorDto } from '../auth/auth.dto.js';
import { scope } from '../supply/common.js';
import { OnboardingService } from './onboarding.service.js';
import { OnboardingDto } from './settings.dto.js';

/** Tenant onboarding checklist (Phase 10, ADR 0039). Role-aware, derived, dismissible. */
@ApiTags('settings')
@ApiUnauthorizedResponse({ type: ApiErrorDto })
@ApiForbiddenResponse({ type: ApiErrorDto })
@Controller('onboarding')
export class OnboardingController {
  constructor(private readonly onboarding: OnboardingService) {}

  @Get()
  @AuthOnly()
  @ApiOperation({
    operationId: 'getOnboarding',
    summary: 'The workspace onboarding checklist for the current user.',
  })
  @ApiOkResponse({ type: OnboardingDto })
  get(@Security() ctx: SecurityContext) {
    return this.onboarding.get(scope(ctx), ctx);
  }

  @Post('dismiss')
  @HttpCode(200)
  @RequirePermission('settings.company.update')
  @ApiOperation({ operationId: 'dismissOnboarding', summary: 'Dismiss the onboarding checklist.' })
  @ApiOkResponse({ type: OnboardingDto })
  async dismiss(@Security() ctx: SecurityContext) {
    await this.onboarding.dismiss(scope(ctx));
    return this.onboarding.get(scope(ctx), ctx);
  }
}
