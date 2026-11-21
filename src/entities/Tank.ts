import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/examples/jsm/geometries/RoundedBoxGeometry.js';
import { TextureBundle } from '../engine/ProceduralTextures';
import { EnemyArchetype, HALF_BOARD, NetTankSnapshot, TileType } from '../types';
import { DioramaWorld } from '../world/DioramaWorld';
import { VfxSystem } from '../vfx/VfxSystem';

function lerpAngle(a: number, b: number, t: number): number {
  const diff = Math.atan2(Math.sin(b - a), Math.cos(b - a));
  return a + diff * t;
}

let chargeGlowTexture: THREE.CanvasTexture | null = null;

function getChargeGlowTexture(): THREE.CanvasTexture {
  if (chargeGlowTexture) return chargeGlowTexture;
  const canvas = document.createElement('canvas');
  canvas.width = 128;
  canvas.height = 128;
  const ctx = canvas.getContext('2d')!;
  const grad = ctx.createRadialGradient(64, 64, 4, 64, 64, 62);
  grad.addColorStop(0, 'rgba(255, 236, 214, 0.95)');
  grad.addColorStop(0.35, 'rgba(255, 112, 48, 0.58)');
  grad.addColorStop(0.72, 'rgba(255, 46, 16, 0.2)');
  grad.addColorStop(1, 'rgba(255, 30, 10, 0)');
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, 128, 128);
  chargeGlowTexture = new THREE.CanvasTexture(canvas);
  chargeGlowTexture.colorSpace = THREE.SRGBColorSpace;
  return chargeGlowTexture;
}

// Shared static geometries & immutable materials so spawning/destroying wave tanks allocates zero GPU buffers
interface SharedTankAssets {
  trackGeo: THREE.BufferGeometry;
  wheelGeo: THREE.BufferGeometry;
  fenderGeo: THREE.BufferGeometry;
  hullGeo: THREE.BufferGeometry;
  glacisGeo: THREE.BufferGeometry;
  chevronGeo: THREE.BufferGeometry;
  grilleGeo: THREE.BufferGeometry;
  lampGeo: THREE.BufferGeometry;
  beamGeo: THREE.BufferGeometry;
  turretNormGeo: THREE.BufferGeometry;
  turretJugGeo: THREE.BufferGeometry;
  cupolaGeo: THREE.BufferGeometry;
  opticGeo: THREE.BufferGeometry;
  beaconGeo: THREE.BufferGeometry;
  antRodGeo: THREE.BufferGeometry;
  antTipGeo: THREE.BufferGeometry;
  mantletGeo: THREE.BufferGeometry;
  singleTubeGeo: THREE.BufferGeometry;
  brakeGeo: THREE.BufferGeometry;
  twinTubeGeo: THREE.BufferGeometry;
  twinBrakeGeo: THREE.BufferGeometry;
  coilGeo: THREE.BufferGeometry;
  shieldGeo: THREE.BufferGeometry;
  auraPlaneGeo: THREE.BufferGeometry;
  shadowPlaneGeo: THREE.BufferGeometry;
  teamRingGeo: THREE.BufferGeometry;
  voiceRingGeo: THREE.BufferGeometry;
  hpTrackGeo: THREE.BufferGeometry;
  hpFillGeo: THREE.BufferGeometry;
  darkTrimMat: THREE.MeshStandardMaterial;
  gunSteelMat: THREE.MeshStandardMaterial;
  grilleMat: THREE.MeshStandardMaterial;
  lampMat: THREE.MeshBasicMaterial;
  beamMat: THREE.MeshBasicMaterial;
  antTipMat: THREE.MeshBasicMaterial;
  coilMat: THREE.MeshBasicMaterial;
  opticMat: THREE.MeshBasicMaterial;
  hpTrackMat: THREE.MeshBasicMaterial;
}

let sharedAssets: SharedTankAssets | null = null;

function getSharedTankAssets(): SharedTankAssets {
  if (sharedAssets) return sharedAssets;

  const wheelGeo = new THREE.CylinderGeometry(0.14, 0.14, 0.38, 10);
  wheelGeo.rotateZ(Math.PI / 2);

  const beamGeo = new THREE.ConeGeometry(0.55, 2.7, 12, 1, true);
  beamGeo.translate(0, -1.35, 0);
  const bPos = beamGeo.attributes.position;
  const bCols = new Float32Array(bPos.count * 4);
  for (let i = 0; i < bPos.count; i++) {
    const a = Math.pow(1 + bPos.getY(i) / 2.7, 2.0) * 0.085;
    bCols[i * 4] = 1.0;
    bCols[i * 4 + 1] = 0.88;
    bCols[i * 4 + 2] = 0.62;
    bCols[i * 4 + 3] = a;
  }
  beamGeo.setAttribute('color', new THREE.BufferAttribute(bCols, 4));

  const auraPlaneGeo = new THREE.PlaneGeometry(2.4, 2.4);
  auraPlaneGeo.rotateX(-Math.PI / 2);

  const shadowPlaneGeo = new THREE.PlaneGeometry(2.35, 2.55);
  shadowPlaneGeo.rotateX(-Math.PI / 2);

  const teamRingGeo = new THREE.RingGeometry(0.86, 0.94, 28);
  teamRingGeo.rotateX(-Math.PI / 2);

  const voiceRingGeo = new THREE.RingGeometry(1.02, 1.13, 28);
  voiceRingGeo.rotateX(-Math.PI / 2);

  const hpFillGeo = new THREE.PlaneGeometry(1.16, 0.1);
  hpFillGeo.translate(0.58, 0, 0);

  sharedAssets = {
    trackGeo: new RoundedBoxGeometry(0.34, 0.42, 1.62, 1, 0.07),
    wheelGeo,
    fenderGeo: new RoundedBoxGeometry(0.38, 0.1, 1.68, 1, 0.03),
    hullGeo: new RoundedBoxGeometry(0.96, 0.38, 1.48, 1, 0.07),
    glacisGeo: new THREE.BoxGeometry(0.88, 0.18, 0.42),
    chevronGeo: new THREE.BoxGeometry(0.56, 0.035, 0.18),
    grilleGeo: new THREE.BoxGeometry(0.68, 0.16, 0.08),
    lampGeo: new THREE.CylinderGeometry(0.055, 0.055, 0.06, 8),
    beamGeo,
    turretNormGeo: new RoundedBoxGeometry(0.82, 0.36, 0.92, 1, 0.08),
    turretJugGeo: new RoundedBoxGeometry(0.96, 0.38, 1.04, 1, 0.08),
    cupolaGeo: new THREE.CylinderGeometry(0.17, 0.2, 0.12, 10),
    opticGeo: new THREE.BoxGeometry(0.22, 0.065, 0.08),
    beaconGeo: new THREE.SphereGeometry(0.13, 10, 8),
    antRodGeo: new THREE.CylinderGeometry(0.012, 0.024, 0.72, 6),
    antTipGeo: new THREE.SphereGeometry(0.035, 6, 6),
    mantletGeo: new RoundedBoxGeometry(0.36, 0.22, 0.22, 1, 0.04),
    singleTubeGeo: new THREE.CylinderGeometry(0.068, 0.085, 1.08, 10),
    brakeGeo: new RoundedBoxGeometry(0.19, 0.17, 0.22, 1, 0.03),
    twinTubeGeo: new THREE.CylinderGeometry(0.052, 0.064, 1.04, 8),
    twinBrakeGeo: new THREE.BoxGeometry(0.11, 0.12, 0.18),
    coilGeo: new THREE.TorusGeometry(0.13, 0.022, 6, 14),
    shieldGeo: new THREE.IcosahedronGeometry(1.18, 2),
    auraPlaneGeo,
    shadowPlaneGeo,
    teamRingGeo,
    voiceRingGeo,
    hpTrackGeo: new THREE.PlaneGeometry(1.22, 0.14),
    hpFillGeo,
    darkTrimMat: new THREE.MeshStandardMaterial({
      color: 0x222933,
      roughness: 0.48,
      metalness: 0.74,
    }),
    gunSteelMat: new THREE.MeshStandardMaterial({
      color: 0x6f7d8f,
      roughness: 0.26,
      metalness: 0.88,
    }),
    grilleMat: new THREE.MeshStandardMaterial({
      color: 0x1d2026,
      emissive: new THREE.Color(0xff5e14),
      emissiveIntensity: 0.9,
    }),
    lampMat: new THREE.MeshBasicMaterial({ color: new THREE.Color(2.6, 2.2, 1.5) }),
    beamMat: new THREE.MeshBasicMaterial({
      vertexColors: true,
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      side: THREE.DoubleSide,
    }),
    antTipMat: new THREE.MeshBasicMaterial({ color: new THREE.Color(2.2, 1.5, 0.4) }),
    coilMat: new THREE.MeshBasicMaterial({ color: new THREE.Color(2.8, 1.85, 0.65) }),
    opticMat: new THREE.MeshBasicMaterial({ color: new THREE.Color(0.45, 1.95, 2.4) }),
    hpTrackMat: new THREE.MeshBasicMaterial({
      color: 0x0b0f16,
      transparent: true,
      opacity: 0.78,
      depthWrite: false,
    }),
  };
  return sharedAssets;
}

