import { NetScreenEvent } from '../types';

const MAX_QUEUED_ICE = 40;

/**
 * One-to-many screen casting for the room.
 *
 * The sharer is always the offerer, so every viewer connection is glare-free.
 * Only one remote share is watched at a time; a new share replaces the old one.
 */
export class ScreenShare {
  public sharing = false;
  public busy = false;
  public onStatusChange?: (sharing: boolean) => void;
  public onRemoteStarted?: (peerId: string, name: string) => void;
  public onRemoteStream?: (peerId: string, stream: MediaStream) => void;
  public onRemoteStopped?: () => void;

  private localStream: MediaStream | null = null;
  private localName = '';
  private shareId = '';
  private pcs = new Map<string, RTCPeerConnection>();
  private sharerIce = new Map<string, RTCIceCandidateInit[]>();

  private viewerPc: RTCPeerConnection | null = null;
  private viewerIce: RTCIceCandidateInit[] = [];
  private remoteShareId = '';
  private remotePeerId = '';
  private remoteName = '';

  constructor(
    private readonly peerId: string,
    private readonly publish: (evt: NetScreenEvent) => void,
    private readonly getIceServers: () => RTCIceServer[],
  ) {}

  public get supported(): boolean {
    return (
      typeof navigator !== 'undefined' &&
      typeof navigator.mediaDevices?.getDisplayMedia === 'function'
    );
  }

  public async start(peerIds: string[], name: string): Promise<void> {
    if (this.sharing || this.busy) return;
    if (this.remoteShareId) throw new Error('Another player is already sharing');
    if (!this.supported) throw new Error('Screen capture is not supported');

    this.busy = true;
    this.emit();

    let stream: MediaStream;
    try {
      stream = await navigator.mediaDevices.getDisplayMedia({
        video: { frameRate: { ideal: 12, max: 15 }, width: { max: 1280 } },
        audio: false,
      });
    } catch (err) {
      this.busy = false;
      this.emit();
      throw err;
    }

    this.localStream = stream;
    this.localName = name;
    this.busy = false;
    this.sharing = true;
    this.shareId = `${this.peerId}_${Date.now()}`;

    const track = stream.getVideoTracks()[0];
    if (track) {
      try {
        track.contentHint = 'detail';
      } catch {
        // contentHint is a hint only.
      }
      track.onended = () => this.stop();
    }

    this.emit();
    this.publish({
      t: 'screen',
      action: 'start',
      shareId: this.shareId,
      name,
    });

    for (const peerId of peerIds) {
      if (peerId && peerId !== this.peerId) void this.createOffer(peerId);
    }
  }

  public stop(announce = true): void {
    const wasSharing = this.sharing;
    const stoppedShareId = this.shareId;

    this.sharing = false;
    this.busy = false;
    this.localStream?.getTracks().forEach((track) => {
      track.onended = null;
      track.stop();
    });
    this.localStream = null;
    this.localName = '';
    for (const id of [...this.pcs.keys()]) this.closePeer(id);
    this.pcs.clear();
    this.sharerIce.clear();
    this.shareId = '';

    if (wasSharing && announce) {
      this.publish({ t: 'screen', action: 'stop', shareId: stoppedShareId });
    }
    this.emit();
  }

  public reset(announce = true): void {
    this.stop(announce);
    this.closeViewer();
  }

  public dropPeer(peerId: string): void {
    this.closePeer(peerId);
    if (peerId === this.remotePeerId) this.closeViewer();
  }

  public addPeer(peerId: string): void {
    if (!this.sharing || !this.localStream || !peerId || peerId === this.peerId) return;
    if (this.pcs.has(peerId)) return;
    void this.createOffer(peerId);
  }

  public handleEvent(evt: NetScreenEvent, senderId: string): void {
    if (!senderId || senderId === this.peerId || !evt.shareId) return;

    if (evt.action === 'start') {
      if (this.sharing) return;
      if (evt.shareId === this.remoteShareId) return;
      this.closeViewer();
      this.remoteShareId = evt.shareId;
      this.remotePeerId = senderId;
      this.remoteName = evt.name || '玩家';
      this.onRemoteStarted?.(senderId, this.remoteName);
      return;
    }

    if (evt.action === 'stop') {
      if (evt.shareId !== this.remoteShareId && senderId !== this.remotePeerId) return;
      this.closeViewer();
      return;
    }

    if (evt.action === 'offer') {
      if (evt.to !== this.peerId || !evt.sdp || this.sharing) return;
      if (evt.shareId !== this.remoteShareId) {
        this.closeViewer();
        this.remoteShareId = evt.shareId;
        this.remotePeerId = senderId;
        this.remoteName = evt.name || '玩家';
        this.onRemoteStarted?.(senderId, this.remoteName);
      }
      void this.onOffer(senderId, evt.sdp);
      return;
    }

    if (evt.action === 'answer') {
      if (evt.to !== this.peerId || !evt.sdp) return;
      void this.onAnswer(senderId, evt.sdp);
      return;
    }

    if (evt.action === 'candidate' && evt.candidate && evt.to === this.peerId) {
      void this.onCandidate(senderId, evt.candidate);
    }
  }

