import { describe, expect, it } from 'vitest';
import {
  PERMISSION_DEFINITIONS,
  PERMISSION_KEYS,
  PLATFORM_ROLE_KEYS,
  isPermissionKey,
} from './permissions.js';

describe('permission catalogue', () => {
  it('is the identity/admin set plus the CRM core — no other business domain yet', () => {
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
      ].sort(),
    );
    for (const key of PERMISSION_KEYS) {
      expect(key).not.toMatch(/^hr\.|^telecall|^field|^quotation|^booking|^payroll|^invoice/i);
    }
  });

  it('has unique keys and non-empty descriptions', () => {
    expect(new Set(PERMISSION_KEYS).size).toBe(PERMISSION_KEYS.length);
    for (const def of PERMISSION_DEFINITIONS) {
      expect(def.description.trim().length).toBeGreaterThan(0);
      // "<resource>.<action>" or the namespaced "<domain>.<resource>.<action>".
      expect(def.key).toMatch(/^[a-z]+(\.[a-z]+){1,2}$/);
    }
  });

  it('recognises catalogue keys only', () => {
    expect(isPermissionKey('users.read')).toBe(true);
    expect(isPermissionKey('users.explode')).toBe(false);
    expect(isPermissionKey(42)).toBe(false);
  });

  it('exposes the generic TENANT_ADMIN platform role and nothing business-specific', () => {
    expect(PLATFORM_ROLE_KEYS.tenantAdmin).toBe('TENANT_ADMIN');
    expect(Object.values(PLATFORM_ROLE_KEYS)).not.toContain('SALES_MANAGER');
  });
});
