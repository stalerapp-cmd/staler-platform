import { useEffect, useState } from 'react';
import { get } from './api';

export interface PublicConfig {
  googleClientId?: string | null;
  sms?: boolean;
  [k: string]: unknown;
}
let cache: Promise<PublicConfig> | null = null;

/** /api/config, fetched once per page load. */
export function usePublicConfig(): PublicConfig | null {
  const [c, setC] = useState<PublicConfig | null>(null);
  useEffect(() => {
    cache ??= get<any>('/api/config')
      .then((r) => (r?.data ?? r) as PublicConfig)
      .catch(() => {
        cache = null;
        return {} as PublicConfig;
      });
    let alive = true;
    void cache.then((v) => alive && setC(v));
    return () => {
      alive = false;
    };
  }, []);
  return c;
}
