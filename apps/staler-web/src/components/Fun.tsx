import { motion } from 'framer-motion';
import { useEffect, useRef, useState, type ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { ArrowLeft, Moon, Sun } from 'lucide-react';
import { useI18n } from '../lib/i18n';
import { useTheme } from '../lib/theme';
import { cx } from './ui';

/** "See all"-style links as a little pill whose arrow nudges forward on hover. */
export function MoreLink({ to, children, icon, className, tone = 'stitch' }: { to: string; children: ReactNode; icon?: ReactNode; className?: string; tone?: 'stitch' | 'sky' | 'olive' }) {
  const tones = {
    stitch: 'bg-stitch/10 text-stitch ring-stitch/20 hover:bg-stitch hover:text-white',
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

/** Language as a two-letter pill with a sliding knob. */
export function LangSwitch({ onDark = false }: { onDark?: boolean }) {
  const { lang, setLang } = useI18n();
  return (
    <div dir="ltr" role="radiogroup" aria-label="Language" className={cx('relative flex h-9 items-center rounded-full p-1 text-xs font-bold', onDark ? 'bg-white/15 text-white' : 'bg-sunk text-muted ring-1 ring-line')}>
      {(['ar', 'en'] as const).map((l) => (
        <button key={l} role="radio" aria-checked={lang === l} onClick={() => setLang(l)} className={cx('relative z-10 grid h-7 w-9 place-items-center rounded-full transition', lang === l && (onDark ? 'text-night' : 'text-white'))}>
          {lang === l && <motion.span layoutId={`lang-knob-${onDark}`} className={cx('absolute inset-0 -z-10 rounded-full shadow', onDark ? 'bg-white' : 'bg-stitch')} transition={{ type: 'spring', bounce: 0.3, duration: 0.4 }} />}
          {l === 'ar' ? 'ع' : 'EN'}
        </button>
      ))}
    </div>
  );
}

/** Light/dark as a tiny sky switch: the sun rolls over and becomes a moon. */
export function ThemeSwitch({ onDark = false }: { onDark?: boolean }) {
  const { theme, setTheme } = useTheme();
  const { t } = useI18n();
  const dark = theme === 'dark';
  return (
    <button
      dir="ltr"
      role="switch"
      aria-checked={dark}
      aria-label={t.common.theme}
      onClick={() => setTheme(dark ? 'light' : 'dark')}
      className={cx('relative h-9 w-16 shrink-0 overflow-hidden rounded-full p-1 transition-colors duration-500', dark ? 'bg-[#1E2257]' : onDark ? 'bg-white/20' : 'bg-[#CDE8FF]')}
    >
      {dark &&
        [18, 30, 42].map((x, i) => (
          <motion.span key={x} className="absolute h-1 w-1 rounded-full bg-[#FFE7A6]" style={{ left: x - 10, top: 9 + (i % 2) * 12 }} animate={{ opacity: [0.2, 1, 0.2] }} transition={{ repeat: Infinity, duration: 1.6 + i * 0.4 }} />
        ))}
      <motion.span
        className={cx('relative grid h-7 w-7 place-items-center rounded-full shadow', dark ? 'bg-[#F4E7C9] text-[#3B3F8C]' : 'bg-[#FFC94A] text-[#B86A00]')}
        animate={{ x: dark ? 28 : 0, rotate: dark ? 360 : 0 }}
        transition={{ type: 'spring', bounce: 0.35, duration: 0.6 }}
      >
        {dark ? <Moon className="h-4 w-4" /> : <Sun className="h-4 w-4" />}
      </motion.span>
    </button>
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
        className={cx('absolute right-[3px] w-[7px] rounded-full bg-stitch/55 transition-[opacity,width,background-color] duration-300 hover:w-[9px] hover:bg-stitch/85', s.active || drag.current ? 'opacity-100' : 'opacity-0 group-hover:opacity-100')}
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
