import { useEffect, useRef } from 'react';
import { useI18n } from '../lib/i18n';
import { cx } from './ui';

export interface Pin {
  lat: number;
  lng: number;
  label?: string;
  kind?: 'store' | 'home' | 'track' | 'now' | 'agent';
  /** Lets a tap on the pin be reported back (onPinClick). */
  id?: string;
}

/** Where the person is, and how sure the phone is about it (metres). */
export interface Me {
  lat: number;
  lng: number;
  acc?: number;
}

const COLORS: Record<NonNullable<Pin['kind']>, string> = { store: '#141B3D', home: '#5E7A2E', track: '#9AA3B5', now: '#E2506A', agent: '#C99A2E' };

/**
 * Map tiles, best first. If one provider fails to deliver tiles (blocked
 * network, rate limit, app WebView refused), the map moves on to the next
 * instead of staying blank.
 */
const PROVIDERS = [
  { url: 'https://{s}.basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}{r}.png', opts: { subdomains: 'abcd', maxZoom: 20, attribution: '© OpenStreetMap · © CARTO' } },
  { url: 'https://tile.openstreetmap.org/{z}/{x}/{y}.png', opts: { maxZoom: 19, attribution: '© OpenStreetMap' } },
  { url: 'https://server.arcgisonline.com/ArcGIS/rest/services/World_Street_Map/MapServer/tile/{z}/{y}/{x}', opts: { maxZoom: 19, attribution: '© Esri · OpenStreetMap' } },
];

const pinHtml = (color: string, size: number, pulse: boolean, selected: boolean) =>
  `<span style="position:relative;display:block;width:${size}px;height:${size}px">` +
  (pulse ? `<span style="position:absolute;inset:-8px;border-radius:999px;background:${color};opacity:.25;animation:stPulse 1.6s ease-out infinite"></span>` : '') +
  `<span style="position:absolute;inset:0;border-radius:999px;background:${color};border:3px solid #fff;box-shadow:0 2px 8px rgba(0,0,0,.35);transition:transform .2s;transform:scale(${selected ? 1.25 : 1})"></span></span>`;

/** A teardrop marker for agents and shops, with the selected one lifted and ringed. */
const dropHtml = (color: string, selected: boolean) =>
  `<span style="display:block;width:34px;height:44px;transform:translateY(${selected ? -4 : 0}px) scale(${selected ? 1.15 : 1});transform-origin:50% 100%;transition:transform .25s cubic-bezier(.34,1.56,.64,1);filter:drop-shadow(0 4px 6px rgba(0,0,0,.35))">` +
  `<svg viewBox="0 0 34 44" width="34" height="44"><path d="M17 43C17 43 3 27.5 3 17a14 14 0 1 1 28 0C31 27.5 17 43 17 43z" fill="${selected ? '#E2506A' : color}" stroke="#fff" stroke-width="2.5"/>` +
  `<rect x="12.5" y="12.5" width="9" height="9" rx="1.5" transform="rotate(45 17 17)" fill="#fff"/></svg></span>`;

/**
 * OpenStreetMap via Leaflet (loaded on demand). Shows pins, a delivery trail and
 * the person's own position; pins can be tapped, and with onPick a tap on the
 * map places a pin.
 */
