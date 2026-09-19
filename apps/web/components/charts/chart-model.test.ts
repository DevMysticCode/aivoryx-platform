import { describe, expect, it } from 'vitest';
import { kindsFor, resolveKind, summarize, toCsv, type ChartData } from './chart-model';

describe('chart capability model', () => {
  it('offers only meaningful kinds per dataset shape', () => {
    expect(kindsFor('timeseries')).toEqual(['line', 'area', 'column']);
    expect(kindsFor('categorical')).toEqual(['bar', 'column', 'donut', 'pie']);
    expect(kindsFor('target')).toEqual(['gauge', 'progress', 'bar']);
    expect(kindsFor('timeseries')).not.toContain('pie');
    expect(kindsFor('categorical')).not.toContain('gauge');
  });

  it('a remembered kind that is invalid for the shape falls back to the default', () => {
    expect(resolveKind('timeseries', 'pie')).toBe('line');
    expect(resolveKind('timeseries', 'area')).toBe('area');
    expect(resolveKind('target', null)).toBe('gauge');
  });
});

describe('summaries and export', () => {
  const series: ChartData = {
    shape: 'timeseries',
    points: [
      { label: 'Mon', value: 2 },
      { label: 'Tue', value: 6 },
    ],
  };

  it('summarises a time series', () => {
    expect(summarize(series)).toEqual([
      { label: 'Total', value: '8' },
      { label: 'Daily average', value: '4' },
      { label: 'Peak', value: '6 · Tue' },
    ]);
  });

  it('summarises a target dataset without dividing by zero (a zero target falls back to a 0-100 scale)', () => {
    const m = summarize({ shape: 'target', value: 3, target: 0, label: 'x' });
    expect(m.map((x) => x.label)).toEqual(['Value', 'Target', 'Of scale']);
    expect(m[2]!.value).toBe('3%');
  });

  it('CSV neutralises formula-looking cells and quotes commas', () => {
    const csv = toCsv({
      shape: 'categorical',
      points: [
        { label: '=HYPERLINK("x")', value: 1 },
        { label: 'a, b', value: 2 },
      ],
    });
    expect(csv).toContain(`"'=HYPERLINK(""x"")",1`);
    expect(csv).toContain('"a, b",2');
  });
});
