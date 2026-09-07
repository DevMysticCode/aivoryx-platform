import { Body, Controller, Get, Inject, Post, Req, Res } from '@nestjs/common';
import {
  ApiOkResponse,
  ApiOperation,
  ApiTags,
  ApiUnauthorizedResponse,
  ApiForbiddenResponse,
} from '@nestjs/swagger';
import type { CookieOptions, Request, Response } from 'express';
import type { ServerEnv } from '@aivoryx/config';
import { SERVER_ENV } from '../config/config.module.js';
import { AuthOnly, Public, Security } from '../security/security.decorators.js';
import type { SecurityContext } from '../security/security-context.js';
import { AuthService, type MembershipView } from './auth.service.js';
import { RbacService } from './rbac.service.js';
import { CompanyProfileService } from '../settings/company-profile.service.js';
import { EntitlementService } from '../entitlements/entitlement.service.js';
import { PlatformAdminService } from '../entitlements/platform-admin.service.js';
import { moduleForPermission } from '@aivoryx/shared';
import {
  ActiveContextDto,
  ApiErrorDto,
  LoginRequestDto,
  LoginResponseDto,
  LogoutResponseDto,
  MeResponseDto,
  MembershipSummaryDto,
  SwitchTenantRequestDto,
  SwitchTenantResponseDto,
} from './auth.dto.js';

@ApiTags('auth')
@Controller('auth')
export class AuthController {
  constructor(
    @Inject(SERVER_ENV) private readonly env: ServerEnv,
    private readonly auth: AuthService,
    private readonly rbac: RbacService,
    private readonly companyProfiles: CompanyProfileService,
    private readonly entitlements: EntitlementService,
    private readonly platformAdmins: PlatformAdminService,
  ) {}

  @Post('login')
  @Public()
  @ApiOperation({
    operationId: 'login',
    summary: 'Exchange email + password for a session cookie.',
  })
  @ApiOkResponse({ type: LoginResponseDto })
  @ApiUnauthorizedResponse({ type: ApiErrorDto, description: 'AUTH_INVALID_CREDENTIALS' })
  async login(
    @Body() body: LoginRequestDto,
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ): Promise<LoginResponseDto> {
    const result = await this.auth.login({
      email: body.email,
      password: body.password,
      ip: req.ip ?? null,
      userAgent: req.get('user-agent') ?? null,
    });

    res.cookie(this.env.SESSION_COOKIE_NAME, result.token, this.cookieOptions());

    const active = result.activeMembershipId
      ? await this.buildActiveContext(
          result.userId,
          result.memberships.find((m) => m.id === result.activeMembershipId)!,
        )
      : null;

    return {
      user: { id: result.userId, email: result.email, status: 'active' },
      isPlatformAdmin: await this.platformAdmins.isPlatformAdmin(result.userId),
      memberships: result.memberships.map(toSummary),
      active,
      sessionExpiresAt: result.expiresAt.toISOString(),
      tenantAutoSelected: result.activeMembershipId !== null,
    };
  }

  @Post('logout')
  @AuthOnly()
  @ApiOperation({ operationId: 'logout', summary: 'Revoke the current session.' })
  @ApiOkResponse({ type: LogoutResponseDto })
  @ApiUnauthorizedResponse({ type: ApiErrorDto })
  async logout(
    @Security() ctx: SecurityContext,
    @Res({ passthrough: true }) res: Response,
  ): Promise<LogoutResponseDto> {
    await this.auth.logoutWithContext(
      ctx.session.id,
      ctx.tenantId && ctx.membership
        ? { tenantId: ctx.tenantId, userId: ctx.user.id, membershipId: ctx.membership.id }
        : null,
    );
    res.clearCookie(this.env.SESSION_COOKIE_NAME, this.clearCookieOptions());
    return { ok: true };
  }

  @Get('me')
  @AuthOnly()
  @ApiOperation({
    operationId: 'me',
    summary: 'The current user, their memberships and active tenant.',
  })
  @ApiOkResponse({ type: MeResponseDto })
  @ApiUnauthorizedResponse({ type: ApiErrorDto })
  async me(@Security() ctx: SecurityContext): Promise<MeResponseDto> {
    return this.presentMe(ctx);
  }

