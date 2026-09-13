import { describe, expect, it } from 'vitest';
import { canTransitionTenantStatus, isTenantStatus, nextTenantStatuses } from './lifecycle.js';

describe('tenant lifecycle', () => {
  it('allows provisioning -> active only', () => {
    expect(canTransitionTenantStatus('provisioning', 'active')).toBe(true);
    expect(canTransitionTenantStatus('provisioning', 'suspended')).toBe(false);
    expect(canTransitionTenantStatus('provisioning', 'archived')).toBe(false);
  });

  it('allows active -> suspended and active -> archived', () => {
    expect(canTransitionTenantStatus('active', 'suspended')).toBe(true);
    expect(canTransitionTenantStatus('active', 'archived')).toBe(true);
    expect(canTransitionTenantStatus('active', 'provisioning')).toBe(false);
  });

  it('allows suspended -> active (reactivate) and suspended -> archived', () => {
    expect(canTransitionTenantStatus('suspended', 'active')).toBe(true);
    expect(canTransitionTenantStatus('suspended', 'archived')).toBe(true);
  });

  it('archived is terminal', () => {
    expect(nextTenantStatuses('archived')).toEqual([]);
    expect(canTransitionTenantStatus('archived', 'active')).toBe(false);
    expect(canTransitionTenantStatus('archived', 'suspended')).toBe(false);
  });

  it('isTenantStatus recognizes only the four known values', () => {
    expect(isTenantStatus('active')).toBe(true);
    expect(isTenantStatus('archived')).toBe(true);
    expect(isTenantStatus('deleted')).toBe(false);
    expect(isTenantStatus(42)).toBe(false);
  });
});
