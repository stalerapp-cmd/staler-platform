import { motion, useReducedMotion } from 'framer-motion';
import { useMemo, type ReactNode } from 'react';

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

/** Brand mark: an embroidered wallet — cream cloth, a tatreez star in cross-stitch, a banknote peeking out. */
export function Logo({ className = 'h-9 w-9', animate = false }: { className?: string; animate?: boolean }) {
  const reduce = useReducedMotion();
  const play = animate && !reduce;
  const draw = (delay: number) => (play ? { initial: { pathLength: 0 }, animate: { pathLength: 1 }, transition: { duration: 0.9, delay, ease: 'easeInOut' as const } } : {});
  return (
    <svg viewBox="0 0 64 64" className={`shrink-0 ${className}`} role="img" aria-label="S-Taler">
      <rect width="64" height="64" rx="16" fill="#141B3D" />
      <motion.g initial={play ? { y: 10, opacity: 0 } : false} animate={{ y: 0, opacity: 1 }} transition={{ type: 'spring', bounce: 0.4, delay: 0.1 }}>
        <rect x="17" y="10" width="30" height="16" rx="3" fill="#E2506A" transform="rotate(-8 32 18)" />
        <rect x="20" y="12.5" width="24" height="11" rx="2" fill="none" stroke="#141B3D" strokeOpacity=".3" strokeWidth="1" transform="rotate(-8 32 18)" />
      </motion.g>
      <rect x="8" y="19" width="48" height="36" rx="8" fill="#F4E7C9" />
      <rect x="10.5" y="21.5" width="43" height="31" rx="6" fill="none" stroke="#C8344A" strokeWidth="1" strokeDasharray="1.6 1.4" />
      <g fill="none" strokeLinecap="round" strokeWidth="1.25">
        <motion.path d="M13.51 34.91L15.69 37.09M15.69 34.91L13.51 37.09M16.11 34.91L18.29 37.09M18.29 34.91L16.11 37.09M18.71 32.31L20.89 34.49M20.89 32.31L18.71 34.49M18.71 37.51L20.89 39.69M20.89 37.51L18.71 39.69M21.31 29.71L23.49 31.89M23.49 29.71L21.31 31.89M21.31 40.11L23.49 42.29M23.49 40.11L21.31 42.29M23.91 27.11L26.09 29.29M26.09 27.11L23.91 29.29M23.91 42.71L26.09 44.89M26.09 42.71L23.91 44.89M26.51 29.71L28.69 31.89M28.69 29.71L26.51 31.89M26.51 40.11L28.69 42.29M28.69 40.11L26.51 42.29M29.11 32.31L31.29 34.49M31.29 32.31L29.11 34.49M29.11 37.51L31.29 39.69M31.29 37.51L29.11 39.69M31.71 34.91L33.89 37.09M33.89 34.91L31.71 37.09M34.31 34.91L36.49 37.09M36.49 34.91L34.31 37.09" stroke="#C8344A" {...draw(0.2)} />
        <motion.path d="M21.31 34.91L23.49 37.09M23.49 34.91L21.31 37.09M23.91 32.31L26.09 34.49M26.09 32.31L23.91 34.49M23.91 34.91L26.09 37.09M26.09 34.91L23.91 37.09M23.91 37.51L26.09 39.69M26.09 37.51L23.91 39.69M26.51 34.91L28.69 37.09M28.69 34.91L26.51 37.09" stroke="#C7911F" {...draw(0.6)} />
        <motion.path d="M13.11 47.91L15.29 50.09M15.29 47.91L13.11 50.09M18.31 47.91L20.49 50.09M20.49 47.91L18.31 50.09M23.51 47.91L25.69 50.09M25.69 47.91L23.51 50.09M28.71 47.91L30.89 50.09M30.89 47.91L28.71 50.09M33.91 47.91L36.09 50.09M36.09 47.91L33.91 50.09M15.71 45.31L17.89 47.49M17.89 45.31L15.71 47.49M20.91 45.31L23.09 47.49M23.09 45.31L20.91 47.49M26.11 45.31L28.29 47.49M28.29 45.31L26.11 47.49M31.31 45.31L33.49 47.49M33.49 45.31L31.31 47.49" stroke="#3B5A1E" {...draw(0.9)} />
      </g>
      <path d="M43 30h13v14H43a7 7 0 0 1 0-14z" fill="#141B3D" />
      <motion.circle cx="45.5" cy="37" r="3.2" fill="#E9C060" initial={play ? { scale: 0 } : false} animate={{ scale: 1 }} transition={{ delay: 1.1, type: 'spring' }} />
      <circle cx="45.5" cy="37" r="1.2" fill="#141B3D" />
    </svg>
  );
}

