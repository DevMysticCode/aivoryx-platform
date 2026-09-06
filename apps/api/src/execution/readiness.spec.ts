import { describe, expect, it } from 'vitest';
import { computeReadiness, installationMaterialsOk } from './readiness.js';

const m = (required: string, allocated: string, dispatched: string, delivered: string) => ({
  requiredQty: required,
  allocatedQty: allocated,
  dispatchedQty: dispatched,
  deliveredQty: delivered,
});

describe('material readiness', () => {
  it('is READY when every line is fully delivered', () => {
    const r = computeReadiness([m('10', '10', '10', '10'), m('4', '4', '4', '4')]);
    expect(r.state).toBe('READY');
    expect(r.shortLines).toBe(0);
    expect(r.deliveredQty).toBe('14.0000');
  });

  it('is NOT_READY when nothing has been delivered', () => {
    const r = computeReadiness([m('10', '10', '5', '0'), m('4', '0', '0', '0')]);
    expect(r.state).toBe('NOT_READY');
    expect(r.shortLines).toBe(2);
  });

  it('is PARTIALLY_READY when some but not all lines are delivered', () => {
    const r = computeReadiness([m('10', '10', '10', '10'), m('4', '4', '2', '2')]);
    expect(r.state).toBe('PARTIALLY_READY');
    expect(r.shortLines).toBe(1);
  });

  it('is READY when there are no material lines at all', () => {
    expect(computeReadiness([]).state).toBe('READY');
  });

  it('handles fractional quantities', () => {
    const r = computeReadiness([m('2.5', '2.5', '2.5', '2.5')]);
    expect(r.state).toBe('READY');
    expect(r.requiredQty).toBe('2.5000');
  });

  it('gate: installation may begin when READY, or with an override', () => {
    expect(installationMaterialsOk('READY', false)).toBe(true);
    expect(installationMaterialsOk('NOT_READY', false)).toBe(false);
    expect(installationMaterialsOk('PARTIALLY_READY', false)).toBe(false);
    expect(installationMaterialsOk('NOT_READY', true)).toBe(true);
  });
});
