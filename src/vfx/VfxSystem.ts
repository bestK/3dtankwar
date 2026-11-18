import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/examples/jsm/geometries/RoundedBoxGeometry.js';
import { TextureBundle } from '../engine/ProceduralTextures';
import { BrickPopInfo } from '../world/DioramaWorld';

interface RubbleState {
  active: boolean;
  x: number;
  y: number;
  z: number;
  vx: number;
  vy: number;
  vz: number;
  rx: number;
  ry: number;
  rz: number;
  vrx: number;
  vry: number;
  vrz: number;
  age: number;
  life: number;
}

interface SparkState {
  active: boolean;
  x: number;
  y: number;
  z: number;
  vx: number;
  vy: number;
  vz: number;
  age: number;
  life: number;
}

interface SmokeState {
  active: boolean;
  x: number;
  y: number;
  z: number;
  vx: number;
  vy: number;
  vz: number;
  scale0: number;
  scale1: number;
  age: number;
  life: number;
  fiery: boolean;
}

interface ShockwaveRing {
  mesh: THREE.Mesh;
  mat: THREE.MeshBasicMaterial;
  age: number;
  life: number;
  maxScale: number;
}

interface FlyingTurret {
  group: THREE.Group;
  active: boolean;
  vx: number;
  vy: number;
  vz: number;
  vrx: number;
  vry: number;
  vrz: number;
  age: number;
  life: number;
  smokeTimer: number;
}

interface FlashSlot {
  light: THREE.PointLight;
  age: number;
  life: number;
  peak: number;
}

const MAX_RUBBLE = 420;
const MAX_SPARKS = 480;
const MAX_SMOKE = 320;
const MAX_DECALS = 180;
const MAX_TRACKS = 360;

export class VfxSystem {
  public readonly group = new THREE.Group();

  private rubbleMesh: THREE.InstancedMesh;
  private rubblePool: RubbleState[] = [];
  private rubbleCursor = 0;

  private sparkMesh: THREE.InstancedMesh;
  private sparkPool: SparkState[] = [];
  private sparkCursor = 0;

  private smokeMesh: THREE.InstancedMesh;
  private smokePool: SmokeState[] = [];
  private smokeCursor = 0;

  private scorchMesh: THREE.InstancedMesh;
  private scorchCursor = 0;

  private trackMesh: THREE.InstancedMesh;
  private trackCursor = 0;

  private shockwaves: ShockwaveRing[] = [];
  private flyingTurrets: FlyingTurret[] = [];
  private flashSlots: FlashSlot[] = [];

  private dummy = new THREE.Object3D();
  private zeroMatrix = new THREE.Matrix4().makeScale(0, 0, 0);
  private tmpColor = new THREE.Color();
  private upVec = new THREE.Vector3(0, 1, 0);
  private velVec = new THREE.Vector3();

