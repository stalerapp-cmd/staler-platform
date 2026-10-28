import { useEffect, useState } from "react";
import { motion } from "framer-motion";
import { Fingerprint } from "lucide-react";
import { useAuth } from "../lib/auth";
import { useI18n } from "../lib/i18n";
import {
  bioAsked,
  bioAvailable,
  bioEnabled,
  bioVerify,
  setBioEnabled,
} from "../lib/biometric";
import { useToast } from "./Toast";
import { Avatar, Button, Sheet, Toggle } from "./ui";
import { Logo } from "./Tatreez";

/** Full-screen lock: fingerprint / face / phone PIN instead of typing the password again. */
export function AppLock() {
  const { user, locked, unlock, logout } = useAuth();
  const { t } = useI18n();
  const [busy, setBusy] = useState(false);
  const tryUnlock = async () => {
    setBusy(true);
    try {
      await bioVerify({
        title: t.bio.unlockTitle,
        reason: t.bio.unlockReason,
        cancel: t.common.cancel,
      });
      unlock();
    } catch {
      /* cancelled — stay locked */
    } finally {
      setBusy(false);
    }
  };
  useEffect(() => {
    if (locked && user) void tryUnlock();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [locked, user]);
  if (!locked || !user) return null;
  return (
    <div className="safe-top safe-bottom fixed inset-0 z-[70] flex flex-col items-center justify-center gap-8 bg-bg px-6 text-center">
      <motion.div
        initial={{ scale: 0.8, opacity: 0 }}
        animate={{ scale: 1, opacity: 1 }}
        transition={{ type: "spring", bounce: 0.4 }}
      >
        <Logo className="h-16 w-16" />
      </motion.div>
      <div className="flex flex-col items-center gap-3">
        <Avatar name={user.full_name} size={72} />
        <p className="font-display text-2xl">{user.full_name}</p>
        <p className="text-sm text-muted">{t.bio.lockedLead}</p>
      </div>
      <motion.button
        onClick={tryUnlock}
        disabled={busy}
        whileTap={{ scale: 0.92 }}
        className="grid h-24 w-24 place-items-center rounded-full bg-sunk text-ink shadow-card ring-1 ring-line"
        aria-label={t.bio.unlock}
      >
        <motion.span
          animate={busy ? { opacity: [1, 0.4, 1] } : {}}
          transition={{ repeat: Infinity, duration: 1.2 }}
        >
          <Fingerprint className="h-12 w-12" strokeWidth={1.4} />
        </motion.span>
      </motion.button>
      <div className="flex flex-col items-center gap-2">
        <Button onClick={tryUnlock} loading={busy}>
          {t.bio.unlock}
        </Button>
        <button
          className="text-sm text-muted underline underline-offset-4"
          onClick={() => void logout().then(unlock)}
        >
          {t.bio.usePassword}
        </button>
      </div>
      <span className="sr-only">S-Taler</span>
    </div>
  );
}

/** Asked once after the first sign-in on the phone. */
export function BioOffer() {
  const { user, refreshBio } = useAuth();
  const { t } = useI18n();
  const toast = useToast();
  const [open, setOpen] = useState(false);
  useEffect(() => {
    if (!user) return;
    void (async () => {
      if (
        (await bioAvailable()) &&
        !(await bioAsked()) &&
        !(await bioEnabled())
      )
        setOpen(true);
    })();
  }, [user]);
  const decide = async (on: boolean) => {
    if (on) {
      try {
        await bioVerify({
          title: t.bio.enableTitle,
          reason: t.bio.unlockReason,
          cancel: t.common.cancel,
        });
      } catch {
        return;
      }
    }
    await setBioEnabled(on);
    refreshBio();
    setOpen(false);
    if (on) toast(t.bio.enabled);
  };
  return (
    <Sheet
      open={open}
      onClose={() => void decide(false)}
      title={t.bio.enableTitle}
    >
      <div className="flex flex-col items-center gap-4 text-center">
        <span className="grid h-20 w-20 place-items-center rounded-full bg-sunk">
          <Fingerprint className="h-10 w-10" strokeWidth={1.5} />
        </span>
        <p className="text-muted">{t.bio.enableLead}</p>
        <div className="grid w-full grid-cols-2 gap-3">
          <Button variant="secondary" onClick={() => void decide(false)}>
            {t.bio.notNow}
          </Button>
          <Button onClick={() => void decide(true)}>{t.bio.enable}</Button>
        </div>
      </div>
    </Sheet>
  );
}

/** Settings switch. Renders nothing on the web or on phones without a lock screen. */
export function BioToggle() {
  const { refreshBio } = useAuth();
  const { t } = useI18n();
  const [avail, setAvail] = useState(false);
  const [on, setOn] = useState(false);
  useEffect(() => {
    void (async () => {
      setAvail(await bioAvailable());
      setOn(await bioEnabled());
    })();
  }, []);
  if (!avail) return null;
  return (
    <section className="card p-5 sm:p-6">
      <Toggle
        checked={on}
        label={t.bio.toggle}
        description={t.bio.toggleD}
        onChange={async (v) => {
          try {
            await bioVerify({
              title: t.bio.enableTitle,
              reason: t.bio.unlockReason,
              cancel: t.common.cancel,
            });
          } catch {
            return;
          }
          await setBioEnabled(v);
          setOn(v);
          refreshBio();
        }}
      />
    </section>
  );
}