/** A one-shot burst of cross-stitches flying out from the centre — used when money lands. */
export function StitchBurst({ count = 14, className }: { count?: number; className?: string }) {
  const reduce = useReducedMotion();
  const bits = useMemo(
    () =>
      Array.from({ length: count }, (_, i) => {
        const a = (i / count) * Math.PI * 2 + (i % 2 ? 0.2 : -0.1);
        const r = 70 + (i % 3) * 26;
        return { x: Math.cos(a) * r, y: Math.sin(a) * r, c: ['#E2506A', '#E9C060', '#9DBB5F', '#4070D6'][i % 4]!, d: (i % 5) * 0.03, s: 0.7 + (i % 3) * 0.25 };
      }),
    [count],
  );
  if (reduce) return null;
  return (
    <div className={`pointer-events-none absolute left-1/2 top-1/2 ${className ?? ''}`} aria-hidden="true">
      {bits.map((b, i) => (
        <motion.svg
          key={i}
          viewBox="0 0 10 10"
          className="absolute h-3.5 w-3.5 -translate-x-1/2 -translate-y-1/2"
          initial={{ x: 0, y: 0, opacity: 0, scale: 0.2, rotate: 0 }}
          animate={{ x: b.x, y: b.y, opacity: [0, 1, 1, 0], scale: b.s, rotate: 180 }}
          transition={{ duration: 1.3, delay: 0.15 + b.d, ease: 'easeOut' }}
        >
          <path d="M2 2L8 8M8 2L2 8" stroke={b.c} strokeWidth="2.2" strokeLinecap="round" />
        </motion.svg>
      ))}
    </div>
  );
}

/** Two people joined by a thread being stitched between them, a banknote travelling along it. */
export function MoneyThread({ from, to }: { from: ReactNode; to: ReactNode }) {
  const reduce = useReducedMotion();
  return (
    <div className="relative flex items-center justify-between gap-2 py-2" dir="ltr">
      <div className="relative z-10">{from}</div>
      <div className="relative h-10 flex-1">
        <svg viewBox="0 0 200 40" preserveAspectRatio="none" className="absolute inset-0 h-full w-full" aria-hidden="true">
          <motion.path
            d="M0 20 C 50 0, 150 40, 200 20"
            fill="none"
            stroke="rgb(var(--stitch))"
            strokeWidth="2"
            strokeDasharray="6 5"
            initial={reduce ? false : { pathLength: 0 }}
            animate={{ pathLength: 1 }}
            transition={{ duration: 0.9, ease: 'easeInOut' }}
          />
        </svg>
        {!reduce && (
          <motion.div
            className="absolute top-1/2 h-5 w-8 -translate-y-1/2 rounded-[5px] border border-white/60 bg-olive shadow-md"
            initial={{ left: '0%', opacity: 0 }}
            animate={{ left: ['0%', '85%'], opacity: [0, 1, 1, 0] }}
            transition={{ duration: 1.8, repeat: Infinity, repeatDelay: 0.6, ease: 'easeInOut' }}
          >
            <span className="absolute inset-[3px] rounded-[3px] border border-dashed border-white/50" />
          </motion.div>
        )}
      </div>
      <div className="relative z-10">{to}</div>
    </div>
  );
}
