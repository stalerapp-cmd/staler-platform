import { useEffect, useRef } from 'react';
import { useI18n } from '../lib/i18n';
import { cx } from './ui';

export interface Pin {
  lat: number;
  lng: number;
  label?: string;
  kind?: 'store' | 'home' | 'track' | 'now';
}

const COLORS: Record<NonNullable<Pin['kind']>, string> = { store: '#141B3D', home: '#5E7A2E', track: '#9AA3B5', now: '#E2506A' };

/**
 * OpenStreetMap via Leaflet (loaded on demand). Shows the store, the delivery
 * address and the tracking trail; with onPick the person can tap to place a pin.
 */
export function MapView({ pins, trail = false, onPick, className, zoom = 13 }: { pins: Pin[]; trail?: boolean; onPick?: (p: { lat: number; lng: number }) => void; className?: string; zoom?: number }) {
  const box = useRef<HTMLDivElement>(null);
  const map = useRef<any>(null);
  const layer = useRef<any>(null);
  const L = useRef<any>(null);
  const pick = useRef(onPick);
  pick.current = onPick;
  const { lang } = useI18n();

  useEffect(() => {
    let alive = true;
    void (async () => {
      const mod = await import('leaflet');
      await import('leaflet/dist/leaflet.css');
      if (!alive || !box.current) return;
      L.current = mod.default ?? mod;
      const start = pins[pins.length - 1] ?? { lat: 31.9522, lng: 35.2332 }; // Ramallah by default
      map.current = L.current.map(box.current, { zoomControl: true, attributionControl: true }).setView([start.lat, start.lng], zoom);
      L.current
        .tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', { maxZoom: 19, attribution: '© OpenStreetMap' })
        .addTo(map.current);
      layer.current = L.current.layerGroup().addTo(map.current);
      map.current.on('click', (e: any) => pick.current?.({ lat: +e.latlng.lat.toFixed(5), lng: +e.latlng.lng.toFixed(5) }));
      draw();
    })();
    return () => {
      alive = false;
      map.current?.remove();
      map.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const draw = () => {
    if (!map.current || !L.current) return;
    layer.current.clearLayers();
    const pts = pins.filter((p) => Number.isFinite(p.lat) && Number.isFinite(p.lng));
    const trailPts = pts.filter((p) => p.kind === 'track' || p.kind === 'now');
    if (trail && trailPts.length > 1) {
      L.current.polyline(trailPts.map((p) => [p.lat, p.lng]), { color: '#E2506A', weight: 4, dashArray: '6 8', opacity: 0.85 }).addTo(layer.current);
    }
    for (const p of pts) {
      const color = COLORS[p.kind ?? 'now'];
      const size = p.kind === 'now' ? 22 : p.kind === 'track' ? 10 : 18;
      const pulse = p.kind === 'now' ? `<span style="position:absolute;inset:-8px;border-radius:999px;background:${color};opacity:.25;animation:stPulse 1.6s ease-out infinite"></span>` : '';
      const icon = L.current.divIcon({
        className: '',
        iconSize: [size, size],
        iconAnchor: [size / 2, size / 2],
        html: `<span style="position:relative;display:block;width:${size}px;height:${size}px">${pulse}<span style="position:absolute;inset:0;border-radius:999px;background:${color};border:3px solid #fff;box-shadow:0 2px 8px rgba(0,0,0,.35)"></span></span>`,
      });
      const m = L.current.marker([p.lat, p.lng], { icon }).addTo(layer.current);
      if (p.label) m.bindTooltip(p.label, { direction: 'top', offset: [0, -size / 2] });
    }
    if (pts.length > 1) map.current.fitBounds(L.current.latLngBounds(pts.map((p) => [p.lat, p.lng])), { padding: [36, 36], maxZoom: 15 });
    else if (pts.length === 1) map.current.setView([pts[0]!.lat, pts[0]!.lng], Math.max(map.current.getZoom(), zoom));
  };

  useEffect(draw, [pins, trail]);

  return <div ref={box} dir="ltr" lang={lang} className={cx('relative z-0 h-64 w-full overflow-hidden rounded-2xl border border-line bg-sunk', onPick && 'cursor-crosshair', className)} />;
}
