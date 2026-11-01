import { motion, useReducedMotion, type Variants } from 'framer-motion';
import { Link } from 'react-router-dom';
import type { LucideIcon } from 'lucide-react';
import { cx } from './ui';

export type DockMotion = 'send' | 'in' | 'out' | 'scan' | 'pulse';
export interface DockAction {
  to: string;
  icon: LucideIcon;
  label: string;
  /** Colour of the thread this action is stitched in. */
  tone: 'stitch' | 'olive' | 'night' | 'sky' | 'gold';
  motion: DockMotion;
  primary?: boolean;
}

const MotionLink = motion.create(Link);

const TONE: Record<DockAction['tone'], { tint: string; solid: string; ring: string }> = {
  stitch: { tint: 'bg-stitch/12 text-stitch', solid: 'bg-stitch text-white', ring: 'rgb(var(--ruby))' },
  olive: { tint: 'bg-olive/15 text-olive', solid: 'bg-olive text-white', ring: 'rgb(var(--sage))' },
  night: { tint: 'bg-night/10 text-night dark:bg-white/10 dark:text-white', solid: 'bg-night text-white', ring: 'rgb(var(--vault))' },
  sky: { tint: 'bg-sky/12 text-sky', solid: 'bg-sky text-white', ring: 'rgb(var(--sky))' },
  gold: { tint: 'bg-gold/20 text-gold', solid: 'bg-gold text-night', ring: 'rgb(var(--brass))' },
};

/** Each icon answers in its own way: the paper plane takes off, money drops in or lifts out, the scanner sweeps. */
const ICON: Record<DockMotion, Variants> = {
  send: { rest: { x: 0, y: 0, rotate: 0 }, hover: { x: [0, 5, -3, 0], y: [0, -5, 3, 0], rotate: [0, -8, 0], transition: { duration: 0.6 } } },
  in: { rest: { y: 0 }, hover: { y: [0, 5, 0], transition: { duration: 0.5, repeat: Infinity, repeatDelay: 0.25 } } },
  out: { rest: { y: 0 }, hover: { y: [0, -5, 0], transition: { duration: 0.5, repeat: Infinity, repeatDelay: 0.25 } } },
  scan: { rest: { scale: 1 }, hover: { scale: [1, 0.86, 1], transition: { duration: 0.45 } } },
  pulse: { rest: { scale: 1, rotate: 0 }, hover: { scale: [1, 1.14, 1], rotate: [0, 6, 0], transition: { duration: 0.5 } } },
};

/**
 * The money actions, docked under the wallet card like the strip a card slides into.
 * One primary action carries the weight; the rest are quieter, each in its own thread colour.
 */
export function ActionDock({ actions }: { actions: DockAction[] }) {
  const reduce = useReducedMotion();
  return (
    <motion.nav
      initial={reduce ? false : { opacity: 0, y: -18, scale: 0.97 }}
      animate={{ opacity: 1, y: 0, scale: 1 }}
      transition={{ type: 'spring', bounce: 0.3, duration: 0.7, delay: 0.25 }}
      className="relative z-10 mx-2 -mt-9 rounded-[26px] bg-surface/95 p-1.5 shadow-[0_18px_40px_-22px_rgb(var(--vault)/0.55)] ring-1 ring-line/70 backdrop-blur sm:mx-5 sm:p-2"
    >
      {/* A stitched seam along the top edge, where the dock meets the card. */}
      <span aria-hidden="true" className="pointer-events-none absolute inset-x-6 top-0 h-px bg-[repeating-linear-gradient(90deg,rgb(var(--brass)/0.55)_0_6px,transparent_6px_11px)]" />
      <ul className="grid" style={{ gridTemplateColumns: `repeat(${actions.length}, minmax(0, 1fr))` }}>
        {actions.map((a, i) => {
          const tone = TONE[a.tone];
          return (
            <li key={a.to} className="min-w-0">
              <MotionLink
                to={a.to}
                initial={reduce ? false : 'hidden'}
                animate="rest"
                whileHover="hover"
                whileFocus="hover"
                whileTap="tap"
                variants={{
                  hidden: { opacity: 0, y: 10 },
                  rest: { opacity: 1, y: 0, transition: { delay: 0.4 + i * 0.06, type: 'spring', bounce: 0.4 } },
                  hover: { y: -3 },
                  tap: { scale: 0.92 },
                }}
                className="group relative flex flex-col items-center gap-1.5 rounded-[20px] px-0.5 py-2 text-center outline-none focus-visible:ring-2 focus-visible:ring-sky/50"
              >
                <span className="relative grid h-12 w-12 place-items-center sm:h-14 sm:w-14">
                  {/* A dashed thread ring that draws itself around the icon on hover. */}
                  {!reduce && (
                    <motion.svg viewBox="0 0 56 56" className="pointer-events-none absolute -inset-1 h-[calc(100%+8px)] w-[calc(100%+8px)]" aria-hidden="true">
                      <motion.circle
                        cx="28"
                        cy="28"
                        r="26"
                        fill="none"
                        stroke={tone.ring}
                        strokeWidth="1.6"
                        strokeDasharray="4 4"
                        variants={{ rest: { pathLength: 0, opacity: 0, rotate: -90 }, hidden: { pathLength: 0, opacity: 0 }, hover: { pathLength: 1, opacity: 0.8, rotate: 0, transition: { duration: 0.5 } } }}
                        style={{ originX: '50%', originY: '50%' }}
                      />
                    </motion.svg>
                  )}
                  <span
                    className={cx('grid h-full w-full place-items-center rounded-[18px] transition-colors duration-300', a.primary ? tone.solid : tone.tint)}
                    style={a.primary ? { boxShadow: `0 10px 22px -10px ${tone.ring}` } : undefined}
                  >
                    <motion.span variants={reduce ? undefined : ICON[a.motion]} className="grid place-items-center">
                      <a.icon className="h-[22px] w-[22px]" strokeWidth={a.primary ? 2.2 : 1.9} />
                    </motion.span>
                    {a.motion === 'scan' && !reduce && (
                      <motion.span
                        aria-hidden="true"
                        className="absolute inset-x-3 h-0.5 rounded-full bg-current opacity-0"
                        variants={{ rest: { opacity: 0, top: '30%' }, hover: { opacity: [0, 0.9, 0.9, 0], top: ['26%', '72%', '26%', '26%'], transition: { duration: 1.1, repeat: Infinity } } }}
                      />
                    )}
                  </span>
                </span>
                <span className={cx('max-w-full truncate text-[11px] leading-tight sm:text-[13px]', a.primary ? 'font-semibold text-ink' : 'font-medium text-muted group-hover:text-ink')}>{a.label}</span>
              </MotionLink>
            </li>
          );
        })}
      </ul>
    </motion.nav>
  );
}
