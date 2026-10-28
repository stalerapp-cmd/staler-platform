import { createContext, useCallback, useContext, useRef, useState, type ReactNode } from 'react';
import { AlertTriangle, ShieldQuestion } from 'lucide-react';
import { useI18n } from '../lib/i18n';
import { Button, Sheet, cx } from './ui';

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
  return (
    <Ctx.Provider value={ask}>
      {children}
      <Sheet open={!!opts} onClose={() => finish(false)} title={opts?.title ?? ''}>
        {opts && (
          <div>
            <div className="flex gap-4">
              <span className={cx('grid h-12 w-12 shrink-0 place-items-center rounded-2xl', danger ? 'bg-stitch/15 text-stitch' : 'bg-sky/15 text-sky')}>
                {danger ? <AlertTriangle className="h-6 w-6" /> : <ShieldQuestion className="h-6 w-6" />}
              </span>
              <div className="min-w-0 pt-1 text-[15px] leading-relaxed text-ink/85">{opts.body ?? t.common.areYouSure}</div>
            </div>
            <div className="mt-6 grid grid-cols-2 gap-3">
              <Button variant="secondary" onClick={() => finish(false)}>
                {opts.cancelLabel ?? t.common.cancel}
              </Button>
              <Button variant={danger ? 'danger-solid' : 'primary'} onClick={() => finish(true)} autoFocus>
                {opts.confirmLabel ?? t.common.confirm}
              </Button>
            </div>
          </div>
        )}
      </Sheet>
    </Ctx.Provider>
  );
}

export const useConfirm = () => useContext(Ctx);
