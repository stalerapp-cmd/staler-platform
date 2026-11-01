import { useId, type ReactNode } from 'react';
import { motion } from 'framer-motion';
import { Check } from 'lucide-react';
import { cx } from './ui';

type Tone = 'good' | 'warn' | 'bad' | 'info' | 'neutral';
const DOT: Record<Tone, string> = { good: 'bg-olive', warn: 'bg-gold', bad: 'bg-stitch', info: 'bg-sky', neutral: 'bg-muted' };

export interface ChoiceOption<T extends string> {
  value: T;
  label: string;
  /** A coloured dot that says what the state means (green active, red closed…). */
  tone?: Tone;
  icon?: ReactNode;
}

/**
 * Pick one of a few options, all visible at once — the chosen one sits on a
 * sliding pill. Replaces drop-downs for short lists like status, role or language.
 */
export function ChoicePills<T extends string>({ label, value, onChange, options, className, disabled }: { label: string; value: T; onChange: (v: T) => void; options: ChoiceOption<T>[]; className?: string; disabled?: boolean }) {
  const id = useId();
  return (
    <div className={className}>
      <p id={id} className="mb-1.5 text-sm font-medium text-ink/80">
        {label}
      </p>
      <div role="radiogroup" aria-labelledby={id} className={cx('flex flex-wrap gap-1 rounded-2xl bg-sunk/80 p-1 ring-1 ring-line/70', disabled && 'pointer-events-none opacity-60')}>
        {options.map((o) => {
          const on = o.value === value;
          return (
            <button
              key={o.value}
              type="button"
              role="radio"
              aria-checked={on}
              onClick={() => onChange(o.value)}
              className={cx('relative flex min-w-0 flex-1 items-center justify-center gap-2 rounded-xl px-3 py-2.5 text-sm transition-colors', on ? 'font-semibold text-ink' : 'text-muted hover:text-ink')}
            >
              {on && <motion.span layoutId={`choice-${id}`} className="absolute inset-0 rounded-xl bg-surface shadow-[0_4px_14px_-6px_rgb(var(--night)/0.35)] ring-1 ring-line/80" transition={{ type: 'spring', bounce: 0.25, duration: 0.45 }} />}
              {o.tone && <span className={cx('relative h-2 w-2 shrink-0 rounded-full transition-transform', DOT[o.tone], on ? 'scale-125' : 'opacity-60')} />}
              {o.icon && <span className="relative shrink-0 [&_svg]:h-4 [&_svg]:w-4">{o.icon}</span>}
              <span className="relative truncate">{o.label}</span>
            </button>
          );
        })}
      </div>
    </div>
  );
}

/** A switch-like option drawn as a card: icon, title, an optional line of help, and a check that pops in. */
export function OptionCard({ checked, onChange, icon, title, description, className }: { checked: boolean; onChange: (v: boolean) => void; icon?: ReactNode; title: string; description?: string; className?: string }) {
  return (
    <button
      type="button"
      role="checkbox"
      aria-checked={checked}
      onClick={() => onChange(!checked)}
      className={cx(
        'group relative flex w-full items-start gap-3 rounded-2xl border p-3.5 text-start transition',
        checked ? 'border-sky/50 bg-sky/[0.07] shadow-[0_6px_18px_-12px_rgb(var(--sky)/0.9)]' : 'border-line bg-surface hover:border-ink/20 hover:bg-sunk/50',
        className,
      )}
    >
      {icon && <span className={cx('grid h-9 w-9 shrink-0 place-items-center rounded-xl transition-colors [&_svg]:h-[18px] [&_svg]:w-[18px]', checked ? 'bg-sky text-white' : 'bg-sunk text-muted group-hover:text-ink')}>{icon}</span>}
      <span className="min-w-0 flex-1 pt-0.5">
        <span className={cx('block text-sm leading-snug', checked ? 'font-semibold text-ink' : 'font-medium text-ink/85')}>{title}</span>
        {description && <span className="mt-0.5 block text-xs leading-snug text-muted">{description}</span>}
      </span>
      <CheckMark on={checked} />
    </button>
  );
}

/** The round check used by option cards and lists. */
export function CheckMark({ on }: { on: boolean }) {
  return (
    <span className={cx('grid h-5 w-5 shrink-0 place-items-center rounded-full border-2 transition-colors', on ? 'border-sky bg-sky text-white' : 'border-line bg-surface')} aria-hidden="true">
      <motion.span initial={false} animate={{ scale: on ? 1 : 0, rotate: on ? 0 : -45 }} transition={{ type: 'spring', stiffness: 520, damping: 22 }} className="grid place-items-center">
        <Check className="h-3 w-3" strokeWidth={3.5} />
      </motion.span>
    </span>
  );
}
