import { Injectable, Logger } from '@nestjs/common';
import { and, eq, sql } from 'drizzle-orm';
import { getDb, schema, withTenantContext, type Tx } from '@aivoryx/db';
import { AppError, PLATFORM_ROLE_KEYS } from '@aivoryx/shared';
import {
  countUsableTenantAdmins,
  findRoleByKey,
  getMembershipRoleKeys,
  loadMemberView,
  loadMemberViews,
  type MemberView,
} from './admin-queries.js';
import { InvitationService } from './invitation.service.js';
import { AuditService, userActor } from '../audit/audit.service.js';

const { membershipRoles, userTenantMemberships } = schema;

export interface TenantScope {
  tenantId: string;
  userId: string;
  /** the acting membership — for audit attribution */
  actorMembershipId: string;
}

/**
 * Tenant membership lifecycle (ADR 0030). All operations run inside
 * `withTenantContext`, so PostgreSQL RLS scopes every read/write to the active
 * tenant; a membership in another tenant is invisible and unmodifiable.
 *
 * The "last usable TENANT_ADMIN" invariant is enforced before suspend, remove,
 * and TENANT_ADMIN role removal.
 */
@Injectable()
export class MembersService {
  private readonly logger = new Logger(MembersService.name);

  constructor(
    private readonly invitations: InvitationService,
    private readonly audit: AuditService,
  ) {}

  list(scope: TenantScope): Promise<MemberView[]> {
    return withTenantContext(getDb(), scope, (tx) => loadMemberViews(tx, scope.tenantId));
  }

  async get(scope: TenantScope, membershipId: string): Promise<MemberView> {
    const member = await withTenantContext(getDb(), scope, (tx) =>
      loadMemberView(tx, scope.tenantId, membershipId),
    );
    if (!member) throw new AppError('MEMBER_NOT_FOUND');
    return member;
  }

  /** Invite (or re-invite) a person into the active tenant. Returns the member + one-time token. */
  async invite(
    scope: TenantScope,
    input: { email: string; name?: string; roleKeys?: string[] },
  ): Promise<{ member: MemberView; invitation: { id: string; token: string; expiresAt: string } }> {
    const created = await this.invitations.create({
      tenantId: scope.tenantId,
      actingUserId: scope.userId,
      actingMembershipId: scope.actorMembershipId,
      email: input.email,
      name: input.name,
      roleKeys: input.roleKeys ?? [],
    });
    const member = await this.get(scope, created.membershipId);
    return {
      member,
      invitation: { id: created.invitationId, token: created.token, expiresAt: created.expiresAt },
    };
  }

  /** Suspend or reactivate a membership. */
  async setStatus(
    scope: TenantScope,
    membershipId: string,
    status: 'active' | 'suspended',
  ): Promise<MemberView> {
    return withTenantContext(getDb(), scope, async (tx) => {
      const [current] = await tx
        .select({ id: userTenantMemberships.id, status: userTenantMemberships.status })
        .from(userTenantMemberships)
        .where(
          and(
            eq(userTenantMemberships.id, membershipId),
            eq(userTenantMemberships.tenantId, scope.tenantId),
          ),
        )
        .limit(1);
      if (!current) throw new AppError('MEMBER_NOT_FOUND');

      if (status === 'suspended' && current.status === 'active') {
        await this.assertNotLastAdmin(tx, scope.tenantId, membershipId);
      }

      await tx
        .update(userTenantMemberships)
        .set({ status, updatedAt: sql`now()` })
        .where(eq(userTenantMemberships.id, membershipId));

      await this.audit.record(tx, {
        tenantId: scope.tenantId,
        action: status === 'suspended' ? 'tenant.member.suspended' : 'tenant.member.reactivated',
        entityType: 'membership',
        entityId: membershipId,
        actor: userActor(scope),
        changes: { status: { from: current.status, to: status } },
      });

      this.logger.log(
        { tenantId: scope.tenantId, membershipId, status },
        'membership status changed',
      );
      const member = await loadMemberView(tx, scope.tenantId, membershipId);
      return member!;
    });
  }

