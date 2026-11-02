import { useEffect, useState } from 'react';
import { useLocation } from 'react-router-dom';
import { AnimatePresence, motion } from 'framer-motion';
import { ChevronDown, ChevronsDown } from 'lucide-react';
import { useI18n } from '../lib/i18n';

/**
 * Not everyone thinks to scroll. When a page continues below the screen:
 * - at the top, a small pill says so (it leaves once they scroll);
 * - further down, whenever they pause with more still below, a quiet arrow
 *   appears at the bottom edge, and fades as soon as they move again.
 * Tapping either scrolls for them.
 */
export function ScrollCue({ bottom = 'calc(env(safe-area-inset-bottom) + 108px)' }: { bottom?: string }) {
  const { lang } = useI18n();
  const { pathname } = useLocation();
  const [mode, setMode] = useState<'none' | 'pill' | 'arrow'>('none');

  useEffect(() => {
    setMode('none');
    const more = () => document.documentElement.scrollHeight - (window.scrollY + window.innerHeight) > 160;
    let idle = 0;
    const first = window.setTimeout(() => {
      if (window.scrollY < 40 && more()) setMode('pill');
    }, 900);
    const onScroll = () => {
      setMode('none');
      window.clearTimeout(idle);
      idle = window.setTimeout(() => {
        if (more()) setMode('arrow');
      }, 2200);
    };
    window.addEventListener('scroll', onScroll, { passive: true });
    return () => {
      window.clearTimeout(first);
      window.clearTimeout(idle);
      window.removeEventListener('scroll', onScroll);
    };
  }, [pathname]);

  const go = () => window.scrollBy({ top: window.innerHeight * 0.7, behavior: 'smooth' });

  return (
    <AnimatePresence>
      {mode === 'pill' && (
        <motion.button
          key="pill"
          type="button"
          initial={{ opacity: 0, y: 12, x: '-50%' }}
          animate={{ opacity: 1, y: 0, x: '-50%' }}
          exit={{ opacity: 0, y: 12, x: '-50%' }}
          transition={{ type: 'spring', bounce: 0.3, duration: 0.45 }}
          onClick={go}
          style={{ bottom }}
          className="fixed left-1/2 z-40 flex items-center gap-1.5 rounded-full bg-night/90 py-2 pe-4 ps-3 text-sm font-medium text-white shadow-card backdrop-blur lg:hidden"
        >
          <ChevronsDown className="cue-bob h-4 w-4" />
          {lang === 'ar' ? 'في كمان تحت' : 'More below'}
        </motion.button>
      )}
      {mode === 'arrow' && (
        <motion.button
          key="arrow"
          type="button"
          aria-label={lang === 'ar' ? 'في كمان تحت' : 'More below'}
          initial={{ opacity: 0, x: '-50%' }}
          animate={{ opacity: 1, x: '-50%' }}
          exit={{ opacity: 0, x: '-50%' }}
          transition={{ duration: 0.35 }}
          onClick={go}
          style={{ bottom }}
          className="fixed left-1/2 z-40 grid h-9 w-9 place-items-center rounded-full bg-surface/80 text-ink/70 shadow-card ring-1 ring-line backdrop-blur-md"
        >
          <ChevronDown className="cue-bob h-5 w-5" />
        </motion.button>
      )}
    </AnimatePresence>
  );
}
