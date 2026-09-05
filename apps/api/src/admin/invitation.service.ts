import { Inject, Injectable, Logger } from '@nestjs/common';
import { and, eq, sql } from 'drizzle-orm';
import { getDb, schema, withProgressiveContext, withTenantContext, type Tx } from '@aivoryx/db';
import { AppError } from '@aivoryx/shared';
import type { ServerEnv } from '@aivoryx/config';
import { SERVER_ENV } from '../config/config.module.js';
import { PasswordService } from '../auth/password.service.js';
import { generateInvitationToken, hashInvitationToken } from './invitation-token.js';
import { OutboxService } from './outbox.service.js';
import { resolveRoleKeys } from './admin-queries.js';

const { membershipRoles, tenantInvitations, userTenantMemberships, users } = schema;

export const INVITATION_CREATED_EVENT = 'user.invitation.created';

export interface CreateInvitationInput {
  tenantId: string;
  actingUserId: string;
  email: string;
  name?: string;
  roleKeys: string[];
}

export interface CreateInvitationResult {
  membershipId: string;
  invitationId: string;
  /** the plaintext token — returned ONCE, only here, for the onboarding flow */
  token: string;
  expiresAt: string;
}

export interface AcceptInvitationInput {
  token: string;
  password?: string;
  name?: string;
}

export interface AcceptInvitationResult {
  email: string;
  tenantSlug: string;
}

@Injectable()
export class InvitationService {
  private readonly logger = new Logger(InvitationService.name);
  private readonly ttlMs: number;

  constructor(
    @Inject(SERVER_ENV) env: ServerEnv,
    private readonly passwords: PasswordService,
    private readonly outbox: OutboxService,
  ) {
    this.ttlMs = env.INVITATION_TTL_HOURS * 3_600_000;
  }

  /**
   * Create (or re-issue) an invitation for `email` in the active tenant. In one
   * transaction: upsert the global user, create/attach an `invited` membership,
   * assign the requested roles, revoke any prior pending invitation, write the
   * new invitation row (hash only) and the `user.invitation.created` outbox
   * event. Returns the plaintext token exactly once.
   */
  async create(input: CreateInvitationInput): Promise<CreateInvitationResult> {
    const email = input.email.trim().toLowerCase();
    const token = generateInvitationToken();
    const tokenHash = hashInvitationToken(token);
    const expiresAt = new Date(Date.now() + this.ttlMs);

    const { membershipId, invitationId } = await withTenantContext(
      getDb(),
      { tenantId: input.tenantId, userId: input.actingUserId },
      async (tx) => {
        // 1. global user (no RLS on `users`)
        const [existingUser] = await tx
          .select({ id: users.id })
          .from(users)
          .where(sql`lower(${users.email}) = ${email}`)
          .limit(1);
        let userId = existingUser?.id;
        if (!userId) {
          const [created] = await tx
            .insert(users)
            .values({ email, name: input.name ?? null })
            .returning({ id: users.id });
          userId = created!.id;
        } else if (input.name) {
          await tx
            .update(users)
            .set({ name: sql`coalesce(${users.name}, ${input.name})` })
            .where(eq(users.id, userId));
        }

        // 2. membership (unique on (user_id, tenant_id))
        const [existingMembership] = await tx
          .select({ id: userTenantMemberships.id, status: userTenantMemberships.status })
          .from(userTenantMemberships)
          .where(
            and(
              eq(userTenantMemberships.userId, userId),
              eq(userTenantMemberships.tenantId, input.tenantId),
            ),
          )
          .limit(1);

        if (existingMembership && existingMembership.status === 'active') {
          throw new AppError('MEMBER_ALREADY_EXISTS');
        }

        let membershipId = existingMembership?.id;
        if (!membershipId) {
          const [m] = await tx
            .insert(userTenantMemberships)
            .values({ userId, tenantId: input.tenantId, status: 'invited' })
            .returning({ id: userTenantMemberships.id });
          membershipId = m!.id;
        } else {
          // re-inviting a suspended/invited membership: reset to invited
          await tx
            .update(userTenantMemberships)
            .set({ status: 'invited', updatedAt: sql`now()` })
            .where(eq(userTenantMemberships.id, membershipId));
        }

        // 3. roles
        const { ids, missing } = await resolveRoleKeys(tx, input.tenantId, input.roleKeys);
        if (missing) throw new AppError('ROLE_NOT_FOUND', { details: { roleKey: missing } });
        if (ids.length > 0) {
          await tx
            .insert(membershipRoles)
            .values(ids.map((r) => ({ membershipId, roleId: r.id, tenantId: input.tenantId })))
            .onConflictDoNothing();
        }

        // 4. supersede any prior pending invitation, then create the new one
        await tx
          .update(tenantInvitations)
          .set({ status: 'revoked', updatedAt: sql`now()` })
          .where(
            and(
              eq(tenantInvitations.membershipId, membershipId),
              eq(tenantInvitations.status, 'pending'),
            ),
          );

        const [invitation] = await tx
          .insert(tenantInvitations)
          .values({
            tenantId: input.tenantId,
            membershipId,
            email,
            tokenHash,
            expiresAt,
            invitedByUserId: input.actingUserId,
          })
          .returning({ id: tenantInvitations.id });

        // 5. transactional outbox event (ADR 0013) — same transaction
        await this.outbox.emit(tx, {
          tenantId: input.tenantId,
          type: INVITATION_CREATED_EVENT,
          payload: {
            invitationId: invitation!.id,
            membershipId,
            userId,
            email,
            expiresAt: expiresAt.toISOString(),
            invitedByUserId: input.actingUserId,
          },
        });

        return { membershipId, invitationId: invitation!.id };
      },
    );

    this.logger.log({ tenantId: input.tenantId, membershipId, invitationId }, 'invitation created');
    return { membershipId, invitationId, token, expiresAt: expiresAt.toISOString() };
  }

