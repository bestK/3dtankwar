import * as THREE from 'three';
import { HALF_BOARD, TileType } from '../types';
import { DioramaWorld } from '../world/DioramaWorld';

export interface ProjectileData {
  id: string;
  ownerId: string;
  team: 'player' | 'enemy';
  x: number;
  y: number;
  z: number;
  vx: number;
  vz: number;
  angle: number;
  dmg: number;
  heavy: boolean;
  pierceSteel: boolean;
  bouncesLeft: number;
  alive: boolean;
  mesh: THREE.Group;
  trailTimer: number;
}

export class BallisticSight {
  public readonly group = new THREE.Group();
  private beamMesh: THREE.Mesh;
  private beamUniforms = {
    uTime: { value: 0 },
    uCharge: { value: 0 },
    uLength: { value: 5.0 },
  };
  private reticleGroup = new THREE.Group();
  private outerRing: THREE.Mesh;
  private innerCross: THREE.Mesh;
  private innerDot: THREE.Mesh;

  constructor() {
    // Unit-length horizontal plane stretched via Object3D scale (zero GPU buffer upload per frame!)
    const beamGeo = new THREE.PlaneGeometry(0.14, 1.0);
    beamGeo.rotateX(-Math.PI / 2);
    beamGeo.translate(0, 0, 0.5);

    const beamMat = new THREE.ShaderMaterial({
      uniforms: this.beamUniforms,
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      side: THREE.DoubleSide,
      vertexShader: /* glsl */ `
        varying vec2 vUv;
        void main() {
          vUv = uv;
          gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
        }
      `,
      fragmentShader: /* glsl */ `
        uniform float uTime;
        uniform float uCharge;
        uniform float uLength;
        varying vec2 vUv;
        void main() {
          float core = exp(-pow(abs(vUv.x - 0.5) * 7.5, 2.0));
          float dash = smoothstep(0.25, 0.65, fract(vUv.y * uLength * 1.4 - uTime * 3.2));
          float pattern = mix(dash * 0.72 + 0.18, 1.0, uCharge * 0.85);
          float fadeEnds = smoothstep(0.0, 0.06, vUv.y) * (1.0 - smoothstep(0.92, 1.0, vUv.y) * 0.35);
          vec3 col = mix(vec3(1.9, 1.25, 0.38), vec3(3.2, 1.15, 0.45), uCharge);
          gl_FragColor = vec4(col, core * pattern * fadeEnds * (0.48 + uCharge * 0.38));
        }
      `,
    });
    this.beamMesh = new THREE.Mesh(beamGeo, beamMat);
    this.beamMesh.position.y = 0.72;
    this.group.add(this.beamMesh);

    const ringGeo = new THREE.RingGeometry(0.36, 0.44, 24);
    ringGeo.rotateX(-Math.PI / 2);
    this.outerRing = new THREE.Mesh(
      ringGeo,
      new THREE.MeshBasicMaterial({
        color: new THREE.Color(2.2, 1.55, 0.45),
        transparent: true,
        opacity: 0.82,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
      }),
    );
    this.reticleGroup.add(this.outerRing);

    const crossRingGeo = new THREE.RingGeometry(0.2, 0.25, 4);
    crossRingGeo.rotateX(-Math.PI / 2);
    this.innerCross = new THREE.Mesh(
      crossRingGeo,
      new THREE.MeshBasicMaterial({
        color: new THREE.Color(2.4, 1.8, 0.7),
        transparent: true,
        opacity: 0.65,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
      }),
    );
    this.reticleGroup.add(this.innerCross);

    const dotGeo = new THREE.CircleGeometry(0.09, 14);
    dotGeo.rotateX(-Math.PI / 2);
    this.innerDot = new THREE.Mesh(
      dotGeo,
      new THREE.MeshBasicMaterial({
        color: new THREE.Color(3.0, 2.2, 1.0),
        depthWrite: false,
        blending: THREE.AdditiveBlending,
      }),
    );
    this.reticleGroup.add(this.innerDot);
    this.group.add(this.reticleGroup);
  }