export interface TankOptions {
  id: string;
  team: 'player' | 'enemy';
  color: number;
  name?: string;
  archetype?: EnemyArchetype;
  isBonusCarrier?: boolean;
  isRemote?: boolean;
}

export class Tank {
  public readonly id: string;
  public readonly team: 'player' | 'enemy';
  public readonly archetype?: EnemyArchetype;
  public isBonusCarrier: boolean;
  public isRemote: boolean;
  public name: string;

  public readonly root = new THREE.Group();
  public modSelection = 'default';
  private hullYawGroup = new THREE.Group();
  private suspensionGroup = new THREE.Group();
  private modGroup = new THREE.Group();
  private turretGroup = new THREE.Group();
  private gunRecoilGroup = new THREE.Group();
  private antennaPivot = new THREE.Group();
  private shieldMesh!: THREE.Mesh;
  private shieldMat!: THREE.ShaderMaterial;
  private shieldUniforms = { uTime: { value: 0 }, uOpacity: { value: 0 } };

  private primaryMat!: THREE.MeshStandardMaterial;
  private accentMat!: THREE.MeshStandardMaterial;
  private muzzleMat!: THREE.MeshStandardMaterial;
  private barrelMat!: THREE.MeshStandardMaterial;
  private treadMat!: THREE.MeshStandardMaterial;
  private treadTex!: THREE.CanvasTexture;
  private shadowMat!: THREE.MeshBasicMaterial;
  private teamRingMesh!: THREE.Mesh;
  private teamRingMat!: THREE.MeshBasicMaterial;
  private voiceRingMesh!: THREE.Mesh;
  private voiceRingMat!: THREE.MeshBasicMaterial;
  private chargeGlow!: THREE.Mesh;
  private chargeGlowMat!: THREE.MeshBasicMaterial;
  private singleBarrel!: THREE.Group;
  private twinBarrels!: THREE.Group;
  private railCoils!: THREE.Group;
  private bonusBeacon?: THREE.Mesh;
  private bonusBeaconMat?: THREE.MeshBasicMaterial;
  private labelSprite?: THREE.Sprite;
  private labelMat?: THREE.SpriteMaterial;
  private labelTex?: THREE.CanvasTexture;

  private hpBarGroup = new THREE.Group();
  private hpFillMesh!: THREE.Mesh;
  private hpFillMat!: THREE.MeshBasicMaterial;

  public x = 0;
  public z = 0;
  public vx = 0;
  public vz = 0;
  // Post-collision true ground velocity for drift-free network broadcast
  public syncVx = 0;
  public syncVz = 0;
  public hullAngle = 0; // 0 = +Z, Math.PI = -Z
  public turretAngle = 0;

  public hp = 1;
  public maxHp = 1;
  public stars = 1;
  public alive = true;
  public isSpeaking = false;
  public shieldTimer = 0;
  public speedTimer = 0;
  public armorTimer = 0;
  public attackTimer = 0;
  public fireCooldown = 0;
  public chargeRatio = 0;
  public kills = 0;
  public score = 0;

  public maxSpeed = 5.8;
  public bulletSpeed = 16.5;
  public reloadTime = 0.42;
  public radius = 0.76;

  private pitch = 0;
  private pitchVel = 0;
  private roll = 0;
  private rollVel = 0;
  private recoilOffset = 0;
  private barrelHeat = 0;
  private trackDistAccum = 0;
  private smokeAccum = 0;
  private baseColorHex: number;
  private cheatGlow = false;
  private cheatLight?: THREE.PointLight;

  // Remote network target state (anti-drift bounded dead-reckoning + sequence guard)
  private lastNetSeq = 0;
  private hasNetInit = false;
  private netAge = 0;
  private netX = 0;
  private netZ = 0;
  private netVx = 0;
  private netVz = 0;
  private netHull = 0;
  private netTurret = 0;

  // AI helper state
  public aiDirAngle = 0;
  public aiTurnTimer = 0;
  public aiShootTimer = 0.6;
  public aiStuckTime = 0;