  @Post('switch-tenant')
  @AuthOnly()
  @ApiOperation({
    operationId: 'switchTenant',
    summary: 'Set the active tenant for this session to one of the user’s own memberships.',
  })
  @ApiOkResponse({ type: SwitchTenantResponseDto })
  @ApiUnauthorizedResponse({ type: ApiErrorDto })
  @ApiForbiddenResponse({
    type: ApiErrorDto,
    description: 'AUTH_MEMBERSHIP_INVALID / AUTH_MEMBERSHIP_SUSPENDED / TENANT_SUSPENDED',
  })
  async switchTenant(
    @Security() ctx: SecurityContext,
    @Body() body: SwitchTenantRequestDto,
  ): Promise<SwitchTenantResponseDto> {
    const membership = await this.auth.switchTenant(
      { userId: ctx.user.id, sessionId: ctx.session.id },
      body.membershipId,
    );
    // Re-present with the freshly selected tenant.
    const memberships = await this.auth.listMemberships(ctx.user.id);
    const active = await this.buildActiveContext(
      ctx.user.id,
      memberships.find((m) => m.id === membership.id)!,
    );
    return {
      user: ctx.user,
      isPlatformAdmin: ctx.isPlatformAdmin,
      memberships: memberships.map(toSummary),
      active,
      sessionExpiresAt: ctx.session.expiresAt.toISOString(),
    };
  }

  // ---- helpers ----------------------------------------------------------

  private async presentMe(ctx: SecurityContext): Promise<MeResponseDto> {
    const memberships = await this.auth.listMemberships(ctx.user.id);
    const active =
      ctx.membership && ctx.tenantId
        ? await this.buildActiveContext(
            ctx.user.id,
            memberships.find((m) => m.id === ctx.membership!.id) ?? null,
            ctx.permissions,
            ctx.entitledModules,
          )
        : null;
    return {
      user: ctx.user,
      isPlatformAdmin: ctx.isPlatformAdmin,
      memberships: memberships.map(toSummary),
      active,
      sessionExpiresAt: ctx.session.expiresAt.toISOString(),
    };
  }

  private async buildActiveContext(
    userId: string,
    membership: MembershipView | null,
    knownPermissions?: ReadonlySet<string>,
    knownEntitledModules?: ReadonlySet<string>,
  ): Promise<ActiveContextDto | null> {
    if (!membership) return null;
    const [roles, rawPermissions, entitledModules] = await Promise.all([
      this.rbac.rolesForMembership({
        membershipId: membership.id,
        tenantId: membership.tenantId,
        userId,
      }),
      knownPermissions
        ? Promise.resolve(knownPermissions)
        : this.rbac.permissionsForMembership({
            membershipId: membership.id,
            tenantId: membership.tenantId,
            userId,
          }),
      knownEntitledModules
        ? Promise.resolve(knownEntitledModules)
        : this.entitlements.getEnabledModules({ tenantId: membership.tenantId, userId }),
    ]);
    const branding = await this.companyProfiles.getBranding({
      tenantId: membership.tenantId,
      userId,
    });
    // effective permissions: entitlement always precedes permission (ADR 0042).
    const effective = [...rawPermissions]
      .filter((k) => {
        const m = moduleForPermission(k);
        return m === null || entitledModules.has(m);
      })
      .sort();
    return {
      membership: toSummary(membership),
      permissions: effective,
      roles: roles.map((r) => r.key).sort(),
      entitledModules: [...entitledModules].sort(),
      branding,
    };
  }

  private cookieOptions(): CookieOptions {
    return {
      httpOnly: true,
      secure: this.cookieSecure(),
      sameSite: this.env.SESSION_COOKIE_SAMESITE,
      path: '/',
      maxAge: this.env.SESSION_ABSOLUTE_TTL_HOURS * 3_600_000,
    };
  }

  private clearCookieOptions(): CookieOptions {
    return {
      httpOnly: true,
      secure: this.cookieSecure(),
      sameSite: this.env.SESSION_COOKIE_SAMESITE,
      path: '/',
    };
  }

  private cookieSecure(): boolean {
    return this.env.SESSION_COOKIE_SECURE ?? this.env.APP_ENV !== 'development';
  }
}

function toSummary(m: MembershipView): MembershipSummaryDto {
  return {
    id: m.id,
    tenantId: m.tenantId,
    tenantSlug: m.tenantSlug,
    tenantName: m.tenantName,
    tenantStatus: m.tenantStatus,
    status: m.status,
  };
}
