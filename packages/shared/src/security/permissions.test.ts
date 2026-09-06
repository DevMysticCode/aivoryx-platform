import { describe, expect, it } from 'vitest';
import {
  PERMISSION_DEFINITIONS,
  PERMISSION_KEYS,
  PLATFORM_ROLE_KEYS,
  isPermissionKey,
} from './permissions.js';

describe('permission catalogue', () => {
  it('is the identity/admin set plus CRM, field operations, supply chain, commercial, EPC execution, notifications, finance, platform settings, the audit log, and HR & workforce — no other business domain yet', () => {
    expect([...PERMISSION_KEYS].sort()).toEqual(
      [
        'memberships.read',
        'memberships.update',
        'permissions.read',
        'roles.create',
        'roles.delete',
        'roles.read',
        'roles.update',
        'tenants.read',
        'tenants.update',
        'users.create',
        'users.delete',
        'users.read',
        'users.update',
        'crm.leads.read',
        'crm.leads.create',
        'crm.leads.update',
        'crm.leads.assign',
        'crm.leads.qualify',
        'crm.leads.followup',
        'crm.activities.read',
        'crm.activities.create',
        'crm.integrations.manage',
        'field.agents.manage',
        'field.visits.read',
        'field.visits.create',
        'field.visits.update',
        'field.visits.assign',
        'field.visits.checkin',
        'field.visits.survey',
        'field.visits.attachments',
        'field.visits.complete',
        'projects.read',
        'projects.create',
        'projects.update',
        'projects.approve',
        'products.read',
        'products.create',
        'products.update',
        'suppliers.read',
        'suppliers.create',
        'suppliers.update',
        'warehouses.read',
        'warehouses.create',
        'warehouses.update',
        'inventory.read',
        'inventory.adjust',
        'inventory.allocate',
        'inventory.transfer',
        'procurement.read',
        'procurement.create',
        'procurement.update',
        'procurement.approve',
        'procurement.receive',
        'dispatch.read',
        'dispatch.create',
        'dispatch.update',
        'dispatch.dispatch',
        'dispatch.deliver',
        'customers.read',
        'customers.create',
        'customers.update',
        'quotations.read',
        'quotations.create',
        'quotations.update',
        'quotations.send',
        'quotations.accept',
        'quotations.cancel',
        'quotations.revise',
        'quotations.book',
        'projects.execution.read',
        'projects.execution.update',
        'projects.installation.assign',
        'projects.installation.read',
        'projects.installation.update',
        'projects.installation.complete',
        'projects.qc.read',
        'projects.qc.create',
        'projects.qc.update',
        'projects.qc.approve',
        'projects.net_metering.read',
        'projects.net_metering.update',
        'projects.handover.read',
        'projects.handover.update',
        'projects.handover.complete',
        'projects.complete',
        'projects.defects.read',
        'projects.defects.create',
        'projects.defects.update',
        'notifications.read',
        'notifications.manage',
        'notifications.templates.read',
        'notifications.templates.manage',
        'notifications.deliveries.read',
        'notifications.preferences.read',
        'notifications.preferences.update',
        'finance.read',
        'finance.invoices.read',
        'finance.invoices.create',
        'finance.invoices.update',
        'finance.invoices.issue',
        'finance.invoices.cancel',
        'finance.payments.read',
        'finance.payments.create',
        'finance.payments.allocate',
        'finance.payments.reverse',
        'finance.credit_notes.read',
        'finance.credit_notes.create',
        'finance.credit_notes.issue',
        'finance.credit_notes.cancel',
        'settings.company.read',
        'settings.company.update',
        'audit.read',
        'hr.employee.read',
        'hr.employee.create',
        'hr.employee.update',
        'hr.employee.manage',
        'hr.organization.read',
        'hr.organization.manage',
        'hr.attendance.read',
        'hr.attendance.self',
        'hr.attendance.manage',
        'hr.attendance.correct',
        'hr.leave.read',
        'hr.leave.request',
        'hr.leave.approve',
        'hr.leave.manage',
        'hr.expense.read',
        'hr.expense.submit',
        'hr.expense.approve',
        'hr.expense.manage',
        'hr.expense.reimburse',
        'hr.compensation.read',
        'hr.compensation.manage',
        'hr.bank_details.read',
        'hr.bank_details.manage',
        'hr.payroll.read',
        'hr.payroll.manage',
        'hr.payroll.process',
        'hr.payroll.finalize',
        'hr.payroll.payment',
        'hr.incentive.read',
        'hr.incentive.manage',
        'hr.performance.read',
        'hr.performance.manage',
      ].sort(),
    );
    // No recruitment / ATS / benefits domain yet, and no country-specific
    // statutory payroll permissions (those belong to future modules).
    for (const key of PERMISSION_KEYS) {
      expect(key).not.toMatch(/^recruit|^ats\.|^benefits\.|statutory|\bpf\b|\besi\b/i);
    }
  });

  it('has unique keys and non-empty descriptions', () => {
    expect(new Set(PERMISSION_KEYS).size).toBe(PERMISSION_KEYS.length);
    for (const def of PERMISSION_DEFINITIONS) {
      expect(def.description.trim().length).toBeGreaterThan(0);
      // "<resource>.<action>" or the namespaced "<domain>.<resource>.<action>".
      expect(def.key).toMatch(/^[a-z]+(\.[a-z_]+){1,2}$/);
    }
  });

  it('recognises catalogue keys only', () => {
    expect(isPermissionKey('users.read')).toBe(true);
    expect(isPermissionKey('users.explode')).toBe(false);
    expect(isPermissionKey(42)).toBe(false);
  });

  it('exposes only the two generic platform roles and nothing business-specific', () => {
    expect(PLATFORM_ROLE_KEYS.tenantAdmin).toBe('TENANT_ADMIN');
    expect(PLATFORM_ROLE_KEYS.fieldAgent).toBe('FIELD_AGENT');
    expect(Object.values(PLATFORM_ROLE_KEYS)).not.toContain('SALES_MANAGER');
    expect(Object.values(PLATFORM_ROLE_KEYS).sort()).toEqual(['FIELD_AGENT', 'TENANT_ADMIN']);
  });
});
