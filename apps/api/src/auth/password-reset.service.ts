import { createHash, randomBytes } from 'node:crypto';
import { Inject, Injectable, Logger } from '@nestjs/common';
import { and, eq, isNull, sql } from 'drizzle-orm';
import { getDb, schema, withAppTransaction } from '@aivoryx/db';
import { AppError } from '@aivoryx/shared';
import type { RateLimiter } from '../integrations/rate-limiter.js';
import { EMAIL_PROVIDER, type EmailProvider } from '../notifications/email/email-provider.js';
import { getCorrelationId } from '../observability/correlation.js';
import { PasswordService } from './password.service.js';
import { SessionService } from './session.service.js';

const { users, passwordResetTokens } = schema;

/** DI token for the password-reset-request rate limiter (keyed by attempted email). */
export const PASSWORD_RESET_RATE_LIMITER = Symbol('PASSWORD_RESET_RATE_LIMITER');

const TOKEN_BYTES = 32;
const RESET_TTL_MS = 60 * 60 * 1000; // 1 hour

/**
 * Self-service password reset — closes a real account-recovery gap: before
 * this, a user (including a tenant's first/only admin) who forgot their
 * password had no way back in short of a direct database operation.
 *
 * Same one-time-token convention as tenant invitations (ADR 0030): a 256-bit
 * random token handed out once, only its SHA-256 hash stored
 * (`password_reset_tokens.token_hash`) — the plaintext token is never
 * persisted. `requestReset` never reveals whether an account exists (same
 * principle as login's `AUTH_INVALID_CREDENTIALS`); `confirmReset` revokes
 * every existing session for the user (`SessionService.revokeAllForUser`,
 * previously written for exactly this purpose but never called from
 * anywhere) so a compromised-password scenario can't leave an attacker's
 * existing session alive after the legitimate owner resets the password.
 */
@Injectable()
export class PasswordResetService {
  private readonly logger = new Logger('PasswordReset');

  constructor(
    private readonly passwords: PasswordService,
    private readonly sessions: SessionService,
    @Inject(EMAIL_PROVIDER) private readonly email: EmailProvider,
    @Inject(PASSWORD_RESET_RATE_LIMITER) private readonly rateLimiter: RateLimiter,
  ) {}

  /** Always resolves; never throws for an unknown email (no account enumeration). */
  async requestReset(email: string): Promise<void> {
    const emailNormalized = email.trim().toLowerCase();

    // Same per-email throttle principle as login (auth.service.ts) — keyed by the
    // attempted email, not IP, for the same trusted-proxy reason documented there.
    const decision = this.rateLimiter.consume(`password-reset:${emailNormalized}`);
    if (!decision.allowed) {
      throw new AppError('RATE_LIMITED', {
        message:
          'Too many password reset requests for this account. Retry after the indicated delay.',
        details: { retryAfterSeconds: decision.retryAfterSeconds, limit: decision.limit },
      });
    }

    const user = await withAppTransaction(getDb(), async (tx) => {
      const [candidate] = await tx
        .select({ id: users.id, email: users.email, status: users.status })
        .from(users)
        .where(sql`lower(${users.email}) = ${emailNormalized}`)
        .limit(1);
      return candidate && candidate.status === 'active' ? candidate : null;
    });

    // Deliberately the same outcome either way — no branch the caller can observe.
    if (!user) return;

    const token = randomBytes(TOKEN_BYTES).toString('base64url');
    const tokenHash = createHash('sha256').update(token, 'utf8').digest('hex');
    const expiresAt = new Date(Date.now() + RESET_TTL_MS);

    await withAppTransaction(getDb(), (tx) =>
      tx.insert(passwordResetTokens).values({ userId: user.id, tokenHash, expiresAt }),
    );

    try {
      await this.email.send({
        to: user.email,
        subject: 'Reset your Aivoryx password',
        text:
          `A password reset was requested for your Aivoryx account.\n\n` +
          `Reset code: ${token}\n\n` +
          `This code expires in 1 hour. If you did not request this, you can ignore this email — ` +
          `your password will not be changed.`,
      });
    } catch (err) {
      // Best-effort: the token row already exists and remains valid even if the
      // email bounces/fails — never fail the request itself over delivery (same
      // "never reveal anything by branching" principle as above). Correlation id
      // + user id (never the email/token) so ops can trace a specific failure
      // without the log line itself becoming a place secrets or PII collect.
      this.logger.warn({
        msg: 'password reset email failed to send',
        userId: user.id,
        correlationId: getCorrelationId() ?? null,
        err: String((err as Error)?.message ?? err),
      });
    }
  }

  async confirmReset(token: string, newPassword: string): Promise<void> {
    const tokenHash = createHash('sha256').update(token.trim(), 'utf8').digest('hex');

    await withAppTransaction(getDb(), async (tx) => {
      const [row] = await tx
        .select({
          id: passwordResetTokens.id,
          userId: passwordResetTokens.userId,
          expiresAt: passwordResetTokens.expiresAt,
        })
        .from(passwordResetTokens)
        .where(
          and(eq(passwordResetTokens.tokenHash, tokenHash), isNull(passwordResetTokens.usedAt)),
        )
        .limit(1);

      // One code for "unknown", "expired", and "already used" — no probing (same
      // convention as INVITATION_INVALID elsewhere in this codebase).
      if (!row || row.expiresAt.getTime() <= Date.now()) {
        throw new AppError('PASSWORD_RESET_INVALID');
      }

      const newHash = await this.passwords.hash(newPassword);
      await tx
        .update(users)
        .set({ passwordHash: newHash, passwordUpdatedAt: sql`now()` })
        .where(eq(users.id, row.userId));
      await tx
        .update(passwordResetTokens)
        .set({ usedAt: sql`now()` })
        .where(eq(passwordResetTokens.id, row.id));

      return row.userId;
    }).then((userId) => this.sessions.revokeAllForUser(userId));
  }
}