export function MapView({
  pins,
  trail = false,
  onPick,
  onPinClick,
  selectedId,
  me,
  fitKey,
  className,
  zoom = 13,
}: {
  pins: Pin[];
  trail?: boolean;
  onPick?: (p: { lat: number; lng: number }) => void;
  onPinClick?: (id: string) => void;
  selectedId?: string | null;
  me?: Me | null;
  /** Change this value to re-frame the map around everything shown. */
  fitKey?: unknown;
  className?: string;
  zoom?: number;
}) {
  const box = useRef<HTMLDivElement>(null);
  const map = useRef<any>(null);
  const layer = useRef<any>(null);
  const meLayer = useRef<any>(null);
  const L = useRef<any>(null);
  const resize = useRef<ResizeObserver | null>(null);
  const pick = useRef(onPick);
  pick.current = onPick;
  const pinClick = useRef(onPinClick);
  pinClick.current = onPinClick;
  const { lang } = useI18n();

  useEffect(() => {
    let alive = true;
    void (async () => {
      const mod = await import('leaflet');
      await import('leaflet/dist/leaflet.css');
      if (!alive || !box.current) return;
      L.current = mod.default ?? mod;
      const start = me ?? pins[pins.length - 1] ?? { lat: 31.9522, lng: 35.2332 }; // Ramallah by default
      map.current = L.current.map(box.current, { zoomControl: true, attributionControl: true, tap: true }).setView([start.lat, start.lng], zoom);

      // Tiles with automatic fallback: a provider that keeps failing before any tile loads is replaced by the next.
      let idx = 0;
      let tiles: any = null;
      const use = (i: number) => {
        if (tiles) map.current?.removeLayer(tiles);
        const p = PROVIDERS[i]!;
        let ok = 0;
        let bad = 0;
        tiles = L.current.tileLayer(p.url, { ...p.opts, crossOrigin: false, referrerPolicy: 'strict-origin-when-cross-origin' });
        tiles.on('tileload', () => ok++);
        tiles.on('tileerror', () => {
          bad++;
          if (ok === 0 && bad >= 3 && idx < PROVIDERS.length - 1) use(++idx);
        });
        tiles.addTo(map.current);
      };
      use(0);

      layer.current = L.current.layerGroup().addTo(map.current);
      meLayer.current = L.current.layerGroup().addTo(map.current);
      map.current.on('click', (e: any) => pick.current?.({ lat: +e.latlng.lat.toFixed(5), lng: +e.latlng.lng.toFixed(5) }));
      // The map may first appear inside a tab or sheet that is still sizing up: re-measure when it settles.
      if (typeof ResizeObserver !== 'undefined') {
        resize.current = new ResizeObserver(() => map.current?.invalidateSize());
        resize.current.observe(box.current);
      }
      setTimeout(() => map.current?.invalidateSize(), 300);
      draw();
      drawMe();
      fit();
    })();
    return () => {
      alive = false;
      resize.current?.disconnect();
      map.current?.remove();
      map.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const valid = () => pins.filter((p) => Number.isFinite(p.lat) && Number.isFinite(p.lng));

  const draw = () => {
    if (!map.current || !L.current) return;
    layer.current.clearLayers();
    const pts = valid();
    const trailPts = pts.filter((p) => p.kind === 'track' || p.kind === 'now');
    if (trail && trailPts.length > 1) {
      L.current.polyline(trailPts.map((p) => [p.lat, p.lng]), { color: '#E2506A', weight: 4, dashArray: '6 8', opacity: 0.85 }).addTo(layer.current);
    }
    for (const p of pts) {
      const color = COLORS[p.kind ?? 'now'];
      const selected = !!p.id && p.id === selectedId;
      const drop = p.kind === 'agent' || (p.kind === 'store' && !!p.id);
      const size = p.kind === 'now' ? 22 : p.kind === 'track' ? 10 : 18;
      const icon = drop
        ? L.current.divIcon({ className: '', iconSize: [34, 44], iconAnchor: [17, 43], html: dropHtml(color, selected) })
        : L.current.divIcon({ className: '', iconSize: [size, size], iconAnchor: [size / 2, size / 2], html: pinHtml(color, size, p.kind === 'now', selected) });
      const m = L.current.marker([p.lat, p.lng], { icon, zIndexOffset: selected ? 1000 : 0, keyboard: true, title: p.label ?? '' }).addTo(layer.current);
      if (p.label) m.bindTooltip(p.label, { direction: 'top', offset: [0, drop ? -40 : -size / 2] });
      if (p.id) {
        m.on('click', (e: any) => {
          L.current.DomEvent.stopPropagation(e);
          pinClick.current?.(p.id!);
        });
      }
    }
  };

  const drawMe = () => {
    if (!map.current || !L.current) return;
    meLayer.current.clearLayers();
    if (!me) return;
    if (me.acc && me.acc > 15) {
      L.current.circle([me.lat, me.lng], { radius: me.acc, color: '#3E7BD6', weight: 1, fillColor: '#3E7BD6', fillOpacity: 0.12 }).addTo(meLayer.current);
    }
    L.current
      .marker([me.lat, me.lng], {
        icon: L.current.divIcon({
          className: '',
          iconSize: [20, 20],
          iconAnchor: [10, 10],
          html: '<span style="position:relative;display:block;width:20px;height:20px"><span style="position:absolute;inset:-9px;border-radius:999px;background:#3E7BD6;opacity:.25;animation:stPulse 1.8s ease-out infinite"></span><span style="position:absolute;inset:0;border-radius:999px;background:#3E7BD6;border:3px solid #fff;box-shadow:0 2px 8px rgba(0,0,0,.35)"></span></span>',
        }),
        zIndexOffset: 2000,
        interactive: false,
      })
      .addTo(meLayer.current);
  };

  /** Frame everything: all pins, plus the person when we know where they are. */
  const fit = () => {
    if (!map.current || !L.current) return;
    const pts: [number, number][] = valid().map((p) => [p.lat, p.lng]);
    if (me) pts.push([me.lat, me.lng]);
    if (pts.length > 1) map.current.fitBounds(L.current.latLngBounds(pts), { padding: [48, 48], maxZoom: 15 });
    else if (pts.length === 1) map.current.setView(pts[0]!, Math.max(map.current.getZoom(), zoom));
  };

  useEffect(draw, [pins, trail, selectedId]);
  useEffect(drawMe, [me]);
  useEffect(fit, [fitKey, me]);
  // Fly to the chosen pin.
  useEffect(() => {
    if (!map.current || !selectedId) return;
    const p = valid().find((x) => x.id === selectedId);
    if (p) map.current.flyTo([p.lat, p.lng], Math.max(map.current.getZoom(), 15), { duration: 0.8 });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedId]);
  // Pages that don't use fitKey keep the old behaviour: re-frame whenever the pins change.
  useEffect(() => {
    if (fitKey === undefined) fit();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pins]);

  return <div ref={box} dir="ltr" lang={lang} className={cx('relative z-0 h-64 w-full overflow-hidden rounded-2xl border border-line bg-sunk', onPick && 'cursor-crosshair', className)} />;
}
