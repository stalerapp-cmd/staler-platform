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
