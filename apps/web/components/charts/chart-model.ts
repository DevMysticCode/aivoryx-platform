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

export type ChartData =
  | { shape: 'timeseries' | 'categorical'; points: ChartPoint[] }
  | { shape: 'target'; value: number; target: number; label: string };

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
    const pct = data.target > 0 ? Math.round((data.value / data.target) * 100) : 0;
    return [
      { label: 'Achieved', value: fmt(data.value) },
      { label: 'Target', value: fmt(data.target) },
      { label: 'Progress', value: `${pct}%` },
    ];
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
      `Target,${cell(data.target)}`,
    ].join('\n');
  }
  return ['label,value', ...data.points.map((p) => `${cell(p.label)},${cell(p.value)}`)].join('\n');
}
