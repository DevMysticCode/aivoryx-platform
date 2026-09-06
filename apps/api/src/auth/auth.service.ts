import { Inject, Injectable, Logger } from '@nestjs/common';
import { and, eq, sql } from 'drizzle-orm';
import { getDb, schema, withAppTransaction, withTenantContext, withUserContext } from '@aivoryx/db';
import { AppError } from '@aivoryx/shared';
import type { ServerEnv } from '@aivoryx/config';
import { SERVER_ENV } from '../config/config.module.js';
import type { SecurityMembership } from '../security/security-context.js';
import { AuditService } from '../audit/audit.service.js';
import { PasswordService } from './password.service.js';
import { SessionService } from './session.service.js';

const { tenants, userTenantMemberships, users } = schema;

// A well-formed Argon2id hash of a random value. `login` verifies against this
// when the email is unknown so the response time does not reveal account
// existence. Generated once at process start.
let dummyHashPromise: Promise<string> | null = null;

export interface MembershipView {
  id: string;
  tenantId: string;
  tenantSlug: string;
  tenantName: string;
  tenantStatus: 'active' | 'suspended';
  status: 'active' | 'suspended' | 'invited';
}

export interface LoginResult {
  token: string;
  sessionId: string;
  expiresAt: Date;
  userId: string;
  email: string;
  memberships: MembershipView[];
  activeMembershipId: string | null;
}

@Injectable()
export class AuthService {
  private readonly logger = new Logger(AuthService.name);

  constructor(
    @Inject(SERVER_ENV) private readonly env: ServerEnv,
    private readonly passwords: PasswordService,
    private readonly sessions: SessionService,
    private readonly audit: AuditService,
  ) {}

  /**
   * Record a security event in a tenant's audit log. Auth events can happen
   * before a tenant is resolved (multi-tenant login, logout with no active
   * tenant); those cases are intentionally NOT written to any tenant's log
   * (ADR 0040 §"auth events"). This is best-effort (`recordSafe`) — an audit
   * hiccup must never fail a login/logout.
   */
  private async auditSecurityEvent(
    tenantId: string,
    userId: string,
    membershipId: string,
    action: 'auth.login' | 'auth.logout' | 'auth.tenant_switched',
    sessionId: string,
  ): Promise<void> {
    await withTenantContext(getDb(), { tenantId, userId }, (tx) =>
      this.audit.recordSafe(tx, {
        tenantId,
        action,
        entityType: 'session',
        entityId: sessionId,
        actor: { type: 'USER', membershipId },
      }),
    );
  }

  private dummyHash(): Promise<string> {
    dummyHashPromise ??= this.passwords.hash(`dummy:${cryptoRandom()}`);
    return dummyHashPromise;
  }

  /**
   * Verify credentials, (re)hash if params changed, create a session. If the
   * user has exactly one usable membership it becomes the session's active
   * membership; otherwise the session starts with none and the client must call
   * `switchTenant` (ADR 0028).
   */
  async login(input: {
    email: string;
    password: string;
    ip?: string | null;
    userAgent?: string | null;
  }): Promise<LoginResult> {
    const emailNormalized = input.email.trim().toLowerCase();

    const user = await withAppTransaction(getDb(), async (tx) => {
      const [candidate] = await tx
        .select({
          id: users.id,
          email: users.email,
          status: users.status,
          passwordHash: users.passwordHash,
        })
        .from(users)
        .where(sql`lower(${users.email}) = ${emailNormalized}`)
        .limit(1);

      const hashToCheck = candidate?.passwordHash ?? (await this.dummyHash());
      const passwordOk = await this.passwords.verify(hashToCheck, input.password);

      if (!candidate || !candidate.passwordHash || !passwordOk || candidate.status !== 'active') {
        throw new AppError('AUTH_INVALID_CREDENTIALS');
      }

      if (this.passwords.needsRehash(candidate.passwordHash)) {
        const rehashed = await this.passwords.hash(input.password);
        await tx
          .update(users)
          .set({ passwordHash: rehashed, passwordUpdatedAt: sql`now()` })
          .where(eq(users.id, candidate.id));
      }

      return { id: candidate.id, email: candidate.email };
    });

    const memberships = await this.listMemberships(user.id);
    const usable = memberships.filter((m) => m.status === 'active' && m.tenantStatus === 'active');
    const activeMembershipId = usable.length === 1 ? usable[0]!.id : null;

    const { token, session } = await this.sessions.create({
      userId: user.id,
      activeMembershipId,
      ip: input.ip,
      userAgent: input.userAgent,
    });

    this.logger.log(
      { userId: user.id, sessionId: session.id, autoSelectedTenant: activeMembershipId !== null },
      'login succeeded',
    );

    // Only when login auto-selected a single tenant can this be attributed to a
    // tenant. Multi-tenant users generate `auth.tenant_switched` on their next call.
    if (activeMembershipId) {
      const active = usable.find((m) => m.id === activeMembershipId);
      if (active) {
        await this.auditSecurityEvent(
          active.tenantId,
          user.id,
          activeMembershipId,
          'auth.login',
          session.id,
        );
      }
    }

    return {
      token,
      sessionId: session.id,
      expiresAt: session.expiresAt,
      userId: user.id,
      email: user.email,
      memberships,
      activeMembershipId,
    };
  }

