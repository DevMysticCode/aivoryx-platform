import { describe, expect, it, vi } from 'vitest';
import { removeStaleDrainSchedules, startPoller } from './drain-schedule.js';

describe('removeStaleDrainSchedules', () => {
  it('removes every drain schedule (old 2s, duplicates, any interval) and ignores other jobs', async () => {
    const removed: string[] = [];
    const queue = {
      getRepeatableJobs: async () =>
        [
          { key: 'a', name: 'drain', every: '2000' },
          { key: 'b', name: 'drain', every: '30000' },
          { key: 'c', name: 'drain', every: '2000' },
          { key: 'x', name: 'report', every: '1000' },
        ] as never,
      removeRepeatableByKey: async (k: string) => {
        removed.push(k);
        return true;
      },
    };
    expect(await removeStaleDrainSchedules(queue)).toBe(3);
    expect(removed).toEqual(['a', 'b', 'c']);
  });

  it('is a read-only no-op when nothing is registered (safe on every boot)', async () => {
    const remove = vi.fn();
    const n = await removeStaleDrainSchedules({
      getRepeatableJobs: async () => [],
      removeRepeatableByKey: remove,
    });
    expect(n).toBe(0);
    expect(remove).not.toHaveBeenCalled();
  });
});

describe('startPoller', () => {
  it('runs immediately, reschedules only after completion, survives errors, and stops', async () => {
    vi.useFakeTimers();
    let calls = 0;
    const errors: unknown[] = [];
    const p = startPoller(
      async () => {
        calls += 1;
        if (calls === 1) throw new Error('boom');
      },
      30_000,
      (e) => errors.push(e),
    );
    await vi.advanceTimersByTimeAsync(0);
    expect(calls).toBe(1);
    expect(errors).toHaveLength(1);
    await vi.advanceTimersByTimeAsync(29_999);
    expect(calls).toBe(1);
    await vi.advanceTimersByTimeAsync(1);
    expect(calls).toBe(2);
    p.stop();
    await vi.advanceTimersByTimeAsync(120_000);
    expect(calls).toBe(2);
    vi.useRealTimers();
  });
});
