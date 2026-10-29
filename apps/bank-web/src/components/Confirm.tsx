import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { AnimatePresence, motion } from 'framer-motion';
import { AlertTriangle, ShieldQuestion } from 'lucide-react';
import { useI18n } from '../lib/i18n';
import { Button, cx } from './ui';

export interface ConfirmOptions {
  title: string;
  body?: ReactNode;
  /** Label of the confirming button — say exactly what happens ("Pay 25.00 PS"). */
  confirmLabel?: string;
  cancelLabel?: string;
  /** danger: irreversible or harmful (delete, suspend, sign out everywhere). */
  tone?: 'primary' | 'danger';
}

type Ask = (o: ConfirmOptions) => Promise<boolean>;
const Ctx = createContext<Ask>(async () => true);

/** `if (!(await confirm({...}))) return;` — one consistent confirmation step for every important action. */
export function ConfirmProvider({ children }: { children: ReactNode }) {
  const { t } = useI18n();
  const [opts, setOpts] = useState<ConfirmOptions | null>(null);
  const resolver = useRef<(v: boolean) => void>();
  const ask = useCallback<Ask>(
    (o) =>
      new Promise<boolean>((resolve) => {
        resolver.current?.(false);
        resolver.current = resolve;
        setOpts(o);
      }),
    [],
  );
  const finish = (v: boolean) => {
    resolver.current?.(v);
    resolver.current = undefined;
    setOpts(null);
  };
  const danger = opts?.tone === 'danger';
  useEffect(() => {
    if (!opts) return;
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && finish(false);
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  });
  return (
    <Ctx.Provider value={ask}>
      {children}
      {createPortal(
        <AnimatePresence>
          {opts && (
            // A centred card on every screen size: never hidden behind the keyboard,
            // the tab bar or a notch, and long labels wrap instead of being cut.
            <motion.div
              key="confirm"
              className="fixed inset-0 z-[90] grid place-items-center overflow-y-auto p-4 pb-[max(env(safe-area-inset-bottom),1rem)] pt-[max(env(safe-area-inset-top),1rem)]"
              role="alertdialog"
              aria-modal="true"
              aria-label={opts.title}
              initial={{ opacity: 1 }}
              exit={{ opacity: 1, pointerEvents: 'none', transition: { duration: 0.18 } }}
            >
              <motion.div className="fixed inset-0 bg-night/60 backdrop-blur-[3px]" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} onClick={() => finish(false)} />
              <motion.div
                initial={{ opacity: 0, scale: 0.88, y: 16 }}
                animate={{ opacity: 1, scale: 1, y: 0 }}
                exit={{ opacity: 0, scale: 0.94, y: 8, transition: { duration: 0.15 } }}
                transition={{ type: 'spring', bounce: 0.35, duration: 0.45 }}
                className="relative w-full max-w-[380px] rounded-[28px] bg-surface p-6 text-center shadow-card"
              >
                <span className="pointer-events-none absolute inset-[7px] rounded-[22px] border border-dashed border-line" />
                <motion.span
                  initial={{ rotate: -20, scale: 0.5 }}
                  animate={{ rotate: 0, scale: 1 }}
                  transition={{ type: 'spring', bounce: 0.55, delay: 0.05 }}
                  className={cx('relative mx-auto grid h-16 w-16 place-items-center rounded-[22px]', danger ? 'bg-stitch/12 text-stitch' : 'bg-sky/12 text-sky')}
                >
                  {danger ? <AlertTriangle className="h-8 w-8" /> : <ShieldQuestion className="h-8 w-8" />}
                </motion.span>
                <h2 className="relative mt-4 text-xl leading-snug">{opts.title}</h2>
                <div className="relative mt-2 break-words text-[15px] leading-relaxed text-muted">{opts.body ?? t.common.areYouSure}</div>
                <div className="relative mt-6 flex flex-col-reverse gap-2.5 min-[360px]:grid min-[360px]:grid-cols-2">
                  <Button variant="secondary" className="!h-auto min-h-12 whitespace-normal" onClick={() => finish(false)}>
                    {opts.cancelLabel ?? t.common.cancel}
                  </Button>
                  <Button variant={danger ? 'danger-solid' : 'primary'} className="!h-auto min-h-12 whitespace-normal" onClick={() => finish(true)} autoFocus>
                    {opts.confirmLabel ?? t.common.confirm}
                  </Button>
                </div>
              </motion.div>
            </motion.div>
          )}
        </AnimatePresence>,
        document.body,
      )}
    </Ctx.Provider>
  );
}

export const useConfirm = () => useContext(Ctx);
