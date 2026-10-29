import { Capacitor } from '@capacitor/core';
import { Preferences } from '@capacitor/preferences';

/**
 * Security model of the client:
 *  - the access token lives ONLY in memory (never localStorage — XSS can't lift it later);
 *  - on the web the refresh token is an HttpOnly, SameSite=Strict cookie the JS can't read;
 *  - in the Android app it sits in app-private storage and is sent explicitly;
 *  - every money-moving call carries an Idempotency-Key so retries never double-charge.
 */
export const isNative = Capacitor.isNativePlatform();
const BASE = (import.meta.env.VITE_API_URL as string | undefined)?.replace(/\/+$/, '') ?? '';
const RT_KEY = 'st.rt';

export const apiUrl = (path: string) => `${BASE}${path}`;
/** The public web address for links people share — never the app's internal https://localhost. */
export const PUBLIC_ORIGIN = isNative ? BASE || 'https://s-taler.onrender.com' : typeof location !== 'undefined' ? location.origin : '';
export const publicUrl = (path: string) => `${PUBLIC_ORIGIN}${path}`;
/** Image URLs coming from the API may be relative (/files/…) — make them absolute for the native app. */
export const assetUrl = (u?: string | null) => (u ? (u.startsWith('/') ? `${BASE}${u}` : u) : null);

export class ApiError extends Error {
  constructor(
    public status: number,
    public code: string,
    message: string,
    public details?: unknown,
  ) {
    super(message);
  }
}

let accessToken: string | null = null;
let refreshing: Promise<any> | null = null;
const listeners = new Set<(user: any | null) => void>();

let currentUser: any | null = null;
export const session = {
  onChange(fn: (user: any | null) => void) {
    listeners.add(fn);
    return () => {
      listeners.delete(fn);
    };
  },
  emit(user: any | null) {
    currentUser = user;
    listeners.forEach((l) => l(user));
  },
  get user(): any | null {
    return currentUser;
  },
  get token() {
    return accessToken;
  },
};

async function storeRefresh(token?: string) {
  if (!isNative) return;
  if (token) await Preferences.set({ key: RT_KEY, value: token });
  else await Preferences.remove({ key: RT_KEY });
}
async function readRefresh(): Promise<string | null> {
  if (!isNative) return null;
  return (await Preferences.get({ key: RT_KEY })).value;
}

export function newIdempotencyKey() {
  return `ik_${crypto.randomUUID().replace(/-/g, '')}`;
}

/** The merchant's currently selected store or branch (sent as X-Store-Id). */
export const currentStore = {
  get(): string | null {
    try {
      return localStorage.getItem('st.store');
    } catch {
      return null;
    }
  },
  set(id: string | null) {
    try {
      if (id) localStorage.setItem('st.store', id);
      else localStorage.removeItem('st.store');
    } catch {
      /* private mode */
    }
  },
};

function headers(extra: Record<string, string> = {}): Record<string, string> {
  const store = currentStore.get();
  return {
    ...(store ? { 'X-Store-Id': store } : {}),
    Accept: 'application/json',
    'X-Requested-With': 'fetch',
    ...(isNative ? { 'X-Client': 'mobile' } : {}),
    ...(accessToken ? { Authorization: `Bearer ${accessToken}` } : {}),
    ...extra,
  };
}

async function parse(res: Response) {
  const text = await res.text();
  let json: any = null;
  try {
    json = text ? JSON.parse(text) : null;
  } catch {
    /* non-JSON (e.g. proxy error page) */
  }
  if (!res.ok) {
    const e = json?.error ?? {};
    throw new ApiError(res.status, e.code ?? `HTTP_${res.status}`, e.message ?? 'Something went wrong. Please try again.', e.details);
  }
  return json;
}

/** Applies a fresh session (login, refresh, verify). */
export async function applySession(data: { accessToken: string; refreshToken?: string; user?: any }) {
  accessToken = data.accessToken;
  if (data.refreshToken) await storeRefresh(data.refreshToken);
  if (data.user) session.emit(data.user);
}

export async function clearSession() {
  accessToken = null;
  await storeRefresh(undefined);
  session.emit(null);
}

/** Single-flight refresh: concurrent 401s share one rotation (rotation reuse would revoke the session). */
export function refreshSession(): Promise<any | null> {
  refreshing ??= (async () => {
    try {
      const rt = await readRefresh();
      if (isNative && !rt) return null;
      const res = await fetch(apiUrl('/api/auth/refresh'), {
        method: 'POST',
        credentials: isNative ? 'omit' : 'same-origin',
        headers: headers({ 'Content-Type': 'application/json' }),
        body: JSON.stringify(isNative ? { refreshToken: rt } : {}),
      });
      if (res.status === 204) return null;
      if (!res.ok) {
        accessToken = null;
        if (res.status === 401) await storeRefresh(undefined);
        return null;
      }
      const json = await res.json();
      await applySession(json.data);
      return json.data.user;
    } catch {
      return null;
    } finally {
      setTimeout(() => (refreshing = null), 0);
    }
  })();
  return refreshing;
}

interface Opts {
  body?: unknown;
  form?: FormData;
  idempotencyKey?: string;
  retry?: boolean;
}

export async function api<T = any>(method: string, path: string, opts: Opts = {}): Promise<T> {
  const init: RequestInit = {
    method,
    credentials: isNative ? 'omit' : 'same-origin',
    headers: headers({
      ...(opts.body !== undefined ? { 'Content-Type': 'application/json' } : {}),
      ...(opts.idempotencyKey ? { 'Idempotency-Key': opts.idempotencyKey } : {}),
    }),
    body: opts.form ?? (opts.body !== undefined ? JSON.stringify(opts.body) : undefined),
  };
  let res: Response;
  try {
    res = await fetch(apiUrl(path), init);
  } catch {
    throw new ApiError(0, 'NETWORK', 'No connection. Check your internet and try again.');
  }
  if (res.status === 401 && opts.retry !== false && accessToken !== null) {
    const user = await refreshSession();
    if (user) return api<T>(method, path, { ...opts, retry: false });
    await clearSession();
  }
  const json = await parse(res);
  return (json?.data ?? json) as T;
}

export const get = <T = any>(path: string) => api<T>('GET', path);
export const post = <T = any>(path: string, body?: unknown, idempotencyKey?: string) => api<T>('POST', path, { body: body ?? {}, idempotencyKey });
export const put = <T = any>(path: string, body?: unknown) => api<T>('PUT', path, { body: body ?? {} });
export const patch = <T = any>(path: string, body?: unknown) => api<T>('PATCH', path, { body: body ?? {} });
export const del = <T = any>(path: string) => api<T>('DELETE', path);
export const upload = <T = any>(path: string, form: FormData) => api<T>('POST', path, { form });

/** Downloads a protected file (Authorization header, no token in the URL). */
export async function downloadFile(path: string, fallbackName: string) {
  const res = await fetch(apiUrl(path), { headers: headers(), credentials: isNative ? 'omit' : 'same-origin' });
  if (res.headers.get('content-type')?.includes('application/json')) {
    const json = await parse(res);
    if (json?.data?.url) window.open(json.data.url, '_blank', 'noopener');
    return;
  }
  if (!res.ok) await parse(res);
  const blob = await res.blob();
  const name = /filename\*=UTF-8''([^;]+)/.exec(res.headers.get('content-disposition') ?? '')?.[1];
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = name ? decodeURIComponent(name) : fallbackName;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 2000);
}