  constructor(opts: TankOptions, textures: TextureBundle) {
    this.id = opts.id;
    this.team = opts.team;
    this.archetype = opts.archetype;
    this.isBonusCarrier = Boolean(opts.isBonusCarrier);
    this.isRemote = Boolean(opts.isRemote);
    this.name = opts.name || '';
    this.baseColorHex = opts.color;

    this.configureStats();
    this.buildModel(textures);
    if (this.name) {
      this.buildNameBadge(this.name, opts.color);
    }
  }

  private configureStats(): void {
    if (this.team === 'player') {
      this.maxHp = 3;
      this.hp = 3;
      this.maxSpeed = 6.2;
      this.bulletSpeed = 17.5;
      this.reloadTime = 0.36;
    } else {
      switch (this.archetype) {
        case 'scout':
          this.maxHp = 1;
          this.maxSpeed = 7.2;
          this.bulletSpeed = 16.5;
          this.reloadTime = 0.78;
          break;
        case 'raider':
          this.maxHp = 2;
          this.maxSpeed = 5.4;
          this.bulletSpeed = 21.5;
          this.reloadTime = 0.85;
          break;
        case 'twin':
          this.maxHp = 2;
          this.maxSpeed = 5.2;
          this.bulletSpeed = 17.0;
          this.reloadTime = 0.46;
          break;
        case 'juggernaut':
          this.maxHp = 4;
          this.maxSpeed = 3.9;
          this.bulletSpeed = 16.5;
          this.reloadTime = 0.95;
          break;
        default:
          this.maxHp = 1;
          this.maxSpeed = 5.0;
          this.bulletSpeed = 15.5;
          this.reloadTime = 0.9;
      }
      this.hp = this.maxHp;
    }
  }