  constructor(textures: TextureBundle) {
    // 1. Tumbling Physical Bricks
    this.rubbleMesh = new THREE.InstancedMesh(
      new RoundedBoxGeometry(0.42, 0.24, 0.24, 1, 0.03),
      new THREE.MeshStandardMaterial({
        map: textures.brickMap,
        normalMap: textures.brickNormal,
        roughness: 0.85,
        metalness: 0.05,
      }),
      MAX_RUBBLE,
    );
    this.rubbleMesh.castShadow = true;
    this.rubbleMesh.receiveShadow = true;
    for (let i = 0; i < MAX_RUBBLE; i++) {
      this.rubbleMesh.setMatrixAt(i, this.zeroMatrix);
      this.rubbleMesh.setColorAt(i, new THREE.Color(0xc45a3a));
      this.rubblePool.push({
        active: false,
        x: 0,
        y: 0,
        z: 0,
        vx: 0,
        vy: 0,
        vz: 0,
        rx: 0,
        ry: 0,
        rz: 0,
        vrx: 0,
        vry: 0,
        vrz: 0,
        age: 0,
        life: 1,
      });
    }
    this.group.add(this.rubbleMesh);

    // 2. Incandescent Velocity-Stretched Sparks
    this.sparkMesh = new THREE.InstancedMesh(
      new THREE.BoxGeometry(0.055, 0.32, 0.055),
      new THREE.MeshBasicMaterial({ color: 0xffffff }),
      MAX_SPARKS,
    );
    for (let i = 0; i < MAX_SPARKS; i++) {
      this.sparkMesh.setMatrixAt(i, this.zeroMatrix);
      this.sparkMesh.setColorAt(i, new THREE.Color(2.8, 1.8, 0.7));
      this.sparkPool.push({
        active: false,
        x: 0,
        y: 0,
        z: 0,
        vx: 0,
        vy: 0,
        vz: 0,
        age: 0,
        life: 0.5,
      });
    }
    this.group.add(this.sparkMesh);

    // 3. Volumetric Fire-to-Soot Smoke Spheres
    this.smokeMesh = new THREE.InstancedMesh(
      new THREE.IcosahedronGeometry(0.45, 1),
      new THREE.MeshStandardMaterial({
        color: 0xffffff,
        roughness: 0.95,
        metalness: 0.0,
        transparent: true,
        opacity: 0.86,
      }),
      MAX_SMOKE,
    );
    for (let i = 0; i < MAX_SMOKE; i++) {
      this.smokeMesh.setMatrixAt(i, this.zeroMatrix);
      this.smokeMesh.setColorAt(i, new THREE.Color(1, 1, 1));
      this.smokePool.push({
        active: false,
        x: 0,
        y: 0,
        z: 0,
        vx: 0,
        vy: 0,
        vz: 0,
        scale0: 0.3,
        scale1: 1.2,
        age: 0,
        life: 1,
        fiery: false,
      });
    }
    this.group.add(this.smokeMesh);

    // 4. Scorch Crater Decals
    const planeGeo = new THREE.PlaneGeometry(1, 1);
    planeGeo.rotateX(-Math.PI / 2);
    this.scorchMesh = new THREE.InstancedMesh(
      planeGeo,
      new THREE.MeshBasicMaterial({
        map: textures.scorchTex,
        transparent: true,
        depthWrite: false,
        polygonOffset: true,
        polygonOffsetFactor: -2,
      }),
      MAX_DECALS,
    );
    for (let i = 0; i < MAX_DECALS; i++) this.scorchMesh.setMatrixAt(i, this.zeroMatrix);
    this.group.add(this.scorchMesh);

    // 5. Persistent Tank Tread Marks
    this.trackMesh = new THREE.InstancedMesh(
      planeGeo,
      new THREE.MeshBasicMaterial({
        map: textures.trackDecalTex,
        transparent: true,
        opacity: 0.55,
        depthWrite: false,
        polygonOffset: true,
        polygonOffsetFactor: -1,
      }),
      MAX_TRACKS,
    );
    for (let i = 0; i < MAX_TRACKS; i++) this.trackMesh.setMatrixAt(i, this.zeroMatrix);
    this.group.add(this.trackMesh);

    // 6. Shockwave Rings Pool
    const ringGeo = new THREE.RingGeometry(0.68, 1.0, 32);
    ringGeo.rotateX(-Math.PI / 2);
    for (let i = 0; i < 14; i++) {
      const mat = new THREE.MeshBasicMaterial({
        color: new THREE.Color(2.5, 1.6, 0.6),
        transparent: true,
        opacity: 0,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
        side: THREE.DoubleSide,
      });
      const mesh = new THREE.Mesh(ringGeo, mat);
      mesh.visible = false;
      this.group.add(mesh);
      this.shockwaves.push({ mesh, mat, age: 0, life: 0.4, maxScale: 3 });
    }

    // 7. Pop-Off Charred Tank Turrets Pool
    const charMat = new THREE.MeshStandardMaterial({
      color: 0x221f1e,
      roughness: 0.78,
      metalness: 0.45,
      emissive: new THREE.Color(0x551804),
      emissiveIntensity: 0.5,
    });
    for (let i = 0; i < 10; i++) {
      const g = new THREE.Group();
      const dome = new THREE.Mesh(new RoundedBoxGeometry(0.84, 0.36, 0.92, 2, 0.08), charMat);
      dome.castShadow = true;
      g.add(dome);
      const barrel = new THREE.Mesh(new THREE.CylinderGeometry(0.065, 0.08, 1.05, 8), charMat);
      barrel.rotation.x = Math.PI / 2;
      barrel.position.set(0, 0.02, 0.72);
      barrel.castShadow = true;
      g.add(barrel);
      g.visible = false;
      this.group.add(g);
      this.flyingTurrets.push({
        group: g,
        active: false,
        vx: 0,
        vy: 0,
        vz: 0,
        vrx: 0,
        vry: 0,
        vrz: 0,
        age: 0,
        life: 3.2,
        smokeTimer: 0,
      });
    }

    // 8. Pooled Dynamic PointLights (zero runtime shader recompile!)
    for (let i = 0; i < 6; i++) {
      const light = new THREE.PointLight(0xffa63b, 0, 9.5, 1.8);
      light.position.set(0, -20, 0);
      this.group.add(light);
      this.flashSlots.push({ light, age: 1, life: 0.2, peak: 0 });
    }
  }

