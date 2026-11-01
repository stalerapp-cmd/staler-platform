import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import { useReducedMotion } from 'framer-motion';
import { cx } from './ui';

/**
 * A horizontal rail that tells people it scrolls: the edges fade where more
 * items wait, arrow buttons appear on devices with a mouse, and on touch
 * screens the rail gives one small nudge the first time it comes into view.
 */
export function ScrollRow({ children, className, innerClassName, label, nudgeKey, bleed = true }: { children: ReactNode; className?: string; innerClassName?: string; label?: string; nudgeKey?: string; bleed?: boolean }) {
  const ref = useRef<HTMLDivElement>(null);
  const [edge, setEdge] = useState({ start: false, end: false });
  const reduce = useReducedMotion();

  // Distance scrolled from the reading start, the same for RTL and LTR.
  const measure = useCallback(() => {
    const el = ref.current;
    if (!el) return;
    const rtl = getComputedStyle(el).direction === 'rtl';
    const max = el.scrollWidth - el.clientWidth;
    const from = rtl ? -el.scrollLeft : el.scrollLeft;
    setEdge({ start: from > 4, end: max - from > 4 });
  }, []);

  useEffect(() => {
    measure();
    const el = ref.current;
    if (!el) return;
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    if (el.firstElementChild) ro.observe(el.firstElementChild);
    return () => ro.disconnect();
  }, [measure, children]);

  // A one-time nudge on touch screens so people learn the rail moves.
  useEffect(() => {
    const el = ref.current;
    if (!el || reduce || !nudgeKey || window.matchMedia('(hover: hover)').matches) return;
    const key = `st.nudge.${nudgeKey}`;
    try {
      if (sessionStorage.getItem(key)) return;
    } catch {
      /* private mode */
    }
    const io = new IntersectionObserver(
      ([e]) => {
        if (!e?.isIntersecting || el.scrollWidth <= el.clientWidth + 8) return;
        io.disconnect();
        try {
          sessionStorage.setItem(key, '1');
        } catch {
          /* ignore */
        }
        const rtl = getComputedStyle(el).direction === 'rtl';
        setTimeout(() => {
          el.scrollBy({ left: rtl ? -56 : 56, behavior: 'smooth' });
          setTimeout(() => el.scrollBy({ left: rtl ? 56 : -56, behavior: 'smooth' }), 520);
        }, 450);
      },
      { threshold: 0.8 },
    );
    io.observe(el);
    return () => io.disconnect();
  }, [nudgeKey, reduce]);

  const go = (dir: 1 | -1) => {
    const el = ref.current;
    if (!el) return;
    const rtl = getComputedStyle(el).direction === 'rtl';
    el.scrollBy({ left: dir * (rtl ? -1 : 1) * el.clientWidth * 0.8, behavior: 'smooth' });
  };

  const mask =
    edge.start && edge.end
      ? 'linear-gradient(to var(--row-end), transparent 0, #000 36px, #000 calc(100% - 36px), transparent 100%)'
      : edge.end
        ? 'linear-gradient(to var(--row-end), #000 calc(100% - 44px), transparent 100%)'
        : edge.start
          ? 'linear-gradient(to var(--row-end), transparent 0, #000 44px)'
          : undefined;

  return (
    <div className={cx('group/row relative', bleed && '-mx-4 sm:mx-0', className)} aria-label={label} role={label ? 'region' : undefined}>
      <div
        ref={ref}
        onScroll={measure}
        className={cx('row-scroll flex snap-x gap-3 overflow-x-auto scroll-smooth pb-2 pt-1 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden', bleed ? 'px-4 sm:px-1' : 'px-1', innerClassName)}
        style={mask ? { WebkitMaskImage: mask, maskImage: mask } : undefined}
      >
        {children}
      </div>
      {/* Arrows for mouse users; hidden on touch, where swiping is natural. */}
      {(['start', 'end'] as const).map((side) =>
        edge[side] ? (
          <button
            key={side}
            type="button"
            onClick={() => go(side === 'end' ? 1 : -1)}
            className={cx(
              'absolute top-1/2 z-10 hidden h-10 w-10 -translate-y-1/2 place-items-center rounded-full bg-surface text-ink shadow-card ring-1 ring-line transition hover:scale-105 [@media(hover:hover)]:grid',
              side === 'start' ? 'start-0 sm:-start-3' : 'end-0 sm:-end-3',
              'opacity-0 group-hover/row:opacity-100 focus-visible:opacity-100',
            )}
            aria-label={side === 'end' ? 'Next' : 'Previous'}
          >
            {side === 'end' ? <ChevronLeft className="h-5 w-5 ltr:rotate-180" /> : <ChevronRight className="h-5 w-5 ltr:rotate-180" />}
          </button>
        ) : null,
      )}
    </div>
  );
}
