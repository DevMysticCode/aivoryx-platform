import { afterEach, describe, expect, it } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import { Gauge } from './gauge';
import { ChartCanvas } from './chart-canvas';
import {
  CHART_CAPABILITIES,
  CHART_KINDS,
  gaugeScale,
  gaugeStatus,
  isChartKind,
  validateChartData,
  type TargetData,
} from './chart-model';

afterEach(cleanup);

const data = (over: Partial<TargetData> = {}): TargetData => ({
  shape: 'target',
  label: 'Attendance',
  value: 18,
  max: 25,
  ...over,
});

describe('gauge model', () => {
  it('is a first-class kind, valid for target datasets only', () => {
    expect(isChartKind('gauge')).toBe(true);
    expect(CHART_KINDS).toContain('gauge');
    expect(CHART_CAPABILITIES.target).toContain('gauge');
    expect(CHART_CAPABILITIES.timeseries).not.toContain('gauge');
    expect(CHART_CAPABILITIES.categorical).not.toContain('gauge');
    expect(isChartKind('scatter3d')).toBe(false);
  });

  it('resolves the scale: explicit min/max, else 0..target, else 0..100; clamps', () => {
    expect(gaugeScale(data())).toMatchObject({ min: 0, max: 25, pct: 72 });
    expect(gaugeScale(data({ max: undefined, target: 20 }))).toMatchObject({ max: 20, pct: 90 });
    expect(gaugeScale(data({ max: undefined, value: 40 })).max).toBe(100);
    expect(gaugeScale(data({ value: 999 })).frac).toBe(1);
    expect(gaugeScale(data({ value: -5 })).frac).toBe(0);
    expect(gaugeScale(data({ target: 20 })).targetFrac).toBeCloseTo(0.8);
  });

  it('rejects an unusable scale or non-finite value', () => {
    expect(validateChartData(data())).toBeNull();
    expect(validateChartData(data({ max: 0 }))).toMatch(/max must be greater/);
    expect(validateChartData(data({ value: Number.NaN }))).toMatch(/finite/);
  });

  it('maps thresholds to a status, optionally inverted', () => {
    expect(gaugeStatus(0.9, { goodAt: 0.8, warnAt: 0.5 })).toBe('good');
    expect(gaugeStatus(0.6, { goodAt: 0.8, warnAt: 0.5 })).toBe('warn');
    expect(gaugeStatus(0.2, { goodAt: 0.8, warnAt: 0.5 })).toBe('bad');
    expect(gaugeStatus(0.9, { goodAt: 0.8, warnAt: 0.5, higherIsBetter: false })).toBe('bad');
  });
});

describe('Gauge component', () => {
  it('exposes the real numbers as a text equivalent and never bakes in a raw colour', () => {
    const { container } = render(
      <Gauge
        data={data({ target: 20, unit: '%', secondary: '18 of 25 employees', status: 'good' })}
      />,
    );
    const img = screen.getByRole('img', { name: /Attendance: 18%/ });
    expect(img.getAttribute('aria-label')).toMatch(/scale 0% to 25%/);
    expect(img.getAttribute('aria-label')).toMatch(/target 20%/);
    expect(img.getAttribute('aria-label')).toMatch(/on track/);
    expect(screen.getByText('18 of 25 employees')).toBeTruthy();
    const html = container.innerHTML;
    expect(html).toContain('hsl(var(--success))');
    expect(html).not.toMatch(/#[0-9a-f]{3,6}\b|rgb\(/i);
  });

  it('reports an invalid dataset instead of drawing nonsense', () => {
    render(<Gauge data={data({ max: 0 })} />);
    expect(screen.getByRole('alert').textContent).toMatch(/Gauge unavailable/);
  });

  it('renders through the shared canvas registry, with a screen-reader table', () => {
    render(<ChartCanvas kind="gauge" data={data({ target: 20 })} ariaLabel="Attendance rate" />);
    expect(screen.getAllByText('Attendance').length).toBeGreaterThan(0);
    expect(screen.getByRole('table', { hidden: true })).toBeTruthy();
  });
});
