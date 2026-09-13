import { describe, expect, it } from 'vitest';
import {
  bucketDailyCounts,
  computeFunnel,
  computeSourcePerformance,
  followupBucket,
  weekOverWeekDelta,
} from './analytics-calc.js';

describe('bucketDailyCounts', () => {
  it('fills every day in range, defaulting missing days to 0', () => {
    const now = new Date('2026-09-10T12:00:00Z');
    const out = bucketDailyCounts([{ day: '2026-09-10', count: 3 }], 3, now);
    expect(out).toEqual([
      { date: '2026-09-08', count: 0 },
      { date: '2026-09-09', count: 0 },
      { date: '2026-09-10', count: 3 },
    ]);
  });

  it('always returns exactly `days` entries even with no rows', () => {
    const out = bucketDailyCounts([], 7, new Date('2026-01-01T00:00:00Z'));
    expect(out).toHaveLength(7);
    expect(out.every((d) => d.count === 0)).toBe(true);
  });
});

describe('weekOverWeekDelta', () => {
  it('returns null with fewer than 14 days of trend (never fabricates a %)', () => {
    const trend = Array.from({ length: 10 }, (_, i) => ({ date: `d${i}`, count: 1 }));
    expect(weekOverWeekDelta(trend)).toBeNull();
  });

  it('computes this-week vs previous-week and a change percentage', () => {
    const trend = [
      ...Array.from({ length: 7 }, () => ({ date: 'x', count: 2 })), // previous week: 14
      ...Array.from({ length: 7 }, () => ({ date: 'x', count: 3 })), // this week: 21
    ];
    expect(weekOverWeekDelta(trend)).toEqual({ thisWeek: 21, previousWeek: 14, changePct: 50 });
  });

  it('changePct is null when the previous week is zero (avoids divide-by-zero)', () => {
    const trend = [
      ...Array.from({ length: 7 }, () => ({ date: 'x', count: 0 })),
      ...Array.from({ length: 7 }, () => ({ date: 'x', count: 5 })),
    ];
    expect(weekOverWeekDelta(trend)).toEqual({ thisWeek: 35, previousWeek: 0, changePct: null });
  });
});

describe('computeFunnel', () => {
  it('computes stage counts and both conversion percentages', () => {
    const out = computeFunnel({
      NEW: 100,
      ASSIGNED: 80,
      CONTACTED: 60,
      QUALIFIED: 30,
      CONVERTED: 10,
    });
    expect(out).toEqual([
      { stage: 'NEW', count: 100, conversionFromStart: 100, conversionFromPrevious: null },
      { stage: 'ASSIGNED', count: 80, conversionFromStart: 80, conversionFromPrevious: 80 },
      { stage: 'CONTACTED', count: 60, conversionFromStart: 60, conversionFromPrevious: 75 },
      { stage: 'QUALIFIED', count: 30, conversionFromStart: 30, conversionFromPrevious: 50 },
      { stage: 'CONVERTED', count: 10, conversionFromStart: 10, conversionFromPrevious: 33.3 },
    ]);
  });

  it('never divides by zero — an empty funnel reports null percentages, not NaN/0', () => {
    const out = computeFunnel({});
    expect(out.every((s) => s.count === 0)).toBe(true);
    expect(out.every((s) => s.conversionFromStart === null)).toBe(true);
    expect(out[0]!.conversionFromPrevious).toBeNull();
    expect(out[1]!.conversionFromPrevious).toBeNull(); // previous stage (NEW) is 0
  });

  it('ignores DISQUALIFIED — it is a terminal branch, not a funnel stage', () => {
    const out = computeFunnel({ NEW: 10, DISQUALIFIED: 4, CONVERTED: 1 });
    expect(out.map((s) => s.stage)).toEqual([
      'NEW',
      'ASSIGNED',
      'CONTACTED',
      'QUALIFIED',
      'CONVERTED',
    ]);
  });
});

describe('computeSourcePerformance', () => {
  it('computes qualification and conversion rates', () => {
    const out = computeSourcePerformance([
      { sourceId: 's1', sourceName: 'Website', total: 40, qualified: 18, converted: 6 },
    ]);
    expect(out[0]).toMatchObject({ qualificationRate: 45, conversionRate: 15 });
  });

  it('reports null rates (not 0%) for a source with zero leads', () => {
    const out = computeSourcePerformance([
      { sourceId: null, sourceName: 'Manual', total: 0, qualified: 0, converted: 0 },
    ]);
    expect(out[0]!.qualificationRate).toBeNull();
    expect(out[0]!.conversionRate).toBeNull();
  });
});

describe('followupBucket', () => {
  const now = new Date('2026-09-10T15:00:00Z');

  it('classifies a past due date as overdue', () => {
    expect(followupBucket(new Date('2026-09-09T10:00:00Z'), now)).toBe('overdue');
  });

  it('classifies later today as today', () => {
    expect(followupBucket(new Date('2026-09-10T23:00:00Z'), now)).toBe('today');
  });

  it('classifies a future date as upcoming', () => {
    expect(followupBucket(new Date('2026-09-12T10:00:00Z'), now)).toBe('upcoming');
  });
});
