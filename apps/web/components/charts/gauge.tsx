'use client';

import { cn } from '@aivoryx/ui';
import { type GaugeStatus, type TargetData, gaugeScale, validateChartData } from './chart-model';

/** Semantic status → theme token (never a raw colour). */
const STATUS_STROKE: Record<GaugeStatus, string> = {
  good: 'hsl(var(--success))',
  warn: 'hsl(var(--warning))',
  bad: 'hsl(var(--danger))',
  neutral: 'hsl(var(--chart-1))',
};
const STATUS_WORD: Record<GaugeStatus, string> = {
  good: 'on track',
  warn: 'needs attention',
  bad: 'off track',
  neutral: '',
};

const R = 78;
const CX = 100;
const CY = 100;

const point = (frac: number, radius: number) => {
  const a = Math.PI * (1 - frac);
  return { x: CX + radius * Math.cos(a), y: CY - radius * Math.sin(a) };
};

const fmt = (n: number) =>
  Number.isInteger(n) ? n.toLocaleString() : n.toFixed(Math.abs(n) < 10 ? 1 : 0);

/**
 * The shared gauge: a clean semicircle (no 3-D), value arc coloured by a semantic
 * status token, an optional target marker, min/max ends, a centred value with its
 * label and secondary text, a hover tooltip (<title>) and a full text equivalent
 * for assistive tech. Sizes with its container. It only draws what it is given —
 * callers pass the real value/scale/status (see `gaugeStatus`).
 */
export function Gauge({
  data,
  className,
  compact,
}: {
  data: TargetData;
  className?: string;
  /** smaller type for KPI-sized placements */
  compact?: boolean;
}) {
  const invalid = validateChartData(data);
  if (invalid) {
    return (
      <p role="alert" className="text-xs text-danger">
        Gauge unavailable: {invalid}.
      </p>
    );
  }
  const sc = gaugeScale(data);
  const status = data.status ?? 'neutral';
  const unit = data.unit ?? '';
  const end = point(sc.frac, R);
  const start = point(0, R);
  const tickA = sc.targetFrac === null ? null : point(sc.targetFrac, R - 11);
  const tickB = sc.targetFrac === null ? null : point(sc.targetFrac, R + 11);
  const summary = [
    `${data.label}: ${fmt(data.value)}${unit}`,
    data.secondary,
    `scale ${fmt(sc.min)}${unit} to ${fmt(sc.max)}${unit}`,
    data.target !== undefined ? `target ${fmt(data.target)}${unit}` : null,
    STATUS_WORD[status] || null,
  ]
    .filter(Boolean)
    .join('; ');

  return (
    <div className={cn('mx-auto w-full max-w-[16rem]', className)}>
      <svg viewBox="0 0 200 122" className="h-auto w-full" role="img" aria-label={summary}>
        <title>{summary}</title>
        <path
          d={`M${start.x},${start.y} A${R},${R} 0 0 1 ${point(1, R).x},${point(1, R).y}`}
          fill="none"
          stroke="hsl(var(--secondary))"
          strokeWidth={14}
          strokeLinecap="round"
        />
        {sc.frac > 0 ? (
          <path
            d={`M${start.x},${start.y} A${R},${R} 0 0 1 ${end.x},${end.y}`}
            fill="none"
            stroke={STATUS_STROKE[status]}
            strokeWidth={14}
            strokeLinecap="round"
          />
        ) : null}
        {tickA && tickB ? (
          <line
            x1={tickA.x}
            y1={tickA.y}
            x2={tickB.x}
            y2={tickB.y}
            stroke="hsl(var(--foreground))"
            strokeWidth={2}
            strokeLinecap="round"
          >
            <title>{`Target ${fmt(data.target!)}${unit}`}</title>
          </line>
        ) : null}
        <text
          x={CX}
          y={compact ? 92 : 90}
          textAnchor="middle"
          fontSize={compact ? 24 : 28}
          fontWeight={600}
          fill="hsl(var(--foreground))"
          style={{ fontVariantNumeric: 'tabular-nums' }}
        >
          {fmt(data.value)}
          {unit}
        </text>
        <text x={CX} y={108} textAnchor="middle" fontSize={11} fill="hsl(var(--muted-foreground))">
          {data.label}
        </text>
        <text x={CX - R} y={118} textAnchor="middle" fontSize={9} fill="hsl(var(--text-subtle))">
          {fmt(sc.min)}
        </text>
        <text x={CX + R} y={118} textAnchor="middle" fontSize={9} fill="hsl(var(--text-subtle))">
          {fmt(sc.max)}
        </text>
      </svg>
      {data.secondary ? (
        <p className="-mt-1 text-center text-xs text-muted-foreground">{data.secondary}</p>
      ) : null}
    </div>
  );
}
