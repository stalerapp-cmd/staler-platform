import { get, patch, post } from './api';

/**
 * One support call over WebRTC. The server only relays the handshake (offer,
 * answer, network candidates) — sound and picture go directly between the two
 * people. A video slot is negotiated from the start, so the camera or a shared
 * screen can be switched on later without starting over.
 */
export type CallState = 'idle' | 'calling' | 'ringing' | 'connecting' | 'active' | 'ended';
export interface CallView {
  state: CallState;
  sessionId: string | null;
  other: { full_name: string; profile_image: string | null } | null;
  muted: boolean;
  camera: boolean;
  screen: boolean;
  remoteVideo: boolean;
  startedAt: number | null;
  reason: string | null;
  local: MediaStream | null;
  remote: MediaStream | null;
  incoming: { id: string; caller_name: string; caller_image: string | null; video: boolean } | null;
}

const ICE: RTCConfiguration = { iceServers: [{ urls: ['stun:stun.l.google.com:19302', 'stun:stun1.l.google.com:19302'] }] };

class Engine {
  v: CallView = { state: 'idle', sessionId: null, other: null, muted: false, camera: false, screen: false, remoteVideo: false, startedAt: null, reason: null, local: null, remote: null, incoming: null };
  private subs = new Set<(v: CallView) => void>();
  private pc: RTCPeerConnection | null = null;
  private after = 0;
  private poll: ReturnType<typeof setTimeout> | null = null;
  private videoSender: RTCRtpSender | null = null;
  private camTrack: MediaStreamTrack | null = null;
  private screenTrack: MediaStreamTrack | null = null;
  private pendingIce: RTCIceCandidateInit[] = [];

  subscribe(f: (v: CallView) => void) {
    this.subs.add(f);
    f(this.v);
    return () => void this.subs.delete(f);
  }
  private set(p: Partial<CallView>) {
    this.v = { ...this.v, ...p };
    this.subs.forEach((f) => f(this.v));
  }
  get busy() {
    return !['idle', 'ended'].includes(this.v.state);
  }

  setIncoming(c: CallView['incoming']) {
    if (this.busy && c) return;
    if (c?.id !== this.v.incoming?.id) this.set({ incoming: c, ...(c ? { state: 'ringing', sessionId: c.id, other: { full_name: c.caller_name, profile_image: c.caller_image }, reason: null } : {}) });
  }

