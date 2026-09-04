import { Body, Controller, HttpCode, Post } from '@nestjs/common';
import { ApiBadRequestResponse, ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger';
import { Public } from '../security/security.decorators.js';
import { InvitationService } from './invitation.service.js';
import {
  AcceptInvitationRequestDto,
  AcceptInvitationResponseDto,
  ApiErrorDto,
} from './admin.dto.js';

/**
 * Public onboarding endpoint (ADR 0030). It is the only place an invitation
 * token is consumed. It does not create a session — the invitee signs in
 * normally afterwards, so there is a single authentication path.
 */
@ApiTags('auth')
@Controller('auth')
export class InvitationController {
  constructor(private readonly invitations: InvitationService) {}

  @Post('accept-invitation')
  @Public()
  @HttpCode(200)
  @ApiOperation({
    operationId: 'acceptInvitation',
    summary: 'Accept a workspace invitation and finish account setup.',
  })
  @ApiOkResponse({ type: AcceptInvitationResponseDto })
  @ApiBadRequestResponse({
    type: ApiErrorDto,
    description:
      'INVITATION_INVALID / INVITATION_EXPIRED / INVITATION_REVOKED / INVITATION_ALREADY_USED / INVITATION_PASSWORD_REQUIRED',
  })
  async accept(@Body() body: AcceptInvitationRequestDto): Promise<AcceptInvitationResponseDto> {
    const result = await this.invitations.accept({
      token: body.token,
      password: body.password,
      name: body.name,
    });
    return { ok: true, email: result.email, tenantSlug: result.tenantSlug };
  }
}
