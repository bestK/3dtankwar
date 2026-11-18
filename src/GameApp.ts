import * as THREE from 'three';
import { AudioSynth } from './engine/AudioSynth';
import { CameraRig } from './engine/CameraRig';
import { PostPipeline } from './engine/PostPipeline';
import { createProceduralTextures, TextureBundle } from './engine/ProceduralTextures';
import { PowerUpItem } from './entities/PowerUp';
import { BallisticSight, createProjectileMesh, ProjectileData } from './entities/Projectile';
import { Tank } from './entities/Tank';
import { loadVehicleMod, parseMod } from './mod/ModCatalog';
import { MqttMultiplayer } from './net/MqttMultiplayer';
import { VoiceChat } from './net/VoiceChat';
import {
  CameraPreset,
  ENEMY_COLORS,
  EnemyArchetype,
  GameMode,
  GRID_SIZE,
  HALF_BOARD,
  NetRoomEvent,
  NetTankSnapshot,
  PeerPresence,
  PowerUpKind,
  PublicRoomBeacon,
  SQUAD_COLORS,
  TileType,
} from './types';
import { VfxSystem } from './vfx/VfxSystem';
import { DioramaWorld } from './world/DioramaWorld';
import {
  buildCampaignGrid,
  buildPvpGrid,
  createEmptyGrid,
  decodeGrid,
  encodeGrid,
  stampEagleFortress,
} from './world/Stages';

export interface HudSnapshot {
  mode: GameMode;
  stageIndex: number;
  enemyWaveLeft: number;
  hp: number;
  maxHp: number;
  lives: number;
  stars: number;
  score: number;
  chargeRatio: number;
  slowMo: boolean;
  cameraPreset: CameraPreset;
}

export interface VoteUiState {
  voteId: string;
  targetName: string;
  yes: number;
  no: number;
  required: number;
  until: number;
  voted: boolean;
  isInitiator: boolean;
}

export interface GameUiBridge {
  onHudUpdate: (hud: HudSnapshot) => void;
  onNetStatus: (status: 'connecting' | 'online' | 'offline', url: string, ping: number | null) => void;
  onRosterUpdate: (peers: PeerPresence[], hostId: string | null) => void;
  onPublicRooms: (rooms: PublicRoomBeacon[]) => void;
  onToast: (msg: string) => void;
  onMatchEnd: (victory: boolean, title: string, statsText: string, canNextStage: boolean) => void;
  onOnlineMatchStarted: (mode: 'pvp' | 'coop') => void;
  onChatMessage: (name: string, text: string, self: boolean) => void;
  onKicked: (msg: string, banUntil?: number) => void;
  onVoteUpdate: (state: VoteUiState | null) => void;
  onFingerprintBan: (fp: string, until: number) => void;
}

interface ActiveVoteState {
  id: string;
  targetId: string;
  targetName: string;
  targetFp: string;
  initiatorId: string;
  until: number;
  yes: Set<string>;
  no: Set<string>;
  required: number;
  resolved: boolean;
  passed: boolean;
  timer: number;
}

const PVP_SPAWNS: Array<[number, number, number]> = [
  [-10.5, 10.5, Math.PI],
  [10.5, -10.5, 0],
  [-10.5, -10.5, 0],
  [10.5, 10.5, Math.PI],
];

const COOP_SPAWNS: Array<[number, number, number]> = [
  [-4.0, 11.5, Math.PI],
  [4.0, 11.5, Math.PI],
  [-8.0, 11.5, Math.PI],
  [8.0, 11.5, Math.PI],
];

const ENEMY_TOP_SPAWNS: Array<[number, number]> = [
  [-12.0, -12.0],
  [0.0, -12.0],
  [12.0, -12.0],
];

export class GameApp {
  public readonly renderer: THREE.WebGLRenderer;
  public readonly scene: THREE.Scene;
  public readonly cameraRig: CameraRig;
  public readonly post: PostPipeline;
  public readonly textures: TextureBundle;
  public readonly world: DioramaWorld;
  public readonly vfx: VfxSystem;
  public readonly audio = new AudioSynth();
  public readonly net: MqttMultiplayer;
  public readonly voice: VoiceChat;

  public mode: GameMode = 'demo';
  public stageIndex = 0;
  public pvpMapIndex = 0;
  public workshopBrush: TileType = TileType.BRICK;
  public slowMo = false;
  public turretKeyTurnSpeed = 2.6; // rad/s for keyboard turret aiming
  public playerMod = 'default';
  public matchEnded = false;

  private customWorkshopGrid: Uint8Array | null = null;
  private localPlayer: Tank | null = null;
  private remotePlayers = new Map<string, Tank>();
  private aiTanks: Tank[] = [];
  private projectiles: ProjectileData[] = [];
  private powerUps: PowerUpItem[] = [];
  private sight = new BallisticSight();

  private playerLives = 3;
  private enemyQueue: EnemyArchetype[] = [];
  private enemySpawnTimer = 1.0;
  private freezeTimer = 0;
  private fortressTimer = 0;
  private pvpPowerUpTimer = 8.0;
  private respawnTimer = 0;

  private keys = new Set<string>();
  private mouseNdc = new THREE.Vector2(0, 0);
  private aimWorldPoint = new THREE.Vector3(0, 0, 0);
  private hasMouseMoved = false;
  private lastPointerX = -1;
  private lastPointerY = -1;
  private aimMode: 'mouse' | 'keyboard' = 'mouse';
  private keyboardAimAngle = 0;
  private isLeftMouseDown = false;
  private isSpaceDown = false;
  private isPaintingWorkshop = false;
  private chargeHoldSec = 0;
  private cheatBuffer = '';
  private cheatActive = false;
  private cheatCooldown = 0;
  private activeVote: ActiveVoteState | null = null;

