import { motion, useReducedMotion } from 'framer-motion';
import { useMemo } from 'react';

/**
 * Banknote-style guilloché: layered hypotrochoid curves drawn in thin brass,
 * engraved in on mount and turning very slowly — the security printing of a
 * real note, used as the bank's signature surface.
 */
function hypotrochoid(R: number, r: number, d: number, scale: number, steps = 720) {
  const k = (R - r) / r;
  const turns = r / gcd(Math.round(R), Math.round(r));
  const pts: string[] = [];
  for (let i = 0; i <= steps * turns; i++) {
    const t = (i / steps) * Math.PI * 2;
    const x = (R - r) * Math.cos(t) + d * Math.cos(k * t);
    const y = (R - r) * Math.sin(t) - d * Math.sin(k * t);
    pts.push(`${(x * scale).toFixed(2)},${(y * scale).toFixed(2)}`);
  }
  return `M${pts.join('L')}Z`;
}
function gcd(a: number, b: number): number {
  return b === 0 ? a : gcd(b, a % b);
}

const LAYERS = [
  { R: 96, r: 36, d: 52, s: 1, w: 0.6, o: 0.85 },
  { R: 90, r: 30, d: 40, s: 1.05, w: 0.45, o: 0.6 },
  { R: 84, r: 21, d: 34, s: 1.12, w: 0.4, o: 0.45 },
  { R: 100, r: 40, d: 22, s: 0.86, w: 0.5, o: 0.7 },
];

export function Guilloche({ className, color = 'rgb(var(--brass))', spin = true, draw = true }: { className?: string; color?: string; spin?: boolean; draw?: boolean }) {
  const reduce = useReducedMotion();
  const paths = useMemo(() => LAYERS.map((l) => ({ ...l, d: hypotrochoid(l.R, l.r, l.d, l.s) })), []);
  return (
    <motion.svg
      viewBox="-200 -200 400 400"
      className={className}
      aria-hidden="true"
      fill="none"
      animate={spin && !reduce ? { rotate: 360 } : undefined}
      transition={{ duration: 240, repeat: Infinity, ease: 'linear' }}
    >
      {paths.map((p, i) => (
        <motion.path
          key={i}
          d={p.d}
          stroke={color}
          strokeWidth={p.w}
          strokeOpacity={p.o}
          initial={draw && !reduce ? { pathLength: 0 } : false}
          animate={{ pathLength: 1 }}
          transition={{ duration: 2.4, delay: i * 0.25, ease: 'easeInOut' }}
        />
      ))}
      <circle r="18" stroke={color} strokeOpacity="0.8" strokeWidth="0.8" />
      <circle r="12" stroke={color} strokeOpacity="0.6" strokeWidth="0.5" strokeDasharray="1.5 2.5" />
    </motion.svg>
  );
}

/** Brand emblem: a bank facade in brass on vault green — readable down to 24px. */
export function Emblem({ className = 'h-9 w-9' }: { className?: string }) {
  return (
    <svg viewBox="0 0 64 64" className={`shrink-0 ${className}`} role="img" aria-label="TalerBank">
      <rect width="64" height="64" rx="16" fill="#0C1A17" />
      <circle cx="32" cy="32" r="26" fill="none" stroke="#C9A45C" strokeWidth="1.4" opacity=".55" />
      <g fill="#C9A45C">
        <path d="M32 12.5L50 22H14z" />
        <rect x="15" y="24" width="34" height="3.2" rx="1" />
        <rect x="18" y="29" width="4.4" height="14" rx="1" />
        <rect x="26.2" y="29" width="4.4" height="14" rx="1" />
        <rect x="33.4" y="29" width="4.4" height="14" rx="1" />
        <rect x="41.6" y="29" width="4.4" height="14" rx="1" />
        <rect x="15" y="45" width="34" height="3.2" rx="1" />
        <rect x="13" y="49.6" width="38" height="3.2" rx="1" />
      </g>
      <circle cx="32" cy="18.6" r="1.8" fill="#0C1A17" />
    </svg>
  );
}
