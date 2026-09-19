'use client';

import { cn } from '@aivoryx/ui';
import type { ChartData, ChartKind, ChartPoint } from './chart-model';

const SERIES = [1, 2, 3, 4, 5, 6].map((n) => `hsl(var(--chart-${n}))`);
const AXIS = 'hsl(var(--border))';
const TEXT = 'hsl(var(--muted-foreground))';

const W = 640;

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
  const H = size === 'lg' ? 380 : 220;
  return (
    <figure className="m-0">
      <div role="img" aria-label={ariaLabel}>
        {data.shape === 'target' ? (
          kind === 'gauge' ? (
            <Gauge data={data} />
          ) : kind === 'bar' ? (
            <Bars
              points={[
                { label: data.label, value: data.value },
                { label: 'Target', value: data.target },
              ]}
              h={H}
              horizontal
            />
          ) : (
            <Progress data={data} />
          )
        ) : data.points.length === 0 ? (
          <p className="py-10 text-center text-sm text-muted-foreground">
            No data for this period.
          </p>
        ) : kind === 'line' || kind === 'area' ? (
          <LineArea points={data.points} h={H} area={kind === 'area'} />
        ) : kind === 'donut' || kind === 'pie' ? (
          <Slices points={data.points} donut={kind === 'donut'} size={size} />
        ) : (
          <Bars points={data.points} h={H} horizontal={kind === 'bar'} />
        )}
      </div>
      <table className="sr-only">
        <caption>{ariaLabel}</caption>
        <tbody>
          {data.shape === 'target' ? (
            <>
              <tr>
                <th scope="row">{data.label}</th>
                <td>{data.value}</td>
              </tr>
              <tr>
                <th scope="row">Target</th>
                <td>{data.target}</td>
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
    </figure>
  );
}

function niceMax(v: number): number {
  if (v <= 4) return Math.max(1, Math.ceil(v));
  const pow = 10 ** Math.floor(Math.log10(v));
  return Math.ceil(v / pow) * pow;
}

function LineArea({ points, h, area }: { points: ChartPoint[]; h: number; area: boolean }) {
  const padL = 34;
  const padR = 10;
  const padT = 12;
  const padB = 24;
  const max = niceMax(Math.max(1, ...points.map((p) => p.value)));
  const plotW = W - padL - padR;
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
    <svg viewBox={`0 0 ${W} ${h}`} className="h-auto w-full">
      {[0, 0.5, 1].map((f) => {
        const y = padT + plotH * (1 - f);
        return (
          <g key={f}>
            <line x1={padL} x2={W - padR} y1={y} y2={y} stroke={AXIS} />
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
  horizontal,
}: {
  points: ChartPoint[];
  h: number;
  horizontal?: boolean;
}) {
  const max = niceMax(Math.max(1, ...points.map((p) => p.value)));
  if (horizontal) {
    const rowH = Math.min(34, Math.max(22, (h - 8) / Math.max(1, points.length)));
    const labelW = 120;
    const height = points.length * rowH + 8;
    return (
      <svg viewBox={`0 0 ${W} ${height}`} className="h-auto w-full">
        {points.map((p, i) => {
          const y = 4 + i * rowH;
          const w = ((W - labelW - 56) * p.value) / max;
          return (
            <g key={p.label + i}>
              <text x={0} y={y + rowH / 2 + 4} fontSize={12} fill="hsl(var(--foreground))">
                {p.label.length > 18 ? `${p.label.slice(0, 17)}…` : p.label}
              </text>
              <rect
                x={labelW}
                y={y + 3}
                width={Math.max(2, w)}
                height={rowH - 8}
                rx={3}
                fill={SERIES[0]}
              >
                <title>{`${p.label}: ${p.value}`}</title>
              </rect>
              <text x={labelW + Math.max(2, w) + 6} y={y + rowH / 2 + 4} fontSize={12} fill={TEXT}>
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
  const plotW = W - padL - 10;
  const plotH = h - padT - padB;
  const slot = plotW / Math.max(1, points.length);
  const bw = Math.min(46, slot * 0.66);
  const every = Math.ceil(points.length / 10);
  return (
    <svg viewBox={`0 0 ${W} ${h}`} className="h-auto w-full">
      {[0, 0.5, 1].map((f) => {
        const y = padT + plotH * (1 - f);
        return (
          <g key={f}>
            <line x1={padL} x2={W - 10} y1={y} y2={y} stroke={AXIS} />
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

function Gauge({ data }: { data: Extract<ChartData, { shape: 'target' }> }) {
  const frac = data.target > 0 ? Math.min(1, data.value / data.target) : 0;
  const R = 80;
  const end = Math.PI * (1 - frac);
  const x = 100 + R * Math.cos(end);
  const y = 100 - R * Math.sin(end);
  return (
    <svg viewBox="0 0 200 120" className="mx-auto h-auto w-full max-w-xs">
      <path
        d={`M20,100 A${R},${R} 0 0 1 180,100`}
        fill="none"
        stroke="hsl(var(--secondary))"
        strokeWidth={16}
        strokeLinecap="round"
      />
      {frac > 0 ? (
        <path
          d={`M20,100 A${R},${R} 0 0 1 ${x},${y}`}
          fill="none"
          stroke={SERIES[0]}
          strokeWidth={16}
          strokeLinecap="round"
        >
          <title>{`${data.value} of ${data.target}`}</title>
        </path>
      ) : null}
      <text
        x={100}
        y={92}
        textAnchor="middle"
        fontSize={26}
        fontWeight={600}
        fill="hsl(var(--foreground))"
      >
        {Math.round(frac * 100)}%
      </text>
      <text x={100} y={112} textAnchor="middle" fontSize={11} fill={TEXT}>
        {data.value} of {data.target}
      </text>
    </svg>
  );
}

function Progress({ data }: { data: Extract<ChartData, { shape: 'target' }> }) {
  const frac = data.target > 0 ? Math.min(1, data.value / data.target) : 0;
  return (
    <div className="space-y-2 py-4">
      <div className="flex items-baseline justify-between text-sm">
        <span className="font-medium">{data.label}</span>
        <span className="tabular-nums text-muted-foreground">
          {data.value} of {data.target}
        </span>
      </div>
      <div className="h-3 overflow-hidden rounded-full bg-secondary" role="presentation">
        <div className="h-full rounded-full bg-chart-1" style={{ width: `${frac * 100}%` }} />
      </div>
    </div>
  );
}
