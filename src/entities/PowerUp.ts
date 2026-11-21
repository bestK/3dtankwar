import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/examples/jsm/geometries/RoundedBoxGeometry.js';
import { PowerUpKind } from '../types';

const KIND_COLORS: Record<PowerUpKind, number> = {
  star: 0xffc642,
  shield: 0x3ac8ff,
  freeze: 0x70f0ff,
  fortress: 0xc2d0e0,
  bomb: 0xff6238,
  repair: 0x52e080,
};

const KIND_LABELS: Record<PowerUpKind, string> = {
  star: '★',
  shield: '盾',
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

  const col = KIND_COLORS[kind];
  const canvas = document.createElement('canvas');
  canvas.width = 128;
  canvas.height = 128;
  const ctx = canvas.getContext('2d')!;
  ctx.fillStyle = '#10161f';
  ctx.fillRect(0, 0, 128, 128);
  ctx.strokeStyle = '#' + col.toString(16).padStart(6, '0');
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
  public readonly life = 16.0;

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
      sharedBoxGeo = new RoundedBoxGeometry(0.76, 0.56, 0.76, 1, 0.08);
      sharedPlateGeo = new THREE.PlaneGeometry(0.62, 0.62);
      sharedRingGeo = new THREE.RingGeometry(0.56, 0.68, 24);
      sharedRingGeo.rotateX(-Math.PI / 2);
    }

    const col = KIND_COLORS[kind];
    this.bodyMat = new THREE.MeshStandardMaterial({
      color: 0x1c2430,
      roughness: 0.35,
      metalness: 0.75,
      emissive: new THREE.Color(col),
      emissiveIntensity: 0.38,
    });

    const box = new THREE.Mesh(sharedBoxGeo, this.bodyMat);
    box.castShadow = true;
    this.crateGroup.add(box);

    this.plateMat = new THREE.MeshBasicMaterial({ map: getBadgeTexture(kind) });
    const topPlate = new THREE.Mesh(sharedPlateGeo!, this.plateMat);
    topPlate.rotation.x = -Math.PI / 2;
    topPlate.position.y = 0.29;
    this.crateGroup.add(topPlate);

    this.crateGroup.position.y = 0.55;
    this.group.add(this.crateGroup);

    this.ringMat = new THREE.MeshBasicMaterial({
      color: new THREE.Color(col).multiplyScalar(2.0),
      transparent: true,
      opacity: 0.75,
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
    this.crateGroup.position.y = 0.55 + Math.sin(elapsed * 3.5 + this.x) * 0.1;
    this.crateGroup.rotation.y += dt * 1.4;
    this.ringMesh.scale.setScalar(0.95 + Math.sin(elapsed * 5) * 0.08);

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
