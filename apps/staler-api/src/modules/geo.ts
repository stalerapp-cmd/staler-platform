import { Router } from 'express';
import { z } from 'zod';
import { ah } from '../lib/http.js';
import { validate } from '../lib/validate.js';
import { logger } from '../lib/logger.js';
import { isTest } from '../config/env.js';
import { requireAuth } from '../middleware/auth.js';
import { limiter } from '../middleware/security.js';

/**
 * Place search for the maps ("type an address, the map goes there"), like a
 * maps app. Backed by Photon (OpenStreetMap data, free, built for
 * search-as-you-type), limited to Palestine and its surroundings, cached.
 */
export const geoRouter = Router();

// Palestine with a little margin: west, south, east, north.
const BBOX = '34.15,29.45,35.95,33.40';
const cache = new Map<string, { at: number; data: unknown }>();
const TTL = 6 * 60 * 60_000;

interface Hit {
  label: string;
  sub: string;
  lat: number;
  lng: number;
  bbox: [number, number, number, number] | null;
  kind: string;
}

function toHit(f: any): Hit | null {
  const p = f?.properties ?? {};
  const [lng, lat] = f?.geometry?.coordinates ?? [];
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;
  const street = [p.street, p.housenumber].filter(Boolean).join(' ');
  const label = p.name || street || p.city || p.county || '';
  if (!label) return null;
  const sub = [p.name && street && street !== p.name ? street : null, p.locality, p.district, p.city !== label ? p.city : null, p.county !== label ? p.county : null, p.state]
    .filter(Boolean)
    .filter((v, i, a) => a.indexOf(v) === i)
    .join('، ');
  const e = p.extent as number[] | undefined; // [minLon, maxLat, maxLon, minLat]
  return { label, sub, lat, lng, bbox: e?.length === 4 ? [e[3]!, e[0]!, e[1]!, e[2]!] : null, kind: String(p.osm_value ?? p.type ?? '') };
}

geoRouter.get(
  '/search',
  requireAuth,
  limiter({ windowMs: 60_000, limit: 60 }),
  validate({
    query: z
      .object({
        q: z.string().trim().min(2).max(120),
        lat: z.coerce.number().min(-90).max(90).optional(),
        lng: z.coerce.number().min(-180).max(180).optional(),
      })
      .strict(),
  }),
  ah(async (req, res) => {
    const { q, lat, lng } = req.query as unknown as { q: string; lat?: number; lng?: number };
    const key = `${q.toLowerCase()}|${lat?.toFixed(2) ?? ''}|${lng?.toFixed(2) ?? ''}`;
    const hit = cache.get(key);
    if (hit && Date.now() - hit.at < TTL) return res.json({ success: true, data: hit.data });
    const url = new URL('https://photon.komoot.io/api/');
    url.searchParams.set('q', q);
    url.searchParams.set('limit', '8');
    url.searchParams.set('bbox', BBOX);
    if (lat != null && lng != null) {
      url.searchParams.set('lat', String(lat));
      url.searchParams.set('lon', String(lng));
    }
    let results: Hit[] = [];
    if (!isTest) try {
      const r = await fetch(url, { signal: AbortSignal.timeout(6000), headers: { 'User-Agent': 'S-Taler/1.0 (wallet map search)' } });
      if (r.ok) {
        const j: any = await r.json();
        results = (j?.features ?? []).map(toHit).filter(Boolean) as Hit[];
      } else logger.warn({ status: r.status }, 'place search failed');
    } catch (e) {
      logger.warn({ err: (e as Error).message }, 'place search failed');
    }
    // Same place twice (e.g. a node and its area) → keep the first.
    const seen = new Set<string>();
    results = results.filter((x) => {
      const k = `${x.label}|${x.lat.toFixed(3)}|${x.lng.toFixed(3)}`;
      if (seen.has(k)) return false;
      seen.add(k);
      return true;
    });
    const data = { results };
    if (results.length) {
      cache.set(key, { at: Date.now(), data });
      if (cache.size > 2000) cache.delete(cache.keys().next().value!);
    }
    res.json({ success: true, data });
  }),
);
