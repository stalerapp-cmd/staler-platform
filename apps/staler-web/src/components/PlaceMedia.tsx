import { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { AnimatePresence, motion } from 'framer-motion';
import { ChevronLeft, ChevronRight, Images, Play, X } from 'lucide-react';
import { assetUrl } from '../lib/api';
import { useI18n } from '../lib/i18n';
import { cx } from './ui';

export type PlaceShot = { url: string; kind: 'image' | 'video'; caption?: string };

/** One photo or the first frame of a video, cropped to fill its box. */
export function ShotThumb({ m, className }: { m: PlaceShot; className?: string }) {
  const src = assetUrl(m.url)!;
  return (
    <span className={cx('relative block overflow-hidden bg-sunk', className)}>
      {m.kind === 'video' ? (
        <>
          <video src={`${src}#t=0.1`} muted playsInline preload="metadata" className="h-full w-full object-cover" />
          <span className="absolute inset-0 grid place-items-center bg-black/20">
            <span className="grid h-8 w-8 place-items-center rounded-full bg-white/90 text-night shadow">
              <Play className="h-4 w-4 translate-x-px fill-current" />
            </span>
          </span>
        </>
      ) : (
        <img src={src} alt={m.caption ?? ''} loading="lazy" className="h-full w-full object-cover" />
      )}
    </span>
  );
}

/** A row of the place's photos; tapping one opens the viewer. */
export function PlaceStrip({ media, onOpen, className }: { media: PlaceShot[]; onOpen: (i: number) => void; className?: string }) {
  if (!media?.length) return null;
  return (
    <div className={cx('-mx-1 flex gap-2 overflow-x-auto px-1 pb-1 [scrollbar-width:none]', className)}>
      {media.map((m, i) => (
        <button
          key={m.url}
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            onOpen(i);
          }}
          className="group relative shrink-0 overflow-hidden rounded-2xl ring-1 ring-line transition hover:-translate-y-0.5 hover:shadow-lift"
        >
          <ShotThumb m={m} className="h-24 w-32 transition duration-500 group-hover:scale-105" />
          {m.caption && <span className="absolute inset-x-0 bottom-0 truncate bg-gradient-to-t from-black/70 to-transparent px-2 pb-1 pt-4 text-start text-[11px] text-white">{m.caption}</span>}
        </button>
      ))}
    </div>
  );
}

/** A small "N photos" chip for collapsed cards. */
export function ShotsChip({ n }: { n: number }) {
  const { lang } = useI18n();
  if (!n) return null;
  return (
    <span className="inline-flex items-center gap-1 rounded-full bg-sunk px-2 py-0.5 text-[11px] font-medium text-ink/75">
      <Images className="h-3.5 w-3.5" /> {lang === 'ar' ? `صور المكان · ${n}` : `Photos · ${n}`}
    </span>
  );
}

/** Full-screen viewer: swipe or use the arrows; Esc closes. */
export function MediaViewer({ media, index, title, onClose }: { media: PlaceShot[]; index: number | null; title?: string; onClose: () => void }) {
  const [i, setI] = useState(index ?? 0);
  const { lang } = useI18n();
  const rtl = lang === 'ar';
  useEffect(() => {
    if (index != null) setI(index);
  }, [index]);
  useEffect(() => {
    if (index == null) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
      if (e.key === 'ArrowRight') setI((x) => (rtl ? Math.max(0, x - 1) : Math.min(media.length - 1, x + 1)));
      if (e.key === 'ArrowLeft') setI((x) => (rtl ? Math.min(media.length - 1, x + 1) : Math.max(0, x - 1)));
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [index, media.length, onClose, rtl]);
  const m = media[i];
  return createPortal(
    <AnimatePresence>
      {index != null && m && (
        <motion.div className="fixed inset-0 z-[3000] flex flex-col bg-[rgb(8_10_24/0.94)] text-white backdrop-blur-sm" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} onClick={onClose}>
          <div className="flex items-center justify-between gap-3 px-4 pb-2 pt-[max(1rem,env(safe-area-inset-top))]">
            <div className="min-w-0">
              {title && <p className="truncate font-semibold">{title}</p>}
              <p className="num text-xs text-white/60">
                {i + 1} / {media.length}
              </p>
            </div>
            <button type="button" onClick={onClose} className="grid h-11 w-11 place-items-center rounded-full bg-white text-night shadow-lg ring-4 ring-white/20 transition hover:scale-105" aria-label="✕">
              <X className="h-5 w-5" />
            </button>
          </div>
          <div className="relative flex min-h-0 flex-1 items-center justify-center px-2" onClick={(e) => e.stopPropagation()}>
            <AnimatePresence mode="popLayout" initial={false}>
              <motion.div
                key={m.url}
                className="flex max-h-full max-w-full items-center justify-center"
                initial={{ opacity: 0, scale: 0.96 }}
                animate={{ opacity: 1, scale: 1 }}
                exit={{ opacity: 0, scale: 0.96 }}
                transition={{ duration: 0.2 }}
                drag={media.length > 1 ? 'x' : false}
                dragConstraints={{ left: 0, right: 0 }}
                dragElastic={0.5}
                onDragEnd={(_e, info) => {
                  const next = info.offset.x < -60 ? (rtl ? -1 : 1) : info.offset.x > 60 ? (rtl ? 1 : -1) : 0;
                  if (next) setI((x) => Math.min(media.length - 1, Math.max(0, x + next)));
                }}
              >
                {m.kind === 'video' ? (
                  <video src={assetUrl(m.url)!} controls autoPlay playsInline className="max-h-[78dvh] max-w-full rounded-2xl" />
                ) : (
                  <img src={assetUrl(m.url)!} alt={m.caption ?? ''} className="max-h-[78dvh] max-w-full select-none rounded-2xl object-contain" draggable={false} />
                )}
              </motion.div>
            </AnimatePresence>
            {media.length > 1 && (
              <>
                <button type="button" disabled={i === 0} onClick={() => setI(i - 1)} className="absolute start-3 top-1/2 hidden h-11 w-11 -translate-y-1/2 place-items-center rounded-full bg-white/10 transition hover:bg-white/20 disabled:opacity-25 sm:grid" aria-label="‹">
                  {rtl ? <ChevronRight className="h-6 w-6" /> : <ChevronLeft className="h-6 w-6" />}
                </button>
                <button type="button" disabled={i === media.length - 1} onClick={() => setI(i + 1)} className="absolute end-3 top-1/2 hidden h-11 w-11 -translate-y-1/2 place-items-center rounded-full bg-white/10 transition hover:bg-white/20 disabled:opacity-25 sm:grid" aria-label="›">
                  {rtl ? <ChevronLeft className="h-6 w-6" /> : <ChevronRight className="h-6 w-6" />}
                </button>
              </>
            )}
          </div>
          <div className="px-4 pb-[max(1rem,env(safe-area-inset-bottom))] pt-3 text-center" onClick={(e) => e.stopPropagation()}>
            {m.caption && <p className="mb-3 text-sm text-white/85">{m.caption}</p>}
            {media.length > 1 && (
              <div className="flex justify-center gap-1.5">
                {media.map((x, k) => (
                  <button key={x.url} type="button" onClick={() => setI(k)} className={cx('h-1.5 rounded-full transition-all', k === i ? 'w-6 bg-white' : 'w-1.5 bg-white/35')} aria-label={String(k + 1)} />
                ))}
              </div>
            )}
          </div>
        </motion.div>
      )}
    </AnimatePresence>,
    document.body,
  );
}
