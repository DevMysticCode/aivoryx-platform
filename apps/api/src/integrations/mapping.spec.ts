import { describe, expect, it } from 'vitest';
import { mapProviderFields } from './mapping.js';

describe('mapProviderFields', () => {
  it('maps well-known provider keys to canonical lead fields by default', () => {
    const result = mapProviderFields({
      full_name: 'Jane Doe',
      phone_number: '9876543210',
      email_address: 'jane@x.com',
      city: 'Pune',
    });
    expect(result.canonical).toEqual({
      name: 'Jane Doe',
      phone: '9876543210',
      email: 'jane@x.com',
      city: 'Pune',
    });
    expect(result.unmapped).toEqual({});
  });

  it('routes an unrecognised key to unmapped, never dropped', () => {
    const result = mapProviderFields({ campaign_utm: 'diwali-2025' });
    expect(result.unmapped).toEqual({ campaign_utm: 'diwali-2025' });
    expect(result.canonical).toEqual({});
  });

  it('a per-source override wins over the built-in default', () => {
    const result = mapProviderFields({ mobile_no: '9876543210' }, { mobile_no: 'canonical:phone' });
    expect(result.canonical.phone).toBe('9876543210');
  });

  it('routes a "custom:<key>" target into the custom bucket, unvalidated', () => {
    const result = mapProviderFields({ budget: '50000' }, { budget: 'custom:budget_amount' });
    expect(result.custom).toEqual({ budget_amount: '50000' });
  });

  it('an override target of "skip" discards the field entirely', () => {
    const result = mapProviderFields({ noise: 'ignore me' }, { noise: 'skip' });
    expect(result.unmapped).toEqual({});
    expect(result.custom).toEqual({});
    expect(result.canonical).toEqual({});
  });

  it('an unrecognised canonical field name in the override falls back to unmapped', () => {
    const result = mapProviderFields({ x: 'y' }, { x: 'canonical:not_a_real_field' });
    expect(result.unmapped).toEqual({ x: 'y' });
  });

  it('does not write an empty/blank value onto a canonical field', () => {
    const result = mapProviderFields({ name: '' });
    expect(result.canonical.name).toBeUndefined();
  });
});