  /**
   * Accept an invitation by its one-time token. Single atomic transaction:
   *  - bind `app.invitation_token_hash` → the RLS policy exposes exactly that row
   *  - validate status / expiry
   *  - widen the context to the invitation's tenant + user
   *  - if the user has no password yet, one is required and set now
   *  - conditional `UPDATE … WHERE status='pending'` → replay-safe
   *  - activate the bound membership
   */
  async accept(input: AcceptInvitationInput): Promise<AcceptInvitationResult> {
    const tokenHash = hashInvitationToken(input.token.trim());

    return withProgressiveContext(getDb(), async (tx, setContext) => {
      // Step 1: bind only the token hash — the `tenant_invitations_by_token`
      // policy now exposes exactly this one invitation row.
      await setContext({ invitationTokenHash: tokenHash });

      const [invitation] = await tx
        .select({
          id: tenantInvitations.id,
          tenantId: tenantInvitations.tenantId,
          membershipId: tenantInvitations.membershipId,
          email: tenantInvitations.email,
          status: tenantInvitations.status,
          expiresAt: tenantInvitations.expiresAt,
        })
        .from(tenantInvitations)
        .where(eq(tenantInvitations.tokenHash, tokenHash))
        .limit(1);

      if (!invitation) throw new AppError('INVITATION_INVALID');
      if (invitation.status === 'revoked') throw new AppError('INVITATION_REVOKED');
      if (invitation.status === 'accepted') throw new AppError('INVITATION_ALREADY_USED');
      if (invitation.expiresAt.getTime() <= Date.now()) throw new AppError('INVITATION_EXPIRED');

      // Step 2: widen to the invitation's OWN tenant — this is server-derived,
      // never client-supplied, so it cannot cross tenants. `utm_tenant_isolation`
      // and `tenants_visibility` now apply for this one tenant.
      await setContext({ tenantId: invitation.tenantId });

      const [membershipRow] = await tx
        .select({ id: userTenantMemberships.id, userId: userTenantMemberships.userId })
        .from(userTenantMemberships)
        .where(
          and(
            eq(userTenantMemberships.id, invitation.membershipId),
            eq(userTenantMemberships.tenantId, invitation.tenantId),
          ),
        )
        .limit(1);
      if (!membershipRow) throw new AppError('INVITATION_INVALID');

      const [user] = await tx
        .select({ id: users.id, passwordHash: users.passwordHash, name: users.name })
        .from(users)
        .where(eq(users.id, membershipRow.userId))
        .limit(1);
      if (!user) throw new AppError('INVITATION_INVALID');

      if (!user.passwordHash) {
        if (!input.password) throw new AppError('INVITATION_PASSWORD_REQUIRED');
        const passwordHash = await this.passwords.hash(input.password);
        await tx
          .update(users)
          .set({
            passwordHash,
            passwordUpdatedAt: sql`now()`,
            name: sql`coalesce(${users.name}, ${input.name ?? null})`,
          })
          .where(eq(users.id, user.id));
      } else if (input.name && !user.name) {
        await tx.update(users).set({ name: input.name }).where(eq(users.id, user.id));
      }

      // replay-safe accept
      const accepted = await tx
        .update(tenantInvitations)
        .set({ status: 'accepted', acceptedAt: sql`now()`, updatedAt: sql`now()` })
        .where(
          and(eq(tenantInvitations.id, invitation.id), eq(tenantInvitations.status, 'pending')),
        )
        .returning({ id: tenantInvitations.id });
      if (accepted.length === 0) throw new AppError('INVITATION_ALREADY_USED');

      await tx
        .update(userTenantMemberships)
        .set({ status: 'active', updatedAt: sql`now()` })
        .where(eq(userTenantMemberships.id, membershipRow.id));

      const [tenant] = await tx
        .select({ slug: schema.tenants.slug })
        .from(schema.tenants)
        .where(eq(schema.tenants.id, invitation.tenantId))
        .limit(1);

      this.logger.log(
        { tenantId: invitation.tenantId, membershipId: membershipRow.id },
        'invitation accepted',
      );
      return { email: invitation.email, tenantSlug: tenant?.slug ?? '' };
    });
  }

  /** Revoke the pending invitation for a membership (used by member removal / explicit revoke). */
  async revokeForMembership(
    scope: { tenantId: string; userId: string },
    membershipId: string,
  ): Promise<void> {
    await withTenantContext(getDb(), scope, (tx) => this.revokeForMembershipTx(tx, membershipId));
  }

  async revokeForMembershipTx(tx: Tx, membershipId: string): Promise<void> {
    await tx
      .update(tenantInvitations)
      .set({ status: 'revoked', updatedAt: sql`now()` })
      .where(
        and(
          eq(tenantInvitations.membershipId, membershipId),
          eq(tenantInvitations.status, 'pending'),
        ),
      );
  }
}
