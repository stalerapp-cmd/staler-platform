import { GOVERNORATES, placeKey } from './places.js';
import { S } from './db.js';

/**
 * A place selection (`gov:<id>` / `town:<name>`) as normalised names to match
 * against cities people, stores and agents typed, and the English city names the
 * sign-in address lookup returns ("Nablus", "Ramallah").
 */
export function placeKeys(sel: string[]): string[] {
  const out = new Set<string>();
  for (const s of sel) {
    const g = GOVERNORATES.find((x) => `gov:${x.id}` === s);
    if (g) {
      out.add(g.ar);
      out.add(g.en);
      out.add(g.en.split(/[ &]/)[0]!);
      g.towns.forEach((t) => out.add(t));
    } else if (s.startsWith('town:')) out.add(s.slice(5));
  }
  return [...out].map(placeKey).filter(Boolean);
}

/** The same normalisation as placeKey, in SQL (replace, not translate: it is byte-safe whatever the database encoding). */
export const nk = (col: string) =>
  `regexp_replace(replace(replace(replace(replace(replace(lower(btrim(${col})), 'أ', 'ا'), 'إ', 'ا'), 'آ', 'ا'), 'ة', 'ه'), 'ى', 'ي'), '\\s+', ' ', 'g')`;

/**
 * SQL condition: user `u` belongs to one of the places in parameter `$p` (a text[] of
 * placeKeys) — by the town they gave, their store or agent listing, or where they
 * signed in from in the last 90 days.
 */
export const inPlaces = (u: string, p: string) => `(
  ${nk(`${u}.home_city`)} = ANY(${p})
  OR EXISTS (SELECT 1 FROM ${S}.merchants m WHERE m.user_id = ${u}.id AND ${nk('m.city')} = ANY(${p}))
  OR EXISTS (SELECT 1 FROM ${S}.agent_profiles ap WHERE ap.user_id = ${u}.id AND ${nk('ap.city')} = ANY(${p}))
  OR EXISTS (SELECT 1 FROM ${S}.user_device_places dp JOIN ${S}.ip_geo g ON g.ip = dp.ip
              WHERE dp.user_id = ${u}.id AND dp.last_seen > now() - interval '90 days' AND ${nk('g.city')} = ANY(${p}))
)`;

/** The governorate selection a city belongs to, for "everyone around me". */
export function areaOf(city: string | null | undefined): string[] {
  if (!city) return [];
  const k = placeKey(city);
  const g = GOVERNORATES.find((x) => placeKey(x.ar) === k || placeKey(x.en) === k || x.towns.some((t) => placeKey(t) === k));
  return g ? [`gov:${g.id}`] : [`town:${city.trim()}`];
}

// ---------------------------------------------------------------- mentions
/** `@[Name](store:slug)`, `@[Name](agent:id)`, `@[Name](user:id)` inside a message. */
export const MENTION = /@\[([^\]\n]{1,60})\]\((store|agent|user):([A-Za-z0-9_-]{1,80})\)/g;

/** The message as plain text (e-mail, toasts): mentions become "@Name". */
export const plainText = (s: string) => s.replace(MENTION, (_m, name: string) => `@${name}`);

/** Where tapping the notification itself should go: the first mention, if any. */
export function mentionLink(s: string): string | null {
  MENTION.lastIndex = 0;
  const m = MENTION.exec(s);
  MENTION.lastIndex = 0;
  if (!m) return null;
  const [, , kind, ref] = m;
  return kind === 'store' ? `/s/${ref}` : kind === 'agent' ? `/app/agents?agent=${ref}` : null;
}

/** A mention token for a name, safe to put in a message. */
export const mentionOf = (kind: 'store' | 'agent' | 'user', ref: string, name: string) => `@[${name.replace(/[\][\n]/g, ' ').trim().slice(0, 60)}](${kind}:${ref})`;