  private async createOffer(viewerId: string): Promise<void> {
    if (!this.sharing || !this.localStream || this.pcs.has(viewerId)) return;

    const track = this.localStream.getVideoTracks()[0];
    if (!track) return;

    const pc = new RTCPeerConnection({ iceServers: this.getIceServers() });
    pc.addTrack(track, this.localStream);
    pc.onicecandidate = (e) => {
      if (e.candidate) {
        this.publish({
          t: 'screen',
          action: 'candidate',
          shareId: this.shareId,
          to: viewerId,
          candidate: e.candidate.toJSON(),
        });
      }
    };
    pc.onconnectionstatechange = () => {
      if (pc.connectionState === 'failed') this.closePeer(viewerId);
    };
    this.pcs.set(viewerId, pc);

    try {
      const offer = await pc.createOffer();
      await pc.setLocalDescription(offer);
      this.publish({
        t: 'screen',
        action: 'offer',
        shareId: this.shareId,
        to: viewerId,
        name: this.localName,
        sdp: offer.sdp || '',
      });
    } catch {
      this.closePeer(viewerId);
    }
  }

  private async onOffer(sharerId: string, sdp: string): Promise<void> {
    if (!this.viewerPc) {
      const pc = new RTCPeerConnection({ iceServers: this.getIceServers() });
      pc.onicecandidate = (e) => {
        if (e.candidate) {
          this.publish({
            t: 'screen',
            action: 'candidate',
            shareId: this.remoteShareId,
            to: sharerId,
            candidate: e.candidate.toJSON(),
          });
        }
      };
      pc.ontrack = (e) => {
        const stream = e.streams[0];
        if (stream) this.onRemoteStream?.(sharerId, stream);
      };
      pc.onconnectionstatechange = () => {
        if (pc.connectionState === 'failed') this.closeViewer();
      };
      this.viewerPc = pc;
    }

    try {
      await this.viewerPc.setRemoteDescription({ type: 'offer', sdp });
      await this.flushViewerIce(this.viewerPc);
      const answer = await this.viewerPc.createAnswer();
      await this.viewerPc.setLocalDescription(answer);
      this.publish({
        t: 'screen',
        action: 'answer',
        shareId: this.remoteShareId,
        to: sharerId,
        sdp: answer.sdp || '',
      });
    } catch {
      this.closeViewer();
    }
  }

  private async onAnswer(viewerId: string, sdp: string): Promise<void> {
    const pc = this.pcs.get(viewerId);
    if (!pc) return;
    try {
      await pc.setRemoteDescription({ type: 'answer', sdp });
      await this.flushSharerIce(viewerId, pc);
    } catch {
      this.closePeer(viewerId);
    }
  }

  private async onCandidate(fromId: string, candidate: RTCIceCandidateInit): Promise<void> {
    if (!this.sharing && fromId === this.remotePeerId) {
      if (!this.viewerPc || !this.viewerPc.remoteDescription) {
        if (this.viewerIce.length < MAX_QUEUED_ICE) this.viewerIce.push(candidate);
        return;
      }
      try {
        await this.viewerPc.addIceCandidate(candidate);
      } catch {
        // Ignore stale candidates.
      }
      return;
    }

    const pc = this.pcs.get(fromId);
    if (!pc) return;
    if (!pc.remoteDescription) {
      const queue = this.sharerIce.get(fromId) || [];
      if (queue.length < MAX_QUEUED_ICE) queue.push(candidate);
      this.sharerIce.set(fromId, queue);
      return;
    }
    try {
      await pc.addIceCandidate(candidate);
    } catch {
      // Ignore stale candidates.
    }
  }

  private async flushViewerIce(pc: RTCPeerConnection): Promise<void> {
    const queue = this.viewerIce;
    this.viewerIce = [];
    for (const candidate of queue) {
      try {
        await pc.addIceCandidate(candidate);
      } catch {
        // Ignore stale candidates.
      }
    }
  }

  private async flushSharerIce(viewerId: string, pc: RTCPeerConnection): Promise<void> {
    const queue = this.sharerIce.get(viewerId);
    if (!queue) return;
    this.sharerIce.delete(viewerId);
    for (const candidate of queue) {
      try {
        await pc.addIceCandidate(candidate);
      } catch {
        // Ignore stale candidates.
      }
    }
  }

  private closePeer(viewerId: string): void {
    const pc = this.pcs.get(viewerId);
    if (pc) {
      pc.onicecandidate = null;
      pc.onconnectionstatechange = null;
      pc.close();
      this.pcs.delete(viewerId);
    }
    this.sharerIce.delete(viewerId);
  }

  private closeViewer(): void {
    const hadShare = Boolean(this.viewerPc || this.remoteShareId);
    const pc = this.viewerPc;
    if (pc) {
      pc.onicecandidate = null;
      pc.ontrack = null;
      pc.onconnectionstatechange = null;
      pc.close();
      this.viewerPc = null;
    }
    this.viewerIce = [];
    this.remoteShareId = '';
    this.remotePeerId = '';
    this.remoteName = '';
    if (hadShare) this.onRemoteStopped?.();
  }

  private emit(): void {
    this.onStatusChange?.(this.sharing);
  }
}
