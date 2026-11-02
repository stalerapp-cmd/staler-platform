/**
 * Short-lived cache of the per-request account check (role / status /
 * token_version). The database is far away (Seoul) from the app server, so a
 * round trip on every request made every screen slow. Entries live at most
 * TTL_MS and are dropped immediately whenever this process changes a user's
 * status, role or token_version (forgetUser), so suspensions, role changes
 * and "sign out everywhere" still take effect at once.
 */
const TTL_MS = 10_000;
const MAX = 5_000;
const cache = new Map<string, { value: unknown; at: number }>();

export function cachedUser<T>(id: string): T | undefined {
  const e = cache.get(id);
  if (!e) return undefined;
  if (Date.now() - e.at > TTL_MS) {
    cache.delete(id);
    return undefined;
  }
  return e.value as T;
}

export function rememberUser(id: string, value: unknown) {
  if (cache.size >= MAX) cache.delete(cache.keys().next().value as string);
  cache.set(id, { value, at: Date.now() });
}

export function forgetUser(id: string | null | undefined) {
  if (id) cache.delete(id);
}

export function forgetAllUsers() {
  cache.clear();
}

/**
 * Sessions signed out on purpose (one device). Their access tokens would stay
 * valid for up to 10 minutes; remembering the family here refuses them at once.
 */
const revoked = new Map<string, number>();
export function revokeSessionNow(sid: string) {
  revoked.set(sid, Date.now() + 11 * 60_000);
  if (revoked.size > 10_000) for (const [k, until] of revoked) if (until < Date.now()) revoked.delete(k);
}
export function isSessionRevoked(sid: string | undefined) {
  if (!sid) return false;
  const until = revoked.get(sid);
  if (!until) return false;
  if (until < Date.now()) {
    revoked.delete(sid);
    return false;
  }
  return true;
}