  public update(
    startX: number,
    startZ: number,
    angle: number,
    maxDist: number,
    chargeRatio: number,
    world: DioramaWorld,
    elapsed: number,
  ): void {
    const dx = Math.sin(angle);
    const dz = Math.cos(angle);
    let hitDist = maxDist;

    const step = 0.25;
    for (let d = 0.85; d <= maxDist; d += step) {
      const px = startX + dx * d;
      const pz = startZ + dz * d;
      if (Math.abs(px) >= HALF_BOARD || Math.abs(pz) >= HALF_BOARD) {
        hitDist = d;
        break;
      }
      const [gx, gz] = world.worldToGrid(px, pz);
      const t = world.getTile(gx, gz);
      if (t === TileType.BRICK || t === TileType.STEEL || t === TileType.BASE) {
        hitDist = d;
        break;
      }
    }

    const originDist = 0.98;
    const beamLen = Math.max(0.2, hitDist - originDist);
    this.beamMesh.position.set(startX + dx * originDist, 0.72, startZ + dz * originDist);
    this.beamMesh.rotation.y = angle;
    this.beamMesh.scale.set(1 + chargeRatio * 0.85, 1, beamLen);
    this.beamUniforms.uTime.value = elapsed;
    this.beamUniforms.uCharge.value = chargeRatio;
    this.beamUniforms.uLength.value = beamLen;

    const endX = startX + dx * hitDist;
    const endZ = startZ + dz * hitDist;
    this.reticleGroup.position.set(endX, 0.075, endZ);
    const pulse = 1 + chargeRatio * 0.45 + Math.sin(elapsed * 8) * 0.05;
    this.outerRing.scale.setScalar(pulse);
    this.outerRing.rotation.y = elapsed * 1.8;
    this.innerCross.rotation.y = -elapsed * 2.4;
    (this.innerDot.material as THREE.MeshBasicMaterial).color.setRGB(
      2.6 + chargeRatio * 1.5,
      1.8 - chargeRatio * 0.4,
      0.7 - chargeRatio * 0.3,
    );
  }
}

// Shared projectile geometries & cached materials eliminate per-shot WebGL resource leaks!
let lightCoreGeo: THREE.CapsuleGeometry | null = null;
let heavyCoreGeo: THREE.CapsuleGeometry | null = null;
let lightHaloGeo: THREE.SphereGeometry | null = null;
let heavyHaloGeo: THREE.SphereGeometry | null = null;
let tracerStreakGeo: THREE.ConeGeometry | null = null;

const coreMatCache = new Map<string, THREE.MeshBasicMaterial>();
const haloMatCache = new Map<string, THREE.MeshBasicMaterial>();
const streakMatCache = new Map<string, THREE.MeshBasicMaterial>();

function ensureProjectileGeos(): void {
  if (lightCoreGeo) return;
  lightCoreGeo = new THREE.CapsuleGeometry(0.075, 0.24, 4, 8);
  lightCoreGeo.rotateX(Math.PI / 2);
  heavyCoreGeo = new THREE.CapsuleGeometry(0.11, 0.44, 4, 8);
  heavyCoreGeo.rotateX(Math.PI / 2);
  lightHaloGeo = new THREE.SphereGeometry(0.14, 8, 8);
  heavyHaloGeo = new THREE.SphereGeometry(0.23, 8, 8);
  tracerStreakGeo = new THREE.ConeGeometry(0.09, 0.85, 6, 1, true);
  tracerStreakGeo.rotateX(Math.PI / 2);
  tracerStreakGeo.translate(0, 0, -0.45);
}

export function createProjectileMesh(colorHex: number, heavy: boolean): THREE.Group {
  ensureProjectileGeos();
  const key = `${colorHex}_${heavy ? 1 : 0}`;

  let coreMat = coreMatCache.get(key);
  if (!coreMat) {
    coreMat = new THREE.MeshBasicMaterial({
      color: new THREE.Color(colorHex).multiplyScalar(heavy ? 3.4 : 2.5),
    });
    coreMatCache.set(key, coreMat);
  }

  let haloMat = haloMatCache.get(key);
  if (!haloMat) {
    haloMat = new THREE.MeshBasicMaterial({
      color: new THREE.Color(colorHex).multiplyScalar(1.6),
      transparent: true,
      opacity: 0.42,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
    });
    haloMatCache.set(key, haloMat);
  }

  let streakMat = streakMatCache.get(key);
  if (!streakMat) {
    streakMat = new THREE.MeshBasicMaterial({
      color: new THREE.Color(colorHex).multiplyScalar(1.9),
      transparent: true,
      opacity: heavy ? 0.48 : 0.3,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      side: THREE.DoubleSide,
    });
    streakMatCache.set(key, streakMat);
  }

  const g = new THREE.Group();
  g.add(new THREE.Mesh(heavy ? heavyCoreGeo! : lightCoreGeo!, coreMat));
  g.add(new THREE.Mesh(heavy ? heavyHaloGeo! : lightHaloGeo!, haloMat));
  const streak = new THREE.Mesh(tracerStreakGeo!, streakMat);
  if (heavy) streak.scale.set(1.35, 1.35, 1.5);
  g.add(streak);
  return g;
}