  public clearDecals(): void {
    for (let i = 0; i < MAX_DECALS; i++) this.scorchMesh.setMatrixAt(i, this.zeroMatrix);
    for (let i = 0; i < MAX_TRACKS; i++) this.trackMesh.setMatrixAt(i, this.zeroMatrix);
    this.scorchMesh.instanceMatrix.needsUpdate = true;
    this.trackMesh.instanceMatrix.needsUpdate = true;
  }

  public emitFlash(x: number, y: number, z: number, colorHex: number, peak: number, life = 0.18): void {
    let chosen = this.flashSlots[0];
    for (const s of this.flashSlots) {
      if (s.age >= s.life) {
        chosen = s;
        break;
      }
      if (s.age / s.life > chosen.age / chosen.life) chosen = s;
    }
    chosen.light.position.set(x, y, z);
    chosen.light.color.setHex(colorHex);
    chosen.light.intensity = peak;
    chosen.age = 0;
    chosen.life = life;
    chosen.peak = peak;
  }

  public stampTrack(x: number, z: number, hullAngle: number): void {
    const idx = this.trackCursor % MAX_TRACKS;
    this.trackCursor++;
    this.dummy.position.set(x, 0.015, z);
    this.dummy.rotation.set(0, hullAngle, 0);
    this.dummy.scale.set(1.38, 1, 0.55);
    this.dummy.updateMatrix();
    this.trackMesh.setMatrixAt(idx, this.dummy.matrix);
    this.trackMesh.instanceMatrix.needsUpdate = true;
  }

  public stampScorch(x: number, z: number, radius = 2.4): void {
    const idx = this.scorchCursor % MAX_DECALS;
    this.scorchCursor++;
    this.dummy.position.set(x, 0.02, z);
    this.dummy.rotation.set(0, Math.random() * Math.PI * 2, 0);
    this.dummy.scale.set(radius, 1, radius);
    this.dummy.updateMatrix();
    this.scorchMesh.setMatrixAt(idx, this.dummy.matrix);
    this.scorchMesh.instanceMatrix.needsUpdate = true;
  }

  public spawnBrickBurst(bricks: BrickPopInfo[], impactX: number, impactZ: number): void {
    for (const b of bricks) {
      const slot = this.rubblePool[this.rubbleCursor % MAX_RUBBLE];
      const idx = this.rubbleCursor % MAX_RUBBLE;
      this.rubbleCursor++;

      const dx = b.x - impactX + (Math.random() - 0.5) * 0.4;
      const dz = b.z - impactZ + (Math.random() - 0.5) * 0.4;
      const inv = 1 / Math.max(0.25, Math.hypot(dx, dz));
      const speed = 2.8 + Math.random() * 4.5;

      slot.active = true;
      slot.x = b.x;
      slot.y = b.y;
      slot.z = b.z;
      slot.vx = dx * inv * speed;
      slot.vy = 3.2 + Math.random() * 4.6;
      slot.vz = dz * inv * speed;
      slot.rx = Math.random() * 3;
      slot.ry = b.rotY;
      slot.rz = Math.random() * 3;
      slot.vrx = (Math.random() - 0.5) * 14;
      slot.vry = (Math.random() - 0.5) * 14;
      slot.vrz = (Math.random() - 0.5) * 14;
      slot.age = 0;
      slot.life = 3.4 + Math.random() * 1.8;

      this.rubbleMesh.setColorAt(idx, this.tmpColor.setHex(b.color));
    }
    if (this.rubbleMesh.instanceColor) this.rubbleMesh.instanceColor.needsUpdate = true;

    this.spawnSparks(impactX, 0.7, impactZ, 12, 0xffaa44);
    this.spawnSmokePuff(impactX, 0.6, impactZ, 0.45, 1.35, 0.7, false);
  }

