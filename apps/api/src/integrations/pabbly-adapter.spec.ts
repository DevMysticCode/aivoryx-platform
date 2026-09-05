import { describe, expect, it } from 'vitest';
import { parsePabblyPayload } from './pabbly-adapter.js';

describe('parsePabblyPayload (generic_json fallback)', () => {
  it('flattens a flat JSON object into provider fields unchanged', () => {
    const draft = parsePabblyPayload({
      name: 'Jane Doe',
      phone: '9876543210',
      email: 'jane@x.com',
    });
    expect(draft.providerFields).toEqual({
      name: 'Jane Doe',
      phone: '9876543210',
      email: 'jane@x.com',
    });
  });

  it('flattens one level of nesting with dot-notation keys', () => {
    const draft = parsePabblyPayload({
      contact: { name: 'Jane', phone: '9876543210' },
      city: 'Pune',
    });
    expect(draft.providerFields).toEqual({
      'contact.name': 'Jane',
      'contact.phone': '9876543210',
      city: 'Pune',
    });
  });

  it('extracts a provider record id from the known key names', () => {
    expect(parsePabblyPayload({ lead_id: 'PB-123', name: 'x' }).providerRecordId).toBe('PB-123');
    expect(parsePabblyPayload({ id: 42 }).providerRecordId).toBe('42');
    expect(parsePabblyPayload({ name: 'no id here' }).providerRecordId).toBeNull();
  });

  it('extracts a provider timestamp from the known key names', () => {
    expect(parsePabblyPayload({ created_at: '2025-01-01T00:00:00Z' }).providerTimestamp).toBe(
      '2025-01-01T00:00:00Z',
    );
    expect(parsePabblyPayload({}).providerTimestamp).toBeNull();
  });

  it('never throws on a non-object body — returns empty fields', () => {
    expect(parsePabblyPayload('just a string').providerFields).toEqual({});
    expect(parsePabblyPayload(null).providerFields).toEqual({});
    expect(parsePabblyPayload([1, 2, 3]).providerFields).toEqual({});
  });

  it('stringifies array/object leaf values rather than dropping them', () => {
    const draft = parsePabblyPayload({ tags: ['solar', 'website'] });
    expect(draft.providerFields.tags).toBe(JSON.stringify(['solar', 'website']));
  });
});
