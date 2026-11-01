import { motion } from 'framer-motion';
import { Check } from 'lucide-react';
import { useI18n } from '../lib/i18n';
import { Guilloche } from './Guilloche';
import { cx } from './ui';

/** Light / dark as two engraved banknote panels; the chosen one turns its brass rosette. */
export function ThemePicker({ theme, onChange }: { theme: string; onChange: (v: 'light' | 'dark') => void }) {
  const { t } = useI18n();
  return (
    <div role="radiogroup" aria-label={t.settings.appearance} className="grid grid-cols-1 gap-3 min-[420px]:grid-cols-2">
      {(['light', 'dark'] as const).map((v) => {
        const on = theme === v;
        const light = v === 'light';
        return (
          <motion.button
            key={v}
            role="radio"
            aria-checked={on}
            whileTap={{ scale: 0.97 }}
            onClick={() => onChange(v)}
            className={cx(
              'group relative isolate flex h-32 overflow-hidden rounded-[24px] text-start transition duration-300',
              light ? 'bg-[linear-gradient(135deg,#FFFFFF_0%,#F4EFE3_100%)] text-[#0C1A17]' : 'bg-[radial-gradient(120%_120%_at_0%_0%,#1C3A2E_0%,#0A1411_70%)] text-[#F3E9D2]',
              on ? 'shadow-[0_22px_44px_-26px_rgb(0_0_0/0.7)] ring-2 ring-[#C9A45C]' : 'ring-1 ring-line hover:-translate-y-0.5',
            )}
          >
            <span className={cx('pointer-events-none absolute -end-10 top-1/2 h-44 w-44 -translate-y-1/2 transition-opacity duration-500', on ? 'opacity-100' : 'opacity-40 group-hover:opacity-70')}>
              <Guilloche key={on ? 'on' : 'off'} className="h-full w-full" color="#C9A45C" spin={on} />
            </span>
            <span className="relative z-10 flex flex-1 flex-col justify-between p-4">
              <span>
                <span className="block font-display text-2xl leading-none">{light ? t.settings.themeLight : t.settings.themeDark}</span>
                <span className={cx('mt-1.5 block max-w-[60%] text-xs', light ? 'text-[#5E6B64]' : 'text-[#F3E9D2]/60')}>{light ? t.settings.themeLightD : t.settings.themeDarkD}</span>
              </span>
              <span className={cx('grid h-6 w-6 place-items-center rounded-full transition', on ? 'bg-[#C9A45C] text-[#0C1A17]' : light ? 'ring-1 ring-[#0C1A17]/25' : 'ring-1 ring-white/30')}>
                {on && <Check className="h-3.5 w-3.5" strokeWidth={3} />}
              </span>
            </span>
          </motion.button>
        );
      })}
    </div>
  );
}
