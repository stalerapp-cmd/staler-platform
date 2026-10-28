import { useEffect, useId, useRef, useState } from 'react';
import { Html5Qrcode } from 'html5-qrcode';
import { motion } from 'framer-motion';
import { Camera } from 'lucide-react';
import { useI18n } from '../lib/i18n';
import { Button } from './ui';

/** Camera QR scanner. Stops the camera as soon as a code is read or the view unmounts. */
export function Scanner({ onResult }: { onResult: (text: string) => void }) {
  const { t } = useI18n();
  const id = `qr-${useId().replace(/:/g, '')}`;
  const ref = useRef<Html5Qrcode | null>(null);
  const [state, setState] = useState<'idle' | 'running' | 'denied'>('idle');
  const done = useRef(false);

  const stop = async () => {
    try {
      if (ref.current?.isScanning) await ref.current.stop();
      ref.current?.clear();
    } catch {
      /* already stopped */
    }
  };
  useEffect(() => () => void stop(), []);

  const start = async () => {
    done.current = false;
    try {
      ref.current ??= new Html5Qrcode(id, { verbose: false } as any);
      await ref.current.start(
        { facingMode: 'environment' },
        { fps: 12, qrbox: (w, h) => ({ width: Math.min(w, h) * 0.72, height: Math.min(w, h) * 0.72 }), aspectRatio: 1 },
        (text) => {
          if (done.current) return;
          done.current = true;
          navigator.vibrate?.(40);
          void stop().then(() => setState('idle'));
          onResult(text);
        },
        () => {},
      );
      setState('running');
    } catch {
      setState('denied');
    }
  };

  return (
    <div className="relative mx-auto aspect-square w-full max-w-sm overflow-hidden rounded-3xl bg-night">
      <div id={id} className="absolute inset-0 [&_video]:h-full [&_video]:w-full [&_video]:object-cover" />
      {/* stitched viewfinder corners */}
      <div className="pointer-events-none absolute inset-[14%]">
        {['top-0 start-0 border-t-4 border-s-4 rounded-ss-2xl', 'top-0 end-0 border-t-4 border-e-4 rounded-se-2xl', 'bottom-0 start-0 border-b-4 border-s-4 rounded-es-2xl', 'bottom-0 end-0 border-b-4 border-e-4 rounded-ee-2xl'].map((c) => (
          <span key={c} className={`absolute h-10 w-10 border-dashed border-gold ${c}`} />
        ))}
        {state === 'running' && (
          <motion.span className="absolute inset-x-2 h-0.5 bg-stitch shadow-[0_0_14px_rgb(var(--stitch))]" animate={{ top: ['6%', '94%', '6%'] }} transition={{ duration: 2.4, repeat: Infinity, ease: 'easeInOut' }} />
        )}
      </div>
      {state !== 'running' && (
        <div className="absolute inset-0 grid place-items-center p-6 text-center">
          <div className="space-y-4">
            {state === 'denied' && <p className="text-sm text-white/80">{t.scan.denied}</p>}
            <Button variant="stitch" onClick={start} icon={<Camera className="h-5 w-5" />}>
              {t.scan.camera}
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}
