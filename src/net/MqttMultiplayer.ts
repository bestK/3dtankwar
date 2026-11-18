import mqtt, { MqttClient } from 'mqtt';
import {
  NetRoomEvent,
  NetTankSnapshot,
  PeerPresence,
  PublicRoomBeacon,
  SQUAD_COLORS,
} from '../types';

const TOPIC_PREFIX = 'agy3dtank/v1';

export interface MultiplayerCallbacks {
  onConnectionChange: (status: 'connecting' | 'online' | 'offline', brokerUrl: string, pingMs: number | null) => void;
  onRosterChange: (peers: PeerPresence[], hostId: string | null) => void;
  onPublicRoomsChange: (rooms: PublicRoomBeacon[]) => void;
  onRemoteState: (peerId: string, snap: NetTankSnapshot) => void;
  onRoomEvent: (evt: NetRoomEvent, senderId: string) => void;
  onPeerJoinedLate?: (newPeerId: string) => void;
}

export class MqttMultiplayer {
  public readonly peerId: string;
  public readonly joinedAt: number;
  public callsign: string;
  public mod = 'default';
  public fingerprint = '';
  public roomId = '1985';
  public mode: 'pvp' | 'coop' = 'pvp';
  public brokerUrl = 'wss://broker.emqx.io:8084/mqtt';
  public status: 'connecting' | 'online' | 'offline' = 'connecting';
  public pingMs: number | null = null;

  private client: MqttClient | null = null;
  private peers = new Map<string, PeerPresence>();
  private publicRooms = new Map<string, PublicRoomBeacon>();
  private subscribedRoom: string | null = null;
  private blockedPeers = new Set<string>();
  private bannedFingerprints = new Map<string, number>();

  private seq = 0;
  private myKills = 0;
  private myScore = 0;
  private heartbeatTimer: number | null = null;
  private pingSentAt = 0;

  constructor(private cb: MultiplayerCallbacks) {
    this.peerId = 'p_' + Math.random().toString(36).slice(2, 9);
    this.joinedAt = Date.now();
    const savedName = localStorage.getItem('agy_tank_callsign');
    this.callsign = savedName || `装甲-${Math.floor(10 + Math.random() * 89)}`;

    this.connect(this.brokerUrl);
    this.heartbeatTimer = window.setInterval(() => this.tickMaintenance(), 1400);
  }

  public setCallsign(name: string): void {
    const trimmed = name.trim().slice(0, 10) || this.callsign;
    this.callsign = trimmed;
    localStorage.setItem('agy_tank_callsign', trimmed);
    this.publishPresence();
  }

  public setMod(selection: string): void {
    this.mod = selection || 'default';
    this.publishPresence();
  }

  public setFingerprint(fp: string): void {
    this.fingerprint = fp || '';
    this.publishPresence();
  }

  public banFingerprint(fp: string, until: number): void {
    if (!fp) return;
    const previous = this.bannedFingerprints.get(fp) ?? 0;
    if (until > previous) this.bannedFingerprints.set(fp, until);
    for (const peer of [...this.peers.values()]) {
      if (peer.fp === fp) this.blockPeer(peer.peerId);
    }
  }

  private isFingerprintBanned(fp?: string): boolean {
    if (!fp) return false;
    const until = this.bannedFingerprints.get(fp);
    if (!until) return false;
    if (Date.now() >= until) {
      this.bannedFingerprints.delete(fp);
      return false;
    }
    return true;
  }

  public setLocalStats(kills: number, score: number): void {
    this.myKills = kills;
    this.myScore = score;
  }