  public spawnSparks(
    x: number,
    y: number,
    z: number,
    count: number,
    tintHex = 0xffbe55,
  ): void {
    const c = new THREE.Color(tintHex).multiplyScalar(2.6);
    for (let i = 0; i < count; i++) {
      const idx = this.sparkCursor % MAX_SPARKS;
      const s = this.sparkPool[idx];
      this.sparkCursor++;

      const theta = Math.random() * Math.PI * 2;
      const spd = 3.5 + Math.random() * 9.5;
      s.active = true;
      s.x = x;
      s.y = y;
      s.z = z;
      s.vx = Math.cos(theta) * spd;
      s.vy = 2.0 + Math.random() * 6.8;
      s.vz = Math.sin(theta) * spd;
      s.age = 0;
      s.life = 0.28 + Math.random() * 0.36;

      this.sparkMesh.setColorAt(idx, c);
    }
    if (this.sparkMesh.instanceColor) this.sparkMesh.instanceColor.needsUpdate = true;
  }

  public spawnSmokePuff(
    x: number,
    y: number,
    z: number,
    scale0: number,
    scale1: number,
    life: number,
    fiery: boolean,
  ): void {
    const idx = this.smokeCursor % MAX_SMOKE;
    const s = this.smokePool[idx];
    this.smokeCursor++;

    s.active = true;
    s.x = x + (Math.random() - 0.5) * 0.22;
    s.y = y;
    s.z = z + (Math.random() - 0.5) * 0.22;
    s.vx = (Math.random() - 0.5) * (fiery ? 2.1 : 0.7);
    s.vy = fiery ? 1.8 + Math.random() * 2.2 : 0.85 + Math.random() * 0.8;
    s.vz = (Math.random() - 0.5) * (fiery ? 2.1 : 0.7);
    s.scale0 = scale0;
    s.scale1 = scale1;
    s.age = 0;
    s.life = life;
    s.fiery = fiery;
  }

  public spawnShockwave(x: number, y: number, z: number, maxScale: number, colorHex = 0xffaa3b): void {
    const ring = this.shockwaves.find((r) => !r.mesh.visible) || this.shockwaves[0];
    ring.mesh.visible = true;
    ring.mesh.position.set(x, y, z);
    ring.mesh.scale.setScalar(0.2);
    ring.mat.color.setHex(colorHex).multiplyScalar(2.2);
    ring.mat.opacity = 0.9;
    ring.age = 0;
    ring.life = 0.38;
    ring.maxScale = maxScale;
  }

  public spawnMuzzleBlast(x: number, y: number, z: number, dirX: number, dirZ: number, heavy: boolean): void {
    this.emitFlash(x, y + 0.15, z, heavy ? 0xffbe55 : 0xff9d32, heavy ? 5.5 : 3.2, 0.12);
    this.spawnSparks(x + dirX * 0.2, y, z + dirZ * 0.2, heavy ? 18 : 8, 0xffcc66);
    this.spawnSmokePuff(
      x + dirX * 0.35,
      y,
      z + dirZ * 0.35,
      heavy ? 0.36 : 0.22,
      heavy ? 1.05 : 0.68,
      0.42,
      true,
    );
    if (heavy) {
      this.spawnShockwave(x, 0.08, z, 2.2, 0xffb84a);
    }
  }

