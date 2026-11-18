import { NetVoiceEvent, VoiceSignal } from '../types';

export interface VoiceUiState {
  active: boolean;
  pending: boolean;
  muted: boolean;
}

interface AnalyserEntry {
  analyser: AnalyserNode;
  nodes: AudioNode[];
}

const STUN_SERVERS: RTCIceServer[] = [
  { urls: 'stun:stun.miwifi.com:3478' },
  { urls: 'stun:stun.qq.com:3478' },
  { urls: 'stun:stun.l.google.com:19302' },
  { urls: 'stun:stun1.l.google.com:19302' },
];

const MAX_QUEUED_ICE = 40;

export interface TurnConfig {
  urls: string | string[];
  username?: string;
  credential?: string;
}

/**
 * Push-to-toggle voice mesh over WebRTC.
 *
 * Signaling rides on the existing MQTT room channel. The peer with the
 * lexicographically smaller id always creates the offer, which keeps the
 * negotiation glare-free without needing perfect-negotiation rollback.
 */
export class VoiceChat {
  public active = false;
  public muted = false;
  public onStatusChange?: (state: VoiceUiState) => void;
  public onRemoteStream?: (peerId: string, stream: MediaStream) => void;
  public onRemoteGone?: (peerId: string) => void;
  public onSpeakingChange?: (peerId: string, speaking: boolean) => void;

  private pending = false;
  private localStream: MediaStream | null = null;
  private pcs = new Map<string, RTCPeerConnection>();
  private iceQueue = new Map<string, RTCIceCandidateInit[]>();
  private activePeers = new Set<string>();
  private generation = 0;

  private audioCtx: AudioContext | null = null;
  private analysers = new Map<string, AnalyserEntry>();
  private speakingState = new Map<string, boolean>();
  private vadTimer: number | null = null;
  private vadBuffer = new Float32Array(512);
  private turn: TurnConfig | null = null;

  constructor(
    private readonly peerId: string,
    private readonly publish: (evt: NetVoiceEvent) => void,
  ) {}

  public static get supported(): boolean {
    return (
      typeof RTCPeerConnection !== 'undefined' &&
      typeof navigator !== 'undefined' &&
      Boolean(navigator.mediaDevices?.getUserMedia)
    );
  }

  public get busy(): boolean {
    return this.pending;
  }

  public setTurnConfig(turn: TurnConfig | null): void {
    this.turn = turn;
  }

