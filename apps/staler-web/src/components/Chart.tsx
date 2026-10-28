import { motion, useReducedMotion } from 'framer-motion';
import { useId, useMemo, useRef, useState } from 'react';

export interface Series {
  name: string;
  color: string;
  values: number[];
}

/** Monotone cubic path (no overshoot below zero). */
function smooth(points: [number, number][]) {
  if (points.length < 2) return '';
  const d: string[] = [`M${points[0]![0]},${points[0]![1]}`];
  for (let i = 0; i < points.length - 1; i++) {
    const [x0, y0] = points[i]!;
    const [x1, y1] = points[i + 1]!;
    const cx = (x0 + x1) / 2;
    d.push(`C${cx},${y0} ${cx},${y1} ${x1},${y1}`);
  }
  return d.join('');
}

export function AreaChart({ labels, series, height = 200, format }: { labels: string[]; series: Series[]; height?: number; format: (n: number) => string }) {
  const reduce = useReducedMotion();
  const W = 600;
  const H = height;
  const pad = { t: 16, b: 26, l: 24, r: 24 };
  const max = Math.max(1, ...series.flatMap((s) => s.values)) * 1.15;
  const x = (i: number) => pad.l + (i / Math.max(1, labels.length - 1)) * (W - pad.l - pad.r);
  const y = (v: number) => pad.t + (1 - v / max) * (H - pad.t - pad.b);
  const paths = useMemo(
    () =>
      series.map((s) => {
        const pts = s.values.map((v, i) => [x(i), y(v)] as [number, number]);
        const line = smooth(pts);
        return { ...s, line, area: `${line}L${x(s.values.length - 1)},${H - pad.b}L${x(0)},${H - pad.b}Z` };
      }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [series, labels.length, max, H],
  );
  const uid = useId().replace(/:/g, '');
  const [hover, setHover] = useState<number | null>(null);
  const svgRef = useRef<SVGSVGElement>(null);
  const onMove = (e: React.PointerEvent) => {
    const r = svgRef.current!.getBoundingClientRect();
    // Time runs left→right in both languages (the chart container is dir="ltr").
    const rel = (e.clientX - r.left) / r.width;
    setHover(Math.max(0, Math.min(labels.length - 1, Math.round(rel * (labels.length - 1)))));
  };
  return (
    <div className="relative" dir="ltr">
      <svg ref={svgRef} viewBox={`0 0 ${W} ${H}`} className="h-auto w-full touch-none" onPointerMove={onMove} onPointerLeave={() => setHover(null)} role="img" aria-label={series.map((s) => s.name).join(', ')}>
        <defs>
          {paths.map((p, i) => (
            <linearGradient key={i} id={`g${uid}${i}`} x1="0" x2="0" y1="0" y2="1">
              <stop offset="0%" stopColor={p.color} stopOpacity="0.28" />
              <stop offset="100%" stopColor={p.color} stopOpacity="0" />
            </linearGradient>
          ))}
        </defs>
        {[0.25, 0.5, 0.75].map((f) => (
          <line key={f} x1={pad.l} x2={W - pad.r} y1={pad.t + f * (H - pad.t - pad.b)} y2={pad.t + f * (H - pad.t - pad.b)} stroke="rgb(var(--line))" strokeDasharray="3 5" />
        ))}
        {paths.map((p, i) => (
          <g key={p.name}>
            <motion.path d={p.area} fill={`url(#g${uid}${i})`} initial={reduce ? false : { opacity: 0 }} animate={{ opacity: 1 }} transition={{ duration: 0.8, delay: 0.4 }} />
            <motion.path d={p.line} fill="none" stroke={p.color} strokeWidth={2.4} strokeLinecap="round" initial={reduce ? false : { pathLength: 0 }} animate={{ pathLength: 1 }} transition={{ duration: 1.2, ease: 'easeInOut', delay: i * 0.15 }} />
          </g>
        ))}
        {hover !== null && (
          <g>
            <line x1={x(hover)} x2={x(hover)} y1={pad.t} y2={H - pad.b} stroke="rgb(var(--muted))" strokeOpacity="0.4" />
            {paths.map((p) => (
              <circle key={p.name} cx={x(hover)} cy={y(p.values[hover] ?? 0)} r={5} fill="rgb(var(--surface))" stroke={p.color} strokeWidth={2.5} />
            ))}
          </g>
        )}
        {labels.map((l, i) =>
          i % Math.ceil(labels.length / 6) === 0 || i === labels.length - 1 ? (
            <text key={l + i} x={x(i)} y={H - 6} textAnchor="middle" fontSize="11" fill="rgb(var(--muted))">
              {l.slice(5)}
            </text>
          ) : null,
        )}
      </svg>
      {hover !== null && (
        <div className="pointer-events-none absolute top-0 rounded-xl border border-line bg-surface px-3 py-2 text-xs shadow-lift" style={{ left: `${Math.min(80, Math.max(2, (hover / Math.max(1, labels.length - 1)) * 100 - 10))}%` }}>
          <div className="mb-1 text-muted">{labels[hover]}</div>
          {paths.map((p) => (
            <div key={p.name} className="flex items-center gap-2">
              <span className="h-2 w-2 rounded-full" style={{ background: p.color }} />
              <span className="num">{format(p.values[hover] ?? 0)}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

export function BarList({ items, format }: { items: { label: string; value: number }[]; format: (n: number) => string }) {
  const max = Math.max(1, ...items.map((i) => i.value));
  return (
    <ul className="space-y-3">
      {items.map((it, i) => (
        <li key={it.label}>
          <div className="mb-1 flex justify-between text-sm">
            <span className="truncate">{it.label}</span>
            <span className="num text-muted">{format(it.value)}</span>
          </div>
          <div className="h-2 overflow-hidden rounded-full bg-sunk">
            <motion.div className="h-full rounded-full bg-stitch" initial={{ width: 0 }} animate={{ width: `${(it.value / max) * 100}%` }} transition={{ duration: 0.8, delay: i * 0.08 }} />
          </div>
        </li>
      ))}
    </ul>
  );
}
