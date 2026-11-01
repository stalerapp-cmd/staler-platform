import { motion } from 'framer-motion';
import { Check, Moon, Sun } from 'lucide-react';
import { useI18n } from '../lib/i18n';
import { cx } from './ui';

/** Light / dark, each shown as a small preview of the bank in that theme. */
export function ThemePicker({ theme, onChange }: { theme: string; onChange: (v: 'light' | 'dark') => void }) {
  const { t } = useI18n();
  return (
    <div role="radiogroup" aria-label={t.settings.appearance} className="grid grid-cols-2 gap-3">
      {(['light', 'dark'] as const).map((v) => {
        const on = theme === v;
        const light = v === 'light';
        return (
          <motion.button
            key={v}
            role="radio"
            aria-checked={on}
            whileTap={{ scale: 0.96 }}
            onClick={() => onChange(v)}
            className={cx('relative overflow-hidden rounded-[22px] p-1.5 text-start transition duration-300', on ? 'bg-surface shadow-[0_16px_36px_-22px_rgb(0_0_0/0.5)] ring-2 ring-gold' : 'bg-sunk/60 ring-1 ring-line hover:ring-ink/25')}
          >
            {/* A miniature of the bank in this theme */}
            <div className={cx('relative h-28 overflow-hidden rounded-[17px] p-2.5', light ? 'bg-[#F6F3EA]' : 'bg-[#0A1411]')}>
              <div className={cx('flex h-5 items-center justify-between rounded-md px-1.5', light ? 'bg-white' : 'bg-[#13221D]')}>
                <span className={cx('h-1 w-6 rounded-full', light ? 'bg-[#E4DCC8]' : 'bg-[#26392F]')} />
                <span className="h-2.5 w-2.5 rotate-45 rounded-[2px] bg-[#C9A45C]" />
              </div>
              <motion.div
                className="relative mt-2 h-11 overflow-hidden rounded-lg bg-[#0C1A17] p-1.5 ring-1 ring-[#C9A45C]/30"
                animate={on ? { y: [0, -2, 0] } : { y: 0 }}
                transition={{ repeat: on ? Infinity : 0, duration: 3, ease: 'easeInOut' }}
              >
                <span className="block h-1 w-8 rounded-full bg-[#C9A45C]/60" />
                <span className="mt-1.5 block h-2 w-14 rounded-full bg-[#F3E9D2]/90" />
                <span className="absolute -end-3 -top-3 h-12 w-12 rounded-full border border-[#C9A45C]/40" />
                <span className="absolute -end-1 -top-1 h-8 w-8 rounded-full border border-dashed border-[#C9A45C]/40" />
              </motion.div>
              <div className="mt-2 flex gap-1.5">
                {[0, 1, 2].map((k) => (
                  <span key={k} className={cx('h-3.5 flex-1 rounded', light ? 'bg-[#0C1A17]/[0.07]' : 'bg-white/[0.07]')} />
                ))}
              </div>
              {on && (
                <motion.span layoutId="theme-check" className="absolute end-2 top-2 grid h-6 w-6 place-items-center rounded-full bg-gold text-night shadow">
                  <Check className="h-3.5 w-3.5" strokeWidth={3} />
                </motion.span>
              )}
            </div>
            <div className="flex items-center gap-2 px-2 pb-1 pt-2.5">
              <span className="grid h-6 w-6 place-items-center rounded-full bg-gold/15 text-gold">{light ? <Sun className="h-3.5 w-3.5" /> : <Moon className="h-3.5 w-3.5" />}</span>
              <span className="font-semibold">{light ? t.settings.themeLight : t.settings.themeDark}</span>
            </div>
            <p className="px-2 pb-1.5 text-xs text-muted">{light ? t.settings.themeLightD : t.settings.themeDarkD}</p>
          </motion.button>
        );
      })}
    </div>
  );
}
