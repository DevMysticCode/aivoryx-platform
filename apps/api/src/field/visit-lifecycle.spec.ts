import { describe, expect, it } from 'vitest';
import {
  canReassignOrReschedule,
  isTerminalVisitStatus,
  isValidVisitTransition,
  type VisitStatus,
} from './visit-lifecycle.js';

const ALL: VisitStatus[] = ['SCHEDULED', 'ASSIGNED', 'IN_PROGRESS', 'COMPLETED', 'CANCELLED'];

describe('visit lifecycle', () => {
  it('allows the documented forward transitions', () => {
    expect(isValidVisitTransition('SCHEDULED', 'ASSIGNED')).toBe(true);
    expect(isValidVisitTransition('ASSIGNED', 'IN_PROGRESS')).toBe(true);
    expect(isValidVisitTransition('IN_PROGRESS', 'COMPLETED')).toBe(true);
  });

  it('allows cancellation from every non-terminal status', () => {
    expect(isValidVisitTransition('SCHEDULED', 'CANCELLED')).toBe(true);
    expect(isValidVisitTransition('ASSIGNED', 'CANCELLED')).toBe(true);
    expect(isValidVisitTransition('IN_PROGRESS', 'CANCELLED')).toBe(true);
  });

  it('rejects a no-op transition to the same status', () => {
    for (const s of ALL) expect(isValidVisitTransition(s, s)).toBe(false);
  });

  it('rejects reopening a terminal status', () => {
    for (const to of ALL) {
      expect(isValidVisitTransition('COMPLETED', to)).toBe(false);
      expect(isValidVisitTransition('CANCELLED', to)).toBe(false);
    }
  });

  it('rejects skipping stages or going backwards', () => {
    expect(isValidVisitTransition('SCHEDULED', 'IN_PROGRESS')).toBe(false);
    expect(isValidVisitTransition('SCHEDULED', 'COMPLETED')).toBe(false);
    expect(isValidVisitTransition('IN_PROGRESS', 'ASSIGNED')).toBe(false);
    expect(isValidVisitTransition('IN_PROGRESS', 'SCHEDULED')).toBe(false);
  });

  it('identifies exactly the two terminal statuses', () => {
    expect(isTerminalVisitStatus('COMPLETED')).toBe(true);
    expect(isTerminalVisitStatus('CANCELLED')).toBe(true);
    expect(isTerminalVisitStatus('SCHEDULED')).toBe(false);
    expect(isTerminalVisitStatus('ASSIGNED')).toBe(false);
    expect(isTerminalVisitStatus('IN_PROGRESS')).toBe(false);
  });

  it('permits reassignment/reschedule only before on-site work starts', () => {
    expect(canReassignOrReschedule('SCHEDULED')).toBe(true);
    expect(canReassignOrReschedule('ASSIGNED')).toBe(true);
    expect(canReassignOrReschedule('IN_PROGRESS')).toBe(false);
    expect(canReassignOrReschedule('COMPLETED')).toBe(false);
    expect(canReassignOrReschedule('CANCELLED')).toBe(false);
  });
});
