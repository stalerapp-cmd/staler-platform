import { Capacitor } from '@capacitor/core';
import { LocalNotifications } from '@capacitor/local-notifications';
import { get, post } from './api';

/**
 * Notifications on this device: a pop-up (system notification, or an in-app banner
 * while the app is in front) and a chime. Both are OFF until the person turns them on
 * here — and the browser/phone asks them too. Per device, never per account.
 */
const APP: string = 'bank';
const KEY = `${APP}.alerts.v1`;
const native = () => Capacitor.isNativePlatform();

export interface AlertPrefs {
  push: boolean;
  sound: boolean;
}
export interface Notice {
  id: string;
  type?: string;
  title: string;
  body?: string;
  link?: string;
}

export function prefs(): AlertPrefs {
  try {
    const p = JSON.parse(localStorage.getItem(KEY) ?? '{}');
    return { push: p.push === true, sound: p.sound === true };
  } catch {
    return { push: false, sound: false };
  }
}
function save(p: AlertPrefs) {
  try {
    localStorage.setItem(KEY, JSON.stringify(p));
  } catch {
    /* private mode: stays off */
  }
  window.dispatchEvent(new Event('app:alert-prefs'));
}

export type Support = 'native' | 'web' | 'ios-install' | 'unsupported';
/** What this device can do. iPhone browsers only allow it once the site is on the home screen. */
export function support(): Support {
  if (native()) return 'native';
  const ios = /iphone|ipad|ipod/i.test(navigator.userAgent);
  const standalone = window.matchMedia?.('(display-mode: standalone)').matches || (navigator as any).standalone === true;
  if ('serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window) return 'web';
  if (ios && !standalone) return 'ios-install';
  return 'unsupported';
}

export async function permission(): Promise<'granted' | 'denied' | 'default'> {
  if (native()) {
    const p = await LocalNotifications.checkPermissions();
    return p.display === 'granted' ? 'granted' : p.display === 'denied' ? 'denied' : 'default';
  }
  return 'Notification' in window ? (Notification.permission as any) : 'denied';
}

const b64 = (s: string) => {
  const pad = '='.repeat((4 - (s.length % 4)) % 4);
  const raw = atob((s + pad).replace(/-/g, '+').replace(/_/g, '/'));
  return Uint8Array.from(raw, (c) => c.charCodeAt(0));
};

async function worker() {
  return navigator.serviceWorker.register('/sw.js', { scope: '/' });
}

/** Subscribe this browser and tell the server (who is signed in, which language). */
async function subscribeWeb(lang: string) {
  const { key } = await get<{ key: string | null }>('/api/push/key');
  if (!key) throw new Error('PUSH_OFF');
  const reg = await worker();
  await navigator.serviceWorker.ready;
  const sub = (await reg.pushManager.getSubscription()) ?? (await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: b64(key) }));
  const j = sub.toJSON();
  await post('/api/push/subscribe', { endpoint: j.endpoint, keys: j.keys, language: lang === 'en' ? 'en' : 'ar' });
}

async function nativeChannel() {
  try {
    await LocalNotifications.createChannel({ id: 'alerts', name: APP === 'bank' ? 'TalerBank' : 'S-Taler', importance: 5, visibility: 1, vibration: true, lights: true });
  } catch {
    /* older Android: no channels */
  }
}

/** Turn pop-ups on: asks the browser/phone; returns why not if it can't. */
export async function enablePush(lang: string): Promise<'ok' | 'denied' | 'unsupported' | 'ios-install' | 'off'> {
  const s = support();
  if (s === 'ios-install' || s === 'unsupported') return s;
  if (s === 'native') {
    const r = await LocalNotifications.requestPermissions();
    if (r.display !== 'granted') return 'denied';
    await nativeChannel();
  } else {
    const r = await Notification.requestPermission();
    if (r !== 'granted') return 'denied';
    try {
      await subscribeWeb(lang);
    } catch (e) {
      if ((e as Error).message === 'PUSH_OFF') return 'off';
      throw e;
    }
  }
  save({ ...prefs(), push: true });
  return 'ok';
}

export async function disablePush() {
  save({ ...prefs(), push: false });
  if (support() !== 'web') return;
  const reg = await navigator.serviceWorker.getRegistration('/');
  const sub = await reg?.pushManager.getSubscription();
  if (sub) {
    await post('/api/push/unsubscribe', { endpoint: sub.endpoint }).catch(() => undefined);
    await sub.unsubscribe().catch(() => undefined);
  }
}

export function setSound(on: boolean) {
  save({ ...prefs(), sound: on });
  if (on) void chime();
}

/** After sign-in / language change: keep this device linked to whoever is signed in now. */
export async function resync(lang: string) {
  if (!prefs().push) return;
  if (support() === 'web' && Notification.permission === 'granted') await subscribeWeb(lang).catch(() => undefined);
  if (support() === 'native') await nativeChannel();
}

/** On sign-out: this device stops getting that person's notifications (the setting stays for next time). */
export async function detach() {
  if (support() !== 'web') return;
  try {
    const reg = await navigator.serviceWorker.getRegistration('/');
    const sub = await reg?.pushManager.getSubscription();
    if (sub) await post('/api/push/unsubscribe', { endpoint: sub.endpoint });
  } catch {
    /* offline */
  }
}

let ctx: AudioContext | null = null;
/** A short two-note chime, made on the fly (no sound file). */
export async function chime() {
  try {
    ctx ??= new (window.AudioContext || (window as any).webkitAudioContext)();
    if (ctx.state === 'suspended') await ctx.resume();
    const t = ctx.currentTime;
    const out = ctx.createGain();
    out.gain.value = 0.22;
    out.connect(ctx.destination);
    [
      [880, 0],
      [1318.5, 0.12],
    ].forEach(([f, d]) => {
      const o = ctx!.createOscillator();
      const g = ctx!.createGain();
      o.type = 'sine';
      o.frequency.value = f;
      g.gain.setValueAtTime(0, t + d);
      g.gain.linearRampToValueAtTime(1, t + d + 0.015);
      g.gain.exponentialRampToValueAtTime(0.001, t + d + 0.55);
      o.connect(g).connect(out);
      o.start(t + d);
      o.stop(t + d + 0.6);
    });
  } catch {
    /* no audio */
  }
}

const told = new Set<string>();
/** Something new arrived: banner/system pop-up and chime, only as the person chose. */
export async function announce(n: Notice, opts: { hidden?: boolean } = {}) {
  if (told.has(n.id)) return;
  told.add(n.id);
  window.dispatchEvent(new Event('app:notices-changed'));
  const p = prefs();
  if (p.sound) void chime();
  if (!p.push) return;
  const hidden = opts.hidden ?? document.hidden;
  if (hidden && native()) {
    await LocalNotifications.schedule({
      notifications: [{ id: Math.floor(Math.random() * 2_000_000_000), title: n.title, body: n.body ?? '', channelId: 'alerts', extra: { link: n.link ?? '/app' }, autoCancel: true }],
    }).catch(() => undefined);
    return;
  }
  if (!hidden) window.dispatchEvent(new CustomEvent('app:alert', { detail: n }));
}
