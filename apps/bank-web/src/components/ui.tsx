import { AnimatePresence, animate, motion, useMotionValue, useReducedMotion, useTransform } from 'framer-motion';
import {
  forwardRef,
  useEffect,
  useId,
  useRef,
  useState,
  type ButtonHTMLAttributes,
  type InputHTMLAttributes,
  type ReactNode,
} from 'react';
import { Check, Copy, Loader2, X } from 'lucide-react';
import { useI18n } from '../lib/i18n';
import { assetUrl } from '../lib/api';
import { initials, normalizeAmountInput, passwordScore } from '../lib/format';

export const cx = (...c: (string | false | null | undefined)[]) => c.filter(Boolean).join(' ');

// --------------------------------------------------------------------- Button
type Variant = 'primary' | 'secondary' | 'ghost' | 'danger' | 'stitch';
const variants: Record<Variant, string> = {
  primary: 'bg-gold text-night hover:brightness-110',
  stitch: 'bg-ink text-bg hover:opacity-90',
  secondary: 'bg-surface text-ink border border-line hover:border-ink/30',
  ghost: 'text-ink hover:bg-sunk',
  danger: 'bg-stitch/10 text-stitch hover:bg-stitch/15',
};

interface BtnProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: Variant;
  size?: 'sm' | 'md' | 'lg';
  loading?: boolean;
  icon?: ReactNode;
  block?: boolean;
}
export const Button = forwardRef<HTMLButtonElement, BtnProps>(function Button(
  { variant = 'primary', size = 'md', loading, icon, block, className, children, disabled, ...rest },
  ref,
) {
  const sizes = { sm: 'h-9 px-3.5 text-sm gap-1.5', md: 'h-11 px-5 gap-2', lg: 'h-14 px-6 text-lg gap-2.5' };
  return (
    <button
      ref={ref}
      disabled={disabled || loading}
      className={cx(
        'relative inline-flex select-none items-center justify-center rounded-xl font-medium transition active:scale-[0.98] disabled:cursor-not-allowed disabled:opacity-50',
        variants[variant],
        sizes[size],
        block && 'w-full',
        className,
      )}
      {...rest}
    >
      {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : icon}
      {children}
    </button>
  );
});

// ---------------------------------------------------------------------- Field
interface FieldProps extends InputHTMLAttributes<HTMLInputElement> {
  label: string;
  hint?: ReactNode;
  error?: string | null;
  trailing?: ReactNode;
}
export const Field = forwardRef<HTMLInputElement, FieldProps>(function Field({ label, hint, error, trailing, className, id, ...rest }, ref) {
  const auto = useId();
  const fid = id ?? auto;
  return (
    <div className={className}>
      <label htmlFor={fid} className="mb-1.5 block text-sm font-medium text-ink/80">
        {label}
      </label>
      <div className="relative">
        <input ref={ref} id={fid} aria-invalid={error ? true : undefined} aria-describedby={error || hint ? `${fid}-d` : undefined} className={cx('field', trailing ? 'pe-12' : undefined)} {...rest} />
        {trailing && <div className="absolute inset-y-0 end-0 flex items-center pe-2">{trailing}</div>}
      </div>
      {(error || hint) && (
        <p id={`${fid}-d`} className={cx('mt-1.5 text-sm', error ? 'text-stitch' : 'text-muted')}>
          {error || hint}
        </p>
      )}
    </div>
  );
});

export function TextArea({ label, ...rest }: { label: string } & React.TextareaHTMLAttributes<HTMLTextAreaElement>) {
  const id = useId();
  return (
    <div>
      <label htmlFor={id} className="mb-1.5 block text-sm font-medium text-ink/80">
        {label}
      </label>
      <textarea id={id} className="field min-h-[96px] resize-y" {...rest} />
    </div>
  );
}

export function PasswordStrength({ value }: { value: string }) {
  const { t } = useI18n();
  if (!value) return <p className="mt-1.5 text-sm text-muted">{t.auth.pwRules}</p>;
  const s = passwordScore(value);
  const colors = ['bg-stitch', 'bg-stitch', 'bg-gold', 'bg-olive', 'bg-olive'];
  return (
    <div className="mt-2">
      <div className="flex gap-1" aria-hidden="true">
        {[0, 1, 2, 3].map((i) => (
          <span key={i} className={cx('h-1.5 flex-1 rounded-full transition-colors', i < s ? colors[s] : 'bg-sunk')} />
        ))}
      </div>
      <p className="mt-1 text-xs text-muted">
        {t.auth.strength[s]} — {t.auth.pwRules}
      </p>
    </div>
  );
}

