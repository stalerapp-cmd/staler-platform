import { useCallback, useEffect, useRef, useState } from 'react';
import { get, session } from './api';

/**
 * Small in-memory response cache (stale-while-revalidate): returning to a
 * screen shows the last data instantly while fresh data loads in the
 * background, and identical requests fired at the same moment share one call.
 */
const cache = new Map<string, { data: unknown; at: number }>();
const inflight = new Map<string, Promise<unknown>>();
let cacheOwner: unknown = undefined;

function fetchShared<T>(path: string): Promise<T> {
  const running = inflight.get(path);
  if (running) return running as Promise<T>;
  const p = get<T>(path)
    .then((d) => {
      cache.set(path, { data: d, at: Date.now() });
      return d;
    })
    .finally(() => inflight.delete(path));
  inflight.set(path, p);
  return p;
}

/** Drop cached responses (after sign-out, or after a change that affects many screens). */
export function invalidateData(prefix = '') {
  for (const k of [...cache.keys()]) if (k.startsWith(prefix)) cache.delete(k);
}

/** Fetch-on-mount with cache, reload and stale-response protection. */
export function useData<T>(path: string | null, deps: unknown[] = []) {
  // Never show one account's cached data to another account.
  const owner = session.user?.id ?? null;
  if (owner !== cacheOwner) {
    cache.clear();
    cacheOwner = owner;
  }
  const cached = path ? (cache.get(path) as { data: T; at: number } | undefined) : undefined;
  const [data, setData] = useState<T | null>(cached ? cached.data : null);
  const [error, setError] = useState<unknown>(null);
  const [loading, setLoading] = useState(Boolean(path) && !cached);
  const seq = useRef(0);
  const load = useCallback(
    async (force = true) => {
      if (!path) return;
      const n = ++seq.current;
      const c = cache.get(path) as { data: T; at: number } | undefined;
      if (c) setData(c.data);
      if (!c) setLoading(true);
      try {
        if (force) inflight.delete(path);
        const d = await fetchShared<T>(path);
        if (n === seq.current) {
          setData(d);
          setError(null);
        }
      } catch (e) {
        if (n === seq.current) setError(e);
      } finally {
        if (n === seq.current) setLoading(false);
      }
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [path, ...deps],
  );
  useEffect(() => {
    void load(false);
  }, [load]);
  const reload = useCallback(() => load(true), [load]);
  const set = useCallback(
    (v: T | null | ((p: T | null) => T | null)) =>
      setData((prev) => {
        const next = typeof v === 'function' ? (v as (p: T | null) => T | null)(prev) : v;
        if (path && next !== null) cache.set(path, { data: next, at: Date.now() });
        return next;
      }),
    [path],
  );
  return { data, error, loading, reload, setData: set };
}

export function usePolling(fn: () => void | Promise<void>, ms: number, active = true) {
  const saved = useRef(fn);
  saved.current = fn;
  useEffect(() => {
    if (!active) return;
    let stop = false;
    const tick = async () => {
      if (stop) return;
      if (!document.hidden) {
        try {
          await saved.current();
        } catch {
          /* keep polling */
        }
      }
      if (!stop) timer = window.setTimeout(tick, ms);
    };
    let timer = window.setTimeout(tick, ms);
    return () => {
      stop = true;
      clearTimeout(timer);
    };
  }, [ms, active]);
}