  /** Remove a membership entirely. Cascades roles, sessions active in this tenant, and invitations. */
  async remove(scope: TenantScope, membershipId: string): Promise<void> {
    await withTenantContext(getDb(), scope, async (tx) => {
      const [current] = await tx
        .select({ id: userTenantMemberships.id, status: userTenantMemberships.status })
        .from(userTenantMemberships)
        .where(
          and(
            eq(userTenantMemberships.id, membershipId),
            eq(userTenantMemberships.tenantId, scope.tenantId),
          ),
        )
        .limit(1);
      if (!current) throw new AppError('MEMBER_NOT_FOUND');

      if (current.status === 'active') {
        await this.assertNotLastAdmin(tx, scope.tenantId, membershipId);
      }

      await this.invitations.revokeForMembershipTx(tx, membershipId);
      await this.audit.record(tx, {
        tenantId: scope.tenantId,
        action: 'tenant.member.removed',
        entityType: 'membership',
        entityId: membershipId,
        actor: userActor(scope),
        metadata: { priorStatus: current.status },
      });
      await tx.delete(userTenantMemberships).where(eq(userTenantMemberships.id, membershipId));
      this.logger.log({ tenantId: scope.tenantId, membershipId }, 'membership removed');
    });
  }

  /** Assign a generic platform role to a membership (idempotent). */
  async assignRole(scope: TenantScope, membershipId: string, roleKey: string): Promise<MemberView> {
    return withTenantContext(getDb(), scope, async (tx) => {
      const member = await this.requireMembership(tx, scope.tenantId, membershipId);
      const role = await findRoleByKey(tx, scope.tenantId, roleKey);
      if (!role) throw new AppError('ROLE_NOT_FOUND', { details: { roleKey } });

      const inserted = await tx
        .insert(membershipRoles)
        .values({ membershipId: member.id, roleId: role.id, tenantId: scope.tenantId })
        .onConflictDoNothing()
        .returning({ membershipId: membershipRoles.membershipId });

      if (inserted.length > 0) {
        await this.audit.record(tx, {
          tenantId: scope.tenantId,
          action: 'tenant.member.role_added',
          entityType: 'membership',
          entityId: member.id,
          actor: userActor(scope),
          metadata: { roleKey },
        });
      }

      this.logger.log({ tenantId: scope.tenantId, membershipId, roleKey }, 'role assigned');
      const view = await loadMemberView(tx, scope.tenantId, membershipId);
      return view!;
    });
  }

  /** Remove a role from a membership. Protects the last usable TENANT_ADMIN. */
  async removeRole(scope: TenantScope, membershipId: string, roleKey: string): Promise<MemberView> {
    return withTenantContext(getDb(), scope, async (tx) => {
      const member = await this.requireMembership(tx, scope.tenantId, membershipId);
      const role = await findRoleByKey(tx, scope.tenantId, roleKey);
      if (!role) throw new AppError('ROLE_NOT_FOUND', { details: { roleKey } });

      if (roleKey === PLATFORM_ROLE_KEYS.tenantAdmin && member.status === 'active') {
        await this.assertNotLastAdmin(tx, scope.tenantId, membershipId);
      }

      const removed = await tx
        .delete(membershipRoles)
        .where(
          and(eq(membershipRoles.membershipId, member.id), eq(membershipRoles.roleId, role.id)),
        )
        .returning({ membershipId: membershipRoles.membershipId });

      if (removed.length > 0) {
        await this.audit.record(tx, {
          tenantId: scope.tenantId,
          action: 'tenant.member.role_removed',
          entityType: 'membership',
          entityId: member.id,
          actor: userActor(scope),
          metadata: { roleKey },
        });
      }

      this.logger.log({ tenantId: scope.tenantId, membershipId, roleKey }, 'role removed');
      const view = await loadMemberView(tx, scope.tenantId, membershipId);
      return view!;
    });
  }

  // ---- helpers --------------------------------------------------------

  private async requireMembership(
    tx: Tx,
    tenantId: string,
    membershipId: string,
  ): Promise<{ id: string; status: 'active' | 'suspended' | 'invited' }> {
    const [row] = await tx
      .select({ id: userTenantMemberships.id, status: userTenantMemberships.status })
      .from(userTenantMemberships)
      .where(
        and(
          eq(userTenantMemberships.id, membershipId),
          eq(userTenantMemberships.tenantId, tenantId),
        ),
      )
      .limit(1);
    if (!row) throw new AppError('MEMBER_NOT_FOUND');
    return row;
  }

  /** Throw `TENANT_LAST_ADMIN` if `membershipId` is an admin and no other active admin remains. */
  private async assertNotLastAdmin(tx: Tx, tenantId: string, membershipId: string): Promise<void> {
    const roleKeys = await getMembershipRoleKeys(tx, membershipId);
    if (!roleKeys.includes(PLATFORM_ROLE_KEYS.tenantAdmin)) return;
    const remaining = await countUsableTenantAdmins(tx, tenantId, membershipId);
    if (remaining === 0) throw new AppError('TENANT_LAST_ADMIN');
  }
}