  private buildModel(textures: TextureBundle): void {
    const shared = getSharedTankAssets();
    const scaleFactor =
      this.archetype === 'juggernaut' ? 1.12 : this.archetype === 'scout' ? 0.92 : 1.0;

    this.primaryMat = new THREE.MeshStandardMaterial({
      color: this.baseColorHex,
      normalMap: textures.armorNormal,
      normalScale: new THREE.Vector2(0.45, 0.45),
      roughness: 0.34,
      metalness: 0.64,
    });

    this.accentMat = new THREE.MeshStandardMaterial({
      color: new THREE.Color(this.baseColorHex).multiplyScalar(1.35),
      roughness: 0.26,
      metalness: 0.78,
    });

    this.muzzleMat = new THREE.MeshStandardMaterial({
      color: 0x3b434f,
      roughness: 0.32,
      metalness: 0.82,
      emissive: new THREE.Color(0xff7b1a),
      emissiveIntensity: 0,
    });

    this.barrelMat = new THREE.MeshStandardMaterial({
      color: 0x6f7d8f,
      roughness: 0.28,
      metalness: 0.86,
      emissive: new THREE.Color(0xff2a0a),
      emissiveIntensity: 0,
    });

    this.treadTex = textures.treadMap.clone();
    this.treadTex.needsUpdate = true;
    this.treadMat = new THREE.MeshStandardMaterial({
      map: this.treadTex,
      roughness: 0.78,
      metalness: 0.35,
    });

    // Ground Contact Ambient Occlusion Shadow (grounds both standard tanks and GLB MOD cars!)
    this.shadowMat = new THREE.MeshBasicMaterial({
      map: textures.contactShadowTex,
      transparent: true,
      opacity: 0.82,
      depthWrite: false,
      polygonOffset: true,
      polygonOffsetFactor: -3,
    });
    const contactShadow = new THREE.Mesh(shared.shadowPlaneGeo, this.shadowMat);
    contactShadow.position.y = 0.016;
    this.hullYawGroup.add(contactShadow);

    // Subtle Squad/Team Base Ring (especially helpful on MOD vehicles & multiplayer identification)
    this.teamRingMat = new THREE.MeshBasicMaterial({
      color: new THREE.Color(this.baseColorHex).multiplyScalar(1.5),
      transparent: true,
      opacity: this.team === 'player' || this.isRemote ? 0.38 : 0.0,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
    });
    this.teamRingMesh = new THREE.Mesh(shared.teamRingGeo, this.teamRingMat);
    this.teamRingMesh.position.y = 0.025;
    this.teamRingMesh.visible = this.team === 'player' || this.isRemote;
    this.root.add(this.teamRingMesh);

    // 3D Diegetic Voice Speaking Ring (pulses emerald when peer talks!)
    this.voiceRingMat = new THREE.MeshBasicMaterial({
      color: new THREE.Color(0.35, 2.2, 1.15),
      transparent: true,
      opacity: 0,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
    });
    this.voiceRingMesh = new THREE.Mesh(shared.voiceRingGeo, this.voiceRingMat);
    this.voiceRingMesh.position.y = 0.032;
    this.voiceRingMesh.visible = false;
    this.root.add(this.voiceRingMesh);

    this.root.add(this.hullYawGroup);
    this.hullYawGroup.add(this.suspensionGroup);
    this.hullYawGroup.add(this.modGroup);
    this.hullYawGroup.scale.setScalar(scaleFactor);

    // 1. Track Housings & Road Wheels
    const leftTrack = new THREE.Mesh(shared.trackGeo, this.treadMat);
    leftTrack.position.set(-0.58, 0.22, 0);
    leftTrack.castShadow = true;
    leftTrack.receiveShadow = true;
    this.suspensionGroup.add(leftTrack);

    const rightTrack = new THREE.Mesh(shared.trackGeo, this.treadMat);
    rightTrack.position.set(0.58, 0.22, 0);
    rightTrack.castShadow = true;
    rightTrack.receiveShadow = true;
    this.suspensionGroup.add(rightTrack);

    for (let w = -2; w <= 2; w++) {
      const lw = new THREE.Mesh(shared.wheelGeo, shared.darkTrimMat);
      lw.position.set(-0.58, 0.15, w * 0.31);
      this.suspensionGroup.add(lw);
      const rw = new THREE.Mesh(shared.wheelGeo, shared.darkTrimMat);
      rw.position.set(0.58, 0.15, w * 0.31);
      this.suspensionGroup.add(rw);
    }

    const lf = new THREE.Mesh(shared.fenderGeo, this.primaryMat);
    lf.position.set(-0.58, 0.45, 0);
    lf.castShadow = true;
    this.suspensionGroup.add(lf);
    const rf = new THREE.Mesh(shared.fenderGeo, this.primaryMat);
    rf.position.set(0.58, 0.45, 0);
    rf.castShadow = true;
    this.suspensionGroup.add(rf);

    // 2. Sloped Glacis Main Hull + Tactical Squad Stripe
    const hullMain = new THREE.Mesh(shared.hullGeo, this.primaryMat);
    hullMain.position.set(0, 0.38, 0);
    hullMain.castShadow = true;
    hullMain.receiveShadow = true;
    this.suspensionGroup.add(hullMain);

    const glacis = new THREE.Mesh(shared.glacisGeo, this.primaryMat);
    glacis.position.set(0, 0.45, 0.62);
    glacis.rotation.x = 0.32;
    glacis.castShadow = true;
    this.suspensionGroup.add(glacis);

    const stripe = new THREE.Mesh(shared.chevronGeo, this.accentMat);
    stripe.position.set(0, 0.51, 0.56);
    stripe.rotation.x = 0.32;
    this.suspensionGroup.add(stripe);

    const grille = new THREE.Mesh(shared.grilleGeo, shared.grilleMat);
    grille.position.set(0, 0.44, -0.73);
    this.suspensionGroup.add(grille);

    for (const sx of [-0.32, 0.32]) {
      const lamp = new THREE.Mesh(shared.lampGeo, shared.lampMat);
      lamp.rotation.x = Math.PI / 2;
      lamp.position.set(sx, 0.48, 0.75);
      this.suspensionGroup.add(lamp);

      const beam = new THREE.Mesh(shared.beamGeo, shared.beamMat);
      beam.rotation.x = -Math.PI / 2 + 0.08;
      beam.position.set(sx, 0.48, 0.78);
      this.suspensionGroup.add(beam);
    }

    // 3. Independent 360° Turret + Commander Optics
    this.turretGroup.position.set(0, 0.58, -0.04);
    this.suspensionGroup.add(this.turretGroup);

    const turretBody = new THREE.Mesh(
      this.archetype === 'juggernaut' ? shared.turretJugGeo : shared.turretNormGeo,
      this.primaryMat,
    );
    turretBody.position.y = 0.16;
    turretBody.castShadow = true;
    turretBody.receiveShadow = true;
    this.turretGroup.add(turretBody);

    const cupola = new THREE.Mesh(shared.cupolaGeo, shared.darkTrimMat);
    cupola.position.set(-0.18, 0.38, -0.1);
    this.turretGroup.add(cupola);

    const optic = new THREE.Mesh(shared.opticGeo, shared.opticMat);
    optic.position.set(0.2, 0.34, 0.36);
    this.turretGroup.add(optic);

    if (this.isBonusCarrier) {
      this.bonusBeaconMat = new THREE.MeshBasicMaterial({ color: new THREE.Color(3.2, 0.45, 0.3) });
      this.bonusBeacon = new THREE.Mesh(shared.beaconGeo, this.bonusBeaconMat);
      this.bonusBeacon.position.set(0.2, 0.44, -0.14);
      this.turretGroup.add(this.bonusBeacon);
    }

    // Spring Whip Antenna
    this.antennaPivot.position.set(0.26, 0.34, -0.32);
    const antRod = new THREE.Mesh(shared.antRodGeo, shared.gunSteelMat);
    antRod.position.y = 0.36;
    this.antennaPivot.add(antRod);
    const antTip = new THREE.Mesh(shared.antTipGeo, shared.antTipMat);
    antTip.position.y = 0.73;
    this.antennaPivot.add(antTip);
    this.turretGroup.add(this.antennaPivot);

    // 4. Recoiling Cannon Assembly
    this.gunRecoilGroup.position.set(0, 0.17, 0.38);
    this.turretGroup.add(this.gunRecoilGroup);

    this.gunRecoilGroup.add(new THREE.Mesh(shared.mantletGeo, shared.darkTrimMat));

    this.singleBarrel = new THREE.Group();
    const bTube = new THREE.Mesh(shared.singleTubeGeo, this.barrelMat);
    bTube.rotation.x = Math.PI / 2;
    bTube.position.z = 0.56;
    bTube.castShadow = true;
    this.singleBarrel.add(bTube);

    const brake = new THREE.Mesh(shared.brakeGeo, this.muzzleMat);
    brake.position.z = 1.12;
    this.singleBarrel.add(brake);
    this.gunRecoilGroup.add(this.singleBarrel);

    this.twinBarrels = new THREE.Group();
    for (const bx of [-0.12, 0.12]) {
      const tb = new THREE.Mesh(shared.twinTubeGeo, this.barrelMat);
      tb.rotation.x = Math.PI / 2;
      tb.position.set(bx, 0, 0.54);
      tb.castShadow = true;
      this.twinBarrels.add(tb);

      const mb = new THREE.Mesh(shared.twinBrakeGeo, this.muzzleMat);
      mb.position.set(bx, 0, 1.08);
      this.twinBarrels.add(mb);
    }
    this.gunRecoilGroup.add(this.twinBarrels);

    this.railCoils = new THREE.Group();
    for (let c = 0; c < 3; c++) {
      const ring = new THREE.Mesh(shared.coilGeo, shared.coilMat);
      ring.position.z = 0.34 + c * 0.26;
      this.railCoils.add(ring);
    }
    this.railCoils.visible = false;
    this.gunRecoilGroup.add(this.railCoils);

    this.refreshWeaponVisuals();

    // 5. Fresnel Energy Shield Dome
    this.shieldMat = new THREE.ShaderMaterial({
      uniforms: this.shieldUniforms,
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      side: THREE.DoubleSide,
      vertexShader: /* glsl */ `
        varying vec3 vNormalW;
        varying vec3 vWorldPos;
        void main() {
          vec4 wp = modelMatrix * vec4(position, 1.0);
          vWorldPos = wp.xyz;
          vNormalW = normalize(mat3(modelMatrix) * normal);
          gl_Position = projectionMatrix * viewMatrix * wp;
        }
      `,
      fragmentShader: /* glsl */ `
        uniform float uTime;
        uniform float uOpacity;
        varying vec3 vNormalW;
        varying vec3 vWorldPos;
        void main() {
          vec3 vd = normalize(cameraPosition - vWorldPos);
          float rim = pow(1.0 - abs(dot(vd, normalize(vNormalW))), 2.2);
          float scan = sin(vWorldPos.y * 14.0 - uTime * 8.0) * 0.5 + 0.5;
          vec3 col = mix(vec3(0.22, 0.78, 1.0), vec3(1.0, 0.85, 0.42), scan * 0.35);
          gl_FragColor = vec4(col * 1.8, (rim * 0.78 + 0.08) * uOpacity);
        }
      `,
    });
    this.shieldMesh = new THREE.Mesh(shared.shieldGeo, this.shieldMat);
    this.shieldMesh.position.y = 0.52;
    this.shieldMesh.visible = false;
    this.root.add(this.shieldMesh);

    // 6. Red charge aura beneath the hull
    this.chargeGlowMat = new THREE.MeshBasicMaterial({
      map: getChargeGlowTexture(),
      color: new THREE.Color(1.7, 0.32, 0.08),
      transparent: true,
      opacity: 0,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
    });
    this.chargeGlow = new THREE.Mesh(shared.auraPlaneGeo, this.chargeGlowMat);
    this.chargeGlow.position.y = 0.035;
    this.chargeGlow.visible = false;
    this.chargeGlow.renderOrder = 2;
    this.root.add(this.chargeGlow);

    // 7. Diegetic Micro HP Bar (visible when damaged on multi-HP tanks)
    this.hpBarGroup.position.set(0, 1.38, 0);
    const hpBg = new THREE.Mesh(shared.hpTrackGeo, shared.hpTrackMat);
    this.hpBarGroup.add(hpBg);
    this.hpFillMat = new THREE.MeshBasicMaterial({
      color: this.team === 'player' ? 0xe5a83b : 0xe05545,
      depthWrite: false,
    });
    this.hpFillMesh = new THREE.Mesh(shared.hpFillGeo, this.hpFillMat);
    this.hpFillMesh.position.set(-0.58, 0, 0.004);
    this.hpBarGroup.add(this.hpFillMesh);
    this.hpBarGroup.visible = false;
    this.root.add(this.hpBarGroup);
  }

