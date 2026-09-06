import { Injectable } from '@nestjs/common';
import { and, eq, inArray } from 'drizzle-orm';
import { schema, type Tx } from '@aivoryx/db';
import type { EffectiveRule } from './catalogue.js';
import type { EventRefs } from './event-context.js';

/**
 * Provider-neutral recipient resolution (ADR 0037). Strategies are explicit and
 * type-safe — there is no scripting. Everything runs inside the event's own
 * tenant RLS context; the event payload is never trusted to supply tenant
 * ownership. A resolved recipient is either an internal membership (in-app /
 * email to that user) or an external email address (customer comms).
 */

export interface ResolvedRecipient {
  membershipId?: string;
  /** account email for a membership recipient, or the external customer address */
  email?: string;
  /** stable identity for dedupe + the delivery record (membership id) */
  ref: string;
}

const { userTenantMemberships, users, membershipRoles, roles } = schema;
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

@Injectable()
export class RecipientResolver {
  async resolve(
    tx: Tx,
    tenantId: string,
    rule: EffectiveRule,
    refs: EventRefs,
  ): Promise<ResolvedRecipient[]> {
    switch (rule.recipientStrategy) {
      case 'USER':
        return this.membership(tx, tenantId, rule.membershipId);
      case 'ACTOR':
        return this.membership(tx, tenantId, refs.actorMembershipId);
      case 'ASSIGNED_USER':
        return this.membership(tx, tenantId, refs.assignedMembershipId);
      case 'ROLE':
        return this.byRole(tx, tenantId, rule.roleKey);
      case 'CUSTOMER':
        return this.customer(refs.customerEmail);
      default:
        return [];
    }
  }

  private async membership(
    tx: Tx,
    tenantId: string,
    membershipId: string | null | undefined,
  ): Promise<ResolvedRecipient[]> {
    if (!membershipId) return [];
    const [row] = await tx
      .select({
        id: userTenantMemberships.id,
        status: userTenantMemberships.status,
        email: users.email,
      })
      .from(userTenantMemberships)
      .innerJoin(users, eq(userTenantMemberships.userId, users.id))
      .where(
        and(
          eq(userTenantMemberships.tenantId, tenantId),
          eq(userTenantMemberships.id, membershipId),
        ),
      )
      .limit(1);
    if (!row || row.status !== 'active') return [];
    return [{ membershipId: row.id, email: row.email ?? undefined, ref: row.id }];
  }

  private async byRole(
    tx: Tx,
    tenantId: string,
    roleKey: string | undefined,
  ): Promise<ResolvedRecipient[]> {
    if (!roleKey) return [];
    const rows = await tx
      .select({ membershipId: membershipRoles.membershipId })
      .from(membershipRoles)
      .innerJoin(roles, eq(membershipRoles.roleId, roles.id))
      .where(and(eq(membershipRoles.tenantId, tenantId), eq(roles.key, roleKey)));
    const ids = [...new Set(rows.map((r) => r.membershipId))];
    if (ids.length === 0) return [];
    const active = await tx
      .select({ id: userTenantMemberships.id, email: users.email })
      .from(userTenantMemberships)
      .innerJoin(users, eq(userTenantMemberships.userId, users.id))
      .where(
        and(
          eq(userTenantMemberships.tenantId, tenantId),
          inArray(userTenantMemberships.id, ids),
          eq(userTenantMemberships.status, 'active'),
        ),
      );
    return active.map((m) => ({ membershipId: m.id, email: m.email ?? undefined, ref: m.id }));
  }

  private customer(email: string | null): ResolvedRecipient[] {
    if (!email) return [];
    const normalised = email.trim().toLowerCase();
    if (!EMAIL_RE.test(normalised)) return [];
    return [{ email: normalised, ref: normalised }];
  }
}
