import { describe, expect, it } from 'vitest';
import type { ConnectorAdapter } from './connector-adapter.js';
import { PabblyAdapter } from './pabbly.adapter.js';

/**
 * Same six assertions as the pre-UC-2 `pabbly-adapter.spec.ts`, now against the adapter class's
 * `parse()` instead of the bare function — the behavior is unchanged, only the call shape moved.
 */
describe('PabblyAdapter.parse (generic_json fallback)', () => {
  const adapter = new PabblyAdapter();
  const parse = (rawBody: unknown) => adapter.parse({ rawBody, headers: {} });

  it('flattens a flat JSON object into provider fields unchanged', () => {
    const draft = parse({ name: 'Ramesh', phone: '9876543210' });
    expect(draft.providerFields).toEqual({ name: 'Ramesh', phone: '9876543210' });
  });

  it('flattens one level of nesting with dot-notation keys', () => {
    const draft = parse({ contact: { phone: '9876543210', city: 'Pune' } });
    expect(draft.providerFields).toEqual({ 'contact.phone': '9876543210', 'contact.city': 'Pune' });
  });

  it('extracts a provider record id from the known key names', () => {
    expect(parse({ lead_id: 'L-1' }).providerRecordId).toBe('L-1');
    expect(parse({ id: 'ID-2' }).providerRecordId).toBe('ID-2');
    expect(parse({ name: 'no id here' }).providerRecordId).toBeNull();
  });

  it('extracts a provider timestamp from the known key names', () => {
    expect(parse({ created_at: '2024-01-01T00:00:00Z' }).providerTimestamp).toBe(
      '2024-01-01T00:00:00Z',
    );
    expect(parse({ name: 'no timestamp' }).providerTimestamp).toBeNull();
  });

  it('never throws on a non-object body — returns empty fields', () => {
    expect(parse('just a string').providerFields).toEqual({});
    expect(parse([1, 2, 3]).providerFields).toEqual({});
    expect(parse(null).providerFields).toEqual({});
    expect(parse(undefined).providerFields).toEqual({});
  });

  it('stringifies array/object leaf values rather than dropping them', () => {
    const draft = parse({ tags: ['a', 'b'], meta: { nested: { deep: true } } });
    expect(draft.providerFields.tags).toBe('["a","b"]');
    expect(draft.providerFields['meta.nested']).toBe('{"deep":true}');
  });
});

describe('PabblyAdapter identity', () => {
  it('declares provider "pabbly_bridge", version 1, and a no-op verify (Pabbly has no own signature)', () => {
    const adapter: ConnectorAdapter = new PabblyAdapter();
    expect(adapter.provider).toBe('pabbly_bridge');
    expect(adapter.version).toBe(1);
    expect(adapter.meta.provider).toBe('pabbly_bridge');
    expect(adapter.verify({ rawBody: {}, headers: {} }, { data: {} })).toEqual({ verified: true });
    expect(adapter.validate).toBeUndefined();
  });
});
