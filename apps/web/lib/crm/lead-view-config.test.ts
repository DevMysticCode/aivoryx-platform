import { describe, expect, it } from 'vitest';
import { parseViewConfig, serializeViewConfig } from './lead-view-config';

describe('saved-view config serialization', () => {
  it('drops empty / false / undefined keys on serialize', () => {
    expect(
      serializeViewConfig({
        q: '',
        status: 'QUALIFIED',
        assignedMembershipId: undefined,
        board: false,
      }),
    ).toEqual({ status: 'QUALIFIED' });
  });

  it('keeps board when true', () => {
    expect(serializeViewConfig({ board: true, status: 'NEW' })).toEqual({
      board: true,
      status: 'NEW',
    });
  });

  it('round-trips a full config', () => {
    const config = { q: 'acme', status: 'CONTACTED', assignedMembershipId: 'm-1', board: true };
    expect(parseViewConfig(serializeViewConfig(config))).toEqual(config);
  });

  it('parse ignores unknown / wrong-typed keys and defaults board to false', () => {
    expect(
      parseViewConfig({ status: 'NEW', junk: 42, assignedMembershipId: 7 } as Record<
        string,
        unknown
      >),
    ).toEqual({ q: undefined, status: 'NEW', assignedMembershipId: undefined, board: false });
  });

  it('parse tolerates a missing config', () => {
    expect(parseViewConfig(undefined)).toEqual({
      q: undefined,
      status: undefined,
      assignedMembershipId: undefined,
      board: false,
    });
  });
});