  private buildNameBadge(label: string, colorHex: number): void {
    const canvas = document.createElement('canvas');
    canvas.width = 256;
    canvas.height = 64;
    const ctx = canvas.getContext('2d')!;
    ctx.fillStyle = 'rgba(10, 14, 21, 0.84)';
    ctx.fillRect(22, 14, 212, 36);
    ctx.strokeStyle = '#' + colorHex.toString(16).padStart(6, '0');
    ctx.lineWidth = 3;
    ctx.strokeRect(22, 14, 212, 36);
    ctx.font = 'bold 22px "Noto Sans SC", sans-serif';
    ctx.fillStyle = '#f2ede2';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(label.slice(0, 9), 128, 33);

    this.labelTex = new THREE.CanvasTexture(canvas);
    this.labelTex.colorSpace = THREE.SRGBColorSpace;
    this.labelMat = new THREE.SpriteMaterial({
      map: this.labelTex,
      transparent: true,
      depthWrite: false,
    });
    this.labelSprite = new THREE.Sprite(this.labelMat);
    this.labelSprite.position.set(0, 1.72, 0);
    this.labelSprite.scale.set(2.2, 0.55, 1);
    this.root.add(this.labelSprite);
  }

  public refreshWeaponVisuals(): void {
    const useTwin = this.archetype === 'twin' || this.stars >= 2 || this.attackTimer > 0;
    this.singleBarrel.visible = !useTwin;
    this.twinBarrels.visible = useTwin;
    this.railCoils.visible = this.stars >= 3 || this.attackTimer > 0 || this.chargeRatio > 0.2;

    if (this.team === 'player') {
      const baseReload = this.stars >= 2 ? 0.25 : 0.35;
      const baseBullet = this.stars >= 2 ? 21.5 : 17.5;
      this.reloadTime = this.attackTimer > 0 ? baseReload * 0.72 : baseReload;
      this.bulletSpeed = this.attackTimer > 0 ? baseBullet * 1.2 : baseBullet;
    }
  }

  public setPosition(x: number, z: number, angle = Math.PI): void {
    this.x = x;
    this.z = z;
    this.vx = 0;
    this.vz = 0;
    this.syncVx = 0;
    this.syncVz = 0;
    this.hullAngle = angle;
    this.turretAngle = angle;
    this.netX = x;
    this.netZ = z;
    this.netVx = 0;
    this.netVz = 0;
    this.netHull = angle;
    this.netTurret = angle;
    this.netAge = 0;
    this.hasNetInit = true;
    this.syncTransforms();
  }

  public triggerRecoil(heavy: boolean): void {
    this.recoilOffset = heavy ? 0.32 : 0.2;
    this.barrelHeat = Math.min(1.0, this.barrelHeat + (heavy ? 0.85 : 0.42));
    const relAngle = this.turretAngle - this.hullAngle;
    this.pitchVel -= Math.cos(relAngle) * (heavy ? 5.2 : 2.8);
    this.rollVel += Math.sin(relAngle) * (heavy ? 4.4 : 2.2);
  }

  public setModModel(model: THREE.Object3D | null, yaw = 0): void {
    this.modGroup.clear();
    if (!model) {
      this.suspensionGroup.visible = true;
      this.teamRingMat.opacity = this.team === 'player' || this.isRemote ? 0.38 : 0.0;
      return;
    }

    const holder = new THREE.Group();
    holder.rotation.y = yaw;
    holder.add(model);
    holder.updateMatrixWorld(true);

    const rawSize = new THREE.Box3().setFromObject(holder).getSize(new THREE.Vector3());
    let scale = 1.9 / Math.max(rawSize.x, rawSize.z, 0.001);
    if (rawSize.y * scale > 1.6) scale = 1.6 / Math.max(rawSize.y, 0.001);
    holder.scale.setScalar(scale);
    holder.updateMatrixWorld(true);

    const box = new THREE.Box3().setFromObject(holder);
    const center = box.getCenter(new THREE.Vector3());
    holder.position.set(-center.x, -box.min.y + 0.02, -center.z);

    this.modGroup.add(holder);
    this.suspensionGroup.visible = false;
    this.teamRingMesh.visible = true;
    this.teamRingMat.opacity = 0.62;
  }

  public setCheatGlow(enabled: boolean): void {
    this.cheatGlow = enabled;
    if (enabled) {
      if (!this.cheatLight) {
        this.cheatLight = new THREE.PointLight(0xff2a14, 0, 7.5, 2);
        this.cheatLight.position.set(0, 0.9, 0);
        this.root.add(this.cheatLight);
      }
      this.primaryMat.emissive.setHex(0xff2208);
      this.cheatLight.intensity = 14;
    } else {
      this.primaryMat.emissive.setHex(0x000000);
      this.primaryMat.emissiveIntensity = 1;
      if (this.cheatLight) this.cheatLight.intensity = 0;
    }
  }

