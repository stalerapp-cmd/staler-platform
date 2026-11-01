import { one, pool, S } from './db.js';
import { isPrivateIp } from './realIp.js';
import { logger } from './logger.js';

export interface IpPlace {
  ok: boolean;
  city: string | null;
  region: string | null;
  country: string | null;
  country_code: string | null;
  lat: number | null;
  lng: number | null;
  isp: string | null;
  org: string | null;
  timezone: string | null;
}

async function fetchJson(url: string) {
  const r = await fetch(url, { signal: AbortSignal.timeout(4000), headers: { Accept: 'application/json' } });
  if (!r.ok) throw new Error(`geo ${r.status}`);
  return r.json() as Promise<any>;
}

/** Ask the free geolocation services (two, in case one is down or rate-limited). */
async function remote(ip: string): Promise<IpPlace | null> {
  try {
    const d = await fetchJson(`https://ipwho.is/${encodeURIComponent(ip)}?fields=success,city,region,country,country_code,latitude,longitude,connection,timezone`);
    if (d?.success) {
      return { ok: true, city: d.city ?? null, region: d.region ?? null, country: d.country ?? null, country_code: d.country_code ?? null, lat: d.latitude ?? null, lng: d.longitude ?? null, isp: d.connection?.isp ?? null, org: d.connection?.org ?? null, timezone: d.timezone?.id ?? null };
    }
  } catch (e) {
    logger.debug({ err: (e as Error).message }, 'ipwho.is failed');
  }
  try {
    const d = await fetchJson(`http://ip-api.com/json/${encodeURIComponent(ip)}?fields=status,city,regionName,country,countryCode,lat,lon,isp,org,timezone`);
    if (d?.status === 'success') {
      return { ok: true, city: d.city ?? null, region: d.regionName ?? null, country: d.country ?? null, country_code: d.countryCode ?? null, lat: d.lat ?? null, lng: d.lon ?? null, isp: d.isp ?? null, org: d.org ?? null, timezone: d.timezone ?? null };
    }
  } catch (e) {
    logger.debug({ err: (e as Error).message }, 'ip-api failed');
  }
  return null;
}

/**
 * Approximate place of a network address (city level — a network address can't
 * say more than that). Cached; private addresses are never looked up.
 */
export async function placeOf(ip: string): Promise<IpPlace | null> {
  if (!ip || ip === 'unknown' || isPrivateIp(ip)) return null;
  const hit = await one<IpPlace & { looked_up_at: string }>(`SELECT * FROM ${S}.ip_geo WHERE ip = $1`, [ip]);
  // Successful answers are kept 30 days; failures are retried after a day.
  if (hit && Date.now() - new Date(hit.looked_up_at).getTime() < (hit.ok ? 30 : 1) * 86_400_000) return hit.ok ? hit : null;
  if (process.env.NODE_ENV === 'test') return null;
  const p = await remote(ip);
  await pool.query(
    `INSERT INTO ${S}.ip_geo (ip, ok, city, region, country, country_code, lat, lng, isp, org, timezone, looked_up_at)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11, now())
     ON CONFLICT (ip) DO UPDATE SET ok = EXCLUDED.ok, city = EXCLUDED.city, region = EXCLUDED.region, country = EXCLUDED.country,
       country_code = EXCLUDED.country_code, lat = EXCLUDED.lat, lng = EXCLUDED.lng, isp = EXCLUDED.isp, org = EXCLUDED.org,
       timezone = EXCLUDED.timezone, looked_up_at = now()`,
    [ip, !!p, p?.city ?? null, p?.region ?? null, p?.country ?? null, p?.country_code ?? null, p?.lat ?? null, p?.lng ?? null, p?.isp ?? null, p?.org ?? null, p?.timezone ?? null],
  );
  return p;
}
