/**
 * The chart capability model (Phase 19). A dataset declares its SHAPE, and the
 * shape decides which visualisations are meaningful — so a user can never pick
 * a nonsensical one (a pie of a time series, a gauge of categories).
 */
export type ChartKind = 'line' | 'area' | 'column' | 'bar' | 'donut' | 'pie' | 'gauge' | 'progress';
export type ChartShape = 'timeseries' | 'categorical' | 'target';

export interface ChartPoint {
  label: string;
  value: number;
}

export type GaugeStatus = 'good' | 'warn' | 'bad' | 'neutral';

/**
 * A single measured value against a scale. Used by gauge / progress / bar.
 * The scale is `min`..`max` (defaults 0..`target` when a target is given, else
 * 0..100). `target` is an optional marker on that scale. `status` is a semantic
 * tone chosen by the caller from real thresholds (see `gaugeStatus`).
 */
export interface TargetData {
  shape: 'target';
  value: number;
  label: string;
  target?: number;
  min?: number;
  max?: number;
  /** supporting text under the value, e.g. "18 of 25 employees" */
  secondary?: string;
  /** appended to displayed numbers, e.g. "%" */
  unit?: string;
  status?: GaugeStatus;
}

export type ChartData = { shape: 'timeseries' | 'categorical'; points: ChartPoint[] } | TargetData;

/** Every chart kind the renderer registry must handle. */
export const CHART_KINDS = Object.keys({
  line: 1,
  area: 1,
  column: 1,
  bar: 1,
  donut: 1,
  pie: 1,
  gauge: 1,
  progress: 1,
} satisfies Record<ChartKind, 1>) as ChartKind[];

export function isChartKind(v: unknown): v is ChartKind {
  return typeof v === 'string' && (CHART_KINDS as string[]).includes(v);
}

export interface GaugeScale {
  min: number;
  max: number;
  /** value position on the scale, clamped to 0..1 */
  frac: number;
  /** target position on the scale (0..1) or null */
  targetFrac: number | null;
  /** value expressed as a percentage of the scale */
  pct: number;
}

/** Resolve a target dataset onto its scale. Pure; tolerant of a degenerate scale. */
export function gaugeScale(d: TargetData): GaugeScale {
  const min = d.min ?? 0;
  const max = d.max ?? (d.target !== undefined && d.target > min ? d.target : 100);
  const span = max - min;
  const clamp = (n: number) => Math.max(0, Math.min(1, n));
  const frac = span > 0 ? clamp((d.value - min) / span) : 0;
  const targetFrac = d.target !== undefined && span > 0 ? clamp((d.target - min) / span) : null;
  return { min, max, frac, targetFrac, pct: Math.round(frac * 100) };
}

/** Why a target dataset is invalid, or null when it can be drawn. */
export function validateChartData(d: ChartData): string | null {
  if (d.shape !== 'target') return null;
  if (!Number.isFinite(d.value)) return 'value must be a finite number';
  const { min, max } = gaugeScale(d);
  if (!(max > min)) return 'max must be greater than min';
  if (d.target !== undefined && !Number.isFinite(d.target)) return 'target must be finite';
  return null;
}

/**
 * Map a fraction of a scale to a semantic status using explicit thresholds.
 * `higherIsBetter` false inverts it (e.g. absence rate). Callers pass thresholds
 * that mean something for the metric — this never invents a "good" level.
 */
export function gaugeStatus(
  frac: number,
  opts: { goodAt: number; warnAt: number; higherIsBetter?: boolean },
): GaugeStatus {
  const f = opts.higherIsBetter === false ? 1 - frac : frac;
  if (f >= opts.goodAt) return 'good';
  if (f >= opts.warnAt) return 'warn';
  return 'bad';
}

export const CHART_KIND_LABEL: Record<ChartKind, string> = {
  line: 'Line',
  area: 'Area',
  column: 'Column',
  bar: 'Bar',
  donut: 'Donut',
  pie: 'Pie',
  gauge: 'Gauge',
  progress: 'Progress',
};

/** Which chart kinds are valid for each dataset shape (first = the default). */
export const CHART_CAPABILITIES: Record<ChartShape, readonly ChartKind[]> = {
  timeseries: ['line', 'area', 'column'],
  categorical: ['bar', 'column', 'donut', 'pie'],
  target: ['gauge', 'progress', 'bar'],
};

export function kindsFor(shape: ChartShape): readonly ChartKind[] {
  return CHART_CAPABILITIES[shape];
}

/** A preferred kind if it is valid for the shape, otherwise the shape's default. */
export function resolveKind(shape: ChartShape, preferred?: string | null): ChartKind {
  const kinds = CHART_CAPABILITIES[shape];
  return (kinds.find((k) => k === preferred) ?? kinds[0]) as ChartKind;
}

export interface SummaryMetric {
  label: string;
  value: string;
}

const fmt = (n: number) => (Number.isInteger(n) ? n.toLocaleString() : n.toFixed(1));

export function summarize(data: ChartData): SummaryMetric[] {
  if (data.shape === 'target') {
    const sc = gaugeScale(data);
    const u = data.unit ?? '';
    const out: SummaryMetric[] = [{ label: 'Value', value: `${fmt(data.value)}${u}` }];
    if (data.target !== undefined) out.push({ label: 'Target', value: `${fmt(data.target)}${u}` });
    out.push({ label: 'Of scale', value: `${sc.pct}%` });
    return out;
  }
  const pts = data.points;
  const total = pts.reduce((a, p) => a + p.value, 0);
  const peak = pts.reduce<ChartPoint | null>((m, p) => (!m || p.value > m.value ? p : m), null);
  if (data.shape === 'timeseries') {
    return [
      { label: 'Total', value: fmt(total) },
      { label: 'Daily average', value: pts.length ? fmt(total / pts.length) : '0' },
      { label: 'Peak', value: peak ? `${fmt(peak.value)} · ${peak.label}` : '—' },
    ];
  }
  return [
    { label: 'Total', value: fmt(total) },
    { label: 'Categories', value: String(pts.length) },
    {
      label: 'Largest',
      value: peak && total > 0 ? `${peak.label} · ${Math.round((peak.value / total) * 100)}%` : '—',
    },
  ];
}

/** CSV text for the data currently shown. Cells that could be read as formulas are neutralised. */
export function toCsv(data: ChartData): string {
  const cell = (v: string | number) => {
    const s = String(v);
    const safe = /^[=+\-@\t\r]/.test(s) ? `'${s}` : s;
    return /[",\n]/.test(safe) ? `"${safe.replace(/"/g, '""')}"` : safe;
  };
  if (data.shape === 'target') {
    return [
      'metric,value',
      `${cell(data.label)},${cell(data.value)}`,
      ...(data.target !== undefined ? [`Target,${cell(data.target)}`] : []),
      `Min,${cell(gaugeScale(data).min)}`,
      `Max,${cell(gaugeScale(data).max)}`,
    ].join('\n');
  }
  return ['label,value', ...data.points.map((p) => `${cell(p.label)},${cell(p.value)}`)].join('\n');
}
