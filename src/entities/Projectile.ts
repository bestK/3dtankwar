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
  private beamLine: THREE.Line;
  private beamGeo: THREE.BufferGeometry;
  private reticleGroup = new THREE.Group();
  private outerRing: THREE.Mesh;
  private innerDot: THREE.Mesh;

  constructor() {
    this.beamGeo = new THREE.BufferGeometry().setFromPoints([
      new THREE.Vector3(0, 0.72, 0),
      new THREE.Vector3(0, 0.72, 5),
    ]);
    const lineMat = new THREE.LineDashedMaterial({
      color: 0xffb84a,
      dashSize: 0.35,
      gapSize: 0.24,
      transparent: true,
      opacity: 0.52,
    });
    this.beamLine = new THREE.Line(this.beamGeo, lineMat);
    this.beamLine.computeLineDistances();
    this.group.add(this.beamLine);

    const ringGeo = new THREE.RingGeometry(0.36, 0.45, 24);
    ringGeo.rotateX(-Math.PI / 2);
    this.outerRing = new THREE.Mesh(
      ringGeo,
      new THREE.MeshBasicMaterial({
        color: new THREE.Color(2.2, 1.55, 0.45),
        transparent: true,
        opacity: 0.8,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
      }),
    );
    this.reticleGroup.add(this.outerRing);

    const dotGeo = new THREE.CircleGeometry(0.11, 16);
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

    // Raymarch along sightline to stop laser cleanly on BRICK / STEEL / border
    const step = 0.25;
    for (let d = 0.8; d <= maxDist; d += step) {
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

    const endX = startX + dx * hitDist;
    const endZ = startZ + dz * hitDist;

    const pos = this.beamGeo.attributes.position as THREE.BufferAttribute;
    pos.setXYZ(0, startX + dx * 0.95, 0.72, startZ + dz * 0.95);
    pos.setXYZ(1, endX, 0.72, endZ);
    pos.needsUpdate = true;
    this.beamLine.computeLineDistances();

    this.reticleGroup.position.set(endX, 0.08, endZ);
    const pulse = 1 + chargeRatio * 0.55 + Math.sin(elapsed * 8) * 0.06;
    this.outerRing.scale.setScalar(pulse);
    this.outerRing.rotation.z = elapsed * 1.8;
    (this.innerDot.material as THREE.MeshBasicMaterial).color.setRGB(
      2.6 + chargeRatio * 1.5,
      1.8 + chargeRatio * 0.6,
      0.7,
    );
  }
}

export function createProjectileMesh(colorHex: number, heavy: boolean): THREE.Group {
  const g = new THREE.Group();
  const c = new THREE.Color(colorHex).multiplyScalar(heavy ? 3.4 : 2.5);

  const core = new THREE.Mesh(
    new THREE.CapsuleGeometry(heavy ? 0.11 : 0.075, heavy ? 0.42 : 0.24, 4, 8),
    new THREE.MeshBasicMaterial({ color: c }),
  );
  core.rotation.x = Math.PI / 2;
  g.add(core);

  const halo = new THREE.Mesh(
    new THREE.SphereGeometry(heavy ? 0.22 : 0.14, 8, 8),
    new THREE.MeshBasicMaterial({
      color: new THREE.Color(colorHex).multiplyScalar(1.6),
      transparent: true,
      opacity: 0.42,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
    }),
  );
  g.add(halo);
  return g;
}
