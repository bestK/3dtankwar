import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/examples/jsm/geometries/RoundedBoxGeometry.js';
import { PowerUpKind } from '../types';

export const POWERUP_COLORS: Record<PowerUpKind, number> = {
  speed: 0x2ce6b8,
  armor: 0x4f9aff,
  attack: 0xff6d2e,
  shield: 0xffcf48,
  star: 0xffb838,
  freeze: 0x74eeff,
  fortress: 0xc2d0e0,
  bomb: 0xff4c42,
  repair: 0x52e080,
};

const KIND_LABELS: Record<PowerUpKind, string> = {
  speed: '速',
  armor: '防',
  attack: '攻',
  shield: '无',
  star: '★',
  freeze: '冰',
  fortress: '钢',
  bomb: '轰',
  repair: '修',
};

let sharedBoxGeo: THREE.BufferGeometry | null = null;
let sharedPlateGeo: THREE.PlaneGeometry | null = null;
let sharedRingGeo: THREE.RingGeometry | null = null;
const badgeTexCache = new Map<PowerUpKind, THREE.CanvasTexture>();

function getBadgeTexture(kind: PowerUpKind): THREE.CanvasTexture {
  let tex = badgeTexCache.get(kind);
  if (tex) return tex;

  const col = POWERUP_COLORS[kind];
  const colHex = '#' + col.toString(16).padStart(6, '0');
  const canvas = document.createElement('canvas');
  canvas.width = 128;
  canvas.height = 128;
  const ctx = canvas.getContext('2d')!;
  ctx.fillStyle = '#0e141d';
  ctx.fillRect(0, 0, 128, 128);

  const glow = ctx.createRadialGradient(64, 64, 8, 64, 64, 60);
  glow.addColorStop(0, colHex + '44');
  glow.addColorStop(1, '#0e141d00');
  ctx.fillStyle = glow;
  ctx.fillRect(0, 0, 128, 128);

  ctx.strokeStyle = colHex;
  ctx.lineWidth = 10;
  ctx.strokeRect(10, 10, 108, 108);
  ctx.fillStyle = '#ffffff';
  ctx.font = '900 66px "Noto Sans SC", sans-serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(KIND_LABELS[kind], 64, 68);

  tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  badgeTexCache.set(kind, tex);
  return tex;
}

export class PowerUpItem {
  public readonly id: string;
  public readonly kind: PowerUpKind;
  public readonly x: number;
  public readonly z: number;
  public readonly group = new THREE.Group();
  public alive = true;
  public age = 0;
  public readonly life = 20.0;

  private crateGroup = new THREE.Group();
  private ringMesh: THREE.Mesh;
  private bodyMat: THREE.MeshStandardMaterial;
  private plateMat: THREE.MeshBasicMaterial;
  private ringMat: THREE.MeshBasicMaterial;

  constructor(id: string, kind: PowerUpKind, x: number, z: number) {
    this.id = id;
    this.kind = kind;
    this.x = x;
    this.z = z;
    this.group.position.set(x, 0, z);

    if (!sharedBoxGeo) {
      sharedBoxGeo = new RoundedBoxGeometry(0.78, 0.56, 0.78, 1, 0.08);
      sharedPlateGeo = new THREE.PlaneGeometry(0.64, 0.64);
      sharedRingGeo = new THREE.RingGeometry(0.58, 0.72, 24);
      sharedRingGeo.rotateX(-Math.PI / 2);
    }

    const col = POWERUP_COLORS[kind];
    this.bodyMat = new THREE.MeshStandardMaterial({
      color: 0x1a222e,
      roughness: 0.32,
      metalness: 0.78,
      emissive: new THREE.Color(col),
      emissiveIntensity: 0.45,
    });

    const box = new THREE.Mesh(sharedBoxGeo, this.bodyMat);
    box.castShadow = true;
    this.crateGroup.add(box);

    this.plateMat = new THREE.MeshBasicMaterial({ map: getBadgeTexture(kind) });
    const topPlate = new THREE.Mesh(sharedPlateGeo!, this.plateMat);
    topPlate.rotation.x = -Math.PI / 2;
    topPlate.position.y = 0.29;
    this.crateGroup.add(topPlate);

    this.crateGroup.position.y = 0.56;
    this.group.add(this.crateGroup);

    this.ringMat = new THREE.MeshBasicMaterial({
      color: new THREE.Color(col).multiplyScalar(2.1),
      transparent: true,
      opacity: 0.8,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      side: THREE.DoubleSide,
    });
    this.ringMesh = new THREE.Mesh(sharedRingGeo!, this.ringMat);
    this.ringMesh.position.y = 0.05;
    this.group.add(this.ringMesh);
  }

  public update(dt: number, elapsed: number): void {
    this.age += dt;
    if (this.age >= this.life) {
      this.alive = false;
      return;
    }
    this.crateGroup.position.y = 0.56 + Math.sin(elapsed * 3.6 + this.x) * 0.1;
    this.crateGroup.rotation.y += dt * 1.45;
    this.ringMesh.scale.setScalar(0.95 + Math.sin(elapsed * 5.2) * 0.09);

    if (this.life - this.age < 3.0) {
      this.group.visible = Math.sin(elapsed * 22) > -0.2;
    }
  }

  public dispose(): void {
    this.bodyMat.dispose();
    this.plateMat.dispose();
    this.ringMat.dispose();
  }
}
