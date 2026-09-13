'use client';

import type { CrmTrendPoint } from '@aivoryx/contracts';

/**
 * Lead-created trend (Phase 13D §6) — a small hand-built inline SVG line
 * chart. No charting library exists in this repo (checked); this keeps the
 * bundle unchanged, consistent with the established pattern from Phase 13B/13C.
 */
export function TrendChart({ trend }: { trend: CrmTrendPoint[] }) {
  const width = 600;
  const height = 120;
  const padding = 8;
  const max = Math.max(1, ...trend.map((p) => p.count));
  const stepX = trend.length > 1 ? (width - padding * 2) / (trend.length - 1) : 0;

  const points = trend.map((p, i) => {
    const x = padding + i * stepX;
    const y = height - padding - (p.count / max) * (height - padding * 2);
    return { x, y, ...p };
  });

  const path = points
    .map((p, i) => `${i === 0 ? 'M' : 'L'}${p.x.toFixed(1)},${p.y.toFixed(1)}`)
    .join(' ');
  const areaPath = `${path} L${points[points.length - 1]?.x ?? 0},${height - padding} L${points[0]?.x ?? 0},${height - padding} Z`;

  const total = trend.reduce((a, p) => a + p.count, 0);

  return (
    <div>
      <svg
        viewBox={`0 0 ${width} ${height}`}
        className="h-28 w-full"
        role="img"
        aria-label={`Leads created over the last ${trend.length} days: ${total} total`}
        preserveAspectRatio="none"
      >
        <path d={areaPath} fill="hsl(var(--primary) / 0.08)" stroke="none" />
        <path d={path} fill="none" stroke="hsl(var(--primary))" strokeWidth={2} />
      </svg>
      <div className="mt-1 flex justify-between text-xs text-muted-foreground">
        <span>{trend[0]?.date}</span>
        <span>{total} leads created</span>
        <span>{trend[trend.length - 1]?.date}</span>
      </div>
    </div>
  );
}
