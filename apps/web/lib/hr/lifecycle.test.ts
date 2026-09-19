import { describe, expect, it } from 'vitest';
import {
  EMPLOYEE_STATUSES,
  employeeStatusLabel,
  isEndingStatus,
  nextEmployeeStatuses,
} from './lifecycle';

describe('employee lifecycle (UI mirror of the server graph)', () => {
  it('offers a new hire only: start, or fall through', () => {
    expect(nextEmployeeStatuses('ONBOARDING')).toEqual(['ACTIVE', 'RESIGNED', 'TERMINATED']);
  });

  it('never offers onboarding as a destination', () => {
    for (const from of EMPLOYEE_STATUSES) {
      expect(nextEmployeeStatuses(from)).not.toContain('ONBOARDING');
    }
  });

  it('a person who has left has no further moves; unknown statuses offer none', () => {
    expect(nextEmployeeStatuses('RESIGNED')).toEqual([]);
    expect(nextEmployeeStatuses('TERMINATED')).toEqual([]);
    expect(nextEmployeeStatuses('SOMETHING_ELSE')).toEqual([]);
  });

  it('every offered move is itself a known status', () => {
    for (const from of EMPLOYEE_STATUSES) {
      for (const to of nextEmployeeStatuses(from)) expect(EMPLOYEE_STATUSES).toContain(to);
    }
  });

  it('flags ending states and formats labels', () => {
    expect(isEndingStatus('TERMINATED')).toBe(true);
    expect(isEndingStatus('ACTIVE')).toBe(false);
    expect(employeeStatusLabel('ON_LEAVE')).toBe('On leave');
  });
});