  public async enable(): Promise<void> {
    if (this.active || this.pending) return;
    if (!VoiceChat.supported) throw new Error('WebRTC is not supported');

    const gen = ++this.generation;
    this.pending = true;
    this.emit();

    let stream: MediaStream;
    try {
      stream = await navigator.mediaDevices.getUserMedia({
        audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true },
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
    this.startVad(stream);
    this.emit();

    this.publishState(true);
    for (const remote of this.activePeers) {
      if (this.peerId < remote) void this.createOffer(remote);
    }
  }

  public disable(announce = true): void {
    this.generation++;
    if (this.active && announce) this.publishState(false);

    this.active = false;
    this.pending = false;
    this.muted = false;
    this.stopVad();
    this.localStream?.getTracks().forEach((track) => track.stop());
    this.localStream = null;
    for (const id of [...this.pcs.keys()]) this.closePeer(id);
    this.activePeers.clear();
    this.iceQueue.clear();
    this.emit();
  }

  public dropPeer(peerId: string): void {
    this.activePeers.delete(peerId);
    this.closePeer(peerId);
  }

  public refresh(): void {
    if (!this.active) return;
    this.publishState(true);
    for (const remote of this.activePeers) {
      if (this.peerId < remote && !this.pcs.has(remote)) void this.createOffer(remote);
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
    if (evt.signal.kind === 'offer') {
      void this.onOffer(senderId, evt.signal.sdp);
    } else if (evt.signal.kind === 'answer') {
      void this.onAnswer(senderId, evt.signal.sdp);
    } else if (evt.signal.kind === 'candidate') {
      void this.onCandidate(senderId, evt.signal.candidate);
    }
  }

  private onState(evt: NetVoiceEvent, senderId: string): void {
    if (evt.to && evt.to !== this.peerId) return;

    if (evt.on) {
      this.activePeers.add(senderId);
      if (!this.active) return;
      // A newcomer's broadcast needs a targeted reply so it can discover us.
      if (!evt.to) this.publishState(true, senderId);
      if (this.peerId < senderId) void this.createOffer(senderId);
    } else {
      this.activePeers.delete(senderId);
      this.closePeer(senderId);
    }
  }

  private async createOffer(remoteId: string): Promise<void> {
    if (!this.active || !this.localStream || this.peerId >= remoteId) return;
    if (this.pcs.has(remoteId)) return;

    const pc = this.ensurePeer(remoteId);
    if (!pc) return;

    try {
      const offer = await pc.createOffer();
      await pc.setLocalDescription(offer);
      this.sendSignal(remoteId, { kind: 'offer', sdp: offer.sdp || '' });
    } catch {
      this.closePeer(remoteId);
    }
  }

  private async onOffer(remoteId: string, sdp: string): Promise<void> {
    if (!this.active || !this.localStream || !sdp) return;

    const pc = this.ensurePeer(remoteId);
    if (!pc) return;

    try {
      await pc.setRemoteDescription({ type: 'offer', sdp });
      await this.flushIce(remoteId);
      const answer = await pc.createAnswer();
      await pc.setLocalDescription(answer);
      this.sendSignal(remoteId, { kind: 'answer', sdp: answer.sdp || '' });
    } catch {
      this.closePeer(remoteId);
    }
  }

  private async onAnswer(remoteId: string, sdp: string): Promise<void> {
    const pc = this.pcs.get(remoteId);
    if (!pc || !sdp) return;

    try {
      await pc.setRemoteDescription({ type: 'answer', sdp });
      await this.flushIce(remoteId);
    } catch {
      this.closePeer(remoteId);
    }
  }

  private async onCandidate(remoteId: string, candidate: RTCIceCandidateInit): Promise<void> {
    if (!candidate) return;
    const pc = this.pcs.get(remoteId);
    if (!pc || !pc.remoteDescription) {
      const queue = this.iceQueue.get(remoteId) || [];
      if (queue.length < MAX_QUEUED_ICE) queue.push(candidate);
      this.iceQueue.set(remoteId, queue);
      return;
    }
    try {
      await pc.addIceCandidate(candidate);
    } catch {
      // Stale candidates from a previous negotiation are safe to ignore.
    }
  }

  private async flushIce(remoteId: string): Promise<void> {
    const pc = this.pcs.get(remoteId);
    const queue = this.iceQueue.get(remoteId);
    if (!pc || !queue) return;
    this.iceQueue.delete(remoteId);
    for (const candidate of queue) {
      try {
        await pc.addIceCandidate(candidate);
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

  private ensurePeer(remoteId: string): RTCPeerConnection | null {
    const existing = this.pcs.get(remoteId);
    if (existing) return existing;
    if (!this.active || !this.localStream) return null;

    const pc = new RTCPeerConnection({ iceServers: this.iceServers() });
    for (const track of this.localStream.getAudioTracks()) {
      pc.addTrack(track, this.localStream);
    }

    pc.onicecandidate = (e) => {
      if (e.candidate) {
        this.sendSignal(remoteId, { kind: 'candidate', candidate: e.candidate.toJSON() });
      }
    };

    pc.ontrack = (e) => {
      const stream = e.streams[0];
      if (stream) {
        this.attachAnalyser(remoteId, stream);
        this.onRemoteStream?.(remoteId, stream);
      }
    };

    pc.onconnectionstatechange = () => {
      if (pc.connectionState === 'failed') this.closePeer(remoteId);
    };

    this.pcs.set(remoteId, pc);
    return pc;
  }

  private closePeer(remoteId: string): void {
    const pc = this.pcs.get(remoteId);
    if (pc) {
      pc.onicecandidate = null;
      pc.ontrack = null;
      pc.onconnectionstatechange = null;
      pc.close();
      this.pcs.delete(remoteId);
    }
    this.iceQueue.delete(remoteId);
    this.removeAnalyser(remoteId);
    this.onRemoteGone?.(remoteId);
  }

  private startVad(stream: MediaStream): void {
    this.stopVad();
    try {
      this.audioCtx = new AudioContext();
      void this.audioCtx.resume().catch(() => {});
      this.attachAnalyser(this.peerId, stream);
      this.vadTimer = window.setInterval(() => this.detectSpeaking(), 120);
    } catch {
      this.audioCtx = null;
    }
  }

  private stopVad(): void {
    if (this.vadTimer !== null) {
      clearInterval(this.vadTimer);
      this.vadTimer = null;
    }
    for (const id of [...this.analysers.keys()]) this.removeAnalyser(id);
    this.speakingState.clear();
    if (this.audioCtx) {
      void this.audioCtx.close().catch(() => {});
      this.audioCtx = null;
    }
  }

  private attachAnalyser(peerId: string, stream: MediaStream): void {
    const ctx = this.audioCtx;
    if (!ctx || this.analysers.has(peerId)) return;

    try {
      const source = ctx.createMediaStreamSource(stream);
      const analyser = ctx.createAnalyser();
      analyser.fftSize = 512;
      analyser.smoothingTimeConstant = 0.55;

      // Keep the graph alive without routing audio back to the speakers.
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
    for (const [peerId, entry] of this.analysers) {
      entry.analyser.getFloatTimeDomainData(this.vadBuffer);
      let sum = 0;
      for (let i = 0; i < this.vadBuffer.length; i++) {
        sum += this.vadBuffer[i] * this.vadBuffer[i];
      }
      const rms = Math.sqrt(sum / this.vadBuffer.length);
      const wasSpeaking = this.speakingState.get(peerId) ?? false;
      // Hysteresis keeps the highlight from flickering between syllables.
      const speaking =
        peerId === this.peerId && this.muted ? false : rms > (wasSpeaking ? 0.015 : 0.03);
      this.setSpeaking(peerId, speaking);
    }
  }

  private setSpeaking(peerId: string, speaking: boolean): void {
    if ((this.speakingState.get(peerId) ?? false) === speaking) return;
    this.speakingState.set(peerId, speaking);
    this.onSpeakingChange?.(peerId, speaking);
  }

  private publishState(on: boolean, to?: string): void {
    this.publish({ t: 'voice', action: 'state', on, ...(to ? { to } : {}) });
  }

  private sendSignal(to: string, signal: VoiceSignal): void {
    this.publish({ t: 'voice', action: 'signal', to, signal });
  }

  private emit(): void {
    this.onStatusChange?.({
      active: this.active,
      pending: this.pending,
      muted: this.muted,
    });
  }
}
