/**
 * Pure CRM analytics calculations (Phase 13D). Deliberately separated from any
 * DB access so every rule here is unit-testable: date bucketing, funnel
 * conversion percentages, source conversion rates, and week-over-week deltas.
 * No metric here is invented — every number is derived from a count that was
 * actually queried; a metric is omitted (not defaulted to 0/fabricated) when
 * the underlying data cannot support it.
 */

/** The CRM lead lifecycle, in funnel order (ADR 0031 — never a second model). DISQUALIFIED is a terminal branch, not a funnel stage. */
export const FUNNEL_STAGES = ['NEW', 'ASSIGNED', 'CONTACTED', 'QUALIFIED', 'CONVERTED'] as const;
export type FunnelStage = (typeof FUNNEL_STAGES)[number];

export interface DailyCount {
  date: string; // YYYY-MM-DD
  count: number;
}

/**
 * Fill every day in `[now - days + 1, now]` with its count from `rows`
 * (0 where no lead was created). Always returns exactly `days` entries, so the
 * frontend never has to guess about a missing day vs. a zero day.
 */
export function bucketDailyCounts(
  rows: { day: string; count: number }[],
  days: number,
  now: Date,
): DailyCount[] {
  const byDay = new Map(rows.map((r) => [r.day, r.count]));
  const out: DailyCount[] = [];
  for (let i = days - 1; i >= 0; i -= 1) {
    const d = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
    d.setUTCDate(d.getUTCDate() - i);
    const key = d.toISOString().slice(0, 10);
    out.push({ date: key, count: byDay.get(key) ?? 0 });
  }
  return out;
}

/**
 * Sum of the most recent 7 days vs. the 7 days before that. Returns `null`
 * (never a fabricated 0%) when fewer than 14 days of trend are available.
 */
export function weekOverWeekDelta(
  trend: DailyCount[],
): { thisWeek: number; previousWeek: number; changePct: number | null } | null {
  if (trend.length < 14) return null;
  const thisWeek = trend.slice(-7).reduce((a, d) => a + d.count, 0);
  const previousWeek = trend.slice(-14, -7).reduce((a, d) => a + d.count, 0);
  const changePct =
    previousWeek > 0 ? Math.round(((thisWeek - previousWeek) / previousWeek) * 100) : null;
  return { thisWeek, previousWeek, changePct };
}

export interface FunnelStageResult {
  stage: FunnelStage;
  count: number;
  /** percentage of the FIRST stage's count that reached this stage; null if the first stage is empty */
  conversionFromStart: number | null;
  /** percentage of the PREVIOUS stage's count that reached this stage; null for the first stage or an empty previous stage */
  conversionFromPrevious: number | null;
}

/** Stage-to-stage funnel from raw status counts. Never mutates lifecycle semantics — only reads existing counts. */
export function computeFunnel(byStatus: Record<string, number>): FunnelStageResult[] {
  const counts = FUNNEL_STAGES.map((s) => byStatus[s] ?? 0);
  const first = counts[0] ?? 0;
  return FUNNEL_STAGES.map((stage, i) => {
    const count = counts[i]!;
    const prev = i > 0 ? counts[i - 1]! : null;
    return {
      stage,
      count,
      conversionFromStart: first > 0 ? Math.round((count / first) * 1000) / 10 : null,
      conversionFromPrevious:
        prev !== null ? (prev > 0 ? Math.round((count / prev) * 1000) / 10 : null) : null,
    };
  });
}

export interface SourcePerformanceInput {
  sourceId: string | null;
  sourceName: string;
  total: number;
  qualified: number;
  converted: number;
}
export interface SourcePerformanceResult extends SourcePerformanceInput {
  qualificationRate: number | null;
  conversionRate: number | null;
}

/** Adds qualification/conversion rates to raw per-source counts; null (not 0%) when there is nothing to divide by. */
export function computeSourcePerformance(
  rows: SourcePerformanceInput[],
): SourcePerformanceResult[] {
  return rows.map((r) => ({
    ...r,
    qualificationRate: r.total > 0 ? Math.round((r.qualified / r.total) * 1000) / 10 : null,
    conversionRate: r.total > 0 ? Math.round((r.converted / r.total) * 1000) / 10 : null,
  }));
}

/** Classify a pending follow-up's due date against "now" into the 3 action buckets. */
export function followupBucket(dueAt: Date, now: Date): 'overdue' | 'today' | 'upcoming' {
  const startOfToday = new Date(
    Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()),
  );
  const startOfTomorrow = new Date(startOfToday);
  startOfTomorrow.setUTCDate(startOfTomorrow.getUTCDate() + 1);
  if (dueAt < startOfToday) return 'overdue';
  if (dueAt < startOfTomorrow) return 'today';
  return 'upcoming';
}