  private raycaster = new THREE.Raycaster();
  private groundPlane = new THREE.Plane(new THREE.Vector3(0, 1, 0), -0.5);
  private floorPlane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);

  private clock = new THREE.Clock();
  private elapsed = 0;
  private netSyncAccum = 0;
  private aiSyncAccum = 0;
  private shockPulse = 0;

  constructor(private container: HTMLElement, private ui: GameUiBridge) {
    const w = window.innerWidth;
    const h = window.innerHeight;

    this.renderer = new THREE.WebGLRenderer({
      antialias: false,
      powerPreference: 'high-performance',
    });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.setSize(w, h);
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.06;
    this.container.appendChild(this.renderer.domElement);

    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color(0x0b0f16);
    this.scene.fog = new THREE.FogExp2(0x0b0f16, 0.0115);

    this.textures = createProceduralTextures(this.renderer);
    this.scene.environment = this.textures.envMap;
    this.scene.environmentIntensity = 0.78;

    this.cameraRig = new CameraRig(w / h);
    this.setupLighting();

    this.world = new DioramaWorld(this.textures);
    this.scene.add(this.world.group);

    this.vfx = new VfxSystem(this.textures);
    this.scene.add(this.vfx.group);

    this.sight.group.visible = false;
    this.scene.add(this.sight.group);

    this.post = new PostPipeline(this.renderer, this.scene, this.cameraRig.camera, w, h);

    this.net = new MqttMultiplayer({
      onConnectionChange: (st, url, ping) => {
        this.ui.onNetStatus(st, url, ping);
        if (st === 'online') this.voice?.refresh();
      },
      onRosterChange: (peers, hostId) => {
        this.syncRemoteRoster(peers);
        this.ui.onRosterUpdate(peers, hostId);
      },
      onPublicRoomsChange: (rooms) => this.ui.onPublicRooms(rooms),
      onRemoteState: (peerId, snap) => this.handleRemoteTankState(peerId, snap),
      onRoomEvent: (evt, senderId) => this.handleRoomEvent(evt, senderId),
      onPeerJoinedLate: () => {
        if ((this.mode === 'pvp' || this.mode === 'coop') && this.net.isHost()) {
          this.net.publishEvent(
            {
              t: 'start',
              mode: this.mode,
              mapIndex: this.mode === 'pvp' ? this.pvpMapIndex : this.stageIndex,
              gridHex: encodeGrid(this.world.grid),
              seed: Date.now(),
            },
            true,
          );
        }
      },
    });

    this.voice = new VoiceChat(this.net.peerId, (evt) =>
      this.net.publishEvent(evt, evt.action === 'signal'),
    );

    this.bindInputs();
    this.startHeroDemo();
    this.animate();
  }

  private setupLighting(): void {
    const hemi = new THREE.HemisphereLight(0x6d90ba, 0x261d17, 0.85);
    this.scene.add(hemi);

    const keyLight = new THREE.DirectionalLight(0xffe6c2, 2.55);
    keyLight.position.set(16, 26, 14);
    keyLight.castShadow = true;
    keyLight.shadow.mapSize.set(2048, 2048);
    keyLight.shadow.camera.near = 4;
    keyLight.shadow.camera.far = 68;
    const d = 18.5;
    keyLight.shadow.camera.left = -d;
    keyLight.shadow.camera.right = d;
    keyLight.shadow.camera.top = d;
    keyLight.shadow.camera.bottom = -d;
    keyLight.shadow.bias = -0.0005;
    this.scene.add(keyLight);

    const rimLight = new THREE.DirectionalLight(0x63a4ff, 1.15);
    rimLight.position.set(-19, 15, -16);
    this.scene.add(rimLight);
  }

  private bindInputs(): void {
    this.cameraRig.attachDomEvents(
      this.renderer.domElement,
      () => this.mode === 'demo' || this.cameraRig.preset === 'orbit',
    );

    window.addEventListener('resize', () => {
      const w = window.innerWidth;
      const h = window.innerHeight;
      this.cameraRig.resize(w / h);
      this.renderer.setSize(w, h);
      this.post.resize(w, h);
    });

    window.addEventListener('keydown', (e) => {
      if ((e.target as HTMLElement)?.tagName === 'INPUT') return;
      this.keys.add(e.code);

      // Cheat code: type "woshinidie" (我是你爹) during combat
      const typedLetter = /^Key[A-Z]$/.test(e.code) ? e.code.slice(3).toLowerCase() : '';
      if (
        typedLetter &&
        this.isCombatMode() &&
        !this.matchEnded &&
        !e.repeat &&
        !e.ctrlKey &&
        !e.altKey &&
        !e.metaKey
      ) {
        this.cheatBuffer = (this.cheatBuffer + typedLetter).slice(-16);
        if (!this.cheatActive && this.cheatBuffer.endsWith('woshinidie')) {
          this.activateCheat();
        }
      }

      if (e.code === 'Tab') {
        e.preventDefault();
        this.toggleSlowMo();
      } else if (e.code === 'KeyC') {
        this.cycleCameraPreset();
      } else if (e.code === 'Space' && this.isCombatMode()) {
        e.preventDefault();
        if (!e.repeat && this.cameraRig.preset !== 'orbit') {
          if (this.cheatActive) {
            this.fireCheatBarrage();
          } else {
            this.isSpaceDown = true;
          }
        }
      } else if (
        this.isCombatMode() &&
        (e.code === 'ArrowLeft' ||
          e.code === 'ArrowRight' ||
          e.code === 'KeyQ' ||
          e.code === 'KeyE')
      ) {
        e.preventDefault();
        if (this.aimMode !== 'keyboard' && this.localPlayer) {
          this.keyboardAimAngle = this.localPlayer.turretAngle;
        }
        this.aimMode = 'keyboard';
      }
    });

    window.addEventListener('keyup', (e) => {
      this.keys.delete(e.code);
      if (e.code === 'Space' && this.isSpaceDown) {
        this.isSpaceDown = false;
        if (this.isCombatMode() && this.cameraRig.preset !== 'orbit') {
          this.tryFireLocal(this.chargeHoldSec >= 0.52);
        }
        this.chargeHoldSec = 0;
        if (this.localPlayer) this.localPlayer.chargeRatio = 0;
      }
    });

    this.renderer.domElement.addEventListener('pointermove', (e) => {
      this.mouseNdc.x = (e.clientX / window.innerWidth) * 2 - 1;
      this.mouseNdc.y = -(e.clientY / window.innerHeight) * 2 + 1;
      this.hasMouseMoved = true;
      const pointerTravel = Math.hypot(e.clientX - this.lastPointerX, e.clientY - this.lastPointerY);
      this.lastPointerX = e.clientX;
      this.lastPointerY = e.clientY;
      if (this.isCombatMode() && pointerTravel > 4) this.aimMode = 'mouse';

      if (this.mode === 'workshop') {
        this.updateWorkshopCursor();
        if (this.isPaintingWorkshop) {
          this.paintAtWorkshopCursor(e.shiftKey);
        }
      }
    });

    this.renderer.domElement.addEventListener('pointerdown', (e) => {
      this.audio.unlock();
      this.mouseNdc.x = (e.clientX / window.innerWidth) * 2 - 1;
      this.mouseNdc.y = -(e.clientY / window.innerHeight) * 2 + 1;

      if (e.button === 0 && !e.altKey) {
        if (this.mode === 'workshop') {
          this.isPaintingWorkshop = true;
          this.updateWorkshopCursor();
          this.paintAtWorkshopCursor(e.shiftKey);
        } else if (this.isCombatMode() && this.cameraRig.preset !== 'orbit') {
          this.aimMode = 'mouse';
          this.hasMouseMoved = true;
          this.isLeftMouseDown = true;
          this.chargeHoldSec = 0;
        }
      }
    });

    window.addEventListener('pointerup', (e) => {
      if (e.button === 0) {
        this.isPaintingWorkshop = false;
        if (this.isLeftMouseDown) {
          this.isLeftMouseDown = false;
          const heavy = this.chargeHoldSec >= 0.52;
          this.tryFireLocal(heavy);
          this.chargeHoldSec = 0;
          if (this.localPlayer) this.localPlayer.chargeRatio = 0;
        }
      }
    });
  }

  public isCombatMode(): boolean {
    return this.mode === 'campaign' || this.mode === 'pvp' || this.mode === 'coop';
  }

  public setPlayerMod(selection: string): void {
    this.playerMod = selection;
    this.net.setMod(selection);
    if (this.localPlayer) this.applyModToTank(this.localPlayer, selection);
  }

  private applyModToTank(tank: Tank, selection: string): void {
    tank.modSelection = selection;
    const { mod, flip } = parseMod(selection);
    if (!mod) {
      tank.setModModel(null);
      return;
    }
    const yaw = (mod.yaw ?? 0) + (flip ? Math.PI : 0);
    void loadVehicleMod(selection).then((scene) => {
      if (scene && tank.modSelection === selection) {
        tank.setModModel(scene.clone(true), yaw);
      }
    });
  }

  public startVoteKick(targetId: string): boolean {
    if (this.mode !== 'pvp' && this.mode !== 'coop' && this.mode !== 'demo') return false;
    if (!targetId || targetId === this.net.peerId) return false;
    if (this.activeVote && !this.activeVote.resolved) return false;

    const peers = this.net.getPeersSorted();
    const target = peers.find((p) => p.peerId === targetId);
    if (!target) return false;

    const eligible = peers.filter((p) => p.peerId !== targetId).length;
    const required = Math.max(1, Math.floor(eligible / 2) + 1);
    const vote: ActiveVoteState = {
      id: `${this.net.peerId}_${Date.now()}`,
      targetId,
      targetName: target.name || '玩家',
      targetFp: target.fp || '',
      initiatorId: this.net.peerId,
      until: Date.now() + 20000,
      yes: new Set([this.net.peerId]),
      no: new Set(),
      required,
      resolved: false,
      passed: false,
      timer: 0,
    };
    this.activeVote = vote;
    this.net.publishEvent(
      {
        t: 'vote',
        action: 'start',
        voteId: vote.id,
        target: targetId,
        initiator: this.net.peerId,
        until: vote.until,
        fp: vote.targetFp,
      },
      true,
    );
    this.ui.onToast(`已发起投票踢出 ${vote.targetName}`);
    this.beginVoteTimer(vote);
    this.evaluateVote(vote);
    return true;
  }

  public castVote(voteId: string, yes: boolean): void {
    const vote = this.activeVote;
    if (!vote || vote.id !== voteId || vote.resolved) return;
    if (vote.targetId === this.net.peerId) return;
    if (vote.yes.has(this.net.peerId) || vote.no.has(this.net.peerId)) return;

    (yes ? vote.yes : vote.no).add(this.net.peerId);
    this.net.publishEvent(
      {
        t: 'vote',
        action: 'cast',
        voteId,
        target: vote.targetId,
        voter: this.net.peerId,
        yes,
      },
      true,
    );
    this.evaluateVote(vote);
  }

  private handleVoteEvent(evt: Extract<NetRoomEvent, { t: 'vote' }>, senderId: string): void {
    const voteId = String(evt.voteId || '');
    const targetId = String(evt.target || '');
    if (!voteId || !targetId) return;

    if (evt.action === 'start') {
      if (this.activeVote && !this.activeVote.resolved) return;
      const peers = this.net.getPeersSorted();
      const target = peers.find((p) => p.peerId === targetId);
      if (!target && targetId !== this.net.peerId) return;

      const fallbackEligible = peers.filter((p) => p.peerId !== targetId).length;
      const vote: ActiveVoteState = {
        id: voteId,
        targetId,
        targetName: target?.name || '玩家',
        targetFp:
          targetId === this.net.peerId ? this.net.fingerprint : target?.fp || '',
        initiatorId: senderId,
        until: Date.now() + 20000,
        yes: new Set([senderId]),
        no: new Set(),
        required: Math.max(1, Math.floor(fallbackEligible / 2) + 1),
        resolved: false,
        passed: false,
        timer: 0,
      };
      this.activeVote = vote;
      if (targetId === this.net.peerId) {
        this.ui.onToast('有人发起了对你的投票踢出');
      }
      this.beginVoteTimer(vote);
      this.emitVoteUi(vote);
      this.evaluateVote(vote);
      return;
    }

    if (evt.action === 'cast') {
      const vote = this.activeVote;
      if (!vote || vote.id !== voteId || vote.resolved) return;
      if (senderId === vote.targetId) return;
      if (evt.yes) vote.yes.add(senderId);
      else vote.no.add(senderId);
      this.evaluateVote(vote);
      return;
    }

    if (evt.action === 'result') {
      const vote = this.activeVote;
      if (!vote || vote.id !== voteId) return;

      const knownPass = vote.yes.size >= vote.required;
      const knownFail = vote.no.size >= vote.required || Date.now() >= vote.until;
      if (evt.passed ? !knownPass : !knownFail) return;

      const banUntil = Date.now() + 10 * 60 * 1000;
      if (vote.resolved) {
        // A passed result wins a race against a local timeout.
        if (evt.passed && !vote.passed) {
          vote.passed = true;
          this.executeVoteKick(vote.targetId, vote.targetName, vote.targetFp, banUntil);
        }
        return;
      }

      vote.resolved = true;
      vote.passed = Boolean(evt.passed);
      clearInterval(vote.timer);
      if (this.activeVote === vote) this.activeVote = null;
      this.emitVoteUi(null);

      if (vote.passed) {
        this.executeVoteKick(vote.targetId, vote.targetName, vote.targetFp, banUntil);
      } else {
        this.ui.onToast(`投票未通过：${vote.targetName} 未被移出`);
      }
    }
  }

  private beginVoteTimer(vote: ActiveVoteState): void {
    if (vote.timer) clearInterval(vote.timer);
    vote.timer = window.setInterval(() => {
      if (!this.activeVote || this.activeVote.id !== vote.id || vote.resolved) {
        clearInterval(vote.timer);
        return;
      }
      this.evaluateVote(vote);
    }, 500);
  }

  private evaluateVote(vote: ActiveVoteState): void {
    if (vote.resolved) return;

    if (vote.yes.size >= vote.required) {
      this.resolveVote(vote, true);
      return;
    }
    if (vote.no.size >= vote.required) {
      this.resolveVote(vote, false);
      return;
    }
    if (Date.now() >= vote.until) {
      this.resolveVote(vote, false);
      return;
    }
    this.emitVoteUi(vote);
  }

  private resolveVote(vote: ActiveVoteState, passed: boolean): void {
    if (vote.resolved) return;
    vote.resolved = true;
    vote.passed = passed;
    clearInterval(vote.timer);
    if (this.activeVote === vote) this.activeVote = null;
    this.emitVoteUi(null);

    const banUntil = Date.now() + 10 * 60 * 1000;
    this.net.publishEvent(
      {
        t: 'vote',
        action: 'result',
        voteId: vote.id,
        target: vote.targetId,
        passed,
        fp: vote.targetFp,
        banUntil,
      },
      true,
    );

    if (passed) {
      this.executeVoteKick(vote.targetId, vote.targetName, vote.targetFp, banUntil);
    } else {
      this.ui.onToast(`投票未通过：${vote.targetName} 未被移出`);
    }
  }

  private executeVoteKick(
    targetId: string,
    targetName: string,
    fingerprint: string,
    banUntil: number,
  ): void {
    if (fingerprint) {
      this.net.banFingerprint(fingerprint, banUntil);
      this.ui.onFingerprintBan(fingerprint, banUntil);
    }

    if (targetId === this.net.peerId) {
      this.voice.disable();
      this.net.leaveRoom();
      this.ui.onKicked('你已被投票移出房间，10 分钟内无法进入', banUntil);
      return;
    }

    this.voice.dropPeer(targetId);
    this.net.blockPeer(targetId);
    this.ui.onToast(`${targetName} 已被投票移出`);
  }

  private emitVoteUi(vote: ActiveVoteState | null): void {
    if (!vote || vote.targetId === this.net.peerId) {
      this.ui.onVoteUpdate(null);
      return;
    }
    const me = this.net.peerId;
    this.ui.onVoteUpdate({
      voteId: vote.id,
      targetName: vote.targetName,
      yes: vote.yes.size,
      no: vote.no.size,
      required: vote.required,
      until: vote.until,
      voted: vote.yes.has(me) || vote.no.has(me),
      isInitiator: vote.initiatorId === me,
    });
  }

  private clearVote(): void {
    if (this.activeVote) clearInterval(this.activeVote.timer);
    this.activeVote = null;
    this.ui.onVoteUpdate(null);
  }

  public sendChat(raw: string, allowLobby = false): void {
    if ((!this.isCombatMode() || this.matchEnded) && !allowLobby) return;
    const text = raw
      .replace(/[\u0000-\u001f\u007f]/g, ' ')
      .trim()
      .slice(0, 120);
    if (!text) return;
    const name = (this.net.callsign || '装甲兵').slice(0, 12);
    this.ui.onChatMessage(name, text, true);
    if (this.mode === 'pvp' || this.mode === 'coop' || allowLobby) {
      this.net.publishEvent({ t: 'chat', name, text });
    }
  }

  public cycleCameraPreset(): CameraPreset {
    const order: CameraPreset[] = ['diorama', 'chase', 'orbit'];
    const next = order[(order.indexOf(this.cameraRig.preset) + 1) % order.length];
    this.cameraRig.setPreset(next);
    document.body.classList.toggle('mode-orbit', next === 'orbit');
    return next;
  }

  public toggleSlowMo(): boolean {
    this.slowMo = !this.slowMo;
    return this.slowMo;
  }

  private clearEntities(): void {
    if (this.localPlayer) {
      this.scene.remove(this.localPlayer.root);
      this.localPlayer = null;
    }
    for (const t of this.remotePlayers.values()) this.scene.remove(t.root);
    this.remotePlayers.clear();

    for (const t of this.aiTanks) this.scene.remove(t.root);
    this.aiTanks = [];

    for (const p of this.projectiles) this.scene.remove(p.mesh);
    this.projectiles = [];

    for (const pu of this.powerUps) this.scene.remove(pu.group);
    this.powerUps = [];

    this.vfx.clearDecals();
    this.sight.group.visible = false;
    this.matchEnded = false;
    this.freezeTimer = 0;
    this.fortressTimer = 0;
    this.aimMode = 'mouse';
    this.isLeftMouseDown = false;
    this.isSpaceDown = false;
    this.chargeHoldSec = 0;
    this.cheatBuffer = '';
    this.cheatActive = false;
    this.cheatCooldown = 0;
    this.clearVote();
  }

  /** Autonomous live 3D tank battle diorama behind the Hero UI */
  public startHeroDemo(): void {
    this.clearEntities();
    this.mode = 'demo';
    document.body.classList.add('mode-hero');
    document.body.classList.remove('in-combat', 'mode-orbit');

    this.world.loadGrid(buildCampaignGrid(0), true);
    this.cameraRig.setHeroPresentation();

    // 2 autonomous allied hero tanks + 4 enemy tanks skirmishing
    const hero1 = new Tank({ id: 'demo_h1', team: 'player', color: SQUAD_COLORS[0] }, this.textures);
    hero1.setPosition(-4, 11, Math.PI);
    hero1.aiDirAngle = Math.PI;
    this.scene.add(hero1.root);
    this.aiTanks.push(hero1);

    const hero2 = new Tank({ id: 'demo_h2', team: 'player', color: SQUAD_COLORS[1] }, this.textures);
    hero2.setPosition(4, 11, Math.PI);
    hero2.aiDirAngle = Math.PI;
    this.scene.add(hero2.root);
    this.aiTanks.push(hero2);

    const demoTypes: EnemyArchetype[] = ['scout', 'raider', 'twin', 'juggernaut'];
    for (let i = 0; i < 4; i++) {
      const arch = demoTypes[i];
      const e = new Tank(
        { id: `demo_e_${i}`, team: 'enemy', archetype: arch, color: ENEMY_COLORS[arch] },
        this.textures,
      );
      e.setPosition(-9 + i * 6, -11, 0);
      e.aiDirAngle = 0;
      this.scene.add(e.root);
      this.aiTanks.push(e);
    }
    this.world.updateRackCounts(12, 3);
  }

  public startCampaign(stageIdx: number, customGrid?: Uint8Array): void {
    this.clearEntities();
    this.mode = 'campaign';
    this.stageIndex = stageIdx;
    document.body.classList.remove('mode-hero', 'mode-orbit');
    document.body.classList.add('in-combat');

    const grid = customGrid ? new Uint8Array(customGrid) : buildCampaignGrid(stageIdx);
    this.world.loadGrid(grid, true);
    this.cameraRig.setPreset('diorama');

    this.playerLives = 3;
    this.localPlayer = new Tank(
      { id: this.net.peerId, team: 'player', color: SQUAD_COLORS[0] },
      this.textures,
    );
    this.localPlayer.respawn(-4.0, 11.5, Math.PI, 3.2);
    this.scene.add(this.localPlayer.root);
    this.applyModToTank(this.localPlayer, this.playerMod);
    this.sight.group.visible = true;

    this.buildWaveQueue(16 + stageIdx * 2);
    this.enemySpawnTimer = 0.6;
    this.audio.playStageFanfare();
    this.ui.onToast(`第 0${stageIdx + 1} 战区 · 守卫鹰徽核心`);
  }

  public enterWorkshop(): void {
    this.clearEntities();
    this.mode = 'workshop';
    document.body.classList.remove('mode-hero', 'in-combat');
    if (!this.customWorkshopGrid) {
      this.customWorkshopGrid = buildCampaignGrid(0);
    }
    this.world.loadGrid(this.customWorkshopGrid, true);
    this.world.brushCursor.visible = true;
    this.cameraRig.setPreset('diorama');
  }

  public resetWorkshopGrid(empty: boolean): void {
    this.customWorkshopGrid = empty ? createEmptyGrid() : buildCampaignGrid(0);
    if (empty) stampEagleFortress(this.customWorkshopGrid, TileType.BRICK);
    this.world.loadGrid(this.customWorkshopGrid, true);
  }

  public launchWorkshopTest(): void {
    this.world.brushCursor.visible = false;
    this.customWorkshopGrid = new Uint8Array(this.world.grid);
    this.startCampaign(0, this.customWorkshopGrid);
  }

  public hostStartOnlineMatch(mode: 'pvp' | 'coop', mapIndex: number): void {
    const grid = mode === 'pvp' ? buildPvpGrid(mapIndex) : buildCampaignGrid(mapIndex);
    const gridHex = encodeGrid(grid);
    this.net.publishEvent(
      {
        t: 'start',
        mode,
        mapIndex,
        gridHex,
        seed: Date.now(),
      },
      true,
    );
    this.beginOnlineSession(mode, mapIndex, grid);
  }

  private beginOnlineSession(mode: 'pvp' | 'coop', mapIndex: number, grid: Uint8Array): void {
    this.clearEntities();
    this.world.brushCursor.visible = false;
    this.mode = mode;
    if (mode === 'pvp') this.pvpMapIndex = mapIndex;
    else this.stageIndex = mapIndex;

    document.body.classList.remove('mode-hero', 'mode-orbit');
    document.body.classList.add('in-combat');

    this.world.loadGrid(grid, mode === 'coop');
    this.cameraRig.setPreset('diorama');

    const slot = this.net.getMySlot();
    const spawns = mode === 'pvp' ? PVP_SPAWNS : COOP_SPAWNS;
    const [sx, sz, sAngle] = spawns[slot % spawns.length];

    this.playerLives = mode === 'pvp' ? 99 : 4;
    this.localPlayer = new Tank(
      {
        id: this.net.peerId,
        team: 'player',
        color: SQUAD_COLORS[slot % 4],
        name: this.net.callsign,
      },
      this.textures,
    );
    this.localPlayer.respawn(sx, sz, sAngle, 3.0);
    this.scene.add(this.localPlayer.root);
    this.applyModToTank(this.localPlayer, this.playerMod);
    this.sight.group.visible = true;
    this.net.setLocalStats(0, 0);

    // Spawn current peers
    this.syncRemoteRoster(this.net.getPeersSorted());

    if (mode === 'coop') {
      this.buildWaveQueue(20);
      this.enemySpawnTimer = 1.0;
    } else if (this.net.getPeersSorted().length === 1) {
      // Solo waiting in PvP room: add 2 AI sparring challengers that clear automatically when a human joins!
      this.spawnPvpSparringBots();
    }

    this.audio.playStageFanfare();
    this.ui.onOnlineMatchStarted(mode);
    this.ui.onToast(
      mode === 'pvp'
        ? `联机死斗 #${this.net.roomId} · 率先 8 击杀获胜`
        : `联机守卫 #${this.net.roomId} · 协同防卫基地`,
    );
  }

  private spawnPvpSparringBots(): void {
    const botTypes: EnemyArchetype[] = ['raider', 'twin'];
    botTypes.forEach((arch, i) => {
      const [bx, bz, ba] = PVP_SPAWNS[(i + 1) % 4];
      const bot = new Tank(
        {
          id: `spar_bot_${i}`,
          team: 'enemy',
          archetype: arch,
          color: ENEMY_COLORS[arch],
          name: i === 0 ? 'AI-铁骑' : 'AI-猎手',
        },
        this.textures,
      );
      bot.respawn(bx, bz, ba, 2.0);
      bot.aiDirAngle = ba;
      this.scene.add(bot.root);
      this.aiTanks.push(bot);
    });
  }

  private buildWaveQueue(count: number): void {
    const pool: EnemyArchetype[] = ['scout', 'raider', 'twin', 'juggernaut'];
    this.enemyQueue = [];
    for (let i = 0; i < count; i++) {
      const weight = (i + this.stageIndex) % 6;
      const arch =
        weight === 5
          ? 'juggernaut'
          : weight === 3
            ? 'twin'
            : weight === 2
              ? 'raider'
              : pool[i % 2];
      this.enemyQueue.push(arch);
    }
  }

  private syncRemoteRoster(peers: PeerPresence[]): void {
    if (!this.isCombatMode() || this.mode === 'campaign') return;

    // If a real human joined PvP, remove solo sparring bots!
    if (this.mode === 'pvp' && peers.length >= 2 && this.aiTanks.length > 0) {
      for (const b of this.aiTanks) this.scene.remove(b.root);
      this.aiTanks = [];
      this.ui.onToast('真人对手已驶入战场！');
    }

    const activeIds = new Set(peers.map((p) => p.peerId));
    for (const [id, tank] of this.remotePlayers.entries()) {
      if (!activeIds.has(id)) {
        this.scene.remove(tank.root);
        this.remotePlayers.delete(id);
      }
    }

    for (const p of peers) {
      if (p.peerId === this.net.peerId) continue;
      let rt = this.remotePlayers.get(p.peerId);
      if (!rt) {
        const spawns = this.mode === 'pvp' ? PVP_SPAWNS : COOP_SPAWNS;
        const [sx, sz, sa] = spawns[p.slot % spawns.length];
        rt = new Tank(
          {
            id: p.peerId,
            team: this.mode === 'pvp' ? 'enemy' : 'player',
            color: p.color,
            name: p.name,
            isRemote: true,
          },
          this.textures,
        );
        rt.setPosition(sx, sz, sa);
        this.scene.add(rt.root);
        this.remotePlayers.set(p.peerId, rt);
      }
      const mod = p.mod || 'default';
      if (rt.modSelection !== mod) this.applyModToTank(rt, mod);
    }
  }

  private handleRemoteTankState(peerId: string, snap: NetTankSnapshot): void {
    if (this.mode !== 'pvp' && this.mode !== 'coop') return;
    const rt = this.remotePlayers.get(peerId);
    if (rt) {
      rt.applyNetState(snap);
    }
  }

  private handleRoomEvent(evt: NetRoomEvent, senderId: string): void {
    if (evt.t === 'start') {
      const grid = decodeGrid(evt.gridHex);
      this.beginOnlineSession(evt.mode, evt.mapIndex, grid);
      return;
    }

    if (evt.t === 'chat') {
      const text = String(evt.text ?? '').trim().slice(0, 120);
      const name = String(evt.name ?? '装甲兵').slice(0, 12);
      if (text) this.ui.onChatMessage(name, text, false);
      return;
    }

    if (evt.t === 'voice') {
      this.voice.handleEvent(evt, senderId);
      return;
    }

    if (evt.t === 'vote') {
      this.handleVoteEvent(evt, senderId);
      return;
    }

    if (this.mode !== 'pvp' && this.mode !== 'coop') return;

    if (evt.t === 'fire') {
      this.spawnProjectile({
        id: evt.id,
        ownerId: evt.owner,
        team: this.mode === 'pvp' && evt.owner !== this.net.peerId ? 'enemy' : evt.team,
        color: evt.color,
        x: evt.x,
        z: evt.z,
        angle: evt.angle,
        speed: evt.speed,
        dmg: evt.dmg,
        heavy: evt.heavy,
        pierceSteel: evt.pierceSteel,
      });
      const shooter = this.remotePlayers.get(evt.owner);
      shooter?.triggerRecoil(evt.heavy);
      this.audio.playCannon(evt.heavy, 0.55);
    } else if (evt.t === 'dmg') {
      const allPopped = [];
      for (const [gx, gz, newType] of evt.cells) {
        allPopped.push(...this.world.setCell(gx, gz, newType as TileType));
      }
      if (allPopped.length > 0) {
        this.vfx.spawnBrickBurst(allPopped, evt.cx, evt.cz);
        this.audio.playBrickBreak();
      }
    } else if (evt.t === 'hit') {
      if (evt.targetId === this.net.peerId && this.localPlayer?.alive) {
        const died = this.localPlayer.takeDamage(evt.dmg);
        this.cameraRig.addTrauma(died ? 0.8 : 0.35);
        if (died) {
          this.vfx.spawnTankExplosion(this.localPlayer.x, this.localPlayer.z, true);
          this.audio.playExplosion(true);
          this.shockPulse = 0.9;
          this.ui.onToast(`被 ${evt.attackerName} 击毁！`);
          this.handleLocalDeath();
        } else {
          this.vfx.spawnSparks(evt.x, 0.7, evt.z, 18, 0xffaa44);
        }
      } else if (evt.fatal) {
        const rt = this.remotePlayers.get(evt.targetId);
        if (rt) {
          rt.alive = false;
          rt.root.visible = false;
        }
        this.vfx.spawnTankExplosion(evt.x, evt.z, true);
        this.audio.playExplosion(true);
        if (evt.attackerId === this.net.peerId && this.localPlayer) {
          this.checkPvpWinCondition();
        }
      }
    } else if (evt.t === 'pu') {
      if (evt.action === 'spawn' && evt.kind && evt.x !== undefined && evt.z !== undefined) {
        this.spawnPowerUpLocal(evt.id, evt.kind, evt.x, evt.z);
      } else if (evt.action === 'pick') {
        this.removePowerUpById(evt.id);
      }
    } else if (evt.t === 'ai' && this.mode === 'coop' && !this.net.isHost()) {
      this.applyCoopAiSync(evt);
    }
  }

  private applyCoopAiSync(evt: Extract<NetRoomEvent, { t: 'ai' }>): void {
    if (!evt.baseAlive && this.world.baseAlive) {
      this.triggerEagleDestruction();
    }
    const seen = new Set<string>();
    for (const [id, arch, x, z, vx, vz, hull, turret, hp, maxHp] of evt.enemies) {
      seen.add(id);
      let ai = this.aiTanks.find((t) => t.id === id);
      if (!ai) {
        ai = new Tank(
          { id, team: 'enemy', archetype: arch, color: ENEMY_COLORS[arch], isRemote: true },
          this.textures,
        );
        ai.setPosition(x, z, hull);
        this.scene.add(ai.root);
        this.aiTanks.push(ai);
      }
      ai.applyNetState({
        seq: 0,
        x,
        z,
        vx,
        vz,
        hull,
        turret,
        hp,
        maxHp,
        shield: 0,
        charge: 0,
        stars: 1,
        alive: 1,
        kills: 0,
        score: 0,
      });
    }
    for (let i = this.aiTanks.length - 1; i >= 0; i--) {
      if (!seen.has(this.aiTanks[i].id)) {
        this.scene.remove(this.aiTanks[i].root);
        this.aiTanks.splice(i, 1);
      }
    }
  }

  private activateCheat(): void {
    const p = this.localPlayer;
    if (!p || this.cheatActive) return;
    this.cheatActive = true;
    this.cheatBuffer = '';
    p.maxHp *= 100;
    p.hp = p.maxHp;
    p.setCheatGlow(true);
    this.audio.playPowerUp();
    this.cameraRig.addTrauma(0.35);
    this.ui.onToast('金手指启动：血量 ×100 · 车身红光 · 空格倾泻全屏弹幕');
  }

  private fireCheatBarrage(): void {
    const p = this.localPlayer;
    if (!p || !p.alive || this.matchEnded || this.cheatCooldown > 0) return;
    this.cheatCooldown = 0.5;

    const count = 32;
    const speed = 27;
    const dmg = 3;
    const color = 0xff3a1e;
    const stamp = Date.now();
    const muzzle = p.getMuzzleWorldPosition();

    p.triggerRecoil(true);
    this.vfx.spawnMuzzleBlast(
      muzzle.x,
      muzzle.y,
      muzzle.z,
      Math.sin(p.turretAngle),
      Math.cos(p.turretAngle),
      true,
    );
    this.cameraRig.addDirectionalKick(Math.sin(p.turretAngle), Math.cos(p.turretAngle), 0.6);
    this.cameraRig.addTrauma(0.8);
    this.audio.playCannon(true, 1.0);
    this.shockPulse = 0.6;

    for (let i = 0; i < count; i++) {
      const angle = (i / count) * Math.PI * 2;
      const px = p.x + Math.sin(angle) * 0.95;
      const pz = p.z + Math.cos(angle) * 0.95;
      const projId = `${this.net.peerId}_cheat_${stamp}_${i}`;

      this.spawnProjectile({
        id: projId,
        ownerId: p.id,
        team: 'player',
        color,
        x: px,
        z: pz,
        angle,
        speed,
        dmg,
        heavy: true,
        pierceSteel: true,
      });

      if (this.mode === 'pvp' || this.mode === 'coop') {
        this.net.publishEvent({
          t: 'fire',
          id: projId,
          owner: p.id,
          team: 'player',
          color,
          x: Number(px.toFixed(2)),
          z: Number(pz.toFixed(2)),
          angle: Number(angle.toFixed(3)),
          speed,
          dmg,
          heavy: true,
          pierceSteel: true,
        });
      }
    }
  }

  private tryFireLocal(heavy: boolean): void {
    const p = this.localPlayer;
    if (!p || !p.alive || this.matchEnded) return;
    if (p.fireCooldown > 0 && !heavy) return;

    p.fireCooldown = heavy ? p.reloadTime * 1.45 : p.reloadTime;
    const muzzle = p.getMuzzleWorldPosition();
    const pierceSteel = heavy || p.stars >= 3;
    const dmg = heavy ? 3 : p.stars >= 2 ? 2 : 1;
    const speed = heavy ? 25.0 : p.bulletSpeed;
    const projId = `${this.net.peerId}_${Date.now()}_${Math.floor(Math.random() * 99)}`;

    p.triggerRecoil(heavy);
    const dx = Math.sin(p.turretAngle);
    const dz = Math.cos(p.turretAngle);
    this.vfx.spawnMuzzleBlast(muzzle.x, muzzle.y, muzzle.z, dx, dz, heavy);
    this.cameraRig.addDirectionalKick(dx, dz, heavy ? 0.55 : 0.18);
    if (heavy) this.shockPulse = 0.55;
    this.audio.playCannon(heavy, 1.0);

    const color = heavy ? 0xffdf78 : 0xffaa38;
    this.spawnProjectile({
      id: projId,
      ownerId: p.id,
      team: 'player',
      color,
      x: muzzle.x,
      z: muzzle.z,
      angle: p.turretAngle,
      speed,
      dmg,
      heavy,
      pierceSteel,
    });

    if (this.mode === 'pvp' || this.mode === 'coop') {
      this.net.publishEvent({
        t: 'fire',
        id: projId,
        owner: p.id,
        team: 'player',
        color,
        x: Number(muzzle.x.toFixed(2)),
        z: Number(muzzle.z.toFixed(2)),
        angle: Number(p.turretAngle.toFixed(3)),
        speed,
        dmg,
        heavy,
        pierceSteel,
      });
    }
  }

  private spawnProjectile(cfg: {
    id: string;
    ownerId: string;
    team: 'player' | 'enemy';
    color: number;
    x: number;
    z: number;
    angle: number;
    speed: number;
    dmg: number;
    heavy: boolean;
    pierceSteel: boolean;
  }): void {
    const mesh = createProjectileMesh(cfg.color, cfg.heavy);
    mesh.position.set(cfg.x, 0.74, cfg.z);
    mesh.rotation.y = cfg.angle;
    this.scene.add(mesh);

    this.projectiles.push({
      id: cfg.id,
      ownerId: cfg.ownerId,
      team: cfg.team,
      x: cfg.x,
      y: 0.74,
      z: cfg.z,
      vx: Math.sin(cfg.angle) * cfg.speed,
      vz: Math.cos(cfg.angle) * cfg.speed,
      angle: cfg.angle,
      dmg: cfg.dmg,
      heavy: cfg.heavy,
      pierceSteel: cfg.pierceSteel,
      bouncesLeft: cfg.heavy ? 0 : 0,
      alive: true,
      mesh,
      trailTimer: 0,
    });
  }

  private updateWorkshopCursor(): void {
    this.raycaster.setFromCamera(this.mouseNdc, this.cameraRig.camera);
    const hit = new THREE.Vector3();
    if (!this.raycaster.ray.intersectPlane(this.floorPlane, hit)) return;
    const [gx, gz] = this.world.worldToGrid(hit.x, hit.z);
    if (gx < 0 || gx >= GRID_SIZE || gz < 0 || gz >= GRID_SIZE) {
      this.world.brushCursor.visible = false;
      return;
    }
    this.world.brushCursor.visible = true;
    const mx = Math.floor(gx / 2) * 2;
    const mz = Math.floor(gz / 2) * 2;
    this.world.brushCursor.position.set(
      -HALF_BOARD + (mx + 1) * 1.0,
      0.14,
      -HALF_BOARD + (mz + 1) * 1.0,
    );
  }

  private paintAtWorkshopCursor(fineSingleCell: boolean): void {
    this.raycaster.setFromCamera(this.mouseNdc, this.cameraRig.camera);
    const hit = new THREE.Vector3();
    if (!this.raycaster.ray.intersectPlane(this.floorPlane, hit)) return;
    const [gx, gz] = this.world.worldToGrid(hit.x, hit.z);
    if (gx < 0 || gx >= GRID_SIZE || gz < 0 || gz >= GRID_SIZE) return;

    const applyCell = (cx: number, cz: number) => {
      if ((cx === 12 || cx === 13) && (cz === 24 || cz === 25)) return; // Protect Eagle core
      const popped = this.world.setCell(cx, cz, this.workshopBrush);
      if (popped.length > 0) this.vfx.spawnBrickBurst(popped, hit.x, hit.z);
    };

    if (fineSingleCell) {
      applyCell(gx, gz);
    } else {
      const mx = Math.floor(gx / 2) * 2;
      const mz = Math.floor(gz / 2) * 2;
      for (let dz = 0; dz < 2; dz++) {
        for (let dx = 0; dx < 2; dx++) applyCell(mx + dx, mz + dz);
      }
    }
  }

  private getAllTanks(): Tank[] {
    const list: Tank[] = [];
    if (this.localPlayer) list.push(this.localPlayer);
    for (const r of this.remotePlayers.values()) list.push(r);
    for (const a of this.aiTanks) list.push(a);
    return list;
  }

  private updateLocalPlayer(dt: number): void {
    const p = this.localPlayer;
    if (!p) return;

    if (!p.alive) {
      if (this.respawnTimer > 0) {
        this.respawnTimer -= dt;
        if (this.respawnTimer <= 0 && !this.matchEnded) {
          this.respawnLocalTank();
        }
      }
      return;
    }

    let moveX = 0;
    let moveZ = 0;
    if (this.keys.has('KeyW')) moveZ -= 1;
    if (this.keys.has('KeyS')) moveZ += 1;
    if (this.keys.has('KeyA')) moveX -= 1;
    if (this.keys.has('KeyD')) moveX += 1;

    // Rotate WASD input relative to current camera azimuth so controls ALWAYS feel intuitive even after 360° camera orbit!
    let worldMoveX = moveX;
    let worldMoveZ = moveZ;
    if (moveX !== 0 || moveZ !== 0) {
      const camDir = new THREE.Vector3();
      this.cameraRig.camera.getWorldDirection(camDir);
      const camYaw = Math.atan2(camDir.x, camDir.z);
      // Forward (moveZ = -1) moves along camera horizontal forward
      const fwdX = Math.sin(camYaw);
      const fwdZ = Math.cos(camYaw);
      const rightX = -fwdZ;
      const rightZ = fwdX;
      worldMoveX = (-moveZ) * fwdX + moveX * rightX;
      worldMoveZ = (-moveZ) * fwdZ + moveX * rightZ;
    }

    let aimAngle: number | null = null;
    if (this.aimMode === 'keyboard') {
      // Left = counter-clockwise on screen, right = clockwise (matches the top-down camera)
      const aimDir =
        (this.keys.has('ArrowLeft') || this.keys.has('KeyQ') ? 1 : 0) -
        (this.keys.has('ArrowRight') || this.keys.has('KeyE') ? 1 : 0);
      if (aimDir !== 0) this.keyboardAimAngle += aimDir * this.turretKeyTurnSpeed * dt;
      aimAngle = this.keyboardAimAngle;
    } else if (this.hasMouseMoved) {
      this.raycaster.setFromCamera(this.mouseNdc, this.cameraRig.camera);
      if (this.raycaster.ray.intersectPlane(this.groundPlane, this.aimWorldPoint)) {
        aimAngle = Math.atan2(this.aimWorldPoint.x - p.x, this.aimWorldPoint.z - p.z);
      }
    }

    if (this.isLeftMouseDown || this.isSpaceDown) {
      this.chargeHoldSec += dt;
      p.chargeRatio = Math.min(1, this.chargeHoldSec / 0.55);
    } else {
      p.chargeRatio = 0;
    }

    p.driveWithInput(worldMoveX, worldMoveZ, aimAngle, dt, this.world, this.getAllTanks(), this.vfx);

    this.sight.group.visible = true;
    this.sight.update(
      p.x,
      p.z,
      p.turretAngle,
      18.0,
      p.chargeRatio,
      this.world,
      this.elapsed,
    );
  }

  private updateAiDirector(dt: number): void {
    const isCoopClient = this.mode === 'coop' && !this.net.isHost();
    if (isCoopClient) {
      for (const ai of this.aiTanks) ai.updateRemote(dt, this.vfx);
      return;
    }

    // Spawn Campaign / Co-op wave enemies
    if ((this.mode === 'campaign' || this.mode === 'coop') && !this.matchEnded) {
      const maxActive = this.mode === 'coop' ? 5 : 4;
      this.enemySpawnTimer -= dt;
      if (this.enemySpawnTimer <= 0 && this.enemyQueue.length > 0 && this.aiTanks.length < maxActive) {
        this.enemySpawnTimer = 2.4;
        const arch = this.enemyQueue.shift()!;
        const [sx, sz] = ENEMY_TOP_SPAWNS[this.enemyQueue.length % ENEMY_TOP_SPAWNS.length];
        const isBonus = this.enemyQueue.length % 4 === 1;
        const id = `ai_${Date.now()}_${Math.floor(Math.random() * 999)}`;
        const enemy = new Tank(
          {
            id,
            team: 'enemy',
            archetype: arch,
            color: ENEMY_COLORS[arch],
            isBonusCarrier: isBonus,
          },
          this.textures,
        );
        enemy.respawn(sx, sz, 0, 1.4);
        enemy.aiDirAngle = 0;
        this.scene.add(enemy.root);
        this.aiTanks.push(enemy);
        this.vfx.spawnShockwave(sx, 0.08, sz, 2.0, 0x62b6ff);
      }
    }

    // Periodic central PowerUp crate in PvP
    if (this.mode === 'pvp' && this.net.isHost() && !this.matchEnded) {
      this.pvpPowerUpTimer -= dt;
      if (this.pvpPowerUpTimer <= 0 && this.powerUps.length < 2) {
        this.pvpPowerUpTimer = 11.0;
        this.spawnRandomPowerUp(['star', 'shield', 'repair']);
      }
    }

    if (this.freezeTimer > 0 && (this.mode === 'campaign' || this.mode === 'coop')) {
      this.freezeTimer -= dt;
      return;
    }

    const allTanks = this.getAllTanks();

    for (const ai of this.aiTanks) {
      if (!ai.alive) {
        // In Demo or PvP Sparring, auto-respawn fallen AI tanks!
        if (this.mode === 'demo' || this.mode === 'pvp') {
          ai.aiTurnTimer -= dt;
          if (ai.aiTurnTimer <= -2.2) {
            const rx = ai.team === 'player' ? (Math.random() > 0.5 ? -4 : 4) : -10 + Math.random() * 20;
            const rz = ai.team === 'player' ? 11 : -11;
            ai.respawn(rx, rz, ai.team === 'player' ? Math.PI : 0, 2.0);
            ai.aiTurnTimer = 1.5;
          }
        }
        continue;
      }

      ai.aiTurnTimer -= dt;
      ai.aiShootTimer -= dt;

      const prevX = ai.x;
      const prevZ = ai.z;

      // Pick target (nearest opposing tank or Eagle Base)
      let targetX = 0;
      let targetZ = 12.0;
      let bestDist = 999;

      for (const cand of allTanks) {
        if (cand === ai || !cand.alive || cand.team === ai.team) continue;
        const d = Math.hypot(cand.x - ai.x, cand.z - ai.z);
        if (d < bestDist) {
          bestDist = d;
          targetX = cand.x;
          targetZ = cand.z;
        }
      }
      if (ai.team === 'enemy' && this.world.baseAlive && (this.mode === 'campaign' || this.mode === 'coop')) {
        if (Math.random() < 0.35 || bestDist > 16) {
          targetX = 0;
          targetZ = 12.0;
        }
      }

      if (ai.aiTurnTimer <= 0 || ai.aiStuckTime > 0.28) {
        ai.aiTurnTimer = 1.1 + Math.random() * 1.6;
        ai.aiStuckTime = 0;
        const cardinals = [0, Math.PI * 0.5, Math.PI, -Math.PI * 0.5];
        if (Math.random() < 0.68) {
          const dx = targetX - ai.x;
          const dz = targetZ - ai.z;
          ai.aiDirAngle =
            Math.abs(dx) > Math.abs(dz)
              ? dx > 0
                ? Math.PI * 0.5
                : -Math.PI * 0.5
              : dz > 0
                ? 0
                : Math.PI;
        } else {
          ai.aiDirAngle = cardinals[Math.floor(Math.random() * cardinals.length)];
        }
      }

      const mx = Math.sin(ai.aiDirAngle);
      const mz = Math.cos(ai.aiDirAngle);
      const aimAngle = Math.atan2(targetX - ai.x, targetZ - ai.z);

      ai.driveWithInput(mx, mz, aimAngle, dt, this.world, allTanks, this.vfx);

      if (Math.hypot(ai.x - prevX, ai.z - prevZ) < dt * 0.6) {
        ai.aiStuckTime += dt;
      } else {
        ai.aiStuckTime = 0;
      }

      if (ai.aiShootTimer <= 0 && ai.fireCooldown <= 0) {
        ai.aiShootTimer = ai.reloadTime + Math.random() * 0.55;
        ai.fireCooldown = ai.reloadTime;
        const muzzle = ai.getMuzzleWorldPosition();
        ai.triggerRecoil(false);
        const dx = Math.sin(ai.turretAngle);
        const dz = Math.cos(ai.turretAngle);
        this.vfx.spawnMuzzleBlast(muzzle.x, muzzle.y, muzzle.z, dx, dz, false);
        if (this.mode !== 'demo') this.audio.playCannon(false, 0.38);

        const color = ai.team === 'player' ? 0xffb84a : 0xff6842;
        const projId = `${ai.id}_${Date.now()}`;
        this.spawnProjectile({
          id: projId,
          ownerId: ai.id,
          team: ai.team,
          color,
          x: muzzle.x,
          z: muzzle.z,
          angle: ai.turretAngle,
          speed: ai.bulletSpeed,
          dmg: 1,
          heavy: false,
          pierceSteel: false,
        });

        if (this.mode === 'coop' && this.net.isHost()) {
          this.net.publishEvent({
            t: 'fire',
            id: projId,
            owner: ai.id,
            team: 'enemy',
            color,
            x: Number(muzzle.x.toFixed(2)),
            z: Number(muzzle.z.toFixed(2)),
            angle: Number(ai.turretAngle.toFixed(3)),
            speed: ai.bulletSpeed,
            dmg: 1,
            heavy: false,
            pierceSteel: false,
          });
        }
      }
    }
  }

  private updateProjectiles(dt: number): void {
    // 1. Mid-air Shell-vs-Shell Interception (classic Battle City!)
    for (let i = 0; i < this.projectiles.length; i++) {
      const a = this.projectiles[i];
      if (!a.alive) continue;
      for (let j = i + 1; j < this.projectiles.length; j++) {
        const b = this.projectiles[j];
        if (!b.alive || a.team === b.team) continue;
        const dx = a.x - b.x;
        const dz = a.z - b.z;
        if (dx * dx + dz * dz < 0.24 * 0.24) {
          if (!a.heavy) a.alive = false;
          if (!b.heavy) b.alive = false;
          this.vfx.spawnSparks((a.x + b.x) * 0.5, 0.74, (a.z + b.z) * 0.5, 16, 0xffe082);
          this.vfx.emitFlash((a.x + b.x) * 0.5, 0.9, (a.z + b.z) * 0.5, 0xffbe55, 3.0, 0.12);
        }
      }
    }

    const isLocalAuthorityForMap =
      this.mode === 'demo' ||
      this.mode === 'campaign' ||
      this.net.isHost();

    for (let i = this.projectiles.length - 1; i >= 0; i--) {
      const p = this.projectiles[i];
      if (!p.alive) {
        this.scene.remove(p.mesh);
        this.projectiles.splice(i, 1);
        continue;
      }

      p.x += p.vx * dt;
      p.z += p.vz * dt;
      p.mesh.position.set(p.x, p.y, p.z);

      p.trailTimer += dt;
      if (p.trailTimer > (p.heavy ? 0.025 : 0.045)) {
        p.trailTimer = 0;
        this.vfx.spawnSmokePuff(p.x, p.y, p.z, p.heavy ? 0.14 : 0.08, 0.26, 0.26, p.heavy);
      }

      // Check outer table boundary
      if (Math.abs(p.x) >= HALF_BOARD || Math.abs(p.z) >= HALF_BOARD) {
        this.vfx.spawnSparks(p.x, p.y, p.z, 12, 0x9ec6ff);
        if (this.mode !== 'demo') this.audio.playSteelRicochet();
        p.alive = false;
        continue;
      }

      // Check Grid Terrain Hit
      const [gx, gz] = this.world.worldToGrid(p.x, p.z);
      const tile = this.world.getTile(gx, gz);

      if (tile === TileType.BASE && this.world.baseAlive) {
        p.alive = false;
        if (this.mode === 'demo') {
          this.vfx.spawnSparks(p.x, 0.8, p.z, 20, 0xffcc55);
        } else if (isLocalAuthorityForMap) {
          this.triggerEagleDestruction();
        }
        continue;
      }

      if (tile === TileType.BRICK || tile === TileType.STEEL) {
        if (tile === TileType.STEEL && !p.pierceSteel) {
          this.vfx.spawnSparks(p.x, p.y, p.z, 20, 0xb8dcff);
          this.vfx.emitFlash(p.x, 0.9, p.z, 0x88c8ff, 2.2, 0.1);
          if (this.mode !== 'demo') this.audio.playSteelRicochet();
          p.alive = false;
          continue;
        }

        // Destroy perpendicular 2-cell slice (authentic Battle City masonry splash!)
        const perpX = Math.abs(p.vz) >= Math.abs(p.vx);
        const targets: Array<[number, number]> = [[gx, gz]];
        if (perpX) {
          const adjX = p.x > this.world.gridToWorldX(gx) ? gx + 1 : gx - 1;
          if (this.world.getTile(adjX, gz) === tile) targets.push([adjX, gz]);
        } else {
          const adjZ = p.z > this.world.gridToWorldZ(gz) ? gz + 1 : gz - 1;
          if (this.world.getTile(gx, adjZ) === tile) targets.push([gx, adjZ]);
        }

        if (isLocalAuthorityForMap || p.ownerId === this.net.peerId) {
          const popped = [];
          const changed: Array<[number, number, number]> = [];
          for (const [tx, tz] of targets) {
            if (this.world.getTile(tx, tz) === TileType.STEEL && !p.pierceSteel) continue;
            popped.push(...this.world.setCell(tx, tz, TileType.EMPTY));
            changed.push([tx, tz, TileType.EMPTY]);
          }
          if (popped.length > 0) {
            this.vfx.spawnBrickBurst(popped, p.x, p.z);
            if (this.mode !== 'demo') this.audio.playBrickBreak();
          } else {
            this.vfx.spawnSparks(p.x, p.y, p.z, 24, 0xffaa44);
            this.audio.playExplosion(false);
          }
          if ((this.mode === 'pvp' || this.mode === 'coop') && changed.length > 0) {
            this.net.publishEvent({
              t: 'dmg',
              cells: changed,
              cx: Number(p.x.toFixed(2)),
              cz: Number(p.z.toFixed(2)),
            });
          }
        }
        if (!p.heavy) {
          p.alive = false;
          continue;
        } else {
          p.heavy = false; // Heavy shell punches through 1 wall layer then becomes normal!
        }
      }

      // Tank Collision Check
      this.checkProjectileTankHits(p);
    }
  }

  private checkProjectileTankHits(p: ProjectileData): void {
    const allTanks = this.getAllTanks();
    for (const target of allTanks) {
      if (!target.alive || target.id === p.ownerId) continue;
      // Friendly fire off in Co-op / Demo
      if (this.mode !== 'pvp' && target.team === p.team) continue;

      const dx = p.x - target.x;
      const dz = p.z - target.z;
      const hitR = target.radius + (p.heavy ? 0.2 : 0.1);
      if (dx * dx + dz * dz > hitR * hitR) continue;

      p.alive = false;

      if (target.shieldTimer > 0) {
        this.vfx.spawnSparks(p.x, 0.8, p.z, 18, 0x55d8ff);
        this.vfx.spawnShockwave(target.x, 0.5, target.z, 1.5, 0x4cd4ff);
        if (this.mode !== 'demo') this.audio.playSteelRicochet();
        return;
      }

      // Remote human player hit in PvP (owned by local shooter!)
      if (this.mode === 'pvp' && target.isRemote) {
        if (p.ownerId === this.net.peerId && this.localPlayer) {
          const fatal = target.hp - p.dmg <= 0;
          target.hp = Math.max(0, target.hp - p.dmg);
          if (fatal) {
            target.alive = false;
            target.root.visible = false;
            this.localPlayer.kills++;
            this.localPlayer.score += 500;
            this.net.setLocalStats(this.localPlayer.kills, this.localPlayer.score);
            this.vfx.spawnTankExplosion(target.x, target.z, true);
            this.audio.playExplosion(true);
            this.cameraRig.addTrauma(0.65);
            this.shockPulse = 0.7;
            this.ui.onToast(`击毁 ${target.name}！`);
            this.checkPvpWinCondition();
          } else {
            this.vfx.spawnSparks(p.x, 0.75, p.z, 18, 0xffb84a);
          }
          this.net.publishEvent(
            {
              t: 'hit',
              targetId: target.id,
              attackerId: this.net.peerId,
              attackerName: this.net.callsign,
              dmg: p.dmg,
              fatal,
              x: Number(target.x.toFixed(2)),
              z: Number(target.z.toFixed(2)),
            },
            fatal,
          );
        }
        return;
      }

      // Local player hit (in Campaign / Co-op / Sparring)
      if (target === this.localPlayer) {
        if (this.mode === 'pvp' && !p.ownerId.startsWith('spar_bot')) return; // Handled via NetHitEvent
        const died = target.takeDamage(p.dmg);
        this.cameraRig.addTrauma(died ? 0.8 : 0.35);
        if (died) {
          this.vfx.spawnTankExplosion(target.x, target.z, true);
          this.audio.playExplosion(true);
          this.shockPulse = 0.85;
          this.handleLocalDeath();
        } else {
          this.vfx.spawnSparks(p.x, 0.75, p.z, 16, 0xffaa44);
        }
        return;
      }

      // AI Tank Hit
      if (!target.isRemote || p.ownerId === this.net.peerId) {
        const died = target.takeDamage(p.dmg);
        if (died) {
          this.vfx.spawnTankExplosion(target.x, target.z, true);
          if (this.mode !== 'demo') {
            this.audio.playExplosion(true);
            this.cameraRig.addTrauma(0.5);
            this.shockPulse = 0.55;
          }
          if (p.ownerId === this.net.peerId && this.localPlayer) {
            this.localPlayer.kills++;
            const pts =
              target.archetype === 'juggernaut'
                ? 400
                : target.archetype === 'twin'
                  ? 300
                  : target.archetype === 'raider'
                    ? 200
                    : 100;
            this.localPlayer.score += pts;
            this.net.setLocalStats(this.localPlayer.kills, this.localPlayer.score);
            if (this.mode === 'pvp') this.checkPvpWinCondition();
          }

          if (target.isBonusCarrier && (this.mode === 'campaign' || (this.mode === 'coop' && this.net.isHost()))) {
            this.spawnRandomPowerUp(['star', 'shield', 'freeze', 'fortress', 'bomb', 'repair']);
          }

          if (this.mode === 'campaign' || this.mode === 'coop') {
            const idx = this.aiTanks.indexOf(target);
            if (idx >= 0) {
              this.scene.remove(target.root);
              this.aiTanks.splice(idx, 1);
            }
            this.checkWaveVictory();
          } else {
            target.aiTurnTimer = 0; // Triggers respawn timer for Demo / Sparring
          }
        } else {
          this.vfx.spawnSparks(p.x, 0.75, p.z, 16, 0xffcf6b);
          if (this.mode !== 'demo') this.audio.playSteelRicochet();
        }
      }
      return;
    }
  }

  private spawnRandomPowerUp(allowed: PowerUpKind[]): void {
    const kind = allowed[Math.floor(Math.random() * allowed.length)];
    let rx = 0;
    let rz = 0;
    for (let tries = 0; tries < 25; tries++) {
      const gx = 3 + Math.floor(Math.random() * 20);
      const gz = 3 + Math.floor(Math.random() * 18);
      if (this.world.getTile(gx, gz) === TileType.EMPTY) {
        rx = this.world.gridToWorldX(gx);
        rz = this.world.gridToWorldZ(gz);
        break;
      }
    }
    const id = `pu_${Date.now()}_${Math.floor(Math.random() * 99)}`;
    this.spawnPowerUpLocal(id, kind, rx, rz);
    if (this.mode === 'pvp' || this.mode === 'coop') {
      this.net.publishEvent({ t: 'pu', action: 'spawn', id, kind, x: rx, z: rz });
    }
  }

  private spawnPowerUpLocal(id: string, kind: PowerUpKind, x: number, z: number): void {
    const item = new PowerUpItem(id, kind, x, z);
    this.scene.add(item.group);
    this.powerUps.push(item);
    this.vfx.spawnShockwave(x, 0.1, z, 2.0, 0xffd257);
  }

  private removePowerUpById(id: string): void {
    const idx = this.powerUps.findIndex((p) => p.id === id);
    if (idx >= 0) {
      this.scene.remove(this.powerUps[idx].group);
      this.powerUps.splice(idx, 1);
    }
  }

  private updatePowerUps(dt: number): void {
    if (this.fortressTimer > 0) {
      this.fortressTimer -= dt;
      if (this.fortressTimer <= 0 && this.world.baseAlive) {
        stampEagleFortress(this.world.grid, TileType.BRICK);
        this.world.rebuildAllInstances();
      }
    }

    const p = this.localPlayer;
    for (let i = this.powerUps.length - 1; i >= 0; i--) {
      const pu = this.powerUps[i];
      pu.update(dt, this.elapsed);
      if (!pu.alive) {
        this.scene.remove(pu.group);
        this.powerUps.splice(i, 1);
        continue;
      }

      if (p && p.alive && Math.hypot(p.x - pu.x, p.z - pu.z) < 1.35) {
        this.applyPowerUp(p, pu.kind);
        this.scene.remove(pu.group);
        this.powerUps.splice(i, 1);
        if (this.mode === 'pvp' || this.mode === 'coop') {
          this.net.publishEvent({ t: 'pu', action: 'pick', id: pu.id, pickerId: p.id });
        }
      }
    }
  }

  private applyPowerUp(p: Tank, kind: PowerUpKind): void {
    this.audio.playPowerUp();
    p.score += 250;
    this.vfx.spawnShockwave(p.x, 0.12, p.z, 2.6, 0xffe066);

    switch (kind) {
      case 'star':
        p.stars = Math.min(3, p.stars + 1);
        p.refreshWeaponVisuals();
        this.ui.onToast(p.stars >= 3 ? '★ 终极穿甲双轨炮已解锁' : '★ 主炮火力晋升');
        break;
      case 'shield':
        p.shieldTimer = 10.0;
        this.ui.onToast('能量偏折护盾已激活');
        break;
      case 'freeze':
        this.freezeTimer = 8.0;
        this.ui.onToast('敌军装甲陷入冰封时停');
        break;
      case 'fortress':
        this.fortressTimer = 18.0;
        stampEagleFortress(this.world.grid, TileType.STEEL);
        this.world.rebuildAllInstances();
        this.ui.onToast('基地已升起复合钢铁壁垒');
        break;
      case 'bomb':
        this.ui.onToast('全屏重炮轰炸！');
        for (const ai of [...this.aiTanks]) {
          if (ai.alive && ai.team === 'enemy') {
            this.vfx.spawnTankExplosion(ai.x, ai.z, true);
            this.scene.remove(ai.root);
            const idx = this.aiTanks.indexOf(ai);
            if (idx >= 0) this.aiTanks.splice(idx, 1);
          }
        }
        this.audio.playExplosion(true);
        this.cameraRig.addTrauma(0.9);
        this.checkWaveVictory();
        break;
      case 'repair':
        p.hp = p.maxHp;
        if (this.mode !== 'pvp') this.playerLives = Math.min(6, this.playerLives + 1);
        this.ui.onToast('装甲完整度已修复');
        break;
    }
  }

  private handleLocalDeath(): void {
    if (this.mode === 'pvp') {
      this.respawnTimer = 2.4;
      return;
    }
    this.playerLives--;
    if (this.playerLives <= 0) {
      this.finishMatch(false, '装甲耗尽', `歼敌 ${this.localPlayer?.kills ?? 0} · 得分 ${this.localPlayer?.score ?? 0}`, false);
    } else {
      this.respawnTimer = 2.0;
    }
  }

  private respawnLocalTank(): void {
    if (!this.localPlayer) return;
    if (this.mode === 'pvp') {
      // Pick corner farthest from active enemies
      let bestCorner = PVP_SPAWNS[0];
      let maxMinDist = -1;
      for (const c of PVP_SPAWNS) {
        let minDist = 999;
        for (const r of this.remotePlayers.values()) {
          if (r.alive) minDist = Math.min(minDist, Math.hypot(c[0] - r.x, c[1] - r.z));
        }
        if (minDist > maxMinDist) {
          maxMinDist = minDist;
          bestCorner = c;
        }
      }
      this.localPlayer.stars = Math.max(1, this.localPlayer.stars - 1);
      this.localPlayer.refreshWeaponVisuals();
      this.localPlayer.respawn(bestCorner[0], bestCorner[1], bestCorner[2], 3.0);
    } else {
      const slot = this.mode === 'coop' ? this.net.getMySlot() : 0;
      const [sx, sz, sa] = COOP_SPAWNS[slot % COOP_SPAWNS.length];
      this.localPlayer.stars = 1;
      this.localPlayer.refreshWeaponVisuals();
      this.localPlayer.respawn(sx, sz, sa, 3.2);
    }
    if (this.aimMode === 'keyboard') {
      this.keyboardAimAngle = this.localPlayer.turretAngle;
    }
  }

  private triggerEagleDestruction(): void {
    if (!this.world.baseAlive || this.matchEnded) return;
    this.world.setEagleAlive(false);
    this.vfx.spawnTankExplosion(0, 12.0, false);
    this.vfx.spawnShockwave(0, 0.2, 12.0, 7.5, 0xff6224);
    this.audio.playExplosion(true);
    this.cameraRig.addTrauma(1.0);
    this.shockPulse = 1.0;
    this.finishMatch(false, '鹰徽沦陷', `防线失守 · 得分 ${this.localPlayer?.score ?? 0}`, false);
  }

  private checkWaveVictory(): void {
    if (this.matchEnded) return;
    if (this.enemyQueue.length === 0 && this.aiTanks.length === 0) {
      this.finishMatch(
        true,
        '防线肃清',
        `歼敌 ${this.localPlayer?.kills ?? 0} · 战功 ${this.localPlayer?.score ?? 0}`,
        this.mode === 'campaign' && this.stageIndex < 4,
      );
    }
  }

  private checkPvpWinCondition(): void {
    if (this.matchEnded || this.mode !== 'pvp') return;
    const myKills = this.localPlayer?.kills ?? 0;
    if (myKills >= 8) {
      this.finishMatch(true, '竞技场主宰', `8 击杀达成 · 战功 ${this.localPlayer?.score ?? 0}`, false);
      return;
    }
    for (const r of this.remotePlayers.values()) {
      if (r.kills >= 8) {
        this.finishMatch(false, `${r.name} 夺冠`, `战功 ${this.localPlayer?.score ?? 0}`, false);
        return;
      }
    }
  }

  private finishMatch(victory: boolean, title: string, statsText: string, canNextStage: boolean): void {
    this.matchEnded = true;
    this.isLeftMouseDown = false;
    this.sight.group.visible = false;
    if (victory) this.audio.playStageFanfare();
    this.ui.onMatchEnd(victory, title, statsText, canNextStage);
  }

  private animate = (): void => {
    requestAnimationFrame(this.animate);

    const rawDt = Math.min(0.05, this.clock.getDelta());
    const simScale = this.slowMo && this.isCombatMode() ? 0.24 : 1.0;
    const dt = rawDt * simScale;
    this.elapsed += dt;
    this.shockPulse = Math.max(0, this.shockPulse - rawDt * 1.9);
    this.cheatCooldown = Math.max(0, this.cheatCooldown - rawDt);

    if (this.isCombatMode()) {
      this.updateLocalPlayer(dt);
      for (const r of this.remotePlayers.values()) {
        r.updateRemote(dt, this.vfx);
      }
      this.updateAiDirector(dt);
      this.updateProjectiles(dt);
      this.updatePowerUps(dt);

      // Network state broadcast at 20Hz
      if ((this.mode === 'pvp' || this.mode === 'coop') && this.localPlayer) {
        this.netSyncAccum += rawDt;
        if (this.netSyncAccum >= 0.05) {
          this.netSyncAccum = 0;
          this.net.publishTankState(this.localPlayer.toNetSnapshot(0));
        }

        if (this.mode === 'coop' && this.net.isHost()) {
          this.aiSyncAccum += rawDt;
          if (this.aiSyncAccum >= 0.085) {
            this.aiSyncAccum = 0;
            this.net.publishEvent({
              t: 'ai',
              waveLeft: this.enemyQueue.length + this.aiTanks.length,
              baseAlive: this.world.baseAlive,
              enemies: this.aiTanks.map((a) => [
                a.id,
                a.archetype || 'scout',
                Number(a.x.toFixed(2)),
                Number(a.z.toFixed(2)),
                Number(a.vx.toFixed(2)),
                Number(a.vz.toFixed(2)),
                Number(a.hullAngle.toFixed(2)),
                Number(a.turretAngle.toFixed(2)),
                a.hp,
                a.maxHp,
              ]),
            });
          }
        }
      }

      const waveLeft =
        this.mode === 'pvp' ? 0 : this.enemyQueue.length + this.aiTanks.length;
      this.world.updateRackCounts(waveLeft, this.mode === 'pvp' ? 0 : this.playerLives);

      this.ui.onHudUpdate({
        mode: this.mode,
        stageIndex: this.stageIndex,
        enemyWaveLeft: waveLeft,
        hp: this.localPlayer?.hp ?? 0,
        maxHp: this.localPlayer?.maxHp ?? 3,
        lives: this.playerLives,
        stars: this.localPlayer?.stars ?? 1,
        score: this.localPlayer?.score ?? 0,
        chargeRatio: this.localPlayer?.chargeRatio ?? 0,
        slowMo: this.slowMo,
        cameraPreset: this.cameraRig.preset,
      });
    } else if (this.mode === 'demo') {
      this.updateAiDirector(dt);
      this.updateProjectiles(dt);
    }

    this.world.update(dt, this.elapsed);
    this.vfx.update(dt);

    const pVec =
      this.localPlayer && this.localPlayer.alive
        ? new THREE.Vector3(this.localPlayer.x, 0, this.localPlayer.z)
        : null;
    this.cameraRig.update(rawDt, pVec, this.localPlayer?.turretAngle);

    const tiltAmt = this.cameraRig.preset === 'diorama' ? 0.36 : 0.0;
    this.post.render(this.elapsed, this.shockPulse + this.cameraRig.shakeIntensity * 0.4, tiltAmt);
  };
}
