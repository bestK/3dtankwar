import { NetVoiceEvent, PeerPresence, VoiceSignal } from '../types';

export interface VoiceUiState {
  active: boolean;
  pending: boolean;
  muted: boolean;
}

interface AnalyserEntry {
  analyser: AnalyserNode;
  nodes: AudioNode[];
}

interface PeerRtcEntry {
  pc: RTCPeerConnection;
  transceiver: RTCRtpTransceiver | null;
  remoteStream: MediaStream | null;
  makingOffer: boolean;
  ignoreOffer: boolean;
  iceRestarts: number;
  watchdogTimer: number | null;
}

const STUN_SERVERS: RTCIceServer[] = [
  { urls: 'stun:stun.l.google.com:19302' },
  { urls: 'stun:stun.cloudflare.com:3478' },
  { urls: 'stun:stun.miwifi.com:3478' },
];

const MAX_QUEUED_ICE = 64;
const FALLBACK_SAMPLE_RATE = 6000;

export interface TurnConfig {
  urls: string | string[];
  username?: string;
  credential?: string;
}

// ITU-T G.711 μ-law lookup & encoder for ultra-lightweight tactical voice fallback
const ULAW_DECODE_TABLE = new Float32Array(256);
(function initUlawTable() {
  for (let i = 0; i < 256; i++) {
    const u = ~i & 0xff;
    const sign = u & 0x80;
    const exponent = (u >> 4) & 0x07;
    const mantissa = u & 0x0f;
    let sample = (((mantissa << 3) + 0x84) << exponent) - 0x84;
    if (sign !== 0) sample = -sample;
    ULAW_DECODE_TABLE[i] = Math.max(-1, Math.min(1, sample / 32768));
  }
})();

function linearToUlaw(sampleFloat: number): number {
  const BIAS = 0x84;
  const CLIP = 32635;
  let pcm = Math.round(Math.max(-1, Math.min(1, sampleFloat)) * 32767);
  let sign = 0;
  if (pcm < 0) {
    sign = 0x80;
    pcm = -pcm;
  }
  if (pcm > CLIP) pcm = CLIP;
  pcm += BIAS;

  let exponent = 7;
  for (let expMask = 0x4000; (pcm & expMask) === 0 && exponent > 0; exponent--, expMask >>= 1) {
    // find segment
  }
  const mantissa = (pcm >> (exponent + 3)) & 0x0f;
  return ~(sign | (exponent << 4) | mantissa) & 0xff;
}

function bytesToBase64(bytes: Uint8Array): string {
  let binary = '';
  for (let i = 0; i < bytes.length; i++) {
    binary += String.fromCharCode(bytes[i]);
  }
  return btoa(binary);
}

function base64ToBytes(b64: string): Uint8Array {
  const binary = atob(b64);
  const out = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    out[i] = binary.charCodeAt(i);
  }
  return out;
}

/**
 * Real-time room voice mesh over WebRTC with automatic Perfect Negotiation,
 * always-on room listening (hear speakers even before opening your own mic),
 * gesture-unlocked audio playback, and automatic VAD-gated μ-law relay fallback
 * when symmetric NATs or firewalls block direct UDP/TURN paths.
 */
export class VoiceChat {
  public active = false;
  public muted = false;
  public roomListening = false;

  public onStatusChange?: (state: VoiceUiState) => void;
  public onActiveChange?: (active: boolean) => void;
  public onRemoteStream?: (peerId: string, stream: MediaStream) => void;
  public onRemoteGone?: (peerId: string) => void;
  public onSpeakingChange?: (peerId: string, speaking: boolean) => void;
  public isRemoteElementPlaying?: (peerId: string) => boolean;

  private pending = false;
  private localStream: MediaStream | null = null;
  private peers = new Map<string, PeerRtcEntry>();
  private iceQueue = new Map<string, RTCIceCandidateInit[]>();
  private remoteVoicePeers = new Set<string>();
  private roomPeerIds = new Set<string>();
  private generation = 0;

  private audioCtx: AudioContext | null = null;
  private analysers = new Map<string, AnalyserEntry>();
  private speakingState = new Map<string, boolean>();
  private fallbackSpeechDecay = new Map<string, number>();
  private fallbackPlayTime = new Map<string, number>();
  private vadTimer: number | null = null;
  private vadBuffer = new Float32Array(512);
  private turn: TurnConfig | null = null;

