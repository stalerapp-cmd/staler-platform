import { useEffect, useState } from 'react';
import QRCode from 'qrcode';
import { motion } from 'framer-motion';

/** QR rendered locally (no third-party service ever sees the payment data). */
export function QRImage({ value, size = 260, label }: { value: string; size?: number; label: string }) {
  const [src, setSrc] = useState('');
  useEffect(() => {
    let on = true;
    QRCode.toDataURL(value, { margin: 1, width: size * 2, errorCorrectionLevel: 'M', color: { dark: '#0C1A17', light: '#FFFFFF' } }).then((d) => on && setSrc(d));
    return () => {
      on = false;
    };
  }, [value, size]);
  return (
    <motion.div key={value} initial={{ opacity: 0, scale: 0.94, rotate: -2 }} animate={{ opacity: 1, scale: 1, rotate: 0 }} transition={{ type: 'spring', bounce: 0.3 }} className="relative mx-auto w-fit rounded-3xl bg-white p-4 shadow-card">
      {src ? <img src={src} width={size} height={size} alt={label} className="block" /> : <div style={{ width: size, height: size }} />}
      <span className="pointer-events-none absolute -inset-1 -z-10 rounded-[30px] bg-[conic-gradient(from_0deg,rgb(var(--stitch)),rgb(var(--gold)),rgb(var(--olive)),rgb(var(--stitch)))] opacity-70 blur-md" />
    </motion.div>
  );
}

export function downloadDataUrl(dataUrl: string, name: string) {
  const a = document.createElement('a');
  a.href = dataUrl;
  a.download = name;
  a.click();
}
