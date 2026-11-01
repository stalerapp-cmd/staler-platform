import type { ReactNode } from 'react';

const TONES = ['#D9A73A', '#E2506A', '#D9A73A', '#9DBB5F'];

/** A ring of small cross-stitches around the avatar. */
export function StitchRing({ children, size = 48, count = 16 }: { children: ReactNode; size?: number; count?: number }) {
  const r = size / 2 - 3;
  return (
    <span className="relative grid shrink-0 place-items-center" style={{ width: size, height: size }}>
      <svg aria-hidden="true" viewBox={`0 0 ${size} ${size}`} className="stitch-ring absolute inset-0" width={size} height={size}>
        {Array.from({ length: count }, (_, i) => {
          const a = (i / count) * Math.PI * 2;
          const x = size / 2 + r * Math.cos(a);
          const y = size / 2 + r * Math.sin(a);
          return <path key={i} d={`M${x - 1.8} ${y - 1.8}l3.6 3.6M${x + 1.8} ${y - 1.8}l-3.6 3.6`} stroke={TONES[i % TONES.length]} strokeWidth="1.3" strokeLinecap="round" />;
        })}
      </svg>
      {children}
    </span>
  );
}

/** Small L-shaped tatreez corner, like the corner of an embroidered panel. */
export function StitchCorner({ className }: { className?: string }) {
  const cells: [number, number, string][] = [[0, 0, '#C8344A'], [1, 0, '#C8344A'], [2, 0, '#C8344A'], [3, 0, '#D9A73A'], [0, 1, '#C8344A'], [0, 2, '#C8344A'], [0, 3, '#D9A73A'], [2, 2, '#D9A73A']];
  const c = 3.2;
  return (
    <svg aria-hidden="true" width={c * 4} height={c * 4} viewBox={`0 0 ${c * 4} ${c * 4}`} className={className}>
      {cells.map(([x, y, col]) => (
        <path key={`${x}${y}`} d={`M${x * c + 0.9} ${y * c + 0.9}L${x * c + c - 0.9} ${y * c + c - 0.9}M${x * c + c - 0.9} ${y * c + 0.9}L${x * c + 0.9} ${y * c + c - 0.9}`} stroke={col} strokeWidth="1.1" strokeLinecap="round" />
      ))}
    </svg>
  );
}