  private async media(video: boolean) {
    const s = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true }, video: video ? { facingMode: 'user', width: { ideal: 640 } } : false });
    this.camTrack = s.getVideoTracks()[0] ?? null;
    return s;
  }

  private build(local: MediaStream) {
    const pc = new RTCPeerConnection(ICE);
    this.pc = pc;
    const remote = new MediaStream();
    pc.ontrack = (e) => {
      e.streams[0]?.getTracks().forEach((t) => remote.addTrack(t));
      if (!e.streams[0]) remote.addTrack(e.track);
      this.set({ remote });
    };
    pc.onicecandidate = (e) => {
      if (e.candidate && this.v.sessionId) void post(`/api/calls/sessions/${this.v.sessionId}/signal`, { kind: 'ice', payload: e.candidate.toJSON() }).catch(() => undefined);
    };
    pc.onconnectionstatechange = () => {
      if (pc.connectionState === 'connected') this.set({ state: 'active', startedAt: this.v.startedAt ?? Date.now() });
      if (pc.connectionState === 'failed') this.end('failed');
    };
    local.getAudioTracks().forEach((t) => pc.addTrack(t, local));
    this.set({ local });
    return pc;
  }

  /** Call the other side of a request. */
  async start(requestId: string, video: boolean) {
    if (this.busy) return;
    this.reset();
    this.set({ state: 'calling', camera: video, reason: null });
    try {
      const s = await post<{ id: string }>('/api/calls/sessions', { requestId, video });
      this.set({ sessionId: s.id });
      const info = await get<{ session: any }>(`/api/calls/sessions/${s.id}`);
      this.set({ other: info.session.other });
      const local = await this.media(video);
      const pc = this.build(local);
      const t = pc.addTransceiver('video', { direction: 'sendrecv' });
      this.videoSender = t.sender;
      if (this.camTrack) await t.sender.replaceTrack(this.camTrack);
      const offer = await pc.createOffer();
      await pc.setLocalDescription(offer);
      await post(`/api/calls/sessions/${s.id}/signal`, { kind: 'offer', payload: { type: offer.type, sdp: offer.sdp } });
      this.loop();
    } catch (e: any) {
      this.end(e?.name === 'NotAllowedError' ? 'mic' : e?.message ?? 'failed');
      throw e;
    }
  }

  /** Answer the ringing call. */
  async accept(video = false) {
    const id = this.v.sessionId;
    if (!id) return;
    this.set({ state: 'connecting', incoming: null, camera: video });
    try {
      await patch(`/api/calls/sessions/${id}`, { status: 'active' });
      const local = await this.media(video);
      this.build(local);
      this.loop();
    } catch (e: any) {
      this.end(e?.name === 'NotAllowedError' ? 'mic' : 'failed');
    }
  }

  async decline() {
    const id = this.v.sessionId;
    this.set({ incoming: null });
    if (id) await patch(`/api/calls/sessions/${id}`, { status: 'declined' }).catch(() => undefined);
    this.end('declined', false);
  }

  private loop() {
    const tick = async () => {
      const id = this.v.sessionId;
      if (!id || !this.pc) return;
      try {
        const r = await get<{ status: string; signals: { id: number; kind: string; payload: any }[] }>(`/api/calls/sessions/${id}/signals?after=${this.after}`);
        for (const s of r.signals) {
          this.after = Math.max(this.after, Number(s.id));
          await this.handle(s.kind, s.payload);
        }
        if (['ended', 'missed', 'declined'].includes(r.status) && this.busy) return this.end(r.status, false);
      } catch {
        /* a lost poll is retried */
      }
      if (this.busy) this.poll = setTimeout(tick, this.v.state === 'active' ? 1500 : 700);
    };
    void tick();
  }

  private async handle(kind: string, payload: any) {
    const pc = this.pc!;
    if (kind === 'offer') {
      await pc.setRemoteDescription(payload);
      // Reuse the video slot the caller opened, so the camera can come and go.
      const t = pc.getTransceivers().find((x) => x.receiver.track?.kind === 'video');
      if (t) {
        t.direction = 'sendrecv';
        this.videoSender = t.sender;
        if (this.camTrack) await t.sender.replaceTrack(this.camTrack);
      }
      const answer = await pc.createAnswer();
      await pc.setLocalDescription(answer);
      await post(`/api/calls/sessions/${this.v.sessionId}/signal`, { kind: 'answer', payload: { type: answer.type, sdp: answer.sdp } });
      await this.flushIce();
      void this.announce();
    } else if (kind === 'answer') {
      await pc.setRemoteDescription(payload);
      await this.flushIce();
      this.set({ state: this.v.state === 'active' ? 'active' : 'connecting' });
      void this.announce();
    } else if (kind === 'ice') {
      if (pc.remoteDescription) await pc.addIceCandidate(payload).catch(() => undefined);
      else this.pendingIce.push(payload);
    } else if (kind === 'media') {
      this.set({ remoteVideo: !!payload?.video });
    } else if (kind === 'bye') {
      this.end('ended', false);
    }
  }
  private async flushIce() {
    for (const c of this.pendingIce.splice(0)) await this.pc?.addIceCandidate(c).catch(() => undefined);
  }
  private announce() {
    return post(`/api/calls/sessions/${this.v.sessionId}/signal`, { kind: 'media', payload: { video: this.v.camera || this.v.screen } }).catch(() => undefined);
  }

  toggleMute() {
    const muted = !this.v.muted;
    this.v.local?.getAudioTracks().forEach((t) => (t.enabled = !muted));
    this.set({ muted });
  }

  async toggleCamera() {
    if (!this.videoSender) return;
    if (this.v.camera) {
      this.camTrack?.stop();
      this.camTrack = null;
      if (!this.v.screen) await this.videoSender.replaceTrack(null);
      this.set({ camera: false });
    } else {
      const s = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'user', width: { ideal: 640 } } });
      this.camTrack = s.getVideoTracks()[0] ?? null;
      if (!this.v.screen) await this.videoSender.replaceTrack(this.camTrack);
      const local = new MediaStream([...(this.v.local?.getAudioTracks() ?? []), ...(this.camTrack ? [this.camTrack] : [])]);
      this.set({ camera: true, local });
    }
    void this.announce();
  }

  static canShare = typeof navigator !== 'undefined' && !!navigator.mediaDevices && 'getDisplayMedia' in navigator.mediaDevices;

  async toggleScreen() {
    if (!this.videoSender) return;
    if (this.v.screen) {
      this.screenTrack?.stop();
      this.screenTrack = null;
      await this.videoSender.replaceTrack(this.camTrack);
      this.set({ screen: false });
    } else {
      const s = await (navigator.mediaDevices as any).getDisplayMedia({ video: true });
      this.screenTrack = s.getVideoTracks()[0] ?? null;
      if (!this.screenTrack) return;
      this.screenTrack.onended = () => void (this.v.screen && this.toggleScreen());
      await this.videoSender.replaceTrack(this.screenTrack);
      this.set({ screen: true });
    }
    void this.announce();
  }

  async hangUp() {
    const id = this.v.sessionId;
    if (id) {
      await post(`/api/calls/sessions/${id}/signal`, { kind: 'bye', payload: null }).catch(() => undefined);
      await patch(`/api/calls/sessions/${id}`, { status: 'ended' }).catch(() => undefined);
    }
    this.end('ended', false);
  }

  private end(reason: string, tell = true) {
    if (tell && this.v.sessionId) void patch(`/api/calls/sessions/${this.v.sessionId}`, { status: 'ended' }).catch(() => undefined);
    if (this.poll) clearTimeout(this.poll);
    this.pc?.close();
    this.pc = null;
    this.v.local?.getTracks().forEach((t) => t.stop());
    this.camTrack?.stop();
    this.screenTrack?.stop();
    this.set({ state: 'ended', reason, incoming: null, local: null });
  }

  dismiss() {
    this.reset();
  }
  private reset() {
    this.after = 0;
    this.pendingIce = [];
    this.videoSender = null;
    this.camTrack = null;
    this.screenTrack = null;
    this.set({ state: 'idle', sessionId: null, other: null, muted: false, camera: false, screen: false, remoteVideo: false, startedAt: null, reason: null, local: null, remote: null, incoming: null });
  }
}

export const callEngine = new Engine();
export const canShareScreen = () => typeof navigator !== 'undefined' && !!navigator.mediaDevices && 'getDisplayMedia' in navigator.mediaDevices;
export const canPickSpeaker = () => typeof HTMLMediaElement !== 'undefined' && 'setSinkId' in HTMLMediaElement.prototype;
