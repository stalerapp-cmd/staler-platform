import { motion, useReducedMotion } from 'framer-motion';
import { useMemo } from 'react';

/**
 * Palestinian tatreez, drawn the way it is embroidered: every filled cell is
 * a cross-stitch (two diagonal threads). Motifs are generated on a grid and
 * "stitched" ring by ring from the centre outwards.
 */
type Cell = { x: number; y: number; ring: number; tone: 0 | 1 };

/** Eight-pointed star (qamar) — one of the oldest motifs on Palestinian thobes. */
function star(size: number): Cell[] {
  const c = Math.floor(size / 2);
  const cells: Cell[] = [];
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const dx = Math.abs(x - c);
      const dy = Math.abs(y - c);
      const diamond = dx + dy;
      const square = Math.max(dx, dy);
      const outerDiamond = diamond <= c && diamond >= c - 1;
      const innerSquare = square === Math.floor(c * 0.55);
      const core = diamond <= 1;
      const arms = (dx === 0 || dy === 0) && square <= c && square % 2 === 0;
      const petals = dx === dy && dx >= 2 && dx <= Math.floor(c * 0.55);
      if (outerDiamond || innerSquare || core || arms || petals) {
        cells.push({ x, y, ring: diamond, tone: core || petals ? 1 : 0 });
      }
    }
  }
  return cells;
}

/** Repeating chevron band (the "feathers" border). */
function band(width: number, height = 7): Cell[] {
  const cells: Cell[] = [];
  for (let x = 0; x < width; x++) {
    const k = x % (height * 2 - 2);
    const y = k < height ? k : height * 2 - 2 - k;
    cells.push({ x, y, ring: x, tone: 0 });
    if (y + 2 < height) cells.push({ x, y: y + 2, ring: x, tone: 1 });
  }
  return cells;
}

function crossPath(cells: Cell[], s: number, inset = 0.18) {
  const a = s * inset;
  const b = s * (1 - inset);
  return cells.map(({ x, y }) => `M${x * s + a} ${y * s + a}L${x * s + b} ${y * s + b}M${x * s + b} ${y * s + a}L${x * s + a} ${y * s + b}`).join('');
}

interface MotifProps {
  size?: number;
  cell?: number;
  className?: string;
  colors?: [string, string];
  animate?: boolean;
  delay?: number;
  strokeWidth?: number;
}

export function StarMotif({ size = 17, cell = 10, className, colors = ['rgb(var(--stitch))', 'rgb(var(--gold))'], animate = true, delay = 0, strokeWidth = 1.7 }: MotifProps) {
  const reduce = useReducedMotion();
  const rings = useMemo(() => {
    const cells = star(size);
    const byRing = new Map<string, Cell[]>();
    for (const c of cells) {
      const k = `${c.ring}:${c.tone}`;
      byRing.set(k, [...(byRing.get(k) ?? []), c]);
    }
    return Array.from(byRing.entries())
      .map(([k, cs]) => ({ ring: Number(k.split(':')[0]), tone: Number(k.split(':')[1]) as 0 | 1, d: crossPath(cs, cell) }))
      .sort((a, b) => a.ring - b.ring);
  }, [size, cell]);
  const px = size * cell;
  return (
    <svg viewBox={`0 0 ${px} ${px}`} className={className} aria-hidden="true" fill="none" strokeLinecap="round">
      {rings.map((r) => (
        <motion.path
          key={`${r.ring}-${r.tone}`}
          d={r.d}
          stroke={colors[r.tone]}
          strokeWidth={strokeWidth}
          initial={animate && !reduce ? { pathLength: 0, opacity: 0 } : false}
          animate={{ pathLength: 1, opacity: 1 }}
          transition={{ duration: 0.5, delay: delay + r.ring * 0.06, ease: 'easeOut' }}
        />
      ))}
    </svg>
  );
}

export function StitchBand({ width = 48, cell = 8, className, colors = ['rgb(var(--stitch))', 'rgb(var(--olive))'], animate = true }: MotifProps & { width?: number }) {
  const reduce = useReducedMotion();
  const cells = useMemo(() => band(width), [width]);
  const groups = useMemo(() => {
    const out: { i: number; tone: 0 | 1; d: string }[] = [];
    for (let i = 0; i < width; i += 6) {
      for (const tone of [0, 1] as const) {
        const cs = cells.filter((c) => c.x >= i && c.x < i + 6 && c.tone === tone);
        if (cs.length) out.push({ i, tone, d: crossPath(cs, cell) });
      }
    }
    return out;
  }, [cells, width, cell]);
  return (
    <svg viewBox={`0 0 ${width * cell} ${7 * cell}`} className={className} aria-hidden="true" fill="none" strokeLinecap="round" preserveAspectRatio="xMidYMid slice">
      {groups.map((g) => (
        <motion.path
          key={`${g.i}-${g.tone}`}
          d={g.d}
          stroke={colors[g.tone]}
          strokeWidth={1.5}
          initial={animate && !reduce ? { pathLength: 0 } : false}
          animate={{ pathLength: 1 }}
          transition={{ duration: 0.35, delay: g.i * 0.02 }}
        />
      ))}
    </svg>
  );
}

/** Brand mark: a small stitched star. */
export function Logo({ className = 'h-9 w-9', animate = false }: { className?: string; animate?: boolean }) {
  return (
    <span className={`relative inline-grid place-items-center rounded-xl bg-night ${className}`}>
      <StarMotif size={9} cell={8} className="h-[78%] w-[78%]" animate={animate} strokeWidth={2.2} colors={['#E2506A', '#E9C060']} />
    </span>
  );
}
