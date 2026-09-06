import { describe, expect, it } from 'vitest';
import {
  AUDIT_ACTIONS,
  AUDIT_ACTION_MODULE,
  AUDIT_MODULES,
  isAuditAction,
  isAuditModule,
  moduleForAction,
} from './audit.actions.js';

/**
 * Phase 11 (ADR 0040) — the central audit action catalogue. Keys are stable
 * contract; each is bound to exactly one module and matches the DB CHECK.
 */
describe('audit action catalogue', () => {
  it('has unique keys', () => {
    expect(new Set(AUDIT_ACTIONS).size).toBe(AUDIT_ACTIONS.length);
    expect(AUDIT_ACTIONS.length).toBeGreaterThan(60);
  });

  it('every key matches the DB CHECK format `a.b.c`', () => {
    const re = /^[a-z][a-z0-9_]*(\.[a-z0-9_]+)+$/;
    for (const key of AUDIT_ACTIONS) expect(key, key).toMatch(re);
  });

  it('every key is bound to a real module', () => {
    for (const key of AUDIT_ACTIONS) {
      expect(AUDIT_MODULES).toContain(AUDIT_ACTION_MODULE[key]);
      expect(moduleForAction(key)).toBe(AUDIT_ACTION_MODULE[key]);
    }
  });

  it('covers every phase brief group', () => {
    const prefixes = [
      'auth.',
      'tenant.member.',
      'crm.lead.',
      'integration.source.',
      'field.visit.',
      'purchase_order.',
      'inventory.',
      'quotation.',
      'project.installation.',
      'project.qc.',
      'notification.',
      'finance.invoice.',
      'finance.payment.',
      'finance.credit_note.',
      'settings.',
      'hr.employee.',
      'hr.leave.',
      'hr.expense.',
      'hr.payroll.',
    ];
    for (const p of prefixes) {
      expect(
        AUDIT_ACTIONS.some((a) => a.startsWith(p)),
        p,
      ).toBe(true);
    }
  });

  it('type guards accept only catalogue values', () => {
    expect(isAuditAction('finance.invoice.issued')).toBe(true);
    expect(isAuditAction('finance.invoice.explode')).toBe(false);
    expect(isAuditAction(42)).toBe(false);
    expect(isAuditModule('finance')).toBe(true);
    expect(isAuditModule('hr')).toBe(true);
    expect(isAuditModule('not-a-module')).toBe(false);
  });
});
