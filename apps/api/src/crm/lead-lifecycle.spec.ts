import { describe, expect, it } from 'vitest';
import { isTerminalLeadStatus, isValidLeadTransition, type LeadStatus } from './lead-lifecycle.js';

const ALL: LeadStatus[] = [
  'NEW',
  'ASSIGNED',
  'CONTACTED',
  'QUALIFIED',
  'DISQUALIFIED',
  'CONVERTED',
];

describe('lead lifecycle', () => {
  it('allows the documented forward transitions', () => {
    expect(isValidLeadTransition('NEW', 'ASSIGNED')).toBe(true);
    expect(isValidLeadTransition('NEW', 'CONTACTED')).toBe(true);
    expect(isValidLeadTransition('NEW', 'QUALIFIED')).toBe(true);
    expect(isValidLeadTransition('NEW', 'DISQUALIFIED')).toBe(true);
    expect(isValidLeadTransition('ASSIGNED', 'CONTACTED')).toBe(true);
    expect(isValidLeadTransition('ASSIGNED', 'QUALIFIED')).toBe(true);
    expect(isValidLeadTransition('CONTACTED', 'QUALIFIED')).toBe(true);
    expect(isValidLeadTransition('QUALIFIED', 'CONVERTED')).toBe(true);
    expect(isValidLeadTransition('QUALIFIED', 'DISQUALIFIED')).toBe(true);
  });

  it('rejects a no-op transition to the same status', () => {
    for (const s of ALL) expect(isValidLeadTransition(s, s)).toBe(false);
  });

  it('rejects reopening a terminal status', () => {
    for (const to of ALL) {
      expect(isValidLeadTransition('DISQUALIFIED', to)).toBe(false);
      expect(isValidLeadTransition('CONVERTED', to)).toBe(false);
    }
  });

  it('rejects skipping backwards or to an unreachable status', () => {
    expect(isValidLeadTransition('CONTACTED', 'NEW')).toBe(false);
    expect(isValidLeadTransition('CONTACTED', 'ASSIGNED')).toBe(false);
    expect(isValidLeadTransition('QUALIFIED', 'CONTACTED')).toBe(false);
    expect(isValidLeadTransition('CONVERTED', 'QUALIFIED')).toBe(false);
    expect(isValidLeadTransition('NEW', 'CONVERTED')).toBe(false);
  });

  it('identifies exactly the two terminal statuses', () => {
    expect(isTerminalLeadStatus('DISQUALIFIED')).toBe(true);
    expect(isTerminalLeadStatus('CONVERTED')).toBe(true);
    expect(isTerminalLeadStatus('NEW')).toBe(false);
    expect(isTerminalLeadStatus('ASSIGNED')).toBe(false);
    expect(isTerminalLeadStatus('CONTACTED')).toBe(false);
    expect(isTerminalLeadStatus('QUALIFIED')).toBe(false);
  });
});
