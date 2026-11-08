import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { AnimatePresence, motion } from 'framer-motion';
import { Mic, MicOff, MonitorUp, Phone, PhoneOff, Video, VideoOff, Volume2 } from 'lucide-react';
import { get } from '../lib/api';
import { useI18n } from '../lib/i18n';
import { callEngine, canPickSpeaker, canShareScreen, type CallView } from '../lib/callEngine';
import { Avatar, cx } from './ui';

export function useCall() {
  const [v, setV] = useState<CallView>(callEngine.v);
  useEffect(() => {
    const off = callEngine.subscribe(setV);
    return off;
  }, []);
  return v;
}

function Clock({ from }: { from: number | null }) {
  const [, tick] = useState(0);
  useEffect(() => {
    const h = setInterval(() => tick((x) => x + 1), 1000);
    return () => clearInterval(h);
  }, []);
  if (!from) return null;
  const s = Math.floor((Date.now() - from) / 1000);
  return (
    <span className="num">
      {String(Math.floor(s / 60)).padStart(2, '0')}:{String(s % 60).padStart(2, '0')}
    </span>
  );
}

function Tile({ stream, muted, className }: { stream: MediaStream | null; muted?: boolean; className?: string }) {
  const ref = useRef<HTMLVideoElement>(null);
  useEffect(() => {
    if (ref.current && ref.current.srcObject !== stream) ref.current.srcObject = stream;
  }, [stream]);
  return <video ref={ref} autoPlay playsInline muted={muted} className={className} />;
}

