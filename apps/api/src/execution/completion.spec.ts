import { describe, expect, it } from 'vitest';
import { checkProjectCompletion, type CompletionState } from './completion.js';

const base: CompletionState = {
  installationStatus: 'COMPLETED',
  latestQcStatus: 'PASSED',
  netMeteringDone: true,
  netMeteringNotRequired: false,
  handoverStatus: 'COMPLETED',
  openDefects: 0,
};

describe('project completion invariants', () => {
  it('passes when every requirement is met', () => {
    expect(checkProjectCompletion(base)).toEqual({ ok: true, missing: [] });
  });

  it('lists exactly what is missing', () => {
    const r = checkProjectCompletion({
      ...base,
      latestQcStatus: 'PENDING',
      handoverStatus: 'PENDING',
    });
    expect(r.ok).toBe(false);
    expect(r.missing).toEqual(['QC not passed', 'Handover not completed']);
  });

  it('accepts net metering when explicitly not required', () => {
    const r = checkProjectCompletion({
      ...base,
      netMeteringDone: false,
      netMeteringNotRequired: true,
    });
    expect(r.ok).toBe(true);
  });

  it('blocks on unresolved defects', () => {
    const r = checkProjectCompletion({ ...base, openDefects: 2 });
    expect(r.ok).toBe(false);
    expect(r.missing).toEqual(['2 unresolved defects']);
  });

  it('blocks when installation is not completed', () => {
    const r = checkProjectCompletion({ ...base, installationStatus: 'IN_PROGRESS' });
    expect(r.missing).toContain('Installation not completed');
  });

  it('blocks when nothing has started', () => {
    const r = checkProjectCompletion({
      installationStatus: null,
      latestQcStatus: null,
      netMeteringDone: false,
      netMeteringNotRequired: false,
      handoverStatus: null,
      openDefects: 0,
    });
    expect(r.missing).toEqual([
      'Installation not completed',
      'QC not passed',
      'Net metering not completed',
      'Handover not completed',
    ]);
  });
});
