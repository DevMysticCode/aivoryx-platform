import { Injectable, Logger } from '@nestjs/common';
import { schema, type Tx } from '@aivoryx/db';
import { AppError } from '@aivoryx/shared';
import { getCorrelationId } from '../observability/correlation.js';
import { getRequestMeta } from '../observability/request-context.js';
import {
  isAuditAction,
  moduleForAction,
  type AuditAction,
  type AuditModule,
} from './audit.actions.js';
import { sanitizeChanges, sanitizeMetadata, type AuditChanges } from './audit.redaction.js';
import { currentSystemAuditActor } from './system-actor.js';

const { auditLogs } = schema;

/** A human actor — always the active membership from the security context. */
export interface UserActor {
  type: 'USER';
  membershipId: string;
}

/** A trusted server-side subsystem. */
export interface SystemActor {
  type: 'SYSTEM';
  source: string;
}

export type AuditActor = UserActor | SystemActor;

/** Convenience: build a USER actor from a resolved tenant scope. */
export function userActor(scope: { actorMembershipId: string }): UserActor {
  return { type: 'USER', membershipId: scope.actorMembershipId };
}

export interface AuditRecordInput {
  /** the tenant the action happened in — server-derived, never from a DTO */
  tenantId: string;
  action: AuditAction;
  entityType: string;
  entityId?: string | null;
  /** defaults to the action's own module (kept in lockstep by the catalogue) */
  module?: AuditModule;
  /**
   * Who acted. Optional: if omitted, a `withSystemAuditActor(...)` context is
   * used; if there is none either, the write is refused (an audit row must
   * always have a known actor).
   */
  actor?: AuditActor;
  metadata?: Record<string, unknown>;
  changes?: AuditChanges | null;
  /** override the auto-captured correlation id (background jobs) */
  correlationId?: string | null;
}

/**
 * The central Global Audit Log writer (Phase 11, ADR 0040).
 *
 * `record` inserts ONE row **inside the caller's transaction** (`tx`), so a
 * critical business mutation and its audit row commit or roll back together —
 * a successful critical mutation cannot silently occur without its audit
 * record. Tenant and actor are always server-derived; correlation / request /
 * ip / ua are pulled from the request context; `occurred_at` is the database
 * clock. Metadata and changes are sanitised (secrets stripped, size bounded)
 * before they touch the row.
 */
@Injectable()
export class AuditService {
  private readonly logger = new Logger('Audit');

  async record(tx: Tx, input: AuditRecordInput): Promise<void> {
    if (!isAuditAction(input.action)) {
      throw new AppError('AUDIT_ACTION_UNKNOWN', { details: { action: input.action } });
    }
    if (!input.tenantId) {
      throw new AppError('AUDIT_TENANT_REQUIRED');
    }

    const actor = this.resolveActor(input.actor);
    const module = input.module ?? moduleForAction(input.action);
    const meta = getRequestMeta();

    await tx.insert(auditLogs).values({
      tenantId: input.tenantId,
      actorType: actor.type,
      actorMembershipId: actor.type === 'USER' ? actor.membershipId : null,
      actorSource: actor.type === 'SYSTEM' ? actor.source : null,
      action: input.action,
      entityType: input.entityType,
      entityId: input.entityId ?? null,
      module,
      correlationId: input.correlationId ?? getCorrelationId() ?? null,
      requestId: meta?.requestId ?? null,
      metadata: sanitizeMetadata(input.metadata),
      changes: sanitizeChanges(input.changes ?? null),
      ipAddress: meta?.ip ?? null,
      userAgent: meta?.userAgent ?? null,
    });
  }

  /**
   * Best-effort variant for NON-critical, informational events (e.g. a login
   * that must not fail the auth flow if the audit write hiccups). It swallows
   * and logs errors. NEVER use this for a state-changing business mutation —
   * those must use `record` so a failed audit rolls the mutation back.
   */
  async recordSafe(tx: Tx, input: AuditRecordInput): Promise<void> {
    try {
      await this.record(tx, input);
    } catch (err) {
      this.logger.error(
        `audit recordSafe failed for ${input.action}: ${String((err as Error)?.message ?? err)}`,
      );
    }
  }

  private resolveActor(explicit: AuditActor | undefined): AuditActor {
    if (explicit) {
      if (explicit.type === 'USER' && !explicit.membershipId) {
        throw new AppError('AUDIT_ACTOR_REQUIRED');
      }
      return explicit;
    }
    const system = currentSystemAuditActor();
    if (system) return { type: 'SYSTEM', source: system.source };
    throw new AppError('AUDIT_ACTOR_REQUIRED');
  }
}