  // Fallback mic capture nodes (active only when mic is ON)
  private fallbackSource: MediaStreamAudioSourceNode | null = null;
  private fallbackProcessor: ScriptProcessorNode | null = null;
  private fallbackSilence: GainNode | null = null;
  private fallbackAccum: number[] = [];
  private fallbackPhase = 0;

  constructor(
    private readonly peerId: string,
    private readonly publish: (evt: NetVoiceEvent, reliable?: boolean) => void,
    private readonly publishFallbackChunk?: (ulawBase64: string, sampleRate: number) => void,
  ) {}

  public static get rtcSupported(): boolean {
    return typeof RTCPeerConnection !== 'undefined';
  }

  public static get micSupported(): boolean {
    return typeof navigator !== 'undefined' && Boolean(navigator.mediaDevices?.getUserMedia);
  }

  public static get supported(): boolean {
    return VoiceChat.micSupported;
  }

  public get busy(): boolean {
    return this.pending;
  }

  public setTurnConfig(turn: TurnConfig | null): void {
    this.turn = turn;
  }

  /** Call on user gestures (pointerdown/keydown/touchstart) so AudioContext is never suspended. */
  public unlockAudio(): void {
    const ctx = this.ensureAudioContext();
    if (ctx && ctx.state === 'suspended') {
      void ctx.resume().catch(() => {});
    }
  }

