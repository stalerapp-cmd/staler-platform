import { useEffect, useState } from 'react';
import { useLocation } from 'react-router-dom';
import { AnimatePresence, motion } from 'framer-motion';
import { ChevronsDown } from 'lucide-react';
import { useI18n } from '../lib/i18n';

/**
 * Not everyone thinks to scroll. When a page clearly continues below the
 * screen and the person hasn't moved yet, a small pill says so; it leaves the
 * moment they scroll, and tapping it scrolls for them.
 */
export function ScrollCue({ bottom = 'calc(env(safe-area-inset-bottom) + 108px)' }: { bottom?: string }) {
  const { lang } = useI18n();
  const { pathname } = useLocation();
  const [show, setShow] = useState(false);

  useEffect(() => {
    setShow(false);
    let done = false;
    const more = () => document.documentElement.scrollHeight - (window.scrollY + window.innerHeight) > 240;
    const timer = window.setTimeout(() => {
      if (!done && window.scrollY < 40 && more()) setShow(true);
    }, 1800);
    const off = () => {
      if (window.scrollY > 40 || !more()) {
        done = true;
        setShow(false);
      }
    };
    window.addEventListener('scroll', off, { passive: true });
    return () => {
      window.clearTimeout(timer);
      window.removeEventListener('scroll', off);
    };
  }, [pathname]);

  return (
    <AnimatePresence>
      {show && (
        <motion.button
          type="button"
          initial={{ opacity: 0, y: 12, x: '-50%' }}
          animate={{ opacity: 1, y: 0, x: '-50%' }}
          exit={{ opacity: 0, y: 12, x: '-50%' }}
          transition={{ type: 'spring', bounce: 0.3, duration: 0.5 }}
          onClick={() => window.scrollBy({ top: window.innerHeight * 0.7, behavior: 'smooth' })}
          style={{ bottom }}
          className="fixed left-1/2 z-40 flex items-center gap-1.5 rounded-full bg-night/90 py-2 pe-4 ps-3 text-sm font-medium text-white shadow-card backdrop-blur lg:hidden"
        >
          <ChevronsDown className="cue-bob h-4 w-4" />
          {lang === 'ar' ? 'في كمان تحت' : 'More below'}
        </motion.button>
      )}
    </AnimatePresence>
  );
}