  public takeDamage(dmg: number): boolean {
    if (!this.alive || this.shieldTimer > 0) return false;
    const effectiveDmg = this.armorTimer > 0 ? dmg * 0.5 : dmg;
    this.hp = Math.max(0, Number((this.hp - effectiveDmg).toFixed(2)));

    if (this.archetype === 'juggernaut' && this.hp > 0) {
      const stages = [0x9e4b3b, 0xb88635, 0x5c8a66, 0x5c6878];
      this.primaryMat.color.setHex(stages[Math.min(stages.length - 1, Math.ceil(this.hp) - 1)]);
    }

    if (this.hp <= 0.01) {
      this.hp = 0;
      this.alive = false;
      this.root.visible = false;
      return true;
    }
    return false;
  }

  public respawn(x: number, z: number, angle = Math.PI, shieldSec = 3.0): void {
    this.alive = true;
    this.hp = this.maxHp;
    this.chargeRatio = 0;
    this.speedTimer = 0;
    this.armorTimer = 0;
    this.attackTimer = 0;
    this.chargeGlow.visible = false;
    this.primaryMat.color.setHex(this.baseColorHex);
    this.shieldTimer = shieldSec;
    this.root.visible = true;
    this.lastNetSeq = 0;
    this.refreshWeaponVisuals();
    this.setPosition(x, z, angle);
  }

  public getMuzzleWorldPosition(out = new THREE.Vector3()): THREE.Vector3 {
    const dist = 1.38;
    out.set(
      this.x + Math.sin(this.turretAngle) * dist,
      0.76,
      this.z + Math.cos(this.turretAngle) * dist,
    );
    return out;
  }

  public applyNetState(snap: NetTankSnapshot): void {
    // Discard stale / out-of-order MQTT QoS 0 packets to prevent rubberband jitter
    if (snap.seq > 0 && snap.seq <= this.lastNetSeq && this.lastNetSeq - snap.seq < 300) {
      return;
    }
    if (snap.seq > 0) this.lastNetSeq = snap.seq;

    const wasAlive = this.alive;
    this.alive = snap.alive > 0;
    this.root.visible = this.alive;
    if (!this.alive) this.chargeGlow.visible = false;

    this.netX = snap.x;
    this.netZ = snap.z;
    this.netVx = snap.vx;
    this.netVz = snap.vz;
    this.netHull = snap.hull;
    this.netTurret = snap.turret;
    this.netAge = 0;

    this.hp = snap.hp;
    this.maxHp = snap.maxHp;
    this.shieldTimer = snap.shield;
    this.speedTimer = snap.speed;
    this.armorTimer = snap.armor;
    this.attackTimer = snap.attack;
    this.chargeRatio = snap.charge;
    this.stars = snap.stars;
    this.kills = snap.kills;
    this.score = snap.score;

    const distErr = Math.hypot(snap.x - this.x, snap.z - this.z);
    if ((!wasAlive && this.alive) || !this.hasNetInit || distErr > 2.8) {
      this.hasNetInit = true;
      this.x = snap.x;
      this.z = snap.z;
      this.vx = snap.vx;
      this.vz = snap.vz;
      this.hullAngle = snap.hull;
      this.turretAngle = snap.turret;
      this.syncTransforms();
    }

    this.refreshWeaponVisuals();
  }

  public toNetSnapshot(seq: number): NetTankSnapshot {
    return {
      seq,
      x: Number(this.x.toFixed(3)),
      z: Number(this.z.toFixed(3)),
      vx: Number(this.syncVx.toFixed(2)),
      vz: Number(this.syncVz.toFixed(2)),
      hull: Number(this.hullAngle.toFixed(3)),
      turret: Number(this.turretAngle.toFixed(3)),
      hp: Number(this.hp.toFixed(2)),
      maxHp: this.maxHp,
      shield: Number(this.shieldTimer.toFixed(2)),
      speed: Number(this.speedTimer.toFixed(2)),
      armor: Number(this.armorTimer.toFixed(2)),
      attack: Number(this.attackTimer.toFixed(2)),
      charge: Number(this.chargeRatio.toFixed(2)),
      stars: this.stars,
      alive: this.alive ? 1 : 0,
      kills: this.kills,
      score: this.score,
    };
  }

  public driveWithInput(
    moveX: number,
    moveZ: number,
    aimWorldAngle: number | null,
    dt: number,
    world: DioramaWorld,
    otherTanks: Tank[],
    vfx: VfxSystem,
  ): void {
    if (!this.alive) return;

    const [gx, gz] = world.worldToGrid(this.x, this.z);
    const onIce = world.getTile(gx, gz) === TileType.ICE;

    const speedBoost = this.speedTimer > 0 ? 1.45 : 1.0;
    const topSpeed = this.maxSpeed * speedBoost;
    const inputLen = Math.hypot(moveX, moveZ);
    const accel = (onIce ? 10.5 : 42.0) * (this.speedTimer > 0 ? 1.35 : 1.0);
    const stopDrag = onIce ? 1.75 : 18.0;
    const lateralGrip = onIce ? 2.2 : 28.0;

    const prevVx = this.vx;
    const prevVz = this.vz;
    const prevX = this.x;
    const prevZ = this.z;

    if (inputLen > 0.05) {
      const nx = moveX / inputLen;
      const nz = moveZ / inputLen;
      const desiredHull = Math.atan2(nx, nz);
      const turnRate = (onIce ? 11.0 : 18.5) * (this.speedTimer > 0 ? 1.25 : 1.0);
      this.hullAngle = lerpAngle(this.hullAngle, desiredHull, Math.min(1, dt * turnRate));

      // Decompose velocity into forward drive axis + lateral slip axis
      const px = -nz;
      const pz = nx;
      let fwdSpd = this.vx * nx + this.vz * nz;
      let latSpd = this.vx * px + this.vz * pz;

      fwdSpd = Math.min(topSpeed, fwdSpd + accel * dt);
      latSpd *= Math.exp(-lateralGrip * dt);

      this.vx = nx * fwdSpd + px * latSpd;
      this.vz = nz * fwdSpd + pz * latSpd;

      const spd = Math.hypot(this.vx, this.vz);
      if (spd > topSpeed) {
        this.vx = (this.vx / spd) * topSpeed;
        this.vz = (this.vz / spd) * topSpeed;
      }
    } else {
      const damp = Math.exp(-stopDrag * dt);
      this.vx *= damp;
      this.vz *= damp;
      if (Math.hypot(this.vx, this.vz) < 0.05) {
        this.vx = 0;
        this.vz = 0;
      }
    }

    // Apply acceleration impulse to hull pitch
    const forwardX = Math.sin(this.hullAngle);
    const forwardZ = Math.cos(this.hullAngle);
    const dvForward = (this.vx - prevVx) * forwardX + (this.vz - prevVz) * forwardZ;
    this.pitchVel -= dvForward * 0.42;

    // Move with smooth corner-assist collision
    this.resolveGridMovement(this.vx * dt, this.vz * dt, world, otherTanks);

    // Measure actual post-collision ground velocity so blocked walls never broadcast phantom speed
    if (dt > 1e-4) {
      this.syncVx = (this.x - prevX) / dt;
      this.syncVz = (this.z - prevZ) / dt;
      if (Math.hypot(this.syncVx, this.syncVz) < 0.05) {
        this.syncVx = 0;
        this.syncVz = 0;
      }
    }

    // Turret aiming
    const targetTurret = aimWorldAngle !== null ? aimWorldAngle : this.hullAngle;
    this.turretAngle = lerpAngle(this.turretAngle, targetTurret, Math.min(1, dt * 19.0));

    this.updateVisualKinematics(dt, vfx, Math.hypot(this.syncVx, this.syncVz));
  }

