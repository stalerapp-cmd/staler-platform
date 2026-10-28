import { useCallback, useEffect, useRef, useState } from 'react';
import { get } from './api';

/** Fetch-on-mount with reload and stale-response protection. */
export function useData<T>(path: string | null, deps: unknown[] = []) {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<unknown>(null);
  const [loading, setLoading] = useState(Boolean(path));
  const seq = useRef(0);
  const load = useCallback(async () => {
    if (!path) return;
    const n = ++seq.current;
    setLoading(true);
    try {
      const d = await get<T>(path);
      if (n === seq.current) {
        setData(d);
        setError(null);
      }
    } catch (e) {
      if (n === seq.current) setError(e);
    } finally {
      if (n === seq.current) setLoading(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [path, ...deps]);
  useEffect(() => {
    void load();
  }, [load]);
  return { data, error, loading, reload: load, setData };
}

export function usePolling(fn: () => void | Promise<void>, ms: number, active = true) {
  const saved = useRef(fn);
  saved.current = fn;
  useEffect(() => {
    if (!active) return;
    let stop = false;
    const tick = async () => {
      if (stop) return;
      if (!document.hidden) await saved.current();
      if (!stop) timer = window.setTimeout(tick, ms);
    };
    let timer = window.setTimeout(tick, ms);
    return () => {
      stop = true;
      clearTimeout(timer);
    };
  }, [ms, active]);
}
