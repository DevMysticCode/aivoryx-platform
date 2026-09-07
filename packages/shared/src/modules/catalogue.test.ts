import { describe, expect, it } from 'vitest';
import { PERMISSION_KEYS } from '../security/permissions.js';
import {
  MODULE_DEFINITIONS,
  MODULE_KEYS,
  moduleForPermission,
  moduleDependencyClosure,
  modulesDependingOn,
  validateEnable,
  validateDisable,
} from './catalogue.js';

describe('module catalogue', () => {
  it('has 7 modules with unique keys and a strict order', () => {
    expect([...MODULE_KEYS].sort()).toEqual(
      ['COMMERCIAL', 'CRM', 'EPC', 'FIELD', 'FINANCE', 'HR', 'SUPPLY'].sort(),
    );
    expect(new Set(MODULE_KEYS).size).toBe(MODULE_KEYS.length);
    const orders = MODULE_DEFINITIONS.map((m) => m.order);
    expect([...orders].sort((a, b) => a - b)).toEqual(orders);
  });

  it('maps every business permission to exactly one module, and platform permissions to none', () => {
    const unowned = new Set([
      'access.read',
      'audit.read',
      'memberships.read',
      'memberships.update',
      'permissions.read',
      'roles.read',
      'roles.create',
      'roles.update',
      'roles.delete',
      'tenants.read',
      'tenants.update',
      'users.read',
      'users.create',
      'users.update',
      'users.delete',
      'settings.company.read',
      'settings.company.update',
      'notifications.read',
      'notifications.manage',
      'notifications.templates.read',
      'notifications.templates.manage',
      'notifications.deliveries.read',
      'notifications.preferences.read',
      'notifications.preferences.update',
      'platform.tenants.read',
      'platform.tenants.manage',
      'platform.modules.provision',
    ]);
    for (const key of PERMISSION_KEYS) {
      const mod = moduleForPermission(key);
      if (unowned.has(key)) {
        expect(mod, `${key} should be platform-owned`).toBeNull();
      } else {
        expect(mod, `${key} should belong to a module`).not.toBeNull();
      }
    }
  });

  it('splits projects.* between SUPPLY (base) and EPC (execution)', () => {
    expect(moduleForPermission('projects.read')).toBe('SUPPLY');
    expect(moduleForPermission('projects.approve')).toBe('SUPPLY');
    expect(moduleForPermission('projects.execution.read')).toBe('EPC');
    expect(moduleForPermission('projects.installation.complete')).toBe('EPC');
    expect(moduleForPermission('projects.qc.approve')).toBe('EPC');
  });

  it('resolves dependency closures', () => {
    expect(moduleDependencyClosure('CRM')).toEqual([]);
    expect(moduleDependencyClosure('COMMERCIAL').sort()).toEqual(['CRM', 'SUPPLY']);
    expect(moduleDependencyClosure('EPC').sort()).toEqual(['COMMERCIAL', 'CRM', 'FIELD', 'SUPPLY']);
  });

  it('lists modules that depend on a given module', () => {
    expect(modulesDependingOn('CRM')).toEqual(['COMMERCIAL']);
    expect(modulesDependingOn('SUPPLY').sort()).toEqual(['COMMERCIAL', 'EPC']);
    expect(modulesDependingOn('HR')).toEqual([]);
  });

  it('validateEnable rejects a module whose dependency is not enabled', () => {
    expect(validateEnable('CRM', [])).toEqual({ ok: true, missingDependencies: [] });
    expect(validateEnable('COMMERCIAL', ['CRM'])).toEqual({
      ok: false,
      missingDependencies: ['SUPPLY'],
    });
    expect(validateEnable('COMMERCIAL', ['CRM', 'SUPPLY'])).toEqual({
      ok: true,
      missingDependencies: [],
    });
    expect(validateEnable('EPC', ['CRM', 'SUPPLY', 'FIELD']).missingDependencies).toEqual([
      'COMMERCIAL',
    ]);
  });

  it('validateDisable rejects a module that an enabled module still depends on', () => {
    expect(validateDisable('HR', ['CRM', 'HR'])).toEqual({ ok: true, blockingDependants: [] });
    expect(validateDisable('SUPPLY', ['CRM', 'SUPPLY', 'COMMERCIAL'])).toEqual({
      ok: false,
      blockingDependants: ['COMMERCIAL'],
    });
    expect(validateDisable('CRM', ['CRM', 'SUPPLY', 'COMMERCIAL', 'FIELD', 'EPC'])).toEqual({
      ok: false,
      blockingDependants: ['COMMERCIAL'],
    });
  });
});