  public connect(rawUrl: string): void {
    let url = rawUrl.trim();
    if (window.location.protocol === 'https:' && url.startsWith('ws://')) {
      url = url.replace('ws://', 'wss://').replace(':8083', ':8084');
    }
    this.brokerUrl = url;
    this.status = 'connecting';
    this.cb.onConnectionChange('connecting', this.brokerUrl, this.pingMs);

    if (this.client) {
      try {
        this.client.end(true);
      } catch {
        // ignore
      }
      this.client = null;
      this.subscribedRoom = null;
    }

    const client = mqtt.connect(this.brokerUrl, {
      clientId: `agy3dtank_${this.peerId}_${Math.floor(Math.random() * 999)}`,
      clean: true,
      keepalive: 20,
      reconnectPeriod: 3000,
      connectTimeout: 8000,
      will: {
        topic: `${TOPIC_PREFIX}/leave`,
        payload: JSON.stringify({ peerId: this.peerId, roomId: this.roomId }),
        qos: 0,
        retain: false,
      },
    });
    this.client = client;

    client.on('connect', () => {
      this.status = 'online';
      this.cb.onConnectionChange('online', this.brokerUrl, this.pingMs);

      client.subscribe(`${TOPIC_PREFIX}/lobby/+`, { qos: 0 });
      client.subscribe(`${TOPIC_PREFIX}/leave`, { qos: 0 });
      client.subscribe(`${TOPIC_PREFIX}/ping/${this.peerId}`, { qos: 0 });

      const targetRoom = this.roomId;
      this.subscribedRoom = null;
      this.joinRoom(targetRoom, this.mode);
      this.sendPing();
    });

    client.on('reconnect', () => {
      this.status = 'connecting';
      this.cb.onConnectionChange('connecting', this.brokerUrl, this.pingMs);
    });

    client.on('offline', () => {
      this.status = 'offline';
      this.cb.onConnectionChange('offline', this.brokerUrl, null);
    });

    client.on('error', () => {
      // Handled via reconnect/offline states
    });

    client.on('message', (topic, payload) => {
      this.handleMessage(topic, payload.toString());
    });
  }

  public joinRoom(rawRoomId: string, mode: 'pvp' | 'coop'): void {
    const clean = rawRoomId.replace(/[^a-zA-Z0-9_-]/g, '').slice(0, 8) || '1985';
    if (this.roomId !== clean) this.blockedPeers.clear();
    if (this.subscribedRoom && this.subscribedRoom !== clean && this.client?.connected) {
      this.client.publish(
        `${TOPIC_PREFIX}/leave`,
        JSON.stringify({ peerId: this.peerId, roomId: this.subscribedRoom }),
      );
      this.client.unsubscribe(`${TOPIC_PREFIX}/r/${this.subscribedRoom}/#`);
    }

    this.roomId = clean;
    this.mode = mode;
    this.peers.clear();
    this.upsertSelfPresence();

    if (this.client?.connected && this.subscribedRoom !== clean) {
      this.subscribedRoom = clean;
      this.client.subscribe(`${TOPIC_PREFIX}/r/${clean}/#`, { qos: 0 });
      this.publishHello();
    }
    this.publishPresence();
    this.emitRoster();
  }

  public getPeersSorted(): PeerPresence[] {
    this.upsertSelfPresence();
    const list = Array.from(this.peers.values()).sort((a, b) => {
      if (a.joinedAt !== b.joinedAt) return a.joinedAt - b.joinedAt;
      return a.peerId.localeCompare(b.peerId);
    });
    list.forEach((p, idx) => {
      p.slot = idx % 4;
      p.color = SQUAD_COLORS[p.slot];
    });
    return list;
  }

  public getHostId(): string {
    const sorted = this.getPeersSorted();
    return sorted[0]?.peerId || this.peerId;
  }

  public isHost(): boolean {
    return this.getHostId() === this.peerId;
  }

  public getMySlot(): number {
    const sorted = this.getPeersSorted();
    const me = sorted.find((p) => p.peerId === this.peerId);
    return me ? me.slot : 0;
  }

  public blockPeer(peerId: string): void {
    if (!peerId || peerId === this.peerId) return;
    this.blockedPeers.add(peerId);
    this.peers.delete(peerId);
    this.emitRoster();
  }

  public leaveRoom(): void {
    if (this.subscribedRoom && this.client?.connected) {
      this.client.publish(
        `${TOPIC_PREFIX}/leave`,
        JSON.stringify({ peerId: this.peerId, roomId: this.subscribedRoom }),
      );
      this.client.unsubscribe(`${TOPIC_PREFIX}/r/${this.subscribedRoom}/#`);
    }
    this.subscribedRoom = null;
    this.roomId = 'x' + Math.random().toString(36).slice(2, 8);
    this.peers.clear();
    this.emitRoster();
  }

