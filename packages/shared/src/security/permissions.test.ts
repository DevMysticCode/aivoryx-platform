import { describe, expect, it } from 'vitest';
import {
  PERMISSION_DEFINITIONS,
  PERMISSION_KEYS,
  PLATFORM_ROLE_KEYS,
  isPermissionKey,
} from './permissions.js';

describe('permission catalogue', () => {
  it('is the identity/admin set plus CRM, field operations, supply chain, commercial, and EPC execution — no other business domain yet', () => {
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
      ].sort(),
    );
    for (const key of PERMISSION_KEYS) {
      expect(key).not.toMatch(/^hr\.|^telecall|^payroll|^invoice|^finance\./i);
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
