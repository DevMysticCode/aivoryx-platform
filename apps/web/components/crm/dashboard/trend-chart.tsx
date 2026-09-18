'use client';

import type { CrmTrendPoint } from '@aivoryx/contracts';

/**
 * Lead-created trend (Phase 13D §6, refined Phase 15.1) — a small hand-built
 * inline SVG line chart. No charting library exists in this repo (checked);
 * this keeps the bundle unchanged, consistent with the established pattern.
 * Faint gridlines + a labelled max value give the line a visible scale, so a
 * single-day spike reads as a real data point rather than a rendering glitch.
 */
export function TrendChart({ trend }: { trend: CrmTrendPoint[] }) {
  const width = 600;
  const height = 140;
  const padding = 8;
  const topPadding = 20;
  const max = Math.max(1, ...trend.map((p) => p.count));
  const plotHeight = height - padding - topPadding;
  const stepX = trend.length > 1 ? (width - padding * 2) / (trend.length - 1) : 0;

  const points = trend.map((p, i) => {
    const x = padding + i * stepX;
    const y = topPadding + plotHeight - (p.count / max) * plotHeight;
    return { x, y, ...p };
  });

  const path = points
    .map((p, i) => `${i === 0 ? 'M' : 'L'}${p.x.toFixed(1)},${p.y.toFixed(1)}`)
    .join(' ');
  const areaPath = `${path} L${points[points.length - 1]?.x ?? 0},${height - padding} L${points[0]?.x ?? 0},${height - padding} Z`;
  const last = points[points.length - 1];

  const total = trend.reduce((a, p) => a + p.count, 0);
  const gridLines = [0, 0.5, 1].map((f) => topPadding + plotHeight * f);

  return (
    <div>
      <svg
        viewBox={`0 0 ${width} ${height}`}
        className="h-32 w-full"
        role="img"
        aria-label={`Leads created over the last ${trend.length} days: ${total} total, peak ${max} in a single day`}
        preserveAspectRatio="none"
      >
        {gridLines.map((y) => (
          <line
            key={y}
            x1={padding}
            x2={width - padding}
            y1={y}
            y2={y}
            stroke="hsl(var(--border))"
            strokeWidth={1}
          />
        ))}
        <text x={padding} y={topPadding - 6} className="fill-muted-foreground" fontSize={11}>
          {max}
        </text>
        <path d={areaPath} fill="hsl(var(--primary) / 0.08)" stroke="none" />
        <path d={path} fill="none" stroke="hsl(var(--primary))" strokeWidth={2} />
        {last ? (
          <circle
            cx={last.x}
            cy={last.y}
            r={3.5}
            fill="hsl(var(--primary))"
            stroke="hsl(var(--card))"
            strokeWidth={1.5}
          />
        ) : null}
      </svg>
      <div className="mt-1 flex justify-between text-xs text-muted-foreground">
        <span>{trend[0]?.date}</span>
        <span>{total} leads created</span>
        <span>{trend[trend.length - 1]?.date}</span>
      </div>
    </div>
  );
}
