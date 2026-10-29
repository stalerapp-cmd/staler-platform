import { motion } from 'framer-motion';
import { Check, Moon, Sun } from 'lucide-react';
import { useI18n } from '../lib/i18n';
import { cx } from './ui';

/** Light / dark as two little skies: a sun that spins its rays, a moon with twinkling stars. */
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
            className={cx('relative overflow-hidden rounded-[22px] p-1.5 text-start transition', on ? 'bg-gold/12 ring-2 ring-gold' : 'bg-sunk/70 ring-1 ring-line hover:ring-ink/30')}
          >
            <div className={cx('relative h-24 overflow-hidden rounded-[18px]', light ? 'bg-gradient-to-b from-[#BFE3FF] to-[#FFF4D6]' : 'bg-gradient-to-b from-[#0B1033] to-[#2A2466]')}>
              {light ? (
                <>
                  <motion.svg viewBox="0 0 40 40" className="absolute end-4 top-3 h-12 w-12" animate={on ? { rotate: 360 } : { rotate: 0 }} transition={on ? { repeat: Infinity, duration: 12, ease: 'linear' } : {}}>
                    {Array.from({ length: 8 }).map((_, i) => (
                      <line key={i} x1="20" y1="3" x2="20" y2="8" stroke="#F2A93B" strokeWidth="2.6" strokeLinecap="round" transform={`rotate(${i * 45} 20 20)`} />
                    ))}
                    <circle cx="20" cy="20" r="8" fill="#FFC94A" />
                  </motion.svg>
                  <motion.span animate={{ x: [0, 10, 0] }} transition={{ repeat: Infinity, duration: 6 }} className="absolute bottom-4 start-4 h-5 w-14 rounded-full bg-white/90 shadow-sm" />
                  <span className="absolute bottom-7 start-8 h-6 w-8 rounded-full bg-white/90" />
                </>
              ) : (
                <>
                  <motion.svg viewBox="0 0 40 40" className="absolute end-4 top-3 h-12 w-12" animate={on ? { rotate: [-8, 8, -8] } : { rotate: 0 }} transition={{ repeat: Infinity, duration: 5 }}>
                    <path d="M26 6a14 14 0 1 0 8 25A12 12 0 0 1 26 6Z" fill="#F4E7C9" />
                  </motion.svg>
                  {[
                    [16, 22],
                    [34, 52],
                    [58, 30],
                    [24, 68],
                    [48, 74],
                  ].map(([x, y], i) => (
                    <motion.span
                      key={i}
                      className="absolute h-1.5 w-1.5 rounded-full bg-[#FFE7A6]"
                      style={{ insetInlineStart: `${x}%`, top: `${y}%` }}
                      animate={{ opacity: [0.2, 1, 0.2], scale: [0.7, 1.2, 0.7] }}
                      transition={{ repeat: Infinity, duration: 1.8 + i * 0.4, delay: i * 0.3 }}
                    />
                  ))}
                </>
              )}
              {on && (
                <motion.span layoutId="theme-check" className="absolute start-2 top-2 grid h-6 w-6 place-items-center rounded-full bg-gold text-night shadow">
                  <Check className="h-3.5 w-3.5" strokeWidth={3} />
                </motion.span>
              )}
            </div>
            <div className="flex items-center gap-2 px-2 pb-1 pt-2.5">
              {light ? <Sun className="h-4 w-4 text-[#E59A1E]" /> : <Moon className="h-4 w-4 text-[#7C83D6]" />}
              <span className="font-semibold">{light ? t.settings.themeLight : t.settings.themeDark}</span>
            </div>
            <p className="px-2 pb-1.5 text-xs text-muted">{light ? t.settings.themeLightD : t.settings.themeDarkD}</p>
          </motion.button>
        );
      })}
    </div>
  );
}
