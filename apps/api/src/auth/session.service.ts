import { Inject, Injectable, Logger } from '@nestjs/common';
import { and, eq, isNull, sql } from 'drizzle-orm';
import { getDb, schema, withAppTransaction } from '@aivoryx/db';
import { AppError } from '@aivoryx/shared';
import type { ServerEnv } from '@aivoryx/config';
import { SERVER_ENV } from '../config/config.module.js';
import { generateSessionToken, hashSessionToken } from './session-token.js';
import type { SecuritySession, SecurityUser } from '../security/security-context.js';

const { sessions, users } = schema;

/** Only touch `last_seen_at` if it is at least this stale — one write per request is wasteful. */
const LAST_SEEN_THROTTLE_MS = 60_000;

export interface ResolvedSession {
  session: SecuritySession & { userId: string };
  user: SecurityUser;
}

export interface CreateSessionInput {
  userId: string;
  activeMembershipId: string | null;
  ip?: string | null;
  userAgent?: string | null;
}

@Injectable()
export class SessionService {
  private readonly logger = new Logger(SessionService.name);
  private readonly absoluteTtlMs: number;
  private readonly idleTtlMs: number;

  constructor(@Inject(SERVER_ENV) env: ServerEnv) {
    this.absoluteTtlMs = env.SESSION_ABSOLUTE_TTL_HOURS * 3_600_000;
    this.idleTtlMs = env.SESSION_IDLE_TTL_HOURS * 3_600_000;
  }

  /** Create a session row and return the raw token (the only time it exists). */
  async create(input: CreateSessionInput): Promise<{ token: string; session: schema.SessionRow }> {
    const token = generateSessionToken();
    const tokenHash = hashSessionToken(token);
    const expiresAt = new Date(Date.now() + this.absoluteTtlMs);

    const row = await withAppTransaction(getDb(), async (tx) => {
      const [inserted] = await tx
        .insert(sessions)
        .values({
          userId: input.userId,
          tokenHash,
          activeMembershipId: input.activeMembershipId,
          expiresAt,
          ip: input.ip ?? null,
          userAgent: input.userAgent ?? null,
        })
        .returning();
      return inserted!;
    });

    return { token, session: row };
  }

  /**
   * Look up a session by its cookie token and enforce the full lifecycle:
   * exists, not revoked, not past `expires_at`, not idle-timed-out, user active.
   * Throttled `last_seen_at` touch on success.
   */
  async resolve(token: string): Promise<ResolvedSession> {
    const tokenHash = hashSessionToken(token);

    return withAppTransaction(getDb(), async (tx) => {
      const [row] = await tx
        .select({
          sessionId: sessions.id,
          activeMembershipId: sessions.activeMembershipId,
          expiresAt: sessions.expiresAt,
          revokedAt: sessions.revokedAt,
          lastSeenAt: sessions.lastSeenAt,
          userId: users.id,
          email: users.email,
          userStatus: users.status,
        })
        .from(sessions)
        .innerJoin(users, eq(users.id, sessions.userId))
        .where(eq(sessions.tokenHash, tokenHash))
        .limit(1);

      if (!row) throw new AppError('AUTH_UNAUTHENTICATED');

      if (row.revokedAt) throw new AppError('AUTH_SESSION_REVOKED');

      const now = Date.now();
      if (row.expiresAt.getTime() <= now) throw new AppError('AUTH_SESSION_EXPIRED');
      if (now - row.lastSeenAt.getTime() > this.idleTtlMs) {
        throw new AppError('AUTH_SESSION_EXPIRED');
      }
      if (row.userStatus !== 'active') throw new AppError('AUTH_UNAUTHENTICATED');

      if (now - row.lastSeenAt.getTime() > LAST_SEEN_THROTTLE_MS) {
        await tx
          .update(sessions)
          .set({ lastSeenAt: sql`now()` })
          .where(eq(sessions.id, row.sessionId));
      }

      return {
        session: {
          id: row.sessionId,
          userId: row.userId,
          activeMembershipId: row.activeMembershipId,
          expiresAt: row.expiresAt,
        },
        user: { id: row.userId, email: row.email, status: row.userStatus },
      };
    });
  }

  /** Mark a session revoked. Effective immediately — the next `resolve` rejects it. */
  async revoke(sessionId: string): Promise<void> {
    await withAppTransaction(getDb(), (tx) =>
      tx
        .update(sessions)
        .set({ revokedAt: sql`now()` })
        .where(and(eq(sessions.id, sessionId), isNull(sessions.revokedAt))),
    );
  }

  /** Revoke every live session for a user (password reset, account lock). */
  async revokeAllForUser(userId: string): Promise<void> {
    await withAppTransaction(getDb(), (tx) =>
      tx
        .update(sessions)
        .set({ revokedAt: sql`now()` })
        .where(and(eq(sessions.userId, userId), isNull(sessions.revokedAt))),
    );
  }

  /**
   * Point the session at a different active membership (or clear it).
   * The composite FK `sessions(user_id, active_membership_id) ->
   * user_tenant_memberships(user_id, id)` is the database guarantee that the
   * membership belongs to this session's user; a violation surfaces as
   * `AUTH_MEMBERSHIP_INVALID`. Callers still perform the explicit ownership /
   * status checks first (see `AuthService.switchTenant`).
   */
  async setActiveMembership(sessionId: string, membershipId: string | null): Promise<void> {
    try {
      await withAppTransaction(getDb(), (tx) =>
        tx
          .update(sessions)
          .set({ activeMembershipId: membershipId })
          .where(eq(sessions.id, sessionId)),
      );
    } catch (err) {
      if (isForeignKeyViolation(err)) {
        this.logger.warn({ sessionId }, 'setActiveMembership rejected by composite FK');
        throw new AppError('AUTH_MEMBERSHIP_INVALID');
      }
      throw err;
    }
  }
}

function isForeignKeyViolation(err: unknown): boolean {
  return typeof err === 'object' && err !== null && (err as { code?: string }).code === '23503';
}