  private ensureAudioContext(): AudioContext | null {
    if (!this.audioCtx) {
      const AudioCtx =
        window.AudioContext ||
        (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
      if (!AudioCtx) return null;
      try {
        this.audioCtx = new AudioCtx();
      } catch {
        this.audioCtx = null;
        return null;
      }
    }
    if (this.audioCtx.state === 'suspended') {
      void this.audioCtx.resume().catch(() => {});
    }
    if (this.vadTimer === null) {
      this.vadTimer = window.setInterval(() => this.detectSpeaking(), 110);
    }
    return this.audioCtx;
  }

  /** Enable/disable room listener mode (true whenever in PvP or Co-op lobby/match). */
  public setRoomListening(enabled: boolean): void {
    if (this.roomListening === enabled) return;
    this.roomListening = enabled;
    if (!enabled) {
      if (this.active || this.pending) {
        this.disable(true);
      }
      for (const id of [...this.peers.keys()]) this.closePeer(id);
      this.remoteVoicePeers.clear();
      this.roomPeerIds.clear();
      this.iceQueue.clear();
      return;
    }
    this.ensureAudioContext();
    this.reconcileConnections();
  }

  /** Synchronize room roster presence so late-joiners automatically discover active speakers. */
  public syncRoster(roster: PeerPresence[]): void {
    const nextRoomIds = new Set<string>();
    for (const p of roster) {
      if (p.peerId === this.peerId) continue;
      nextRoomIds.add(p.peerId);
      if (p.voice) {
        this.remoteVoicePeers.add(p.peerId);
      } else if (p.voice === false) {
        this.remoteVoicePeers.delete(p.peerId);
      }
    }

    for (const oldId of [...this.roomPeerIds]) {
      if (!nextRoomIds.has(oldId)) {
        this.dropPeer(oldId);
      }
    }
    this.roomPeerIds = nextRoomIds;

    if (this.roomListening) {
      this.reconcileConnections();
    }
  }

  public async enable(): Promise<void> {
    if (this.active || this.pending) return;
    if (!VoiceChat.micSupported) throw new Error('Microphone API unavailable');

    this.roomListening = true;
    this.unlockAudio();

    const gen = ++this.generation;
    this.pending = true;
    this.emit();

    let stream: MediaStream;
    try {
      stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true,
          channelCount: 1,
        },
        video: false,
      });
    } catch (err) {
      if (gen === this.generation) {
        this.pending = false;
        this.emit();
      }
      throw err;
    }

    if (gen !== this.generation) {
      stream.getTracks().forEach((track) => track.stop());
      return;
    }

    this.localStream = stream;
    this.pending = false;
    this.active = true;
    this.muted = false;

    const ctx = this.ensureAudioContext();
    if (ctx) {
      this.attachAnalyser(this.peerId, stream);
      this.startFallbackEncoder(ctx, stream);
    }

    this.onActiveChange?.(true);
    this.emit();
    this.publishState(true);
    this.reconcileConnections(true);
  }

  public disable(announce = true): void {
    this.generation++;
    const wasActive = this.active;
    if (wasActive && announce) this.publishState(false);

    this.active = false;
    this.pending = false;
    this.muted = false;
    this.stopFallbackEncoder();
    this.removeAnalyser(this.peerId);

    this.localStream?.getTracks().forEach((track) => track.stop());
    this.localStream = null;

    // Downgrade existing connections to recvonly if the remote peer is still speaking,
    // or close them if nobody on that link has an active mic.
    for (const [remoteId, entry] of [...this.peers.entries()]) {
      if (this.roomListening && this.remoteVoicePeers.has(remoteId)) {
        if (entry.transceiver) {
          void entry.transceiver.sender.replaceTrack(null).catch(() => {});
          try {
            entry.transceiver.direction = 'recvonly';
          } catch {
            // Safari fallback
          }
          void this.negotiate(remoteId);
        }
      } else {
        this.closePeer(remoteId);
      }
    }

    if (wasActive) this.onActiveChange?.(false);
    this.emit();
  }

  public dropPeer(peerId: string): void {
    this.remoteVoicePeers.delete(peerId);
    this.roomPeerIds.delete(peerId);
    this.fallbackPlayTime.delete(peerId);
    this.fallbackSpeechDecay.delete(peerId);
    this.closePeer(peerId);
  }

  public refresh(): void {
    if (this.active) {
      this.publishState(true);
    }
    if (this.roomListening) {
      this.reconcileConnections();
    }
  }

  public toggleMute(): void {
    if (!this.active) return;
    this.muted = !this.muted;
    this.localStream?.getAudioTracks().forEach((track) => {
      track.enabled = !this.muted;
    });
    if (this.muted) this.setSpeaking(this.peerId, false);
    this.emit();
  }

  public handleEvent(evt: NetVoiceEvent, senderId: string): void {
    if (!senderId || senderId === this.peerId) return;

    if (evt.action === 'state') {
      this.onState(evt, senderId);
      return;
    }

    if (evt.to !== this.peerId || !evt.signal) return;
    if (!this.roomListening && !this.active) return;

    if (evt.signal.kind === 'offer' || evt.signal.kind === 'answer') {
      void this.onDescription(senderId, evt.signal);
    } else if (evt.signal.kind === 'candidate') {
      void this.onCandidate(senderId, evt.signal.candidate);
    }
  }

  private onState(evt: NetVoiceEvent, senderId: string): void {
    if (evt.to && evt.to !== this.peerId) return;

    if (evt.on) {
      this.remoteVoicePeers.add(senderId);
      this.roomPeerIds.add(senderId);
      if (this.active && !evt.to) {
        this.publishState(true, senderId);
      }
      if (this.roomListening) {
        this.reconcileConnections();
      }
    } else {
      this.remoteVoicePeers.delete(senderId);
      if (!this.active) {
        this.closePeer(senderId);
      }
    }
  }

  private reconcileConnections(upgradeLocalTrack = false): void {
    if (!this.roomListening || !VoiceChat.rtcSupported) return;

    const candidates = new Set<string>([...this.remoteVoicePeers]);
    if (this.active) {
      for (const id of this.roomPeerIds) candidates.add(id);
    }

    const micTrack = this.active ? this.localStream?.getAudioTracks()[0] ?? null : null;

    for (const remoteId of candidates) {
      if (remoteId === this.peerId) continue;
      const existing = this.peers.get(remoteId);
      if (existing) {
        if (upgradeLocalTrack && micTrack && existing.transceiver) {
          void existing.transceiver.sender.replaceTrack(micTrack).catch(() => {});
          try {
            existing.transceiver.direction = 'sendrecv';
          } catch {
            // ignore
          }
          void this.negotiate(remoteId);
        }
        continue;
      }

      const entry = this.ensurePeer(remoteId);
      if (!entry) continue;
      // Deterministic initiator avoids simultaneous glare on initial link-up,
      // OR whichever side actively has mic on initiates if the smaller id is listener-only.
      const iShouldInitiate =
        this.peerId < remoteId || (this.active && !this.remoteVoicePeers.has(remoteId));
      if (iShouldInitiate) {
        void this.negotiate(remoteId);
      }
    }
  }

  private isPoliteWith(remoteId: string): boolean {
    return this.peerId > remoteId;
  }

  private async negotiate(remoteId: string, iceRestart = false): Promise<void> {
    const entry = this.peers.get(remoteId);
    if (!entry || entry.makingOffer) return;
    const { pc } = entry;
    if (!iceRestart && pc.signalingState !== 'stable') return;

    try {
      entry.makingOffer = true;
      const offer = await pc.createOffer(iceRestart ? { iceRestart: true } : undefined);
      if (!iceRestart && pc.signalingState !== 'stable') return;
      await pc.setLocalDescription(offer);
      this.sendSignal(remoteId, {
        kind: 'offer',
        sdp: pc.localDescription?.sdp || offer.sdp || '',
      });
    } catch {
      // Recoverable via watchdog or remote offer
    } finally {
      entry.makingOffer = false;
    }
  }

  private async onDescription(
    remoteId: string,
    signal: Extract<VoiceSignal, { kind: 'offer' | 'answer' }>,
  ): Promise<void> {
    if (!signal.sdp || !VoiceChat.rtcSupported) return;
    if (signal.kind === 'offer') {
      this.roomPeerIds.add(remoteId);
    }

    const entry = signal.kind === 'offer' ? this.ensurePeer(remoteId) : this.peers.get(remoteId);
    if (!entry) return;
    const { pc } = entry;
    const polite = this.isPoliteWith(remoteId);

    const offerCollision =
      signal.kind === 'offer' && (entry.makingOffer || pc.signalingState !== 'stable');
    entry.ignoreOffer = !polite && offerCollision;
    if (entry.ignoreOffer) return;

    try {
      if (offerCollision) {
        try {
          await pc.setLocalDescription({ type: 'rollback' });
        } catch {
          // Proceed to setRemoteDescription
        }
      }

      // Make sure local mic track is attached before creating an answer if active!
      const micTrack = this.active ? this.localStream?.getAudioTracks()[0] ?? null : null;
      if (signal.kind === 'offer' && micTrack && entry.transceiver) {
        await entry.transceiver.sender.replaceTrack(micTrack).catch(() => {});
        try {
          entry.transceiver.direction = 'sendrecv';
        } catch {
          // ignore
        }
      }

      await pc.setRemoteDescription({ type: signal.kind, sdp: signal.sdp });
      await this.flushIce(remoteId);

      if (signal.kind === 'offer') {
        const answer = await pc.createAnswer();
        await pc.setLocalDescription(answer);
        this.sendSignal(remoteId, {
          kind: 'answer',
          sdp: pc.localDescription?.sdp || answer.sdp || '',
        });
      }
    } catch {
      // If SDP state became wedged from a stale session, rebuild peer cleanly once.
      this.closePeer(remoteId);
      if (signal.kind === 'offer' && this.roomListening) {
        const fresh = this.ensurePeer(remoteId);
        if (fresh) {
          try {
            await fresh.pc.setRemoteDescription({ type: 'offer', sdp: signal.sdp });
            await this.flushIce(remoteId);
            const answer = await fresh.pc.createAnswer();
            await fresh.pc.setLocalDescription(answer);
            this.sendSignal(remoteId, {
              kind: 'answer',
              sdp: fresh.pc.localDescription?.sdp || answer.sdp || '',
            });
          } catch {
            this.closePeer(remoteId);
          }
        }
      }
    }
  }

  private async onCandidate(remoteId: string, candidate: RTCIceCandidateInit): Promise<void> {
    if (!candidate) return;
    const entry = this.peers.get(remoteId);
    if (!entry || !entry.pc.remoteDescription) {
      const queue = this.iceQueue.get(remoteId) || [];
      if (queue.length < MAX_QUEUED_ICE) queue.push(candidate);
      this.iceQueue.set(remoteId, queue);
      return;
    }
    if (entry.ignoreOffer) return;
    try {
      await entry.pc.addIceCandidate(candidate);
    } catch {
      // Stale candidates from a previous negotiation are safe to ignore.
    }
  }

  private async flushIce(remoteId: string): Promise<void> {
    const entry = this.peers.get(remoteId);
    const queue = this.iceQueue.get(remoteId);
    if (!entry || !queue) return;
    this.iceQueue.delete(remoteId);
    for (const candidate of queue) {
      try {
        await entry.pc.addIceCandidate(candidate);
      } catch {
        // Ignore stale candidates.
      }
    }
  }

  public iceServers(): RTCIceServer[] {
    if (!this.turn) return STUN_SERVERS;
    return [
      ...STUN_SERVERS,
      {
        urls: this.turn.urls,
        username: this.turn.username,
        credential: this.turn.credential,
      },
    ];
  }

  private ensurePeer(remoteId: string): PeerRtcEntry | null {
    const existing = this.peers.get(remoteId);
    if (existing) return existing;
    if ((!this.roomListening && !this.active) || !VoiceChat.rtcSupported) return null;

    const pc = new RTCPeerConnection({
      iceServers: this.iceServers(),
      iceCandidatePoolSize: 2,
    });

    const micTrack = this.active ? this.localStream?.getAudioTracks()[0] ?? null : null;
    let transceiver: RTCRtpTransceiver | null = null;
    try {
      transceiver = pc.addTransceiver(micTrack || 'audio', {
        direction: micTrack ? 'sendrecv' : 'recvonly',
        streams: this.localStream ? [this.localStream] : [],
      });
    } catch {
      if (micTrack && this.localStream) {
        pc.addTrack(micTrack, this.localStream);
      }
    }

    const entry: PeerRtcEntry = {
      pc,
      transceiver,
      remoteStream: null,
      makingOffer: false,
      ignoreOffer: false,
      iceRestarts: 0,
      watchdogTimer: null,
    };

    pc.onicecandidate = (e) => {
      if (e.candidate) {
        this.sendSignal(remoteId, { kind: 'candidate', candidate: e.candidate.toJSON() }, false);
      }
    };

    pc.ontrack = (e) => {
      let stream = e.streams?.[0] ?? entry.remoteStream;
      if (!stream) {
        stream = new MediaStream();
      }
      if (!stream.getTracks().includes(e.track)) {
        stream.addTrack(e.track);
      }
      entry.remoteStream = stream;

      const deliver = () => {
        const ctx = this.ensureAudioContext();
        if (ctx) this.attachAnalyser(remoteId, stream!);
        this.onRemoteStream?.(remoteId, stream!);
      };

      deliver();
      e.track.onunmute = () => deliver();
    };

    const checkConnectionHealth = () => {
      const state = pc.connectionState;
      const iceState = pc.iceConnectionState;
      if (state === 'connected' || iceState === 'connected' || iceState === 'completed') {
        entry.iceRestarts = 0;
        if (entry.watchdogTimer !== null) {
          clearTimeout(entry.watchdogTimer);
          entry.watchdogTimer = null;
        }
        return;
      }

      if (state === 'failed' || iceState === 'failed' || iceState === 'disconnected') {
        if (entry.watchdogTimer !== null) clearTimeout(entry.watchdogTimer);
        entry.watchdogTimer = window.setTimeout(() => {
          const cur = this.peers.get(remoteId);
          if (!cur || cur !== entry) return;
          const bad =
            pc.connectionState === 'failed' ||
            pc.iceConnectionState === 'failed' ||
            pc.iceConnectionState === 'disconnected';
          if (!bad) return;
          if (entry.iceRestarts < 2 && !this.isPoliteWith(remoteId)) {
            entry.iceRestarts++;
            void this.negotiate(remoteId, true);
          } else if (entry.iceRestarts >= 2) {
            this.closePeer(remoteId);
            if (this.roomListening && (this.active || this.remoteVoicePeers.has(remoteId))) {
              this.reconcileConnections();
            }
          }
        }, iceState === 'disconnected' ? 2800 : 600);
      }
    };

    pc.onconnectionstatechange = checkConnectionHealth;
    pc.oniceconnectionstatechange = checkConnectionHealth;

    // Initial negotiation watchdog in case initial packet dropped on public broker
    entry.watchdogTimer = window.setTimeout(() => {
      const cur = this.peers.get(remoteId);
      if (!cur || cur !== entry) return;
      const ok =
        pc.connectionState === 'connected' ||
        pc.iceConnectionState === 'connected' ||
        pc.iceConnectionState === 'completed';
      if (!ok && !this.isPoliteWith(remoteId)) {
        entry.iceRestarts++;
        void this.negotiate(remoteId, true);
      }
    }, 4200);

    this.peers.set(remoteId, entry);
    return entry;
  }

  private closePeer(remoteId: string): void {
    const entry = this.peers.get(remoteId);
    if (entry) {
      if (entry.watchdogTimer !== null) clearTimeout(entry.watchdogTimer);
      entry.pc.onicecandidate = null;
      entry.pc.ontrack = null;
      entry.pc.onconnectionstatechange = null;
      entry.pc.oniceconnectionstatechange = null;
      try {
        entry.pc.close();
      } catch {
        // ignore
      }
      this.peers.delete(remoteId);
    }
    this.iceQueue.delete(remoteId);
    this.removeAnalyser(remoteId);
    this.onRemoteGone?.(remoteId);
  }

  private isPeerRtcHealthy(peerId: string): boolean {
    const entry = this.peers.get(peerId);
    if (!entry) return false;
    const { pc } = entry;
    const rtcConnected =
      pc.connectionState === 'connected' ||
      pc.iceConnectionState === 'connected' ||
      pc.iceConnectionState === 'completed';
    if (!rtcConnected) return false;
    if (this.isRemoteElementPlaying && !this.isRemoteElementPlaying(peerId)) {
      return false;
    }
    return true;
  }

  private needsFallbackRelay(): boolean {
    if (!this.publishFallbackChunk || this.roomPeerIds.size === 0) return false;
    for (const remoteId of this.roomPeerIds) {
      if (!this.isPeerRtcHealthy(remoteId)) return true;
    }
    return false;
  }

  private startFallbackEncoder(ctx: AudioContext, stream: MediaStream): void {
    this.stopFallbackEncoder();
    if (!this.publishFallbackChunk) return;

    try {
      const source = ctx.createMediaStreamSource(stream);
      const processor = ctx.createScriptProcessor(2048, 1, 1);
      const silence = ctx.createGain();
      silence.gain.value = 0;

      const ratio = ctx.sampleRate / FALLBACK_SAMPLE_RATE;
      this.fallbackAccum = [];
      this.fallbackPhase = 0;

      processor.onaudioprocess = (ev) => {
        if (!this.active || this.muted || !this.needsFallbackRelay()) {
          if (this.fallbackAccum.length > 0) this.fallbackAccum.length = 0;
          return;
        }

        const input = ev.inputBuffer.getChannelData(0);
        let energy = 0;
        for (let i = 0; i < input.length; i += 4) {
          energy += input[i] * input[i];
        }
        const rms = Math.sqrt(energy / (input.length / 4));
        const isSpeaking = rms > 0.014 || (this.speakingState.get(this.peerId) ?? false);
        if (!isSpeaking) {
          this.fallbackAccum.length = 0;
          return;
        }

        let idx = this.fallbackPhase;
        while (idx < input.length) {
          const s = input[Math.min(input.length - 1, Math.floor(idx))];
          this.fallbackAccum.push(linearToUlaw(s * 1.25));
          idx += ratio;
        }
        this.fallbackPhase = idx - input.length;

        // Flush ~120ms packets (720 bytes = 960 chars Base64)
        while (this.fallbackAccum.length >= 720) {
          const chunk = new Uint8Array(this.fallbackAccum.splice(0, 720));
          this.publishFallbackChunk?.(bytesToBase64(chunk), FALLBACK_SAMPLE_RATE);
        }
      };

      source.connect(processor);
      processor.connect(silence);
      silence.connect(ctx.destination);

      this.fallbackSource = source;
      this.fallbackProcessor = processor;
      this.fallbackSilence = silence;
    } catch {
      // ScriptProcessor unavailable; WebRTC still operates normally.
    }
  }

  private stopFallbackEncoder(): void {
    this.fallbackAccum.length = 0;
    if (this.fallbackProcessor) {
      this.fallbackProcessor.onaudioprocess = null;
      try {
        this.fallbackProcessor.disconnect();
      } catch {
        // ignore
      }
      this.fallbackProcessor = null;
    }
    if (this.fallbackSource) {
      try {
        this.fallbackSource.disconnect();
      } catch {
        // ignore
      }
      this.fallbackSource = null;
    }
    if (this.fallbackSilence) {
      try {
        this.fallbackSilence.disconnect();
      } catch {
        // ignore
      }
      this.fallbackSilence = null;
    }
  }

  /** Play incoming μ-law fallback voice packet when WebRTC P2P is not yet connected or blocked. */
  public handleFallbackChunk(senderId: string, ulawBase64: string, sampleRate: number): void {
    if (!this.roomListening || !senderId || senderId === this.peerId) return;
    if (this.isPeerRtcHealthy(senderId)) return;

    const ctx = this.ensureAudioContext();
    if (!ctx || ctx.state !== 'running') return;

    try {
      const bytes = base64ToBytes(ulawBase64);
      if (bytes.length === 0) return;

      const sr = Math.max(4000, Math.min(16000, sampleRate || FALLBACK_SAMPLE_RATE));
      const audioBuf = ctx.createBuffer(1, bytes.length, sr);
      const channel = audioBuf.getChannelData(0);
      for (let i = 0; i < bytes.length; i++) {
        channel[i] = ULAW_DECODE_TABLE[bytes[i]];
      }
      // Micro fade-in/out at chunk edges to prevent clicks on packet loss
      const ramp = Math.min(24, Math.floor(bytes.length * 0.05));
      for (let i = 0; i < ramp; i++) {
        const w = i / ramp;
        channel[i] *= w;
        channel[bytes.length - 1 - i] *= w;
      }

      const src = ctx.createBufferSource();
      src.buffer = audioBuf;
      const gain = ctx.createGain();
      gain.gain.value = 1.15;
      src.connect(gain);
      gain.connect(ctx.destination);

      const now = ctx.currentTime;
      let startAt = this.fallbackPlayTime.get(senderId) ?? 0;
      if (startAt < now + 0.015 || startAt > now + 0.45) {
        startAt = now + 0.055;
      }
      src.start(startAt);
      this.fallbackPlayTime.set(senderId, startAt + audioBuf.duration);

      this.fallbackSpeechDecay.set(senderId, performance.now() + 260);
      this.setSpeaking(senderId, true);
    } catch {
      // Ignore malformed audio frames
    }
  }

  private attachAnalyser(peerId: string, stream: MediaStream): void {
    const ctx = this.audioCtx;
    if (!ctx) return;
    if (this.analysers.has(peerId)) this.removeAnalyser(peerId);

    try {
      const source = ctx.createMediaStreamSource(stream);
      const analyser = ctx.createAnalyser();
      analyser.fftSize = 512;
      analyser.smoothingTimeConstant = 0.55;

      // Keep the WebAudio graph alive without duplicating speaker output
      const silent = ctx.createGain();
      silent.gain.value = 0;
      source.connect(analyser);
      analyser.connect(silent);
      silent.connect(ctx.destination);

      this.analysers.set(peerId, { analyser, nodes: [source, analyser, silent] });
    } catch {
      // Voice activity detection is best-effort.
    }
  }

  private removeAnalyser(peerId: string): void {
    const entry = this.analysers.get(peerId);
    if (!entry) return;
    this.setSpeaking(peerId, false);
    this.speakingState.delete(peerId);
    for (const node of entry.nodes) {
      try {
        node.disconnect();
      } catch {
        // Already disconnected.
      }
    }
    this.analysers.delete(peerId);
  }

  private detectSpeaking(): void {
    const now = performance.now();
    for (const [peerId, entry] of this.analysers) {
      if ((this.fallbackSpeechDecay.get(peerId) ?? 0) > now) {
        this.setSpeaking(peerId, true);
        continue;
      }
      entry.analyser.getFloatTimeDomainData(this.vadBuffer);
      let sum = 0;
      for (let i = 0; i < this.vadBuffer.length; i++) {
        sum += this.vadBuffer[i] * this.vadBuffer[i];
      }
      const rms = Math.sqrt(sum / this.vadBuffer.length);
      const wasSpeaking = this.speakingState.get(peerId) ?? false;
      const speaking =
        peerId === this.peerId && this.muted ? false : rms > (wasSpeaking ? 0.014 : 0.026);
      this.setSpeaking(peerId, speaking);
    }

    for (const [peerId, until] of this.fallbackSpeechDecay) {
      if (!this.analysers.has(peerId)) {
        if (now > until) {
          this.fallbackSpeechDecay.delete(peerId);
          this.setSpeaking(peerId, false);
        } else {
          this.setSpeaking(peerId, true);
        }
      }
    }
  }

  private setSpeaking(peerId: string, speaking: boolean): void {
    if ((this.speakingState.get(peerId) ?? false) === speaking) return;
    this.speakingState.set(peerId, speaking);
    this.onSpeakingChange?.(peerId, speaking);
  }

  private publishState(on: boolean, to?: string): void {
    this.publish({ t: 'voice', action: 'state', on, ...(to ? { to } : {}) }, true);
  }

  private sendSignal(to: string, signal: VoiceSignal, reliable = true): void {
    this.publish({ t: 'voice', action: 'signal', to, signal }, reliable);
  }

  private emit(): void {
    this.onStatusChange?.({
      active: this.active,
      pending: this.pending,
      muted: this.muted,
    });
  }
}
