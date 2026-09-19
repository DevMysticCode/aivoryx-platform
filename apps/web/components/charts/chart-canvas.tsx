'use client';

import { cn } from '@aivoryx/ui';
import type { ReactNode } from 'react';
import { Gauge } from './gauge';
import {
  type ChartData,
  type ChartKind,
  type ChartPoint,
  type GaugeStatus,
  type TargetData,
  gaugeScale,
} from './chart-model';

const SERIES = [1, 2, 3, 4, 5, 6].map((n) => `hsl(var(--chart-${n}))`);
const AXIS = 'hsl(var(--border))';
const TEXT = 'hsl(var(--muted-foreground))';

/** viewBox widths: the compact card view is drawn narrower so its text stays legible when scaled to a ~330px card */
const W_MD = 400;
const W_LG = 640;

interface CanvasProps {
  kind: ChartKind;
  data: ChartData;
  /** `lg` is the expanded / standalone view */
  size?: 'md' | 'lg';
  ariaLabel: string;
}

/**
 * Renders a dataset as the chosen kind. Hand-built SVG (no chart library — the
 * repo has none and the bundle stays unchanged), coloured only by `--chart-*`
 * tokens so tenant themes and dark mode apply. Every mark carries a <title> so
 * values are available on hover, and a visually-hidden table gives screen
 * readers the same numbers.
 */
