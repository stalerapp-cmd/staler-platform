import { useEffect, useRef, useState } from 'react';
import { ShieldCheck, X } from 'lucide-react';
import { createPortal } from 'react-dom';
import { apiUrl, isNative } from '../lib/api';
import { useI18n } from '../lib/i18n';
import { Spinner } from './ui';

/**
 * View-only reader for purchased files: the (already personalised) PDF is drawn
 * page by page onto canvases in memory — no file is saved, no download or print
 * button, no right-click or text selection. Images are shown the same way.
 */
export function SecureReader({ url, title, onClose }: { url: string | null; title: string; onClose: () => void }) {
  const { t } = useI18n();
  const box = useRef<HTMLDivElement>(null);
  const [state, setState] = useState<'loading' | 'ready' | 'error'>('loading');
  const [pages, setPages] = useState(0);

  useEffect(() => {
    if (!url) return;
    let cancelled = false;
    setState('loading');
    void (async () => {
      try {
        const res = await fetch(apiUrl(url), { credentials: isNative ? 'omit' : 'same-origin', cache: 'no-store' });
        if (!res.ok) throw new Error(String(res.status));
        const type = res.headers.get('content-type') ?? '';
        const bytes = new Uint8Array(await res.arrayBuffer());
        if (cancelled || !box.current) return;
        box.current.innerHTML = '';
        if (type.startsWith('image/')) {
          const img = new Image();
          img.src = URL.createObjectURL(new Blob([bytes], { type }));
          img.className = 'mx-auto max-w-full rounded-lg shadow';
          img.draggable = false;
          box.current.appendChild(img);
          setPages(1);
          setState('ready');
          return;
        }
        const pdfjs: any = await import('pdfjs-dist/legacy/build/pdf.mjs');
        const worker = (await import('pdfjs-dist/legacy/build/pdf.worker.min.mjs?url')).default;
        pdfjs.GlobalWorkerOptions.workerSrc = worker;
        const doc = await pdfjs.getDocument({ data: bytes, isEvalSupported: false, disableAutoFetch: true, standardFontDataUrl: '/pdfjs/standard_fonts/' }).promise;
        setPages(doc.numPages);
        const width = Math.min(box.current.clientWidth - 16, 900);
        for (let n = 1; n <= doc.numPages && !cancelled; n++) {
          const page = await doc.getPage(n);
          const v1 = page.getViewport({ scale: 1 });
          const scale = (width / v1.width) * Math.min(window.devicePixelRatio || 1, 2);
          const vp = page.getViewport({ scale });
          const canvas = document.createElement('canvas');
          canvas.width = vp.width;
          canvas.height = vp.height;
          canvas.style.width = `${width}px`;
          canvas.className = 'mx-auto mb-3 block rounded-md bg-white shadow';
          box.current?.appendChild(canvas);
          await page.render({ canvasContext: canvas.getContext('2d')!, viewport: vp }).promise;
          if (n === 1) setState('ready');
        }
        if (doc.numPages === 0) setState('ready');
      } catch {
        if (!cancelled) setState('error');
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [url]);

  useEffect(() => {
    if (!url) return;
    const block = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && ['s', 'p', 'c'].includes(e.key.toLowerCase())) e.preventDefault();
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', block);
    return () => window.removeEventListener('keydown', block);
  }, [url, onClose]);

  if (!url) return null;
  return createPortal(
    <div className="fixed inset-0 z-[80] flex flex-col bg-night text-white print:hidden" onContextMenu={(e) => e.preventDefault()}>
      <div className="safe-top flex items-center justify-between gap-3 border-b border-white/10 px-4 py-3">
        <div className="min-w-0">
          <p className="truncate font-medium">{title}</p>
          <p className="flex items-center gap-1.5 text-xs text-white/60">
            <ShieldCheck className="h-3.5 w-3.5" /> {t.shop.digitalProtected}
            {pages > 0 && <span className="num"> · {pages}</span>}
          </p>
        </div>
        <button onClick={onClose} className="rounded-xl p-2.5 hover:bg-white/10" aria-label={t.common.close}>
          <X className="h-5 w-5" />
        </button>
      </div>
      <div className="relative flex-1 select-none overflow-y-auto p-2 sm:p-6" style={{ WebkitUserSelect: 'none', WebkitTouchCallout: 'none' }}>
        {state === 'loading' && (
          <div className="absolute inset-0 grid place-items-center">
            <Spinner className="h-8 w-8" />
          </div>
        )}
        {state === 'error' && <p className="mt-20 text-center text-white/70">{t.common.retry}</p>}
        <div ref={box} dir="ltr" />
      </div>
    </div>,
    document.body,
  );
}