  async logout(sessionId: string): Promise<void> {
    await this.sessions.revoke(sessionId);
  }

  /** Logout with a known active tenant — records `auth.logout` in that tenant. */
  async logoutWithContext(
    sessionId: string,
    ctx: { tenantId: string; userId: string; membershipId: string } | null,
  ): Promise<void> {
    await this.sessions.revoke(sessionId);
    if (ctx) {
      await this.auditSecurityEvent(
        ctx.tenantId,
        ctx.userId,
        ctx.membershipId,
        'auth.logout',
        sessionId,
      );
    }
  }

  /** Every membership the user holds, with its tenant. RLS `utm_self_read` scopes this to the user. */
  async listMemberships(userId: string): Promise<MembershipView[]> {
    return withUserContext(getDb(), userId, (tx) =>
      tx
        .select({
          id: userTenantMemberships.id,
          tenantId: userTenantMemberships.tenantId,
          tenantSlug: tenants.slug,
          tenantName: tenants.name,
          tenantStatus: tenants.status,
          status: userTenantMemberships.status,
        })
        .from(userTenantMemberships)
        .innerJoin(tenants, eq(tenants.id, userTenantMemberships.tenantId))
        .where(eq(userTenantMemberships.userId, userId))
        .orderBy(tenants.slug),
    );
  }

  /**
   * Resolve `membershipId` into a usable tenant context for `userId`, or throw a
   * specific error. Used by the guard on every tenant-scoped request and by
   * `switchTenant`.
   */
  async resolveActiveTenant(userId: string, membershipId: string): Promise<SecurityMembership> {
    const [row] = await withUserContext(getDb(), userId, (tx) =>
      tx
        .select({
          id: userTenantMemberships.id,
          userId: userTenantMemberships.userId,
          tenantId: userTenantMemberships.tenantId,
          tenantSlug: tenants.slug,
          tenantStatus: tenants.status,
          status: userTenantMemberships.status,
        })
        .from(userTenantMemberships)
        .innerJoin(tenants, eq(tenants.id, userTenantMemberships.tenantId))
        .where(
          and(eq(userTenantMemberships.id, membershipId), eq(userTenantMemberships.userId, userId)),
        )
        .limit(1),
    );

    if (!row) throw new AppError('AUTH_MEMBERSHIP_INVALID');
    if (row.status !== 'active') throw new AppError('AUTH_MEMBERSHIP_SUSPENDED');
    if (row.tenantStatus !== 'active') throw new AppError('TENANT_SUSPENDED');

    return {
      id: row.id,
      tenantId: row.tenantId,
      tenantSlug: row.tenantSlug,
      status: row.status,
    };
  }

  /** Change the session's active membership after full validation. */
  async switchTenant(
    input: { userId: string; sessionId: string },
    membershipId: string,
  ): Promise<SecurityMembership> {
    const membership = await this.resolveActiveTenant(input.userId, membershipId);
    await this.sessions.setActiveMembership(input.sessionId, membershipId);
    this.logger.log(
      { userId: input.userId, sessionId: input.sessionId, tenantId: membership.tenantId },
      'active tenant switched',
    );
    await this.auditSecurityEvent(
      membership.tenantId,
      input.userId,
      membershipId,
      'auth.tenant_switched',
      input.sessionId,
    );
    return membership;
  }
}

function cryptoRandom(): string {
  return Math.random().toString(36).slice(2) + Date.now().toString(36);
}
