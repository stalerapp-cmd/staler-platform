import { useCallback, useRef, useState } from 'react';
import { ShieldCheck } from 'lucide-react';
import { ApiError } from '../lib/api';
import { useI18n } from '../lib/i18n';
import { Button, ErrorNote, Field, Sheet } from './ui';

/**
 * Wraps a money action. If the server answers MFA_REQUIRED/MFA_INVALID, a
 * sheet asks for the authenticator code and the action is retried with it.
 */
export function useSecureAction() {
  const { t, err } = useI18n();
  const [open, setOpen] = useState(false);
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const pending = useRef<{ fn: (totp?: string) => Promise<any>; resolve: (v: any) => void; reject: (e: any) => void } | null>(null);

  const run = useCallback(<T,>(fn: (totp?: string) => Promise<T>): Promise<T> => {
    return fn().catch((e) => {
      if (e instanceof ApiError && (e.code === 'MFA_REQUIRED' || e.code === 'MFA_INVALID')) {
        return new Promise<T>((resolve, reject) => {
          pending.current = { fn, resolve, reject };
          setCode('');
          setError(e.code === 'MFA_INVALID' ? err(e) : null);
          setOpen(true);
        });
      }
      throw e;
    });
  }, [err]);

  const submit = async () => {
    const p = pending.current;
    if (!p) return;
    setBusy(true);
    setError(null);
    try {
      const v = await p.fn(code.trim());
      p.resolve(v);
      pending.current = null;
      setOpen(false);
    } catch (e) {
      if (e instanceof ApiError && e.code === 'MFA_INVALID') setError(err(e));
      else {
        p.reject(e);
        pending.current = null;
        setOpen(false);
      }
    } finally {
      setBusy(false);
    }
  };

  const element = (
    <Sheet
      open={open}
      onClose={() => {
        setOpen(false);
        pending.current?.reject(new ApiError(0, 'CANCELLED', ''));
        pending.current = null;
      }}
      title={t.auth.mfaTitle}
    >
      <form
        onSubmit={(e) => {
          e.preventDefault();
          void submit();
        }}
        className="space-y-4"
      >
        <div className="flex items-start gap-3 rounded-xl bg-sunk p-3 text-sm text-muted">
          <ShieldCheck className="mt-0.5 h-5 w-5 shrink-0 text-olive" />
          {t.auth.mfaLead}
        </div>
        <Field label={t.auth.mfaCode} value={code} onChange={(e) => setCode(e.target.value)} inputMode="text" autoComplete="one-time-code" placeholder="123456" dir="ltr" />
        <ErrorNote>{error}</ErrorNote>
        <Button block loading={busy} disabled={code.trim().length < 6}>
          {t.common.confirm}
        </Button>
      </form>
    </Sheet>
  );
  return { run, element };
}