  public updateRemote(dt: number, world: DioramaWorld, vfx: VfxSystem): void {
    if (!this.alive) return;

    const prevX = this.x;
    const prevZ = this.z;
    this.netAge += dt;

    // Bounded, collision-aware dead reckoning (max 110ms) prevents drifting into walls or overshooting stops
    const remSpeed = Math.hypot(this.netVx, this.netVz);
    if (remSpeed > 0.04 && this.netAge < 0.11) {
      const taper = this.netAge > 0.065 ? Math.max(0, 1 - (this.netAge - 0.065) / 0.045) : 1.0;
      const stepX = this.netVx * dt * taper;
      const stepZ = this.netVz * dt * taper;
      if (Math.abs(stepX) > 1e-5 && !this.collidesAt(this.netX + stepX, this.netZ, world, [])) {
        this.netX += stepX;
      }
      if (Math.abs(stepZ) > 1e-5 && !this.collidesAt(this.netX, this.netZ + stepZ, world, [])) {
        this.netZ += stepZ;
      }
    }

    const errX = this.netX - this.x;
    const errZ = this.netZ - this.z;
    const errDist = Math.hypot(errX, errZ);

    if (remSpeed < 0.05 && errDist < 0.015) {
      this.x = this.netX;
      this.z = this.netZ;
    } else {
      const rate = remSpeed < 0.05 ? 24.0 : errDist > 0.55 ? 22.0 : 16.5;
      const k = 1 - Math.exp(-dt * rate);
      this.x += errX * k;
      this.z += errZ * k;
    }

    const actualSpeed = dt > 1e-4 ? Math.hypot(this.x - prevX, this.z - prevZ) / dt : 0;
    this.vx = dt > 1e-4 ? (this.x - prevX) / dt : 0;
    this.vz = dt > 1e-4 ? (this.z - prevZ) / dt : 0;

    const rotK = 1 - Math.exp(-dt * 20.0);
    this.hullAngle = lerpAngle(this.hullAngle, this.netHull, rotK);
    this.turretAngle = lerpAngle(this.turretAngle, this.netTurret, Math.min(1, dt * 22.0));

    this.updateVisualKinematics(dt, vfx, actualSpeed);
  }

  private isCellSolidForTank(tile: TileType): boolean {
    return (
      tile === TileType.BRICK ||
      tile === TileType.STEEL ||
      tile === TileType.WATER ||
      tile === TileType.BASE
    );
  }

  private collidesAt(nx: number, nz: number, world: DioramaWorld, otherTanks: Tank[]): boolean {
    const r = this.radius;
    const limit = HALF_BOARD - r;
    if (nx < -limit || nx > limit || nz < -limit || nz > limit) return true;

    const [minGx, minGz] = world.worldToGrid(nx - r, nz - r);
    const [maxGx, maxGz] = world.worldToGrid(nx + r, nz + r);

    for (let gz = minGz; gz <= maxGz; gz++) {
      for (let gx = minGx; gx <= maxGx; gx++) {
        if (!this.isCellSolidForTank(world.getTile(gx, gz))) continue;
        const cx = world.gridToWorldX(gx);
        const cz = world.gridToWorldZ(gz);
        const nearestX = Math.max(cx - 0.5, Math.min(nx, cx + 0.5));
        const nearestZ = Math.max(cz - 0.5, Math.min(nz, cz + 0.5));
        const dx = nx - nearestX;
        const dz = nz - nearestZ;
        if (dx * dx + dz * dz < r * r - 0.0004) {
          return true;
        }
      }
    }

    for (const other of otherTanks) {
      if (other === this || !other.alive) continue;
      const minDist = this.radius + other.radius - 0.06;
      const dx = nx - other.x;
      const dz = nz - other.z;
      if (dx * dx + dz * dz < minDist * minDist) {
        return true;
      }
    }
    return false;
  }

  private resolveGridMovement(
    dx: number,
    dz: number,
    world: DioramaWorld,
    otherTanks: Tank[],
  ): void {
    // Axis X with Corner-Assist Z nudge
    if (Math.abs(dx) > 1e-5) {
      if (!this.collidesAt(this.x + dx, this.z, world, otherTanks)) {
        this.x += dx;
      } else {
        for (const sign of [-1, 1]) {
          if (
            !this.collidesAt(this.x + dx, this.z + sign * 0.42, world, otherTanks) &&
            !this.collidesAt(this.x, this.z + sign * Math.abs(dx) * 0.85, world, otherTanks)
          ) {
            this.z += sign * Math.abs(dx) * 0.85;
            break;
          }
        }
        this.vx = 0;
      }
    }

    // Axis Z with Corner-Assist X nudge
    if (Math.abs(dz) > 1e-5) {
      if (!this.collidesAt(this.x, this.z + dz, world, otherTanks)) {
        this.z += dz;
      } else {
        for (const sign of [-1, 1]) {
          if (
            !this.collidesAt(this.x + sign * 0.42, this.z + dz, world, otherTanks) &&
            !this.collidesAt(this.x + sign * Math.abs(dz) * 0.85, this.z, world, otherTanks)
          ) {
            this.x += sign * Math.abs(dz) * 0.85;
            break;
          }
        }
        this.vz = 0;
      }
    }
  }