  public publishTankState(snap: NetTankSnapshot): void {
    if (!this.client?.connected) return;
    this.seq++;
    const compact = [
      this.seq,
      snap.x,
      snap.z,
      snap.vx,
      snap.vz,
      snap.hull,
      snap.turret,
      snap.hp,
      snap.maxHp,
      snap.shield,
      snap.charge,
      snap.stars,
      snap.alive,
      snap.kills,
      snap.score,
    ];
    this.client.publish(
      `${TOPIC_PREFIX}/r/${this.roomId}/st/${this.peerId}`,
      JSON.stringify(compact),
      { qos: 0 },
    );
  }

  public publishEvent(evt: NetRoomEvent, reliable = false): void {
    if (!this.client?.connected) return;
    this.client.publish(
      `${TOPIC_PREFIX}/r/${this.roomId}/ev`,
      JSON.stringify({ s: this.peerId, e: evt }),
      { qos: reliable ? 1 : 0 },
    );
  }

  public getPublicRooms(): PublicRoomBeacon[] {
    const now = Date.now();
    const out: PublicRoomBeacon[] = [];
    for (const [id, b] of this.publicRooms.entries()) {
      if (now - b.updatedAt > 9000) {
        this.publicRooms.delete(id);
      } else {
        out.push(b);
      }
    }
    return out.sort((a, b) => b.count - a.count);
  }

  private upsertSelfPresence(): void {
    const prev = this.peers.get(this.peerId);
    this.peers.set(this.peerId, {
      peerId: this.peerId,
      name: this.callsign,
      joinedAt: this.joinedAt,
      slot: prev?.slot ?? 0,
      color: prev?.color ?? SQUAD_COLORS[0],
      mode: this.mode,
      kills: this.myKills,
      score: this.myScore,
      lastSeen: Date.now(),
      mod: this.mod,
      fp: this.fingerprint,
    });
  }

  private publishHello(): void {
    if (!this.client?.connected) return;
    this.client.publish(
      `${TOPIC_PREFIX}/r/${this.roomId}/hello`,
      JSON.stringify({ peerId: this.peerId }),
      { qos: 0 },
    );
  }

  private publishPresence(): void {
    this.upsertSelfPresence();
    if (!this.client?.connected) return;
    const payload = {
      peerId: this.peerId,
      name: this.callsign,
      joinedAt: this.joinedAt,
      mode: this.mode,
      kills: this.myKills,
      score: this.myScore,
      mod: this.mod,
      fp: this.fingerprint,
    };
    this.client.publish(
      `${TOPIC_PREFIX}/r/${this.roomId}/pres/${this.peerId}`,
      JSON.stringify(payload),
      { qos: 0 },
    );
  }

  private sendPing(): void {
    if (!this.client?.connected) return;
    this.pingSentAt = performance.now();
    this.client.publish(`${TOPIC_PREFIX}/ping/${this.peerId}`, String(this.pingSentAt), {
      qos: 0,
    });
  }

  private tickMaintenance(): void {
    const now = Date.now();
    let changed = false;

    for (const [id, peer] of this.peers.entries()) {
      if (id !== this.peerId && now - peer.lastSeen > 5200) {
        this.peers.delete(id);
        changed = true;
      }
    }

    this.publishPresence();
    this.sendPing();

    // Broadcast lobby room beacon if we are Host
    if (this.client?.connected && this.isHost()) {
      const sorted = this.getPeersSorted();
      const beacon: PublicRoomBeacon = {
        roomId: this.roomId,
        mode: this.mode,
        hostName: this.callsign,
        count: sorted.length,
        updatedAt: now,
      };
      this.client.publish(`${TOPIC_PREFIX}/lobby/${this.roomId}`, JSON.stringify(beacon), {
        qos: 0,
      });
    }

    if (changed) this.emitRoster();
    this.cb.onPublicRoomsChange(this.getPublicRooms());
  }

  private emitRoster(): void {
    const sorted = this.getPeersSorted();
    this.cb.onRosterChange(sorted, sorted[0]?.peerId ?? this.peerId);
  }

