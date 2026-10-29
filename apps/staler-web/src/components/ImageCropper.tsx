import { useEffect, useRef, useState } from 'react';
import { RotateCw, ZoomIn, ZoomOut } from 'lucide-react';
import { useI18n } from '../lib/i18n';
import { Button, Sheet, cx } from './ui';

type Shape = 'circle' | 'square' | 'wide';

/**
 * Preview before upload: the picture sits behind a frame (round for a profile
 * photo, rounded square for a logo, wide for a cover). Drag to move it, zoom
 * with the slider or the wheel, turn it, then save — or cancel and nothing changes.
 */
export function ImageCropper({ file, shape = 'circle', onCancel, onConfirm }: { file: File | null; shape?: Shape; onCancel: () => void; onConfirm: (blob: Blob) => Promise<void> | void }) {
  const { t } = useI18n();
  const [url, setUrl] = useState<string | null>(null);
  const [img, setImg] = useState<HTMLImageElement | null>(null);
  const [zoom, setZoom] = useState(1);
  const [rot, setRot] = useState(0);
  const [pos, setPos] = useState({ x: 0, y: 0 });
  const [busy, setBusy] = useState(false);
  const drag = useRef<{ x: number; y: number; px: number; py: number } | null>(null);
  const frameW = shape === 'wide' ? 320 : 260;
  const frameH = shape === 'wide' ? 160 : 260;

  useEffect(() => {
    if (!file) return;
    const u = URL.createObjectURL(file);
    setUrl(u);
    setZoom(1);
    setRot(0);
    setPos({ x: 0, y: 0 });
    const i = new Image();
    i.onload = () => setImg(i);
    i.src = u;
    return () => {
      URL.revokeObjectURL(u);
      setImg(null);
    };
  }, [file]);

  // Size of the (possibly turned) picture, and the smallest scale that still fills the frame.
  const turned = rot % 180 !== 0;
  const iw = img ? (turned ? img.naturalHeight : img.naturalWidth) : 1;
  const ih = img ? (turned ? img.naturalWidth : img.naturalHeight) : 1;
  const base = Math.max(frameW / iw, frameH / ih);
  const scale = base * zoom;
  const clamp = (p: { x: number; y: number }, z = zoom) => {
    const s = base * z;
    const mx = Math.max(0, (iw * s - frameW) / 2);
    const my = Math.max(0, (ih * s - frameH) / 2);
    return { x: Math.min(mx, Math.max(-mx, p.x)), y: Math.min(my, Math.max(-my, p.y)) };
  };
  const setZ = (z: number) => {
    const nz = Math.min(4, Math.max(1, z));
    setZoom(nz);
    setPos((p) => clamp(p, nz));
  };

  const save = async () => {
    if (!img) return;
    const outW = shape === 'wide' ? 1400 : 640;
    const outH = shape === 'wide' ? 700 : 640;
    const k = outW / frameW;
    const c = document.createElement('canvas');
    c.width = outW;
    c.height = outH;
    const g = c.getContext('2d')!;
    g.fillStyle = '#ffffff';
    if (shape !== 'circle') g.fillRect(0, 0, outW, outH);
    g.translate(outW / 2 + pos.x * k, outH / 2 + pos.y * k);
    g.rotate((rot * Math.PI) / 180);
    const s = scale * k;
    g.drawImage(img, (-img.naturalWidth * s) / 2, (-img.naturalHeight * s) / 2, img.naturalWidth * s, img.naturalHeight * s);
    const blob = await new Promise<Blob | null>((r) => c.toBlob(r, shape === 'circle' ? 'image/png' : 'image/jpeg', 0.9));
    if (!blob) return;
    setBusy(true);
    try {
      await onConfirm(blob);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Sheet
      open={!!file}
      onClose={onCancel}
      title={t.crop.title}
      footer={
        <div className="grid grid-cols-2 gap-3">
          <Button variant="secondary" onClick={onCancel}>
            {t.common.cancel}
          </Button>
          <Button variant="stitch" loading={busy} disabled={!img} onClick={save}>
            {t.crop.save}
          </Button>
        </div>
      }
    >
      <p className="mb-4 text-sm text-muted">{t.crop.lead}</p>
      <div
        className="relative mx-auto grid touch-none select-none place-items-center overflow-hidden rounded-3xl bg-[conic-gradient(rgb(var(--sunk))_25%,rgb(var(--line))_0_50%,rgb(var(--sunk))_0_75%,rgb(var(--line))_0)] bg-[length:22px_22px]"
        style={{ height: frameH + 60, maxWidth: frameW + 60 }}
        onWheel={(e) => setZ(zoom - e.deltaY * 0.0015)}
        onPointerDown={(e) => {
          (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
          drag.current = { x: e.clientX, y: e.clientY, px: pos.x, py: pos.y };
        }}
        onPointerMove={(e) => {
          if (!drag.current) return;
          setPos(clamp({ x: drag.current.px + e.clientX - drag.current.x, y: drag.current.py + e.clientY - drag.current.y }));
        }}
        onPointerUp={() => (drag.current = null)}
        onPointerCancel={() => (drag.current = null)}
      >
        {url && img && (
          <img
            src={url}
            alt=""
            draggable={false}
            className="pointer-events-none absolute left-1/2 top-1/2 max-w-none cursor-grab"
            style={{
              width: img.naturalWidth * scale,
              height: img.naturalHeight * scale,
              transform: `translate(-50%, -50%) translate(${pos.x}px, ${pos.y}px) rotate(${rot}deg)`,
            }}
          />
        )}
        {/* The frame: everything outside it is dimmed, so you see exactly what will be kept. */}
        <div
          className={cx('pointer-events-none relative border-2 border-white/90', shape === 'circle' ? 'rounded-full' : shape === 'square' ? 'rounded-[28px]' : 'rounded-2xl')}
          style={{ width: frameW, height: frameH, boxShadow: '0 0 0 9999px rgb(10 14 40 / 0.55)' }}
        >
          <span className={cx('absolute inset-2 border border-dashed border-white/50', shape === 'circle' ? 'rounded-full' : 'rounded-[22px]')} />
        </div>
      </div>
      <div className="mt-5 flex items-center gap-3">
        <button onClick={() => setZ(zoom - 0.2)} className="grid h-9 w-9 place-items-center rounded-full bg-sunk text-muted hover:text-ink" aria-label={t.crop.zoomOut}>
          <ZoomOut className="h-4 w-4" />
        </button>
        <input type="range" min={1} max={4} step={0.01} value={zoom} onChange={(e) => setZ(Number(e.target.value))} className="flex-1 accent-[rgb(var(--stitch))]" aria-label={t.crop.zoom} />
        <button onClick={() => setZ(zoom + 0.2)} className="grid h-9 w-9 place-items-center rounded-full bg-sunk text-muted hover:text-ink" aria-label={t.crop.zoomIn}>
          <ZoomIn className="h-4 w-4" />
        </button>
        <button
          onClick={() => {
            setRot((r) => (r + 90) % 360);
            setPos({ x: 0, y: 0 });
          }}
          className="grid h-9 w-9 place-items-center rounded-full bg-sunk text-muted hover:text-ink"
          aria-label={t.crop.rotate}
          title={t.crop.rotate}
        >
          <RotateCw className="h-4 w-4" />
        </button>
      </div>
    </Sheet>
  );
}
