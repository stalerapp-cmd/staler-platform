import { AnimatePresence, motion } from 'framer-motion';
import { useEffect, useRef, useState, type ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { ArrowLeft, Languages, Moon, Sun } from 'lucide-react';
import { useI18n } from '../lib/i18n';
import { useTheme } from '../lib/theme';
import { cx } from './ui';

/** "See all"-style links as a little pill whose arrow nudges forward on hover. */
export function MoreLink({ to, children, icon, className, tone = 'stitch' }: { to: string; children: ReactNode; icon?: ReactNode; className?: string; tone?: 'stitch' | 'sky' | 'olive' }) {
  const tones = {
    stitch: 'bg-gold/12 text-[rgb(122_92_30)] ring-gold/30 hover:bg-gold hover:text-night dark:text-gold',
    sky: 'bg-sky/10 text-sky ring-sky/20 hover:bg-sky hover:text-white',
    olive: 'bg-olive/10 text-olive ring-olive/20 hover:bg-olive hover:text-white',
  };
  return (
    <Link to={to} className={cx('group inline-flex items-center gap-1.5 rounded-full px-3 py-1.5 text-sm font-medium ring-1 transition active:scale-95', tones[tone], className)}>
      {icon}
      <span>{children}</span>
      <span className="grid h-5 w-5 place-items-center rounded-full bg-black/5 transition-transform duration-300 group-hover:-translate-x-0.5 ltr:group-hover:translate-x-0.5">
        <ArrowLeft className="h-3.5 w-3.5 ltr:rotate-180" />
      </span>
    </Link>
  );
}

/** Language and theme, side by side in one quiet pill (header, menus, sign-in screens). */
export function PrefsPill({ onDark = false }: { onDark?: boolean }) {
  const { lang, setLang, t } = useI18n();
  const { theme, setTheme } = useTheme();
  const dark = theme === 'dark';
  const btn = cx('relative grid h-8 place-items-center rounded-full transition active:scale-90', onDark ? 'text-white/85 hover:bg-white/15 hover:text-white' : 'text-muted hover:bg-sunk hover:text-ink');
  return (
    <div className={cx('flex items-center gap-0.5 rounded-full p-0.5 backdrop-blur', onDark ? 'bg-white/10 ring-1 ring-white/20' : 'bg-surface/80 ring-1 ring-line')}>
      <button onClick={() => setLang(lang === 'ar' ? 'en' : 'ar')} className={cx(btn, 'gap-1.5 px-2.5 text-[13px] font-semibold')} aria-label={t.common.language} title={t.common.language}>
        <span className="flex items-center gap-1.5">
          <Languages className="h-4 w-4" />
          <AnimatePresence mode="wait" initial={false}>
            <motion.span key={lang} initial={{ y: 8, opacity: 0 }} animate={{ y: 0, opacity: 1 }} exit={{ y: -8, opacity: 0 }} transition={{ duration: 0.18 }}>
              {lang === 'ar' ? 'EN' : 'ع'}
            </motion.span>
          </AnimatePresence>
        </span>
      </button>
      <span className={cx('h-4 w-px', onDark ? 'bg-white/25' : 'bg-line')} />
      <button onClick={() => setTheme(dark ? 'light' : 'dark')} className={cx(btn, 'w-8')} aria-label={t.common.theme} title={t.common.theme}>
        <AnimatePresence mode="wait" initial={false}>
          <motion.span key={theme} initial={{ rotate: -90, scale: 0.5, opacity: 0 }} animate={{ rotate: 0, scale: 1, opacity: 1 }} exit={{ rotate: 90, scale: 0.5, opacity: 0 }} transition={{ duration: 0.25 }}>
            {dark ? <Sun className="h-4 w-4" /> : <Moon className="h-4 w-4" />}
          </motion.span>
        </AnimatePresence>
      </button>
    </div>
  );
}

/**
 * The page's own scrollbar on desktop (the browser's one would show the plain
 * system pointer). A thin stitched thumb; drag it or click the track.
 */
export function PageScrollbar() {
  const [s, setS] = useState({ show: false, top: 0, h: 0, active: false });
  const drag = useRef<{ y: number; scroll: number } | null>(null);
  const hide = useRef<number>();
  const fine = typeof window !== 'undefined' && window.matchMedia('(hover: hover) and (pointer: fine)').matches;
  useEffect(() => {
    if (!fine) return;
    const update = () => {
      const vh = window.innerHeight;
      const sh = document.documentElement.scrollHeight;
      if (sh <= vh + 2) return setS((x) => ({ ...x, show: false }));
      const h = Math.max(48, (vh * vh) / sh);
      const top = (window.scrollY / (sh - vh)) * (vh - h);
      setS({ show: true, top, h, active: true });
      window.clearTimeout(hide.current);
      hide.current = window.setTimeout(() => setS((x) => ({ ...x, active: false })), 1200);
    };
    update();
    const ro = new ResizeObserver(update);
    ro.observe(document.body);
    window.addEventListener('scroll', update, { passive: true });
    window.addEventListener('resize', update);
    return () => {
      ro.disconnect();
      window.removeEventListener('scroll', update);
      window.removeEventListener('resize', update);
    };
  }, [fine]);
  if (!fine || !s.show) return null;
  const toScroll = (dy: number, base: number) => {
    const vh = window.innerHeight;
    const sh = document.documentElement.scrollHeight;
    window.scrollTo({ top: base + (dy / (vh - s.h)) * (sh - vh) });
  };
  return (
    <div
      className="group fixed bottom-0 right-0 top-0 z-[45] w-3.5"
      onPointerDown={(e) => {
        if (e.target !== e.currentTarget) return;
        const vh = window.innerHeight;
        window.scrollBy({ top: e.clientY < s.top ? -vh * 0.9 : vh * 0.9, behavior: 'smooth' });
      }}
    >
      <div
        className={cx('absolute right-[3px] w-[7px] rounded-full bg-gold/60 transition-[opacity,width,background-color] duration-300 hover:w-[9px] hover:bg-gold/90', s.active || drag.current ? 'opacity-100' : 'opacity-0 group-hover:opacity-100')}
        style={{ top: s.top, height: s.h }}
        onPointerDown={(e) => {
          e.preventDefault();
          (e.target as HTMLElement).setPointerCapture(e.pointerId);
          drag.current = { y: e.clientY, scroll: window.scrollY };
        }}
        onPointerMove={(e) => drag.current && toScroll(e.clientY - drag.current.y, drag.current.scroll)}
        onPointerUp={() => (drag.current = null)}
      />
    </div>
  );
}