  private handleMessage(topic: string, raw: string): void {
    try {
      if (topic === `${TOPIC_PREFIX}/ping/${this.peerId}`) {
        const sent = Number(raw);
        if (!Number.isNaN(sent)) {
          this.pingMs = Math.max(1, Math.round(performance.now() - sent));
          this.cb.onConnectionChange('online', this.brokerUrl, this.pingMs);
        }
        return;
      }

      if (topic.startsWith(`${TOPIC_PREFIX}/lobby/`)) {
        const data = JSON.parse(raw) as PublicRoomBeacon;
        if (data && data.roomId) {
          data.updatedAt = Date.now();
          this.publicRooms.set(data.roomId, data);
          this.cb.onPublicRoomsChange(this.getPublicRooms());
        }
        return;
      }

      if (topic === `${TOPIC_PREFIX}/leave`) {
        const { peerId, roomId } = JSON.parse(raw) as { peerId: string; roomId: string };
        if (roomId === this.roomId && peerId !== this.peerId && this.peers.delete(peerId)) {
          this.emitRoster();
        }
        return;
      }

      const roomBase = `${TOPIC_PREFIX}/r/${this.roomId}/`;
      if (!topic.startsWith(roomBase)) return;
      const sub = topic.slice(roomBase.length);

      if (sub === 'hello') {
        const { peerId } = JSON.parse(raw) as { peerId: string };
        if (peerId && peerId !== this.peerId && !this.blockedPeers.has(peerId)) {
          this.publishPresence();
          if (this.isHost()) {
            this.cb.onPeerJoinedLate?.(peerId);
          }
        }
        return;
      }

      if (sub.startsWith('pres/')) {
        const p = JSON.parse(raw) as Omit<PeerPresence, 'slot' | 'color' | 'lastSeen'>;
        if (!p.peerId || p.peerId === this.peerId || this.blockedPeers.has(p.peerId)) return;
        if (this.isFingerprintBanned(p.fp)) {
          if (this.peers.has(p.peerId)) this.blockPeer(p.peerId);
          return;
        }
        const isNew = !this.peers.has(p.peerId);
        this.peers.set(p.peerId, {
          peerId: p.peerId,
          name: p.name || '装甲兵',
          joinedAt: p.joinedAt || Date.now(),
          slot: 0,
          color: SQUAD_COLORS[0],
          mode: p.mode || 'pvp',
          kills: p.kills || 0,
          score: p.score || 0,
          lastSeen: Date.now(),
          mod: p.mod || 'default',
          fp: p.fp || '',
        });
        if (isNew) {
          this.emitRoster();
        } else {
          this.emitRoster();
        }
        return;
      }

      if (sub.startsWith('st/')) {
        const senderId = sub.slice(3);
        if (senderId === this.peerId || this.blockedPeers.has(senderId)) return;
        const peer = this.peers.get(senderId);
        if (!peer || this.isFingerprintBanned(peer.fp)) return;
        const arr = JSON.parse(raw) as number[];
        if (!Array.isArray(arr) || arr.length < 15) return;
        peer.lastSeen = Date.now();
        this.cb.onRemoteState(senderId, {
          seq: arr[0],
          x: arr[1],
          z: arr[2],
          vx: arr[3],
          vz: arr[4],
          hull: arr[5],
          turret: arr[6],
          hp: arr[7],
          maxHp: arr[8],
          shield: arr[9],
          charge: arr[10],
          stars: arr[11],
          alive: arr[12],
          kills: arr[13],
          score: arr[14],
        });
        return;
      }

      if (sub === 'ev') {
        const { s, e } = JSON.parse(raw) as { s: string; e: NetRoomEvent };
        if (s === this.peerId || this.blockedPeers.has(s)) return;
        const peer = this.peers.get(s);
        if (e.t !== 'start' && (!peer || this.isFingerprintBanned(peer.fp))) return;
        this.cb.onRoomEvent(e, s);
      }
    } catch {
      // Ignore malformed external broker payloads
    }
  }

  public dispose(): void {
    if (this.heartbeatTimer !== null) clearInterval(this.heartbeatTimer);
    this.client?.end(true);
  }
}
