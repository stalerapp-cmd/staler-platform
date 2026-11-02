import { useEffect, useRef, useState } from 'react';
import { Layers } from 'lucide-react';
import { useI18n } from '../lib/i18n';
import { cx } from './ui';
import { isNative } from '../lib/api';

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
 * Map tiles, best first. If a provider fails to deliver tiles, the map moves on
 * to the next instead of staying blank. OpenStreetMap's own servers refuse
 * requests from app WebViews, so the installed app starts with Esri.
 * (No provider that needs an API key: those answer with "key required" pictures
 * that look like successful tiles.)
 */
const OSM = { url: 'https://tile.openstreetmap.org/{z}/{x}/{y}.png', opts: { maxZoom: 19, attribution: '© OpenStreetMap contributors' } };
const ESRI = { url: 'https://server.arcgisonline.com/ArcGIS/rest/services/World_Street_Map/MapServer/tile/{z}/{y}/{x}', opts: { maxZoom: 19, maxNativeZoom: 17, attribution: 'Tiles © Esri — Esri, HERE, Garmin, OpenStreetMap contributors' } };
const PROVIDERS = isNative ? [ESRI, OSM] : [OSM, ESRI];

/**
 * Map styles to switch between, like a maps app: streets, satellite (with labels), terrain, night.
 * Esri has detailed pictures only up to a certain zoom here; past it we enlarge the last real
 * tiles (maxNativeZoom) instead of showing "Map data not yet available".
 */