  public spawnTankExplosion(x: number, z: number, popTurret = true): void {
    this.emitFlash(x, 1.2, z, 0xff9a2e, 9.0, 0.45);
    this.stampScorch(x, z, 2.8);
    this.spawnShockwave(x, 0.07, z, 4.8, 0xffa638);
    this.spawnSparks(x, 0.65, z, 42, 0xffcf6e);

    for (let i = 0; i < 14; i++) {
      this.spawnSmokePuff(
        x + (Math.random() - 0.5) * 0.9,
        0.35 + Math.random() * 0.5,
        z + (Math.random() - 0.5) * 0.9,
        0.45 + Math.random() * 0.35,
        1.65 + Math.random() * 1.1,
        0.75 + Math.random() * 0.7,
        i < 9,
      );
    }

    if (popTurret) {
      const slot = this.flyingTurrets.find((t) => !t.active) || this.flyingTurrets[0];
      slot.active = true;
      slot.group.visible = true;
      slot.group.position.set(x, 0.75, z);
      slot.group.rotation.set(0, Math.random() * Math.PI * 2, 0);
      slot.vx = (Math.random() - 0.5) * 4.2;
      slot.vy = 7.4 + Math.random() * 3.2;
      slot.vz = (Math.random() - 0.5) * 4.2;
      slot.vrx = (Math.random() - 0.5) * 11;
      slot.vry = (Math.random() - 0.5) * 9;
      slot.vrz = (Math.random() - 0.5) * 11;
      slot.age = 0;
      slot.life = 3.4;
      slot.smokeTimer = 0;
    }
  }

