import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { ArrowLeft, Inbox } from 'lucide-react';
import { useI18n } from '../lib/i18n';
import { isNative } from '../lib/api';
import { Button, cx } from './ui';

/** Back for the sign-in screens: goes back if there is somewhere to go, otherwise home. */
export function AuthBack({ onDark = false }: { onDark?: boolean }) {
  const { t } = useI18n();
  const nav = useNavigate();
  // In the app the sign-in screen is the first screen: with nothing behind it, a back arrow would do nothing.
  if (isNative && (window.history.state?.idx ?? 0) === 0) return <span className="w-2" />;
  return (
    <button
      type="button"
      onClick={() => ((window.history.state?.idx ?? 0) > 0 ? nav(-1) : nav('/'))}
      className={cx(
        'group flex h-9 items-center gap-1.5 rounded-full pe-3.5 ps-1 text-sm font-medium transition active:scale-95',
        onDark ? 'bg-white/15 text-[#FBF6EA] hover:bg-white/25' : 'bg-surface text-ink shadow-sm ring-1 ring-line hover:ring-gold/50',
      )}
      aria-label={t.common.back}
    >
      <span className={cx('grid h-7 w-7 place-items-center rounded-full transition group-hover:scale-110', onDark ? 'bg-[#E2C27A] text-night' : 'bg-night text-[#E2C27A]')}>
        <ArrowLeft className="h-4 w-4 flip-rtl" />
      </span>
      {t.common.back}
    </button>
  );
}

/** "Resend code" with a cooldown, so people wait for the first e-mail instead of invalidating it. */
export function ResendCode({ onResend, seconds = 60 }: { onResend: () => Promise<void>; seconds?: number }) {
  const { t } = useI18n();
  const [left, setLeft] = useState(seconds);
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    if (left <= 0) return;
    const h = setTimeout(() => setLeft((s) => s - 1), 1000);
    return () => clearTimeout(h);
  }, [left]);
  return (
    <Button
      type="button"
      variant="ghost"
      block
      loading={busy}
      disabled={left > 0}
      onClick={async () => {
        setBusy(true);
        try {
          await onResend();
          setLeft(seconds);
        } finally {
          setBusy(false);
        }
      }}
    >
      {left > 0 ? `${t.auth.resendIn} ${left}` : t.auth.resend}
    </Button>
  );
}

/** Where the code usually hides when it "didn't arrive". */
export function MailTips({ onChangeEmail }: { onChangeEmail?: () => void }) {
  const { t } = useI18n();
  return (
    <div className="rounded-2xl border border-line bg-sunk/60 p-4 text-sm">
      <p className="flex items-center gap-2 font-medium">
        <Inbox className="h-4 w-4 shrink-0" /> {t.auth.noMailTitle}
      </p>
      <ul className="mt-2 list-disc space-y-1 ps-6 text-muted">
        <li>{t.auth.noMail1}</li>
        <li>{t.auth.noMail2}</li>
        <li>
          {t.auth.noMail3}{' '}
          {onChangeEmail && (
            <button type="button" onClick={onChangeEmail} className="font-medium text-ink underline underline-offset-4">
              {t.auth.changeEmail}
            </button>
          )}
        </li>
      </ul>
    </div>
  );
}
