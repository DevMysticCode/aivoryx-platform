import { describe, expect, it, vi } from 'vitest';
import { AppError } from '@aivoryx/shared';
import { AuditService } from './audit.service.js';
import { withSystemAuditActor } from './system-actor.js';

/**
 * Phase 11 (ADR 0040) — `AuditService.record` derives the actor server-side and
 * refuses to write without a known one or a catalogue action. The insert runs
 * on the caller's `tx`, so a failure there propagates (rolling the caller back).
 */
function fakeTx() {
  const values = vi.fn().mockResolvedValue(undefined);
  return { tx: { insert: vi.fn(() => ({ values })) } as never, values };
}

const base = {
  tenantId: 't1',
  action: 'finance.invoice.issued' as const,
  entityType: 'invoice',
  entityId: 'i1',
};

describe('AuditService.record', () => {
  it('writes a row for an explicit USER actor, inferring the module from the action', async () => {
    const svc = new AuditService();
    const { tx, values } = fakeTx();
    await svc.record(tx, { ...base, actor: { type: 'USER', membershipId: 'm1' } });
    expect(values).toHaveBeenCalledTimes(1);
    const row = values.mock.calls[0]![0] as Record<string, unknown>;
    expect(row).toMatchObject({
      tenantId: 't1',
      actorType: 'USER',
      actorMembershipId: 'm1',
      actorSource: null,
      action: 'finance.invoice.issued',
      module: 'finance',
      entityId: 'i1',
    });
  });

  it('uses the ambient system-actor context when no explicit actor is given', async () => {
    const svc = new AuditService();
    const { tx, values } = fakeTx();
    await withSystemAuditActor('notification-worker', async () => {
      await svc.record(tx, { ...base, action: 'finance.invoice.issued' });
    });
    const row = values.mock.calls[0]![0] as Record<string, unknown>;
    expect(row.actorType).toBe('SYSTEM');
    expect(row.actorSource).toBe('notification-worker');
    expect(row.actorMembershipId).toBeNull();
  });

  it('refuses to write with no actor at all', async () => {
    const svc = new AuditService();
    const { tx } = fakeTx();
    await expect(svc.record(tx, base)).rejects.toBeInstanceOf(AppError);
  });

  it('refuses an unknown action', async () => {
    const svc = new AuditService();
    const { tx } = fakeTx();
    await expect(
      svc.record(tx, {
        ...base,
        action: 'finance.invoice.explode' as never,
        actor: { type: 'USER', membershipId: 'm1' },
      }),
    ).rejects.toMatchObject({ code: 'AUDIT_ACTION_UNKNOWN' });
  });

  it('refuses a USER actor with an empty membership id (no spoofed anonymous)', async () => {
    const svc = new AuditService();
    const { tx } = fakeTx();
    await expect(
      svc.record(tx, { ...base, actor: { type: 'USER', membershipId: '' } }),
    ).rejects.toMatchObject({ code: 'AUDIT_ACTOR_REQUIRED' });
  });

  it('sanitises metadata before insert', async () => {
    const svc = new AuditService();
    const { tx, values } = fakeTx();
    await svc.record(tx, {
      ...base,
      actor: { type: 'USER', membershipId: 'm1' },
      metadata: { password: 'secret', ok: 1 },
    });
    const row = values.mock.calls[0]![0] as Record<string, unknown>;
    expect((row.metadata as Record<string, unknown>).password).toBe('[redacted]');
    expect((row.metadata as Record<string, unknown>).ok).toBe(1);
  });

  it('recordSafe swallows a failing insert', async () => {
    const svc = new AuditService();
    const values = vi.fn().mockRejectedValue(new Error('db down'));
    const tx = { insert: vi.fn(() => ({ values })) } as never;
    await expect(
      svc.recordSafe(tx, { ...base, actor: { type: 'USER', membershipId: 'm1' } }),
    ).resolves.toBeUndefined();
  });
});