  private updateVisualKinematics(dt: number, vfx: VfxSystem, groundSpeed: number): void {
    this.fireCooldown = Math.max(0, this.fireCooldown - dt);
    this.shieldTimer = Math.max(0, this.shieldTimer - dt);
    this.speedTimer = Math.max(0, this.speedTimer - dt);
    this.armorTimer = Math.max(0, this.armorTimer - dt);
    const hadAttack = this.attackTimer > 0;
    this.attackTimer = Math.max(0, this.attackTimer - dt);
    if (hadAttack && this.attackTimer === 0) {
      this.refreshWeaponVisuals();
    }

    // Suspension damped spring
    this.pitchVel += -this.pitch * 48 * dt;
    this.pitchVel *= Math.exp(-9.5 * dt);
    this.pitch += this.pitchVel * dt;

    this.rollVel += -this.roll * 48 * dt;
    this.rollVel *= Math.exp(-9.5 * dt);
    this.roll += this.rollVel * dt;

    this.recoilOffset *= Math.exp(-13 * dt);
    this.barrelHeat = Math.max(0, this.barrelHeat - dt * 0.65);

    this.treadTex.offset.y -= groundSpeed * dt * 0.85;

    this.trackDistAccum += groundSpeed * dt;
    if (this.trackDistAccum > 0.54) {
      this.trackDistAccum = 0;
      vfx.stampTrack(this.x, this.z, this.hullAngle);
    }

    this.smokeAccum += dt * (0.45 + groundSpeed * 0.35);
    if (this.smokeAccum > 0.32) {
      this.smokeAccum = 0;
      const backX = this.x - Math.sin(this.hullAngle) * 0.82;
      const backZ = this.z - Math.cos(this.hullAngle) * 0.82;
      vfx.spawnSmokePuff(backX, 0.36, backZ, 0.1, 0.3, 0.45, false);
    }

    const nowMs = performance.now();

    // Muzzle thermal glow + charge coil glow + attack buff overdrive
    const atkGlow = this.attackTimer > 0 ? 1.45 : 0;
    this.muzzleMat.emissiveIntensity = this.barrelHeat * 2.2 + this.chargeRatio * 3.0 + atkGlow;
    const fullChargePulse =
      this.chargeRatio >= 0.98 ? 0.8 + Math.sin(nowMs * 0.02) * 0.2 : 1;
    this.barrelMat.emissiveIntensity =
      (this.chargeRatio * 3.2 + this.barrelHeat * 0.8 + atkGlow * 0.7) * fullChargePulse;
    this.railCoils.visible = this.stars >= 3 || this.attackTimer > 0 || this.chargeRatio > 0.15;

    // Team / Buff ground ring tint (reflects Speed or Armor buff when active)
    if (this.teamRingMesh.visible) {
      if (this.armorTimer > 0) {
        this.teamRingMat.color.setRGB(0.45, 1.35, 2.6);
        this.teamRingMat.opacity = 0.72;
      } else if (this.speedTimer > 0) {
        this.teamRingMat.color.setRGB(0.3, 2.3, 1.75);
        this.teamRingMat.opacity = 0.72;
      } else {
        this.teamRingMat.color.setHex(this.baseColorHex).multiplyScalar(1.5);
        this.teamRingMat.opacity = this.modGroup.children.length > 0 ? 0.62 : 0.38;
      }
    }

    // Pulsing red aura under the hull while charging
    this.chargeGlow.visible = this.chargeRatio > 0.02 && this.alive;
    if (this.chargeGlow.visible) {
      const full = this.chargeRatio >= 0.98;
      const pulse = full
        ? 0.55 + Math.sin(nowMs * 0.02) * 0.45
        : 0.78 + Math.sin(nowMs * 0.009) * 0.22;
      this.chargeGlowMat.opacity = Math.min(0.9, (0.22 + this.chargeRatio * 0.58) * pulse);
      this.chargeGlow.scale.setScalar(1 + this.chargeRatio * 0.24 + pulse * 0.05);
    }

    // 3D Voice speaking pulse ring
    this.voiceRingMesh.visible = this.isSpeaking && this.alive;
    if (this.voiceRingMesh.visible) {
      const wave = 0.5 + Math.sin(nowMs * 0.012) * 0.5;
      this.voiceRingMat.opacity = 0.42 + wave * 0.45;
      this.voiceRingMesh.scale.setScalar(0.96 + wave * 0.16);
    }

    // Diegetic HP bar when damaged
    const showHp = this.alive && this.maxHp > 1 && this.hp < this.maxHp && this.hp <= 10;
    this.hpBarGroup.visible = showHp;
    if (showHp) {
      const ratio = Math.max(0.04, Math.min(1, this.hp / this.maxHp));
      this.hpFillMesh.scale.x = ratio;
    }

    // Cheat-mode crimson pulse
    if (this.cheatGlow && this.cheatLight) {
      const aura = 0.72 + Math.sin(nowMs * 0.018) * 0.28;
      this.primaryMat.emissiveIntensity = 2.6 * aura;
      this.cheatLight.intensity = 22 * aura;
    }

    // Bonus carrier beacon pulse
    if (this.bonusBeaconMat) {
      const pulse = Math.sin(nowMs * 0.012) > 0 ? 3.4 : 0.4;
      this.bonusBeaconMat.color.setRGB(pulse, 0.35, 0.2);
    }

    // Shield dome shader
    if (this.shieldTimer > 0) {
      this.shieldMesh.visible = true;
      this.shieldUniforms.uTime.value += dt;
      this.shieldUniforms.uOpacity.value = this.shieldTimer < 0.8 ? this.shieldTimer / 0.8 : 1.0;
    } else {
      this.shieldMesh.visible = false;
    }

    // Whip antenna oscillation
    this.antennaPivot.rotation.x = -this.pitch * 2.4 - groundSpeed * 0.035;
    this.antennaPivot.rotation.z = Math.sin(nowMs * 0.014) * 0.08 + this.roll * 2.0;

    this.syncTransforms();
  }

  public updateBillboard(cameraQuat: THREE.Quaternion): void {
    if (this.hpBarGroup.visible) {
      this.hpBarGroup.quaternion.copy(cameraQuat);
    }
  }

  private syncTransforms(): void {
    this.root.position.set(this.x, 0, this.z);
    this.hullYawGroup.rotation.y = this.hullAngle;
    this.suspensionGroup.rotation.x = this.pitch;
    this.suspensionGroup.rotation.z = this.roll;
    this.turretGroup.rotation.y = this.turretAngle - this.hullAngle;
    this.gunRecoilGroup.position.z = 0.38 - this.recoilOffset;
  }

  public dispose(): void {
    this.primaryMat.dispose();
    this.accentMat.dispose();
    this.muzzleMat.dispose();
    this.barrelMat.dispose();
    this.treadMat.dispose();
    this.treadTex.dispose();
    this.shadowMat.dispose();
    this.teamRingMat.dispose();
    this.voiceRingMat.dispose();
    this.shieldMat.dispose();
    this.chargeGlowMat.dispose();
    this.hpFillMat.dispose();
    this.bonusBeaconMat?.dispose();
    this.labelMat?.dispose();
    this.labelTex?.dispose();
    this.modGroup.clear();
  }
}