/** Rings for incoming support calls, and shows the call screen while one is on. Lives in the app shell. */
export function CallOverlay() {
  const { lang } = useI18n();
  const ar = lang === 'ar';
  const v = useCall();
  const audio = useRef<HTMLAudioElement>(null);
  const [sink, setSink] = useState(0);

  // Is someone calling me?
  useEffect(() => {
    let alive = true;
    const tick = async () => {
      if (!callEngine.busy || callEngine.v.state === 'ringing') {
        try {
          const r = await get<{ call: any }>('/api/calls/incoming');
          if (alive) callEngine.setIncoming(r.call ? { id: r.call.id, caller_name: r.call.caller_name, caller_image: r.call.caller_image, video: r.call.video } : null);
        } catch {
          /* offline */
        }
      }
    };
    void tick();
    const h = setInterval(tick, 5000);
    return () => {
      alive = false;
      clearInterval(h);
    };
  }, []);

  useEffect(() => {
    if (audio.current && audio.current.srcObject !== v.remote) audio.current.srcObject = v.remote;
  }, [v.remote]);

  // A soft ring while a call is incoming.
  useEffect(() => {
    if (v.state !== 'ringing') return;
    let ctx: AudioContext | null = null;
    try {
      ctx = new AudioContext();
    } catch {
      return;
    }
    const ring = () => {
      if (!ctx) return;
      const o = ctx.createOscillator();
      const g = ctx.createGain();
      o.frequency.value = 660;
      g.gain.setValueAtTime(0.0001, ctx.currentTime);
      g.gain.exponentialRampToValueAtTime(0.15, ctx.currentTime + 0.05);
      g.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + 0.8);
      o.connect(g).connect(ctx.destination);
      o.start();
      o.stop(ctx.currentTime + 0.9);
    };
    ring();
    const h = setInterval(ring, 1800);
    return () => {
      clearInterval(h);
      void ctx?.close();
    };
  }, [v.state]);

  // Switch between audio outputs (speaker / earpiece / headset) where the device allows it.
  const nextSpeaker = async () => {
    try {
      const outs = (await navigator.mediaDevices.enumerateDevices()).filter((d) => d.kind === 'audiooutput');
      if (!outs.length || !audio.current) return;
      const i = (sink + 1) % outs.length;
      await (audio.current as any).setSinkId(outs[i]!.deviceId);
      setSink(i);
    } catch {
      /* not supported here */
    }
  };

  const show = v.state !== 'idle';
  const reasonText: Record<string, string> = ar
    ? { declined: 'رفض المكالمة', missed: 'ما حدا رد', ended: 'انتهت المكالمة', failed: 'ما زبط الاتصال — جرّب مرة ثانية', mic: 'لازم تسمح للتطبيق يستعمل المايك' }
    : { declined: 'Call declined', missed: 'No answer', ended: 'Call ended', failed: 'Couldn’t connect — try again', mic: 'Allow the microphone to call' };

  const btn = (on: boolean, label: string, Icon: typeof Mic, onClick: () => void, danger = false) => (
    <button type="button" onClick={onClick} aria-label={label} title={label} className="flex flex-col items-center gap-1.5">
      <span className={cx('grid h-14 w-14 place-items-center rounded-full transition active:scale-90', danger ? 'bg-stitch text-white shadow-lg shadow-stitch/40' : on ? 'bg-white text-night' : 'bg-white/12 text-white hover:bg-white/20')}>
        <Icon className="h-6 w-6" />
      </span>
      <span className="text-[11px] text-white/75">{label}</span>
    </button>
  );

  return createPortal(
    <>
      <audio ref={audio} autoPlay />
      <AnimatePresence>
        {show && (
          <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="fixed inset-0 z-[4000] flex flex-col bg-[#0A0E28] text-white">
            {/* remote video fills the screen when the other side shares picture */}
            {v.remoteVideo && v.remote && <Tile stream={v.remote} muted className="absolute inset-0 h-full w-full object-contain" />}
            <div className="pointer-events-none absolute inset-0 bg-gradient-to-b from-[#141B3D]/70 via-transparent to-[#0A0E28]" />
            {(v.camera || v.screen) && v.local && (
              <motion.div drag dragMomentum={false} className="absolute end-4 top-[max(1rem,env(safe-area-inset-top))] z-10 h-40 w-28 overflow-hidden rounded-2xl bg-black shadow-2xl ring-2 ring-white/20 sm:h-48 sm:w-36">
                <Tile stream={v.local} muted className="h-full w-full -scale-x-100 object-cover" />
              </motion.div>
            )}
            <div className="relative flex flex-1 flex-col items-center justify-center px-6 pt-[env(safe-area-inset-top)] text-center">
              {!v.remoteVideo && (
                <>
                  <span className="relative">
                    {['ringing', 'calling', 'connecting'].includes(v.state) && (
                      <motion.span className="absolute inset-0 rounded-full bg-white/15" animate={{ scale: [1, 1.6], opacity: [0.6, 0] }} transition={{ repeat: Infinity, duration: 1.6 }} />
                    )}
                    <Avatar name={v.other?.full_name ?? '…'} src={v.other?.profile_image} size={112} />
                  </span>
                  <p className="mt-6 font-display text-3xl">{v.other?.full_name ?? (ar ? 'دعم S-Taler' : 'S-Taler support')}</p>
                </>
              )}
              <p className="mt-2 text-sm text-white/70">
                {v.state === 'ringing'
                  ? ar
                    ? 'بتصل فيك — مكالمة دعم'
                    : 'is calling you — support call'
                  : v.state === 'calling'
                    ? ar
                      ? 'عم نتصل…'
                      : 'Calling…'
                    : v.state === 'connecting'
                      ? ar
                        ? 'عم نوصل…'
                        : 'Connecting…'
                      : v.state === 'active'
                        ? <Clock from={v.startedAt} />
                        : reasonText[v.reason ?? 'ended'] ?? reasonText.ended}
              </p>
              {v.screen && <p className="mt-2 rounded-full bg-gold/20 px-3 py-1 text-xs text-gold">{ar ? 'عم تشارك شاشتك' : 'You’re sharing your screen'}</p>}
            </div>

            <div className="relative pb-[max(2rem,env(safe-area-inset-bottom))] pt-4">
              {v.state === 'ringing' ? (
                <div className="flex items-center justify-center gap-14">
                  {btn(false, ar ? 'ارفض' : 'Decline', PhoneOff, () => void callEngine.decline(), true)}
                  <button type="button" onClick={() => void callEngine.accept(false)} className="flex flex-col items-center gap-1.5" aria-label={ar ? 'رد' : 'Answer'}>
                    <motion.span animate={{ rotate: [0, -12, 12, -12, 0] }} transition={{ repeat: Infinity, duration: 1.2 }} className="grid h-16 w-16 place-items-center rounded-full bg-olive text-white shadow-lg shadow-olive/40">
                      <Phone className="h-7 w-7" />
                    </motion.span>
                    <span className="text-[11px] text-white/75">{ar ? 'رد' : 'Answer'}</span>
                  </button>
                </div>
              ) : v.state === 'ended' ? (
                <div className="flex justify-center">
                  <button type="button" onClick={() => callEngine.dismiss()} className="rounded-full bg-white px-8 py-3 font-semibold text-night">
                    {ar ? 'تمام' : 'Close'}
                  </button>
                </div>
              ) : (
                <div className="mx-auto flex max-w-md flex-wrap items-start justify-center gap-x-5 gap-y-4 px-4">
                  {btn(v.muted, v.muted ? (ar ? 'رجّع الصوت' : 'Unmute') : ar ? 'اكتم' : 'Mute', v.muted ? MicOff : Mic, () => callEngine.toggleMute())}
                  {btn(v.camera, ar ? 'الكاميرا' : 'Camera', v.camera ? Video : VideoOff, () => void callEngine.toggleCamera().catch(() => undefined))}
                  {canShareScreen() && btn(v.screen, ar ? 'شارك الشاشة' : 'Share screen', MonitorUp, () => void callEngine.toggleScreen().catch(() => undefined))}
                  {canPickSpeaker() && btn(sink > 0, ar ? 'السمّاعة' : 'Speaker', Volume2, () => void nextSpeaker())}
                  {btn(false, ar ? 'إنهاء' : 'End', PhoneOff, () => void callEngine.hangUp(), true)}
                </div>
              )}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </>,
    document.body,
  );
}