// ----------------------------------------------------------- big amount input
export function AmountInput({
  value,
  onChange,
  currency = 'PS',
  label,
  autoFocus,
  error,
}: {
  value: string;
  onChange: (v: string) => void;
  currency?: string;
  label: string;
  autoFocus?: boolean;
  error?: string | null;
}) {
  const id = useId();
  return (
    <div>
      <label htmlFor={id} className="mb-2 block text-sm font-medium text-ink/80">
        {label}
      </label>
      <div
        className={cx(
          'flex items-baseline gap-3 rounded-2xl border bg-surface px-5 py-4 transition focus-within:border-sky focus-within:shadow-[0_0_0_4px_rgb(var(--sky)/0.15)]',
          error ? 'border-stitch' : 'border-line',
        )}
        dir="ltr"
      >
        <input
          id={id}
          inputMode="decimal"
          autoComplete="off"
          autoFocus={autoFocus}
          placeholder="0.00"
          value={value}
          aria-invalid={error ? true : undefined}
          onChange={(e) => {
            const v = normalizeAmountInput(e.target.value);
            if (/^\d{0,10}(\.\d{0,2})?$/.test(v)) onChange(v);
          }}
          className="num w-full min-w-0 bg-transparent font-display text-4xl text-ink outline-none placeholder:text-muted/40 sm:text-5xl"
        />
        <span className="shrink-0 font-display text-xl text-muted">{currency}</span>
      </div>
      {error && <p className="mt-1.5 text-sm text-stitch">{error}</p>}
    </div>
  );
}

// ------------------------------------------------------------- one-time code
export function CodeInput({ value, onChange, length = 6, autoFocus = true }: { value: string; onChange: (v: string) => void; length?: number; autoFocus?: boolean }) {
  const refs = useRef<(HTMLInputElement | null)[]>([]);
  const digits = value.padEnd(length, ' ').slice(0, length).split('');
  const set = (i: number, d: string) => {
    const next = (value.slice(0, i) + d + value.slice(i + 1)).replace(/\s/g, '').slice(0, length);
    onChange(next);
  };
  return (
    <div className="flex justify-center gap-2" dir="ltr" onPaste={(e) => {
      const p = normalizeAmountInput(e.clipboardData.getData('text')).replace(/\D/g, '').slice(0, length);
      if (p) {
        e.preventDefault();
        onChange(p);
        refs.current[Math.min(p.length, length - 1)]?.focus();
      }
    }}>
      {digits.map((d, i) => (
        <input
          key={i}
          ref={(el) => (refs.current[i] = el)}
          inputMode="numeric"
          autoComplete={i === 0 ? 'one-time-code' : 'off'}
          aria-label={`Digit ${i + 1}`}
          autoFocus={autoFocus && i === 0}
          value={d.trim()}
          onChange={(e) => {
            const v = normalizeAmountInput(e.target.value).replace(/\D/g, '').slice(-1);
            if (!v) return;
            set(i, v);
            refs.current[i + 1]?.focus();
          }}
          onKeyDown={(e) => {
            if (e.key === 'Backspace') {
              e.preventDefault();
              if (digits[i]?.trim()) set(i, ' ');
              else if (i > 0) {
                set(i - 1, ' ');
                refs.current[i - 1]?.focus();
              }
            }
          }}
          className="num h-14 w-11 rounded-xl border border-line bg-surface text-center font-display text-2xl outline-none transition focus:border-sky focus:shadow-[0_0_0_4px_rgb(var(--sky)/0.15)] sm:w-12"
        />
      ))}
    </div>
  );
}

// ---------------------------------------------------------- animated numbers
export function AnimatedNumber({ value, format }: { value: number; format: (n: number) => string }) {
  const reduce = useReducedMotion();
  const mv = useMotionValue(reduce ? value : 0);
  const text = useTransform(mv, (n) => format(n));
  const [display, setDisplay] = useState(format(reduce ? value : 0));
  useEffect(() => text.on('change', (v) => setDisplay(v)), [text]);
  useEffect(() => {
    if (reduce) {
      mv.set(value);
      return;
    }
    const c = animate(mv, value, { duration: 1.1, ease: [0.16, 1, 0.3, 1] });
    return () => c.stop();
  }, [value, mv, reduce]);
  return <span className="num">{display}</span>;
}

// -------------------------------------------------------------------- bits
export function Spinner({ className = 'h-5 w-5' }: { className?: string }) {
  return <Loader2 className={cx('animate-spin text-muted', className)} aria-label="Loading" />;
}

export function Skeleton({ className }: { className?: string }) {
  return <div className={cx('skeleton', className)} />;
}