const AG = 'https://server.arcgisonline.com/ArcGIS/rest/services';
const esri = (path: string) => `${AG}/${path}/MapServer/tile/{z}/{y}/{x}`;
type Base = 'streets' | 'satellite' | 'terrain' | 'dark';
const BASES: Record<Exclude<Base, 'streets'>, { layers: string[]; attribution: string }> = {
  satellite: { layers: ['World_Imagery', 'Reference/World_Transportation', 'Reference/World_Boundaries_and_Places'], attribution: 'Imagery © Esri, Maxar, Earthstar Geographics' },
  terrain: { layers: ['World_Topo_Map'], attribution: 'Tiles © Esri — Esri, HERE, Garmin, USGS' },
  dark: { layers: ['Canvas/World_Dark_Gray_Base', 'Canvas/World_Dark_Gray_Reference'], attribution: 'Tiles © Esri — Esri, HERE, Garmin' },
};
// A small preview tile (around Ramallah) for each style.
const THUMB: Record<Base, string> = {
  streets: `${AG}/World_Street_Map/MapServer/tile/10/416/612`,
  satellite: `${AG}/World_Imagery/MapServer/tile/10/416/612`,
  terrain: `${AG}/World_Topo_Map/MapServer/tile/10/416/612`,
  dark: `${AG}/Canvas/World_Dark_Gray_Base/MapServer/tile/10/416/612`,
};
const BASE_NAME: Record<'ar' | 'en', Record<Base, string>> = {
  ar: { streets: 'شوارع', satellite: 'قمر صناعي', terrain: 'تضاريس', dark: 'ليلي' },
  en: { streets: 'Streets', satellite: 'Satellite', terrain: 'Terrain', dark: 'Night' },
};
function startBase(): Base {
  try {
    const v = localStorage.getItem('st.mapBase');
    if (v === 'streets' || v === 'satellite' || v === 'terrain' || v === 'dark') return v;
  } catch {
    /* storage blocked */
  }
  return typeof document !== 'undefined' && document.documentElement.dataset.theme === 'dark' ? 'dark' : 'streets';
}

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
  const [base, setBase] = useState<Base>(startBase);
  const [picking, setPicking] = useState(false);
  const baseRef = useRef(base);
  const applyBase = useRef<((b: Base) => void) | null>(null);
  useEffect(() => {
    baseRef.current = base;
    applyBase.current?.(base);
    try {
      localStorage.setItem('st.mapBase', base);
    } catch {
      /* storage blocked */
    }
  }, [base]);

  useEffect(() => {
    let alive = true;
    void (async () => {
      const mod = await import('leaflet');
      await import('leaflet/dist/leaflet.css');
      if (!alive || !box.current) return;
      L.current = mod.default ?? mod;
      const start = me ?? pins[pins.length - 1] ?? { lat: 31.9522, lng: 35.2332 }; // Ramallah by default
      map.current = L.current.map(box.current, { zoomControl: true, attributionControl: true, tap: true }).setView([start.lat, start.lng], zoom);

      // Base map. Streets fall back to the next provider when one keeps failing before any tile loads.
      let current: any[] = [];
      const clear = () => {
        current.forEach((l) => map.current?.removeLayer(l));
        current = [];
      };
      const streets = (i: number) => {
        clear();
        const p = PROVIDERS[i]!;
        let ok = 0;
        let bad = 0;
        const tiles = L.current.tileLayer(p.url, { ...p.opts, crossOrigin: false, referrerPolicy: 'strict-origin-when-cross-origin' });
        tiles.on('tileload', () => ok++);
        tiles.on('tileerror', () => {
          bad++;
          if (ok === 0 && bad >= 3 && i < PROVIDERS.length - 1) streets(i + 1);
        });
        tiles.addTo(map.current);
        tiles.bringToBack();
        current = [tiles];
      };
      applyBase.current = (b: Base) => {
        if (!map.current) return;
        if (b === 'streets') return streets(0);
        clear();
        const def = BASES[b];
        current = def.layers.map((path, k) =>
          L.current
            .tileLayer(esri(path), { maxZoom: 19, maxNativeZoom: b === 'dark' ? 16 : 17, attribution: k === 0 ? def.attribution : '', referrerPolicy: 'strict-origin-when-cross-origin' })
            .addTo(map.current),
        );
        current[0]?.bringToBack();
      };
      applyBase.current(baseRef.current);

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

  const names = BASE_NAME[lang === 'ar' ? 'ar' : 'en'];
  return (
    <div dir="ltr" lang={lang} className={cx('relative z-0 h-64 w-full overflow-hidden rounded-2xl border border-line bg-sunk', className)}>
      <div ref={box} className={cx('absolute inset-0', onPick && 'cursor-crosshair')} />
      {/* Map style switcher (bottom-left, like a maps app) */}
      <div className="absolute bottom-2.5 left-2.5 z-[500] flex flex-col-reverse items-start gap-2">
        <button
          type="button"
          onClick={() => setPicking((v) => !v)}
          aria-expanded={picking}
          aria-label={lang === 'ar' ? 'شكل الخريطة' : 'Map style'}
          className="group relative h-12 w-12 overflow-hidden rounded-xl bg-white shadow-[0_6px_18px_-6px_rgba(0,0,0,0.45)] ring-2 ring-white transition hover:scale-105 active:scale-95"
        >
          <img src={THUMB[base === 'satellite' ? 'streets' : 'satellite']} alt="" className="absolute inset-0 h-full w-full object-cover" loading="lazy" />
          <span className="absolute inset-x-0 bottom-0 flex items-center justify-center gap-0.5 bg-black/45 py-0.5 text-[9px] font-semibold text-white backdrop-blur-sm">
            <Layers className="h-2.5 w-2.5" />
          </span>
        </button>
        {picking && (
          <div className="grid grid-cols-2 gap-1.5 rounded-2xl bg-white/95 p-1.5 shadow-[0_14px_34px_-12px_rgba(0,0,0,0.5)] ring-1 ring-black/5 backdrop-blur" role="radiogroup" aria-label={lang === 'ar' ? 'شكل الخريطة' : 'Map style'}>
            {(['streets', 'satellite', 'terrain', 'dark'] as Base[]).map((b) => (
              <button
                key={b}
                type="button"
                role="radio"
                aria-checked={base === b}
                onClick={() => {
                  setBase(b);
                  setPicking(false);
                }}
                className={cx('group w-[68px] rounded-xl p-1 text-center transition', base === b ? 'bg-[#141B3D]/[0.07]' : 'hover:bg-black/[0.04]')}
              >
                <span className={cx('block h-12 overflow-hidden rounded-lg ring-2 transition', base === b ? 'ring-[#C8344A]' : 'ring-transparent group-hover:ring-black/10')}>
                  <img src={THUMB[b]} alt="" className="h-full w-full object-cover" loading="lazy" />
                </span>
                <span lang={lang} className={cx('mt-1 block text-[11px] leading-tight', base === b ? 'font-semibold text-[#C8344A]' : 'text-[#141B3D]/80')}>
                  {names[b]}
                </span>
              </button>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
