import { describe, expect, it } from 'vitest';
import {
  dispatchIsEditable,
  isTerminalDispatchStatus,
  isTerminalPoStatus,
  isTerminalProjectStatus,
  isValidDispatchTransition,
  isValidPoTransition,
  isValidProjectTransition,
  poCanReceive,
  poIsEditable,
  type DispatchStatus,
  type ProjectStatus,
  type PurchaseOrderStatus,
} from './lifecycles.js';

const PROJECT_ALL: ProjectStatus[] = [
  'DRAFT',
  'APPROVED',
  'PROCUREMENT',
  'READY_FOR_DISPATCH',
  'IN_PROGRESS',
  'COMPLETED',
  'ON_HOLD',
  'CANCELLED',
];
const PO_ALL: PurchaseOrderStatus[] = [
  'DRAFT',
  'SUBMITTED',
  'APPROVED',
  'PARTIALLY_RECEIVED',
  'RECEIVED',
  'CLOSED',
  'CANCELLED',
];
const DISPATCH_ALL: DispatchStatus[] = ['DRAFT', 'DISPATCHED', 'DELIVERED', 'CANCELLED'];

describe('project lifecycle', () => {
  it('allows the documented forward path', () => {
    expect(isValidProjectTransition('DRAFT', 'APPROVED')).toBe(true);
    expect(isValidProjectTransition('APPROVED', 'PROCUREMENT')).toBe(true);
    expect(isValidProjectTransition('PROCUREMENT', 'READY_FOR_DISPATCH')).toBe(true);
    expect(isValidProjectTransition('READY_FOR_DISPATCH', 'IN_PROGRESS')).toBe(true);
    expect(isValidProjectTransition('IN_PROGRESS', 'COMPLETED')).toBe(true);
  });

  it('allows hold + resume and cancellation from any non-terminal state', () => {
    expect(isValidProjectTransition('APPROVED', 'ON_HOLD')).toBe(true);
    expect(isValidProjectTransition('ON_HOLD', 'PROCUREMENT')).toBe(true);
    for (const s of PROJECT_ALL) {
      if (s === 'COMPLETED' || s === 'CANCELLED') continue;
      expect(isValidProjectTransition(s, 'CANCELLED')).toBe(true);
    }
  });

  it('rejects no-op, backward, and reopening a terminal', () => {
    for (const s of PROJECT_ALL) expect(isValidProjectTransition(s, s)).toBe(false);
    expect(isValidProjectTransition('IN_PROGRESS', 'DRAFT')).toBe(false);
    expect(isValidProjectTransition('DRAFT', 'IN_PROGRESS')).toBe(false);
    for (const to of PROJECT_ALL) {
      expect(isValidProjectTransition('COMPLETED', to)).toBe(false);
      expect(isValidProjectTransition('CANCELLED', to)).toBe(false);
    }
  });

  it('identifies the two terminal statuses', () => {
    expect(isTerminalProjectStatus('COMPLETED')).toBe(true);
    expect(isTerminalProjectStatus('CANCELLED')).toBe(true);
    expect(isTerminalProjectStatus('DRAFT')).toBe(false);
  });
});

describe('purchase-order lifecycle', () => {
  it('allows the documented path incl. partial receipt', () => {
    expect(isValidPoTransition('DRAFT', 'SUBMITTED')).toBe(true);
    expect(isValidPoTransition('SUBMITTED', 'APPROVED')).toBe(true);
    expect(isValidPoTransition('APPROVED', 'PARTIALLY_RECEIVED')).toBe(true);
    expect(isValidPoTransition('PARTIALLY_RECEIVED', 'RECEIVED')).toBe(true);
    expect(isValidPoTransition('RECEIVED', 'CLOSED')).toBe(true);
    expect(isValidPoTransition('SUBMITTED', 'DRAFT')).toBe(true); // send back for edits
  });

  it('rejects invalid PO transitions', () => {
    for (const s of PO_ALL) expect(isValidPoTransition(s, s)).toBe(false);
    expect(isValidPoTransition('DRAFT', 'APPROVED')).toBe(false); // must submit first
    expect(isValidPoTransition('DRAFT', 'RECEIVED')).toBe(false);
    for (const to of PO_ALL) {
      expect(isValidPoTransition('CLOSED', to)).toBe(false);
      expect(isValidPoTransition('CANCELLED', to)).toBe(false);
    }
  });

  it('gates editability and receiving on status', () => {
    expect(poIsEditable('DRAFT')).toBe(true);
    expect(poIsEditable('APPROVED')).toBe(false);
    expect(poCanReceive('APPROVED')).toBe(true);
    expect(poCanReceive('PARTIALLY_RECEIVED')).toBe(true);
    expect(poCanReceive('DRAFT')).toBe(false);
    expect(poCanReceive('RECEIVED')).toBe(false);
    expect(isTerminalPoStatus('CLOSED')).toBe(true);
  });
});

describe('dispatch lifecycle', () => {
  it('allows DRAFT -> DISPATCHED -> DELIVERED and DRAFT -> CANCELLED', () => {
    expect(isValidDispatchTransition('DRAFT', 'DISPATCHED')).toBe(true);
    expect(isValidDispatchTransition('DISPATCHED', 'DELIVERED')).toBe(true);
    expect(isValidDispatchTransition('DRAFT', 'CANCELLED')).toBe(true);
  });

  it('rejects cancelling after dispatch and any terminal reopen', () => {
    expect(isValidDispatchTransition('DISPATCHED', 'CANCELLED')).toBe(false);
    expect(isValidDispatchTransition('DISPATCHED', 'DRAFT')).toBe(false);
    for (const to of DISPATCH_ALL) {
      expect(isValidDispatchTransition('DELIVERED', to)).toBe(false);
      expect(isValidDispatchTransition('CANCELLED', to)).toBe(false);
    }
    expect(dispatchIsEditable('DRAFT')).toBe(true);
    expect(dispatchIsEditable('DISPATCHED')).toBe(false);
    expect(isTerminalDispatchStatus('DELIVERED')).toBe(true);
  });
});