export function Badge({ tone = 'neutral', children }: { tone?: 'neutral' | 'good' | 'warn' | 'bad' | 'info'; children: ReactNode }) {
  const tones = {
    neutral: 'bg-sunk text-muted',
    good: 'bg-olive/15 text-olive',
    warn: 'bg-gold/15 text-[rgb(150_105_10)] dark:text-gold',
    bad: 'bg-stitch/15 text-stitch',
    info: 'bg-sky/15 text-sky',
  };
  return <span className={cx('inline-flex items-center gap-1 rounded-full px-2.5 py-0.5 text-xs font-medium', tones[tone])}>{children}</span>;
}

export function Avatar({ name, src, size = 40 }: { name?: string | null; src?: string | null; size?: number }) {
  const url = assetUrl(src);
  return url ? (
    <img src={url} alt="" width={size} height={size} className="shrink-0 rounded-full object-cover" style={{ width: size, height: size }} />
  ) : (
    <span className="grid shrink-0 place-items-center rounded-full bg-gold font-display text-night" style={{ width: size, height: size, fontSize: size * 0.38 }}>
      {initials(name)}
    </span>
  );
}

export function CopyButton({ text, label }: { text: string; label?: string }) {
  const { t } = useI18n();
  const [done, setDone] = useState(false);
  return (
    <button
      type="button"
      onClick={async () => {
        try {
          await navigator.clipboard.writeText(text);
          setDone(true);
          setTimeout(() => setDone(false), 1600);
        } catch {
          /* clipboard blocked */
        }
      }}
      className="inline-flex items-center gap-1.5 rounded-lg px-2 py-1 text-sm text-muted transition hover:bg-sunk hover:text-ink"
      aria-label={label ?? t.common.copy}
    >
      {done ? <Check className="h-4 w-4 text-olive" /> : <Copy className="h-4 w-4" />}
      {label && <span>{done ? t.common.copied : label}</span>}
    </button>
  );
}

export function EmptyState({ icon, title, action }: { icon: ReactNode; title: string; action?: ReactNode }) {
  return (
    <div className="flex flex-col items-center gap-4 px-6 py-12 text-center">
      <div className="grid h-14 w-14 place-items-center rounded-2xl bg-sunk text-muted">{icon}</div>
      <p className="max-w-sm text-muted">{title}</p>
      {action}
    </div>
  );
}

export function ErrorNote({ children }: { children: ReactNode }) {
  if (!children) return null;
  return (
    <motion.p role="alert" initial={{ opacity: 0, y: -4 }} animate={{ opacity: 1, y: 0 }} className="rounded-xl bg-stitch/10 px-4 py-3 text-sm text-stitch">
      {children}
    </motion.p>
  );
}

export function PageHeader({ title, lead, actions }: { title: string; lead?: string; actions?: ReactNode }) {
  return (
    <div className="mb-6 flex flex-wrap items-end justify-between gap-4">
      <div>
        <h1 className="text-2xl text-ink sm:text-3xl">{title}</h1>
        {lead && <p className="mt-1 max-w-xl text-muted">{lead}</p>}
      </div>
      {actions && <div className="flex flex-wrap gap-2">{actions}</div>}
    </div>
  );
}

export function Segmented<T extends string>({ value, onChange, options }: { value: T; onChange: (v: T) => void; options: { value: T; label: string }[] }) {
  const id = useId();
  return (
    <div role="tablist" className="inline-flex rounded-xl bg-sunk p-1">
      {options.map((o) => (
        <button
          key={o.value}
          role="tab"
          aria-selected={value === o.value}
          onClick={() => onChange(o.value)}
          className={cx('relative rounded-lg px-3.5 py-1.5 text-sm font-medium transition', value === o.value ? 'text-ink' : 'text-muted hover:text-ink')}
        >
          {value === o.value && <motion.span layoutId={`seg-${id}`} className="absolute inset-0 rounded-lg bg-surface shadow-lift" transition={{ type: 'spring', bounce: 0.2, duration: 0.4 }} />}
          <span className="relative">{o.label}</span>
        </button>
      ))}
    </div>
  );
}

export function Toggle({ checked, onChange, label, description }: { checked: boolean; onChange: (v: boolean) => void; label: string; description?: string }) {
  return (
    <label className="flex cursor-pointer items-start justify-between gap-4 py-2">
      <span>
        <span className="block font-medium">{label}</span>
        {description && <span className="block text-sm text-muted">{description}</span>}
      </span>
      <button
        type="button"
        role="switch"
        aria-checked={checked}
        onClick={() => onChange(!checked)}
        className={cx('relative mt-1 h-7 w-12 shrink-0 rounded-full transition', checked ? 'bg-olive' : 'bg-line')}
      >
        <motion.span layout className="absolute top-1 h-5 w-5 rounded-full bg-white shadow" style={{ insetInlineStart: checked ? 24 : 4 }} />
      </button>
    </label>
  );
}