  public update(dt: number): void {
    // 1. Update Rubble
    let rubbleDirty = false;
    for (let i = 0; i < MAX_RUBBLE; i++) {
      const r = this.rubblePool[i];
      if (!r.active) continue;
      rubbleDirty = true;
      r.age += dt;
      if (r.age >= r.life) {
        r.active = false;
        this.rubbleMesh.setMatrixAt(i, this.zeroMatrix);
        continue;
      }

      r.vy -= 18.5 * dt;
      r.x += r.vx * dt;
      r.y += r.vy * dt;
      r.z += r.vz * dt;
      r.rx += r.vrx * dt;
      r.ry += r.vry * dt;
      r.rz += r.vrz * dt;

      if (r.y < 0.12) {
        r.y = 0.12;
        r.vy = -r.vy * 0.36;
        r.vx *= 0.68;
        r.vz *= 0.68;
        r.vrx *= 0.6;
        r.vry *= 0.6;
        r.vrz *= 0.6;
      }

      const fade = r.age > r.life - 0.6 ? Math.max(0.001, (r.life - r.age) / 0.6) : 1.0;
      this.dummy.position.set(r.x, r.y, r.z);
      this.dummy.rotation.set(r.rx, r.ry, r.rz);
      this.dummy.scale.setScalar(fade);
      this.dummy.updateMatrix();
      this.rubbleMesh.setMatrixAt(i, this.dummy.matrix);
    }
    if (rubbleDirty) this.rubbleMesh.instanceMatrix.needsUpdate = true;

    // 2. Update Sparks
    let sparksDirty = false;
    for (let i = 0; i < MAX_SPARKS; i++) {
      const s = this.sparkPool[i];
      if (!s.active) continue;
      sparksDirty = true;
      s.age += dt;
      if (s.age >= s.life) {
        s.active = false;
        this.sparkMesh.setMatrixAt(i, this.zeroMatrix);
        continue;
      }

      s.vy -= 16.0 * dt;
      s.x += s.vx * dt;
      s.y += s.vy * dt;
      s.z += s.vz * dt;
      if (s.y < 0.05) {
        s.y = 0.05;
        s.vy = -s.vy * 0.48;
        s.vx *= 0.8;
        s.vz *= 0.8;
      }

      const t = 1 - s.age / s.life;
      this.dummy.position.set(s.x, s.y, s.z);
      this.velVec.set(s.vx, s.vy, s.vz);
      const speed = this.velVec.length();
      if (speed > 0.01) {
        this.velVec.divideScalar(speed);
        this.dummy.quaternion.setFromUnitVectors(this.upVec, this.velVec);
      }
      this.dummy.scale.set(t, Math.min(2.2, 0.5 + speed * 0.11) * t, t);
      this.dummy.updateMatrix();
      this.sparkMesh.setMatrixAt(i, this.dummy.matrix);
    }
    if (sparksDirty) this.sparkMesh.instanceMatrix.needsUpdate = true;

    // 3. Update Fire-to-Soot Smoke
    let smokeDirty = false;
    for (let i = 0; i < MAX_SMOKE; i++) {
      const s = this.smokePool[i];
      if (!s.active) continue;
      smokeDirty = true;
      s.age += dt;
      if (s.age >= s.life) {
        s.active = false;
        this.smokeMesh.setMatrixAt(i, this.zeroMatrix);
        continue;
      }

      const p = s.age / s.life;
      s.x += s.vx * dt;
      s.y += s.vy * dt;
      s.z += s.vz * dt;
      s.vx *= 1 - dt * 2.2;
      s.vz *= 1 - dt * 2.2;

      const scale = (s.scale0 + (s.scale1 - s.scale0) * Math.sqrt(p)) * (p > 0.75 ? (1 - p) * 4 : 1);
      this.dummy.position.set(s.x, s.y, s.z);
      this.dummy.rotation.set(p * 1.4, i * 0.6 + p, 0);
      this.dummy.scale.setScalar(Math.max(0.01, scale));
      this.dummy.updateMatrix();
      this.smokeMesh.setMatrixAt(i, this.dummy.matrix);

      if (s.fiery) {
        if (p < 0.22) {
          this.tmpColor.setRGB(3.2, 2.2, 0.9);
        } else if (p < 0.5) {
          const k = (p - 0.22) / 0.28;
          this.tmpColor.setRGB(3.2 - k * 2.1, 2.2 - k * 1.85, 0.9 - k * 0.8);
        } else {
          const k = (p - 0.5) / 0.5;
          const g = 0.22 * (1 - k) + 0.08;
          this.tmpColor.setRGB(g + 0.06 * (1 - k), g, g);
        }
      } else {
        const g = 0.26 * (1 - p * 0.55);
        this.tmpColor.setRGB(g, g * 1.02, g * 1.06);
      }
      this.smokeMesh.setColorAt(i, this.tmpColor);
    }
    if (smokeDirty) {
      this.smokeMesh.instanceMatrix.needsUpdate = true;
      if (this.smokeMesh.instanceColor) this.smokeMesh.instanceColor.needsUpdate = true;
    }

    // 4. Shockwaves
    for (const r of this.shockwaves) {
      if (!r.mesh.visible) continue;
      r.age += dt;
      if (r.age >= r.life) {
        r.mesh.visible = false;
        continue;
      }
      const p = r.age / r.life;
      const ease = 1 - Math.pow(1 - p, 3);
      r.mesh.scale.setScalar(0.25 + ease * r.maxScale);
      r.mat.opacity = (1 - p) * 0.85;
    }

    // 5. Flying Popped Turrets
    for (const ft of this.flyingTurrets) {
      if (!ft.active) continue;
      ft.age += dt;
      if (ft.age >= ft.life) {
        ft.active = false;
        ft.group.visible = false;
        continue;
      }

      ft.vy -= 19.5 * dt;
      ft.group.position.x += ft.vx * dt;
      ft.group.position.y += ft.vy * dt;
      ft.group.position.z += ft.vz * dt;
      ft.group.rotation.x += ft.vrx * dt;
      ft.group.rotation.y += ft.vry * dt;
      ft.group.rotation.z += ft.vrz * dt;

      if (ft.group.position.y < 0.22) {
        ft.group.position.y = 0.22;
        if (Math.abs(ft.vy) > 1.8) {
          this.spawnSparks(ft.group.position.x, 0.25, ft.group.position.z, 8, 0xffaa44);
        }
        ft.vy = -ft.vy * 0.34;
        ft.vx *= 0.65;
        ft.vz *= 0.65;
        ft.vrx *= 0.55;
        ft.vry *= 0.55;
        ft.vrz *= 0.55;
      }

      ft.smokeTimer += dt;
      if (ft.age < 1.8 && ft.smokeTimer > 0.07) {
        ft.smokeTimer = 0;
        this.spawnSmokePuff(
          ft.group.position.x,
          ft.group.position.y + 0.15,
          ft.group.position.z,
          0.18,
          0.52,
          0.55,
          ft.age < 0.45,
        );
      }

      const scale = ft.age > ft.life - 0.5 ? Math.max(0.01, (ft.life - ft.age) / 0.5) : 1;
      ft.group.scale.setScalar(scale);
    }

    // 6. Dynamic PointLights decay
    for (const f of this.flashSlots) {
      if (f.age >= f.life) {
        f.light.intensity = 0;
        continue;
      }
      f.age += dt;
      const t = Math.max(0, 1 - f.age / f.life);
      f.light.intensity = f.peak * t * t;
    }
  }
}