export function ChartCanvas({ kind, data, size = 'md', ariaLabel }: CanvasProps) {
  const H = size === 'lg' ? 380 : 200;
  return (
    <figure className="m-0">
      <div
        role={kind === 'gauge' ? undefined : 'img'}
        aria-label={kind === 'gauge' ? undefined : ariaLabel}
      >
        {data.shape !== 'target' && data.points.length === 0 ? (
          <p className="py-10 text-center text-sm text-muted-foreground">
            No data for this period.
          </p>
        ) : (
          RENDERERS[kind]({ data, h: H, size })
        )}
      </div>
      <div className="sr-only">
        <table>
          <caption>{ariaLabel}</caption>
          <tbody>
            {data.shape === 'target' ? (
              <>
                <tr>
                  <th scope="row">{data.label}</th>
                  <td>{data.value}</td>
                </tr>
                <tr>
                  <th scope="row">{data.target !== undefined ? 'Target' : 'Max'}</th>
                  <td>{data.target ?? gaugeScale(data).max}</td>
                </tr>
              </>
            ) : (
              data.points.map((p) => (
                <tr key={p.label}>
                  <th scope="row">{p.label}</th>
                  <td>{p.value}</td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </figure>
  );
}

function niceMax(v: number): number {
  if (v <= 4) return Math.max(1, Math.ceil(v));
  const pow = 10 ** Math.floor(Math.log10(v));
  return Math.ceil(v / pow) * pow;
}

function LineArea({
  points,
  h,
  w,
  area,
}: {
  points: ChartPoint[];
  h: number;
  w: number;
  area: boolean;
}) {
  const padL = 34;
  const padR = 10;
  const padT = 12;
  const padB = 24;
  const max = niceMax(Math.max(1, ...points.map((p) => p.value)));
  const plotW = w - padL - padR;
  const plotH = h - padT - padB;
  const step = points.length > 1 ? plotW / (points.length - 1) : 0;
  const xy = points.map((p, i) => ({
    ...p,
    x: padL + (points.length > 1 ? i * step : plotW / 2),
    y: padT + plotH - (p.value / max) * plotH,
  }));
  const line = xy.map((p, i) => `${i ? 'L' : 'M'}${p.x.toFixed(1)},${p.y.toFixed(1)}`).join(' ');
  const base = padT + plotH;
  const labelIdx = new Set([0, Math.floor((points.length - 1) / 2), points.length - 1]);
  return (
    <svg viewBox={`0 0 ${w} ${h}`} className="h-auto w-full">
      {[0, 0.5, 1].map((f) => {
        const y = padT + plotH * (1 - f);
        return (
          <g key={f}>
            <line x1={padL} x2={w - padR} y1={y} y2={y} stroke={AXIS} />
            <text x={padL - 6} y={y + 4} textAnchor="end" fontSize={11} fill={TEXT}>
              {Math.round(max * f)}
            </text>
          </g>
        );
      })}
      {area ? (
        <path
          d={`${line} L${xy[xy.length - 1]!.x},${base} L${xy[0]!.x},${base} Z`}
          fill={SERIES[0]}
          fillOpacity={0.14}
        />
      ) : null}
      <path d={line} fill="none" stroke={SERIES[0]} strokeWidth={2} strokeLinejoin="round" />
      {xy.map((p, i) => (
        <g key={p.label + i}>
          <circle cx={p.x} cy={p.y} r={points.length > 40 ? 0 : 3} fill={SERIES[0]}>
            <title>{`${p.label}: ${p.value}`}</title>
          </circle>
          {labelIdx.has(i) ? (
            <text
              x={p.x}
              y={h - 6}
              textAnchor={i === 0 ? 'start' : i === points.length - 1 ? 'end' : 'middle'}
              fontSize={11}
              fill={TEXT}
            >
              {p.label}
            </text>
          ) : null}
        </g>
      ))}
    </svg>
  );
}

function Bars({
  points,
  h,
  w,
  horizontal,
}: {
  points: ChartPoint[];
  h: number;
  w: number;
  horizontal?: boolean;
}) {
  const max = niceMax(Math.max(1, ...points.map((p) => p.value)));
  if (horizontal) {
    const rowH = Math.min(34, Math.max(22, (h - 8) / Math.max(1, points.length)));
    const labelW = 120;
    const height = points.length * rowH + 8;
    return (
      <svg viewBox={`0 0 ${w} ${height}`} className="h-auto w-full">
        {points.map((p, i) => {
          const y = 4 + i * rowH;
          const barW = ((w - labelW - 56) * p.value) / max;
          return (
            <g key={p.label + i}>
              <text x={0} y={y + rowH / 2 + 4} fontSize={12} fill="hsl(var(--foreground))">
                {p.label.length > 18 ? `${p.label.slice(0, 17)}…` : p.label}
              </text>
              <rect
                x={labelW}
                y={y + 3}
                width={Math.max(2, barW)}
                height={rowH - 8}
                rx={3}
                fill={SERIES[0]}
              >
                <title>{`${p.label}: ${p.value}`}</title>
              </rect>
              <text
                x={labelW + Math.max(2, barW) + 6}
                y={y + rowH / 2 + 4}
                fontSize={12}
                fill={TEXT}
              >
                {p.value}
              </text>
            </g>
          );
        })}
      </svg>
    );
  }
  const padL = 34;
  const padB = 24;
  const padT = 12;
  const plotW = w - padL - 10;
  const plotH = h - padT - padB;
  const slot = plotW / Math.max(1, points.length);
  const bw = Math.min(46, slot * 0.66);
  const every = Math.ceil(points.length / 10);
  return (
    <svg viewBox={`0 0 ${w} ${h}`} className="h-auto w-full">
      {[0, 0.5, 1].map((f) => {
        const y = padT + plotH * (1 - f);
        return (
          <g key={f}>
            <line x1={padL} x2={w - 10} y1={y} y2={y} stroke={AXIS} />
            <text x={padL - 6} y={y + 4} textAnchor="end" fontSize={11} fill={TEXT}>
              {Math.round(max * f)}
            </text>
          </g>
        );
      })}
      {points.map((p, i) => {
        const bh = (p.value / max) * plotH;
        const x = padL + i * slot + (slot - bw) / 2;
        return (
          <g key={p.label + i}>
            <rect
              x={x}
              y={padT + plotH - bh}
              width={bw}
              height={Math.max(bh, p.value > 0 ? 2 : 0)}
              rx={2}
              fill={SERIES[0]}
            >
              <title>{`${p.label}: ${p.value}`}</title>
            </rect>
            {i % every === 0 ? (
              <text x={x + bw / 2} y={h - 6} textAnchor="middle" fontSize={11} fill={TEXT}>
                {p.label.length > 10 ? `${p.label.slice(0, 9)}…` : p.label}
              </text>
            ) : null}
          </g>
        );
      })}
    </svg>
  );
}

function Slices({
  points,
  donut,
  size,
}: {
  points: ChartPoint[];
  donut: boolean;
  size: 'md' | 'lg';
}) {
  const total = points.reduce((a, p) => a + p.value, 0);
  const R = 90;
  const r = donut ? 56 : 0;
  let angle = -Math.PI / 2;
  const arcs = points.map((p, i) => {
    const frac = total > 0 ? p.value / total : 0;
    const a0 = angle;
    const a1 = angle + frac * Math.PI * 2;
    angle = a1;
    const large = a1 - a0 > Math.PI ? 1 : 0;
    const pt = (rad: number, a: number) =>
      [100 + rad * Math.cos(a), 100 + rad * Math.sin(a)] as const;
    const [x0, y0] = pt(R, a0);
    const [x1, y1] = pt(R, a1);
    const [xi1, yi1] = pt(r, a1);
    const [xi0, yi0] = pt(r, a0);
    const d =
      frac >= 0.9999
        ? `M100,${100 - R} A${R},${R} 0 1 1 99.99,${100 - R} ${donut ? `L99.99,${100 - r} A${r},${r} 0 1 0 100,${100 - r}` : ''} Z`
        : `M${x0},${y0} A${R},${R} 0 ${large} 1 ${x1},${y1} ${
            donut ? `L${xi1},${yi1} A${r},${r} 0 ${large} 0 ${xi0},${yi0}` : `L100,100`
          } Z`;
    return { ...p, frac, d, color: SERIES[i % SERIES.length]! };
  });
  return (
    <div
      className={cn(
        'flex flex-wrap items-center gap-6',
        size === 'lg' ? 'justify-center' : 'justify-start',
      )}
    >
      <svg viewBox="0 0 200 200" className={size === 'lg' ? 'size-64' : 'size-40'}>
        {arcs.map((a) =>
          a.frac > 0 ? (
            <path
              key={a.label}
              d={a.d}
              fill={a.color}
              stroke="hsl(var(--surface))"
              strokeWidth={1.5}
            >
              <title>{`${a.label}: ${a.value} (${Math.round(a.frac * 100)}%)`}</title>
            </path>
          ) : null,
        )}
        {donut ? (
          <text
            x={100}
            y={106}
            textAnchor="middle"
            fontSize={20}
            fontWeight={600}
            fill="hsl(var(--foreground))"
          >
            {total}
          </text>
        ) : null}
      </svg>
      <ul className="min-w-40 space-y-1.5 text-sm">
        {arcs.map((a) => (
          <li key={a.label} className="flex items-center gap-2">
            <span
              className="size-2.5 shrink-0 rounded-sm"
              style={{ background: a.color }}
              aria-hidden
            />
            <span className="truncate">{a.label}</span>
            <span className="ml-auto pl-3 tabular-nums text-muted-foreground">
              {a.value} · {Math.round(a.frac * 100)}%
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}

function Progress({ data }: { data: TargetData }) {
  const sc = gaugeScale(data);
  const u = data.unit ?? '';
  const status = data.status ?? 'neutral';
  const fill: Record<GaugeStatus, string> = {
    good: 'bg-success',
    warn: 'bg-warning',
    bad: 'bg-danger',
    neutral: 'bg-chart-1',
  };
  return (
    <div className="space-y-2 py-4">
      <div className="flex items-baseline justify-between gap-3 text-sm">
        <span className="font-medium">{data.label}</span>
        <span className="tabular-nums text-muted-foreground">
          {data.value}
          {u}
          {data.target !== undefined ? ` of ${data.target}${u}` : ` (${sc.pct}%)`}
        </span>
      </div>
      <div className="relative h-3 overflow-hidden rounded-full bg-secondary" role="presentation">
        <div
          className={`h-full rounded-full ${fill[status]}`}
          style={{ width: `${sc.frac * 100}%` }}
        />
        {sc.targetFrac !== null ? (
          <span
            className="absolute inset-y-0 w-0.5 bg-foreground"
            style={{ left: `${sc.targetFrac * 100}%` }}
            aria-hidden
          />
        ) : null}
      </div>
      {data.secondary ? <p className="text-xs text-muted-foreground">{data.secondary}</p> : null}
    </div>
  );
}

/**
 * The renderer registry: EVERY chart kind must have a renderer here (the Record
 * type makes a missing kind a compile error), so adding a kind to `ChartKind`
 * cannot silently produce an undrawable chart.
 */
const RENDERERS: Record<
  ChartKind,
  (p: { data: ChartData; h: number; size: 'md' | 'lg' }) => ReactNode
> = {
  line: ({ data, h, size }) => (
    <LineArea points={pointsOf(data)} h={h} w={wOf(size)} area={false} />
  ),
  area: ({ data, h, size }) => <LineArea points={pointsOf(data)} h={h} w={wOf(size)} area />,
  column: ({ data, h, size }) => <Bars points={pointsOf(data)} h={h} w={wOf(size)} />,
  bar: ({ data, h, size }) => <Bars points={pointsOf(data)} h={h} w={wOf(size)} horizontal />,
  donut: ({ data, size }) => <Slices points={pointsOf(data)} donut size={size} />,
  pie: ({ data, size }) => <Slices points={pointsOf(data)} donut={false} size={size} />,
  gauge: ({ data }) => (data.shape === 'target' ? <Gauge data={data} /> : null),
  progress: ({ data }) => (data.shape === 'target' ? <Progress data={data} /> : null),
};

const wOf = (size: 'md' | 'lg') => (size === 'lg' ? W_LG : W_MD);

/** Points for kinds that draw a series; a target dataset drawn as `bar` becomes value vs target/max. */
function pointsOf(data: ChartData): ChartPoint[] {
  if (data.shape !== 'target') return data.points;
  const sc = gaugeScale(data);
  return [
    { label: data.label, value: data.value },
    { label: data.target !== undefined ? 'Target' : 'Max', value: data.target ?? sc.max },
  ];
}