// ----------------------------------------------------------------- Sheet
/** Bottom sheet on phones, centred dialog on larger screens. Escape and backdrop close it. */
export function Sheet({ open, onClose, title, children, wide }: { open: boolean; onClose: () => void; title: string; children: ReactNode; wide?: boolean }) {
  const ref = useRef<HTMLDivElement>(null);
  const { t } = useI18n();
  const closeRef = useRef(onClose);
  closeRef.current = onClose;
  useEffect(() => {
    if (!open) return;
    const prev = document.activeElement as HTMLElement | null;
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && closeRef.current();
    window.addEventListener('keydown', onKey);
    const tm = setTimeout(() => ref.current?.querySelector<HTMLElement>('input,button,textarea,select')?.focus(), 60);
    document.body.style.overflow = 'hidden';
    return () => {
      window.removeEventListener('keydown', onKey);
      clearTimeout(tm);
      document.body.style.overflow = '';
      prev?.focus?.();
    };
  }, [open]);
  return (
    <AnimatePresence>
      {open && (
        <motion.div
          className="fixed inset-0 z-50 flex items-end justify-center sm:items-center sm:p-6"
          role="dialog"
          aria-modal="true"
          aria-label={title}
          initial={{ opacity: 1 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 1, pointerEvents: 'none', transition: { duration: 0.2 } }}
        >
          <motion.div className="absolute inset-0 bg-night/55 backdrop-blur-[2px]" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0, transition: { duration: 0.18 } }} onClick={onClose} />
          <motion.div
            ref={ref}
            initial={{ y: 40, opacity: 0, scale: 0.98 }}
            animate={{ y: 0, opacity: 1, scale: 1 }}
            exit={{ y: 40, opacity: 0, scale: 0.98, transition: { duration: 0.18 } }}
            transition={{ type: 'spring', bounce: 0.18, duration: 0.45 }}
            className={cx(
              'safe-bottom relative max-h-[92dvh] w-full overflow-y-auto overscroll-contain rounded-t-3xl bg-surface p-5 shadow-card sm:rounded-3xl sm:p-6',
              wide ? 'sm:max-w-2xl' : 'sm:max-w-md',
            )}
          >
            <div className="mx-auto mb-4 h-1.5 w-10 rounded-full bg-line sm:hidden" />
            <div className="mb-5 flex items-center justify-between gap-4">
              <h2 className="text-xl">{title}</h2>
              <button onClick={onClose} className="rounded-lg p-1.5 text-muted hover:bg-sunk hover:text-ink" aria-label={t.common.close}>
                <X className="h-5 w-5" />
              </button>
            </div>
            {children}
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}

// ----------------------------------------------------------- success burst
/** A short stitched burst — the confirmation moment after money moves. */
export function SuccessMark() {
  const reduce = useReducedMotion();
  return (
    <div className="relative mx-auto grid h-24 w-24 place-items-center">
      {!reduce &&
        Array.from({ length: 12 }).map((_, i) => (
          <motion.span
            key={i}
            className="absolute h-2 w-2 rotate-45 bg-stitch"
            style={{ background: i % 3 === 0 ? 'rgb(var(--gold))' : i % 3 === 1 ? 'rgb(var(--stitch))' : 'rgb(var(--olive))' }}
            initial={{ x: 0, y: 0, opacity: 1, scale: 1 }}
            animate={{ x: Math.cos((i / 12) * Math.PI * 2) * 54, y: Math.sin((i / 12) * Math.PI * 2) * 54, opacity: 0, scale: 0.4 }}
            transition={{ duration: 0.9, ease: 'easeOut', delay: 0.15 }}
          />
        ))}
      <motion.div
        initial={{ scale: reduce ? 1 : 0.4, opacity: 0 }}
        animate={{ scale: 1, opacity: 1 }}
        transition={{ type: 'spring', bounce: 0.5, duration: 0.6 }}
        className="grid h-20 w-20 place-items-center rounded-full bg-olive text-white"
      >
        <svg viewBox="0 0 24 24" className="h-10 w-10" fill="none" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round">
          <motion.path d="M5 12.5l4.5 4.5L19 7.5" initial={{ pathLength: reduce ? 1 : 0 }} animate={{ pathLength: 1 }} transition={{ duration: 0.45, delay: 0.25 }} />
        </svg>
      </motion.div>
    </div>
  );
}
