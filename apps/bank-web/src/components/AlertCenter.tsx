import { AnimatePresence, motion, useReducedMotion } from 'framer-motion';
import { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Capacitor } from '@capacitor/core';
import { LocalNotifications } from '@capacitor/local-notifications';
import { X } from 'lucide-react';
import { get } from '../lib/api';
import { useI18n } from '../lib/i18n';
import { localize, targetOf, type Notice as Row } from '../lib/notifications';
import { announce, prefs, resync, type Notice } from '../lib/alerts';

const clean = (s: string | null | undefined) => (s ?? '').replace(/\*\*/g, '').replace(/\[@([^\]]+)\]\([^)]*\)/g, '@$1');

/**
 * Watches for new notifications while signed in and shows them the way the person chose
 * on this device (Settings → Notifications): an in-app banner or a system pop-up, and a chime.
 */
export function AlertCenter() {
  const { lang } = useI18n();
  const nav = useNavigate();
  const reduce = useReducedMotion();
  const [shown, setShown] = useState<(Notice & { at: number })[]>([]);
  const since = useRef<number | null>(null);

  // Keep this device linked to whoever is signed in, in their language.
  useEffect(() => {
    void resync(lang);
  }, [lang]);

  // New notifications: checked often while the app is in front; on the phone app also in the background.
  useEffect(() => {
    let stop = false;
    let timer = 0;
    const tick = async () => {
      const bg = document.hidden;
      if (!bg || (Capacitor.isNativePlatform() && prefs().push)) {
        try {
          const d = await get<{ notifications: Row[] }>('/api/notifications');
          const list = d.notifications ?? [];
          if (since.current === null) since.current = Math.max(Date.now() - 5000, ...list.map((n) => +new Date(n.created_at)));
          else {
            const fresh = list.filter((n) => !n.is_read && +new Date(n.created_at) > since.current!).slice(0, 3).reverse();
            for (const n of fresh) {
              const l = localize(n, lang);
              await announce({ id: n.id, type: n.type, title: clean(l.title), body: clean(l.body), link: targetOf(n) ?? '/app' }, { hidden: bg });
            }
            if (list[0]) since.current = Math.max(since.current!, +new Date(list[0].created_at));
          }
        } catch {
          /* offline */
        }
      }
      if (!stop) timer = window.setTimeout(tick, document.hidden ? 30_000 : 12_000);
    };
    void tick();
    return () => {
      stop = true;
      window.clearTimeout(timer);
    };
  }, [lang]);

  // A push arrived while the app is open (the service worker hands it over), or a pop-up was tapped.
  useEffect(() => {
    if (!('serviceWorker' in navigator)) return;
    const on = (e: MessageEvent) => {
      const d = e.data ?? {};
      if (d.kind === 'push' && d.notice?.id) void announce({ id: d.notice.id, type: d.notice.type, title: d.notice.title, body: d.notice.body, link: d.notice.link }, { hidden: !!d.hidden });
      if (d.kind === 'open' && typeof d.link === 'string' && d.link.startsWith('/')) nav(d.link);
    };
    navigator.serviceWorker.addEventListener('message', on);
    return () => navigator.serviceWorker.removeEventListener('message', on);
  }, [nav]);

  // Phone app: tapping a system notification opens the right page.
  useEffect(() => {
    if (!Capacitor.isNativePlatform()) return;
    const h = LocalNotifications.addListener('localNotificationActionPerformed', (e) => {
      const link = e.notification.extra?.link;
      if (typeof link === 'string' && link.startsWith('/')) nav(link);
    });
    return () => {
      void h.then((x) => x.remove());
    };
  }, [nav]);

  // The in-app banner.
  useEffect(() => {
    const on = (e: Event) => {
      const n = (e as CustomEvent<Notice>).detail;
      setShown((s) => [{ ...n, at: Date.now() }, ...s.filter((x) => x.id !== n.id)].slice(0, 3));
    };
    window.addEventListener('app:alert', on);
    return () => window.removeEventListener('app:alert', on);
  }, []);
  useEffect(() => {
    if (!shown.length) return;
    const t = window.setTimeout(() => setShown((s) => s.filter((x) => Date.now() - x.at < 6500)), 1000);
    return () => window.clearTimeout(t);
  }, [shown]);

  const ar = lang === 'ar';
  return (
    <div className="pointer-events-none fixed inset-x-0 top-0 z-[90] flex flex-col items-center gap-2 px-3 pt-[max(env(safe-area-inset-top),0.75rem)]" aria-live="polite">
      <AnimatePresence initial={false}>
        {shown.map((n) => (
          <motion.button
            key={n.id}
            type="button"
            layout
            initial={reduce ? { opacity: 0 } : { opacity: 0, y: -28, scale: 0.94 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={reduce ? { opacity: 0 } : { opacity: 0, y: -18, scale: 0.96 }}
            transition={{ type: 'spring', stiffness: 420, damping: 32 }}
            drag={reduce ? false : 'y'}
            dragConstraints={{ top: 0, bottom: 0 }}
            dragElastic={{ top: 0.6, bottom: 0.1 }}
            onDragEnd={(_e, i) => {
              if (i.offset.y < -30) setShown((s) => s.filter((x) => x.id !== n.id));
            }}
            onClick={() => {
              setShown((s) => s.filter((x) => x.id !== n.id));
              if (n.link?.startsWith('/')) nav(n.link);
            }}
            className="pointer-events-auto relative w-full max-w-md overflow-hidden rounded-2xl bg-surface/90 p-3 text-start shadow-[0_18px_50px_-14px_rgb(0_0_0/0.35)] ring-1 ring-line backdrop-blur-xl"
          >
            <span className="flex items-start gap-3">
              <img src="/icon-192.png" alt="" className="h-10 w-10 shrink-0 rounded-xl shadow-sm" />
              <span className="min-w-0 flex-1">
                <span className="flex items-baseline justify-between gap-2">
                  <span className="truncate text-sm font-semibold">{n.title}</span>
                  <span className="shrink-0 text-[11px] text-muted">{ar ? 'هلّأ' : 'now'}</span>
                </span>
                {n.body && <span className="mt-0.5 line-clamp-2 block text-[13px] leading-snug text-ink/75">{n.body}</span>}
              </span>
              <span
                role="button"
                tabIndex={0}
                aria-label={ar ? 'سكّر' : 'Dismiss'}
                onClick={(e) => {
                  e.stopPropagation();
                  setShown((s) => s.filter((x) => x.id !== n.id));
                }}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' || e.key === ' ') {
                    e.stopPropagation();
                    setShown((s) => s.filter((x) => x.id !== n.id));
                  }
                }}
                className="-me-1 -mt-1 grid h-7 w-7 shrink-0 place-items-center rounded-full text-muted hover:bg-sunk hover:text-ink"
              >
                <X className="h-3.5 w-3.5" />
              </span>
            </span>
            {!reduce && <motion.span className="absolute inset-x-0 bottom-0 h-0.5 origin-left bg-current opacity-20 rtl:origin-right" initial={{ scaleX: 1 }} animate={{ scaleX: 0 }} transition={{ duration: 6.5, ease: 'linear' }} />}
          </motion.button>
        ))}
      </AnimatePresence>
    </div>
  );
}
