import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/examples/jsm/geometries/RoundedBoxGeometry.js';
import { TextureBundle } from '../engine/ProceduralTextures';
import { BOARD_SIZE, CELL_SIZE, GRID_SIZE, HALF_BOARD, TileType } from '../types';

export interface BrickPopInfo {
  x: number;
  y: number;
  z: number;
  rotY: number;
  color: number;
}

const BRICKS_PER_CELL = 6;
const MAX_CELLS = GRID_SIZE * GRID_SIZE;

export class DioramaWorld {
  public readonly group = new THREE.Group();
  public grid = new Uint8Array(MAX_CELLS);

  private floorInstanced!: THREE.InstancedMesh;
  private brickInstanced!: THREE.InstancedMesh;
  private steelInstanced!: THREE.InstancedMesh;
  private iceInstanced!: THREE.InstancedMesh;
  private forestInstanced!: THREE.InstancedMesh;
  private waterInstanced!: THREE.InstancedMesh;

  private waterUniforms = {
    uTime: { value: 0 },
    uLightDir: { value: new THREE.Vector3(0.55, 0.75, 0.35).normalize() },
  };
  private forestUniforms = { uTime: { value: 0 } };
  private emberUniforms = { uTime: { value: 0 } };

  private eagleGroup = new THREE.Group();
  private eagleCrest = new THREE.Group();
  private eagleRingOuter!: THREE.Mesh;
  private eagleRingInner!: THREE.Mesh;
  private eagleRuinGroup = new THREE.Group();
  private eagleLight!: THREE.PointLight;
  public baseAlive = true;

  private enemyRackMeshes: THREE.Mesh[] = [];
  private playerRackMeshes: THREE.Mesh[] = [];

  public brushCursor = new THREE.Group();
  private brushFine = false;
  private brickCellColors: number[][] = [];
  private dummy = new THREE.Object3D();
  private tmpColor = new THREE.Color();

  constructor(private textures: TextureBundle) {
    this.buildWarTablePlinth();
    this.buildTileLayers();
    this.buildWaterLayer();
    this.buildEagleMonument();
    this.buildReserveRacks();
    this.buildAtmosphericEmbers();
    this.buildBrushCursor();
  }

  public gridToWorldX(gx: number): number {
    return -HALF_BOARD + (gx + 0.5) * CELL_SIZE;
  }

  public gridToWorldZ(gz: number): number {
    return -HALF_BOARD + (gz + 0.5) * CELL_SIZE;
  }

  public worldToGrid(wx: number, wz: number): [number, number] {
    const gx = Math.floor((wx + HALF_BOARD) / CELL_SIZE);
    const gz = Math.floor((wz + HALF_BOARD) / CELL_SIZE);
    return [gx, gz];
  }

  public getTile(gx: number, gz: number): TileType {
    if (gx < 0 || gx >= GRID_SIZE || gz < 0 || gz >= GRID_SIZE) return TileType.STEEL;
    return this.grid[gz * GRID_SIZE + gx] as TileType;
  }

  public setBrushFine(fine: boolean): void {
    if (this.brushFine === fine) return;
    this.brushFine = fine;
    this.brushCursor.scale.setScalar(fine ? 0.5 : 1.0);
  }

  private buildWarTablePlinth(): void {
    const plinth = new THREE.Group();

    const baseMat = new THREE.MeshStandardMaterial({
      color: 0x151c25,
      roughness: 0.5,
      metalness: 0.68,
      normalMap: this.textures.steelNormal,
      normalScale: new THREE.Vector2(0.35, 0.35),
    });

    const underSlab = new THREE.Mesh(new RoundedBoxGeometry(31.6, 2.1, 31.6, 2, 0.22), baseMat);
    underSlab.position.y = -1.58;
    underSlab.receiveShadow = true;
    plinth.add(underSlab);

    const lowerPedestal = new THREE.Mesh(
      new RoundedBoxGeometry(27.6, 2.4, 27.6, 1, 0.18),
      new THREE.MeshStandardMaterial({ color: 0x0d121a, roughness: 0.65, metalness: 0.55 }),
    );
    lowerPedestal.position.y = -3.6;
    plinth.add(lowerPedestal);

    const rimMat = new THREE.MeshStandardMaterial({
      color: 0x1e2734,
      roughness: 0.38,
      metalness: 0.78,
      normalMap: this.textures.steelNormal,
      normalScale: new THREE.Vector2(0.42, 0.42),
    });

    const wt = 2.4;
    const wh = 0.74;
    const nWall = new THREE.Mesh(
      new RoundedBoxGeometry(BOARD_SIZE + wt * 2, wh, wt, 2, 0.08),
      rimMat,
    );
    nWall.position.set(0, 0.08, -HALF_BOARD - wt * 0.5);
    nWall.castShadow = true;
    nWall.receiveShadow = true;
    plinth.add(nWall);

    const sWall = nWall.clone();
    sWall.position.z = HALF_BOARD + wt * 0.5;
    plinth.add(sWall);

    const wWall = new THREE.Mesh(new RoundedBoxGeometry(wt, wh, BOARD_SIZE, 2, 0.08), rimMat);
    wWall.position.set(-HALF_BOARD - wt * 0.5, 0.08, 0);
    wWall.castShadow = true;
    wWall.receiveShadow = true;
    plinth.add(wWall);

    const eWall = wWall.clone();
    eWall.position.x = HALF_BOARD + wt * 0.5;
    plinth.add(eWall);

    const brassMat = new THREE.MeshStandardMaterial({
      color: 0xdba33e,
      roughness: 0.25,
      metalness: 0.9,
    });

    const nTrim = new THREE.Mesh(new THREE.BoxGeometry(BOARD_SIZE + 0.3, 0.065, 0.15), brassMat);
    nTrim.position.set(0, 0.46, -HALF_BOARD - 0.075);
    plinth.add(nTrim);
    const sTrim = nTrim.clone();
    sTrim.position.z = HALF_BOARD + 0.075;
    plinth.add(sTrim);

    const wTrim = new THREE.Mesh(new THREE.BoxGeometry(0.15, 0.065, BOARD_SIZE), brassMat);
    wTrim.position.set(-HALF_BOARD - 0.075, 0.46, 0);
    plinth.add(wTrim);
    const eTrim = wTrim.clone();
    eTrim.position.x = HALF_BOARD + 0.075;
    plinth.add(eTrim);

    // Subtle warm trench perimeter light strip inside the rim
    const glowStripMat = new THREE.MeshBasicMaterial({ color: new THREE.Color(1.6, 1.08, 0.42) });
    const nsGlow = new THREE.Mesh(new THREE.BoxGeometry(BOARD_SIZE, 0.03, 0.03), glowStripMat);
    nsGlow.position.set(0, 0.04, -HALF_BOARD + 0.015);
    plinth.add(nsGlow);
    const sGlow = nsGlow.clone();
    sGlow.position.z = HALF_BOARD - 0.015;
    plinth.add(sGlow);

    const ewGlow = new THREE.Mesh(new THREE.BoxGeometry(0.03, 0.03, BOARD_SIZE), glowStripMat);
    ewGlow.position.set(-HALF_BOARD + 0.015, 0.04, 0);
    plinth.add(ewGlow);
    const eGlow = ewGlow.clone();
    eGlow.position.x = HALF_BOARD - 0.015;
    plinth.add(eGlow);

    const tickGeo = new THREE.BoxGeometry(0.06, 0.04, 0.32);
    const tickGeoEW = new THREE.BoxGeometry(0.32, 0.04, 0.06);
    for (let i = -12; i <= 12; i += 2) {
      const t1 = new THREE.Mesh(tickGeo, brassMat);
      t1.position.set(i, 0.465, -HALF_BOARD - 0.38);
      plinth.add(t1);
      const t2 = t1.clone();
      t2.position.z = HALF_BOARD + 0.38;
      plinth.add(t2);

      const t3 = new THREE.Mesh(tickGeoEW, brassMat);
      t3.position.set(-HALF_BOARD - 0.38, 0.465, i);
      plinth.add(t3);
      const t4 = t3.clone();
      t4.position.x = HALF_BOARD + 0.38;
      plinth.add(t4);
    }

    // 4 Corner Floodlight Pylons + Volumetric Cones
    const mastMat = new THREE.MeshStandardMaterial({ color: 0x293444, roughness: 0.36, metalness: 0.82 });
    const lensMat = new THREE.MeshBasicMaterial({ color: new THREE.Color(2.5, 2.0, 1.38) });

    const coneGeo = new THREE.ConeGeometry(4.2, 13.5, 16, 1, true);
    coneGeo.translate(0, -6.75, 0);
    const posAttr = coneGeo.attributes.position;
    const coneColors = new Float32Array(posAttr.count * 4);
    for (let i = 0; i < posAttr.count; i++) {
      const alpha = Math.pow(1 + posAttr.getY(i) / 13.5, 2.2) * 0.06;
      coneColors[i * 4] = 1.0;
      coneColors[i * 4 + 1] = 0.85;
      coneColors[i * 4 + 2] = 0.58;
      coneColors[i * 4 + 3] = alpha;
    }
    coneGeo.setAttribute('color', new THREE.BufferAttribute(coneColors, 4));
    const coneMat = new THREE.MeshBasicMaterial({
      vertexColors: true,
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      side: THREE.DoubleSide,
    });

    for (const [cx, cz] of [
      [-14.6, -14.6],
      [14.6, -14.6],
      [-14.6, 14.6],
      [14.6, 14.6],
    ]) {
      const pylon = new THREE.Group();
      pylon.position.set(cx, 0.44, cz);
      const ped = new THREE.Mesh(new THREE.BoxGeometry(0.88, 0.46, 0.88), brassMat);
      ped.position.y = 0.23;
      pylon.add(ped);

      const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.11, 0.18, 6.2, 8), mastMat);
      pole.position.y = 3.3;
      pole.castShadow = true;
      pylon.add(pole);

      const head = new THREE.Group();
      head.position.set(0, 6.45, 0);
      head.lookAt(new THREE.Vector3(-cx, -5.2, -cz));
      head.add(new THREE.Mesh(new THREE.BoxGeometry(0.92, 0.48, 0.55), mastMat));

      const lens = new THREE.Mesh(new THREE.PlaneGeometry(0.76, 0.34), lensMat);
      lens.position.z = 0.28;
      head.add(lens);

      const cone = new THREE.Mesh(coneGeo, coneMat);
      cone.rotation.x = -Math.PI / 2;
      cone.position.z = 0.3;
      head.add(cone);

      pylon.add(head);
      plinth.add(pylon);
    }

    this.group.add(plinth);
  }

  private buildTileLayers(): void {
    this.floorInstanced = new THREE.InstancedMesh(
      new THREE.BoxGeometry(1.002, 0.6, 1.002),
      new THREE.MeshStandardMaterial({
        map: this.textures.floorMap,
        normalMap: this.textures.floorNormal,
        roughnessMap: this.textures.floorRoughness,
        normalScale: new THREE.Vector2(0.85, 0.85),
        roughness: 0.76,
        metalness: 0.24,
      }),
      MAX_CELLS,
    );
    this.floorInstanced.receiveShadow = true;
    this.floorInstanced.frustumCulled = false;
    this.group.add(this.floorInstanced);

    this.brickInstanced = new THREE.InstancedMesh(
      new RoundedBoxGeometry(0.47, 0.51, 0.94, 1, 0.04),
      new THREE.MeshStandardMaterial({
        map: this.textures.brickMap,
        normalMap: this.textures.brickNormal,
        roughnessMap: this.textures.brickRoughness,
        normalScale: new THREE.Vector2(1.15, 1.15),
        roughness: 0.82,
        metalness: 0.06,
      }),
      MAX_CELLS * BRICKS_PER_CELL,
    );
    this.brickInstanced.castShadow = true;
    this.brickInstanced.receiveShadow = true;
    this.brickInstanced.frustumCulled = false;
    // Initialize instanceColor buffer
    this.brickInstanced.setColorAt(0, new THREE.Color(0xffffff));
    this.group.add(this.brickInstanced);

    const palette = [0xd66d4a, 0xc25839, 0xaa472c, 0xcc6341, 0xb54e32, 0xdf7d59];
    for (let i = 0; i < MAX_CELLS; i++) {
      const sub: number[] = [];
      for (let b = 0; b < BRICKS_PER_CELL; b++) {
        sub.push(palette[(i * 7 + b * 13) % palette.length]);
      }
      this.brickCellColors.push(sub);
    }

    this.steelInstanced = new THREE.InstancedMesh(
      new RoundedBoxGeometry(0.96, 1.62, 0.96, 2, 0.06),
      new THREE.MeshStandardMaterial({
        map: this.textures.steelMap,
        normalMap: this.textures.steelNormal,
        roughnessMap: this.textures.steelRoughness,
        normalScale: new THREE.Vector2(1.15, 1.15),
        roughness: 0.3,
        metalness: 0.88,
      }),
      MAX_CELLS,
    );
    this.steelInstanced.castShadow = true;
    this.steelInstanced.receiveShadow = true;
    this.steelInstanced.frustumCulled = false;
    this.group.add(this.steelInstanced);

    // Fast reflective glacial ice (opaque standard material avoids multi-pass clearcoat transparency)
    this.iceInstanced = new THREE.InstancedMesh(
      new RoundedBoxGeometry(0.995, 0.07, 0.995, 1, 0.018),
      new THREE.MeshStandardMaterial({
        color: 0x93dff7,
        normalMap: this.textures.iceNormal,
        normalScale: new THREE.Vector2(0.55, 0.55),
        roughness: 0.09,
        metalness: 0.22,
        envMapIntensity: 1.45,
      }),
      MAX_CELLS,
    );
    this.iceInstanced.receiveShadow = true;
    this.iceInstanced.frustumCulled = false;
    this.group.add(this.iceInstanced);

    const forestMat = new THREE.MeshStandardMaterial({
      color: 0xffffff,
      roughness: 0.76,
      metalness: 0.04,
    });
    forestMat.onBeforeCompile = (shader) => {
      shader.uniforms.uTime = this.forestUniforms.uTime;
      shader.vertexShader =
        `uniform float uTime;\n` +
        shader.vertexShader.replace(
          '#include <begin_vertex>',
          `
          #include <begin_vertex>
          vec4 wPos = instanceMatrix * vec4(transformed, 1.0);
          float sway = sin(uTime * 2.2 + wPos.x * 0.9 + wPos.z * 0.7) * 0.055 * max(0.0, transformed.y + 0.4);
          transformed.x += sway;
          transformed.z += cos(uTime * 1.8 + wPos.z * 1.1) * 0.04 * max(0.0, transformed.y + 0.4);
          `,
        );
    };
    this.forestInstanced = new THREE.InstancedMesh(
      new THREE.DodecahedronGeometry(0.48, 1),
      forestMat,
      MAX_CELLS * 2,
    );
    this.forestInstanced.castShadow = true;
    this.forestInstanced.receiveShadow = true;
    this.forestInstanced.frustumCulled = false;
    this.forestInstanced.setColorAt(0, new THREE.Color(0x4b8742));
    this.group.add(this.forestInstanced);
  }

  private buildWaterLayer(): void {
    // Per-cell instanced canal water: zero vertex/fragment work on dry maps!
    const tileGeo = new THREE.PlaneGeometry(1.01, 1.01, 4, 4);
    tileGeo.rotateX(-Math.PI / 2);

    const waterMat = new THREE.ShaderMaterial({
      uniforms: this.waterUniforms,
      transparent: true,
      depthWrite: false,
      vertexShader: /* glsl */ `
        uniform float uTime;
        varying vec3 vWorldPos;
        varying vec3 vNormal;
        varying vec2 vLocalUv;
        float wave(vec2 p, float t) {
          return sin(p.x * 2.4 + t * 2.2) * cos(p.y * 2.0 - t * 1.7) * 0.028
               + sin((p.x + p.y) * 3.8 - t * 2.7) * 0.014;
        }
        void main() {
          vLocalUv = uv;
          vec4 wp = modelMatrix * instanceMatrix * vec4(position, 1.0);
          float h = wave(wp.xz, uTime);
          wp.y += h;
          float eps = 0.08;
          float hx = wave(wp.xz + vec2(eps, 0.0), uTime) - h;
          float hz = wave(wp.xz + vec2(0.0, eps), uTime) - h;
          vNormal = normalize(vec3(-hx / eps, 1.0, -hz / eps));
          vWorldPos = wp.xyz;
          gl_Position = projectionMatrix * viewMatrix * wp;
        }
      `,
      fragmentShader: /* glsl */ `
        uniform float uTime;
        uniform vec3 uLightDir;
        varying vec3 vWorldPos;
        varying vec3 vNormal;
        varying vec2 vLocalUv;
        void main() {
          vec3 viewDir = normalize(cameraPosition - vWorldPos);
          vec3 n = normalize(vNormal);
          float fresnel = pow(1.0 - max(dot(viewDir, n), 0.0), 3.0);
          float spec = pow(max(dot(n, normalize(uLightDir + viewDir)), 0.0), 90.0);
          float caustic = smoothstep(0.32, 0.92, (sin(vWorldPos.x * 5.4 + uTime * 2.3) * sin(vWorldPos.z * 5.4 - uTime * 1.8)) * 0.5 + 0.5) * 0.2;
          vec2 bank = min(vLocalUv, 1.0 - vLocalUv);
          float edgeFoam = (1.0 - smoothstep(0.0, 0.09, min(bank.x, bank.y))) * 0.14;
          vec3 col = mix(vec3(0.06, 0.26, 0.38), vec3(0.18, 0.6, 0.78), 0.46 + caustic);
          col = mix(col, vec3(0.58, 0.8, 0.95), fresnel * 0.52 + edgeFoam) + vec3(1.0, 0.93, 0.78) * spec * 1.3;
          gl_FragColor = vec4(col, 0.88);
        }
      `,
    });

    this.waterInstanced = new THREE.InstancedMesh(tileGeo, waterMat, MAX_CELLS);
    this.waterInstanced.frustumCulled = false;
    this.waterInstanced.renderOrder = 2;
    this.waterInstanced.count = 0;
    this.waterInstanced.visible = false;
    this.group.add(this.waterInstanced);
  }

  private buildEagleMonument(): void {
    this.eagleGroup.position.set(0, 0, 12.0);
    const basaltMat = new THREE.MeshStandardMaterial({ color: 0x1b222c, roughness: 0.52, metalness: 0.64 });
    const goldMat = new THREE.MeshStandardMaterial({ color: 0xe8b048, roughness: 0.2, metalness: 0.93 });
    const coreMat = new THREE.MeshStandardMaterial({
      color: 0xffcb66,
      emissive: new THREE.Color(0xff961e),
      emissiveIntensity: 2.3,
      roughness: 0.15,
    });

    const b1 = new THREE.Mesh(new THREE.CylinderGeometry(0.92, 1.04, 0.24, 8), basaltMat);
    b1.position.y = 0.12;
    b1.castShadow = true;
    b1.receiveShadow = true;
    this.eagleGroup.add(b1);

    const b2 = new THREE.Mesh(new THREE.CylinderGeometry(0.68, 0.82, 0.22, 8), goldMat);
    b2.position.y = 0.34;
    b2.castShadow = true;
    this.eagleGroup.add(b2);

    this.eagleCrest.position.y = 1.05;
    const torso = new THREE.Mesh(new THREE.OctahedronGeometry(0.34, 0), goldMat);
    torso.scale.set(0.85, 1.45, 0.55);
    torso.castShadow = true;
    this.eagleCrest.add(torso);

    const head = new THREE.Mesh(new THREE.ConeGeometry(0.18, 0.34, 6), goldMat);
    head.position.set(0, 0.54, 0.04);
    head.rotation.x = 0.3;
    this.eagleCrest.add(head);

    for (const side of [-1, 1]) {
      for (let w = 0; w < 3; w++) {
        const feather = new THREE.Mesh(new THREE.BoxGeometry(0.62 - w * 0.11, 0.11, 0.12), goldMat);
        feather.position.set(side * (0.44 + w * 0.08), 0.28 - w * 0.16, -0.02 * w);
        feather.rotation.z = side * (0.34 - w * 0.14);
        feather.castShadow = true;
        this.eagleCrest.add(feather);
      }
    }

    const core = new THREE.Mesh(new THREE.OctahedronGeometry(0.18, 1), coreMat);
    core.position.y = 0.06;
    this.eagleCrest.add(core);

    this.eagleRingOuter = new THREE.Mesh(new THREE.TorusGeometry(0.76, 0.035, 8, 28), goldMat);
    this.eagleCrest.add(this.eagleRingOuter);
    this.eagleRingInner = new THREE.Mesh(new THREE.TorusGeometry(0.56, 0.026, 8, 24), basaltMat);
    this.eagleCrest.add(this.eagleRingInner);
    this.eagleGroup.add(this.eagleCrest);

    const charMat = new THREE.MeshStandardMaterial({
      color: 0x231f1d,
      roughness: 0.9,
      emissive: new THREE.Color(0x551605),
      emissiveIntensity: 0.6,
    });
    for (let i = 0; i < 5; i++) {
      const shard = new THREE.Mesh(new THREE.DodecahedronGeometry(0.24, 0), charMat);
      shard.position.set(Math.cos(i * 1.3) * 0.35, 0.25 + (i % 2) * 0.12, Math.sin(i * 1.3) * 0.35);
      shard.rotation.set(i, i * 0.7, i * 1.4);
      this.eagleRuinGroup.add(shard);
    }
    this.eagleRuinGroup.visible = false;
    this.eagleGroup.add(this.eagleRuinGroup);

    this.eagleLight = new THREE.PointLight(0xffaa38, 2.2, 7.5, 1.8);
    this.eagleLight.position.set(0, 1.35, 0);
    this.eagleGroup.add(this.eagleLight);
    this.group.add(this.eagleGroup);
  }

  private buildReserveRacks(): void {
    const miniGeo = new RoundedBoxGeometry(0.62, 0.32, 0.82, 1, 0.06);
    const enemyMat = new THREE.MeshStandardMaterial({ color: 0xa8553b, roughness: 0.4, metalness: 0.7 });
    const playerMat = new THREE.MeshStandardMaterial({ color: 0xd99b30, roughness: 0.32, metalness: 0.78 });

    for (let i = 0; i < 20; i++) {
      const m = new THREE.Mesh(miniGeo, enemyMat);
      m.position.set(-14.0 - (i % 2) * 0.78, 0.62, -10.5 + Math.floor(i / 2) * 1.15);
      this.group.add(m);
      this.enemyRackMeshes.push(m);
    }
    for (let i = 0; i < 6; i++) {
      const m = new THREE.Mesh(miniGeo, playerMat);
      m.position.set(14.2, 0.62, 5.5 + i * 1.25);
      this.group.add(m);
      this.playerRackMeshes.push(m);
    }
  }

  public updateRackCounts(enemyRemaining: number, playerLives: number): void {
    for (let i = 0; i < this.enemyRackMeshes.length; i++) {
      const vis = i < enemyRemaining;
      if (this.enemyRackMeshes[i].visible !== vis) this.enemyRackMeshes[i].visible = vis;
    }
    for (let i = 0; i < this.playerRackMeshes.length; i++) {
      const vis = i < playerLives;
      if (this.playerRackMeshes[i].visible !== vis) this.playerRackMeshes[i].visible = vis;
    }
  }

  private buildAtmosphericEmbers(): void {
    // 100% GPU-driven rising embers: zero CPU loop and zero buffer upload per frame!
    const count = 130;
    const positions = new Float32Array(count * 3);
    const seeds = new Float32Array(count * 2);
    const colors = new Float32Array(count * 3);

    for (let i = 0; i < count; i++) {
      positions[i * 3] = (Math.random() - 0.5) * 36;
      positions[i * 3 + 1] = Math.random() * 14.5;
      positions[i * 3 + 2] = (Math.random() - 0.5) * 36;
      seeds[i * 2] = 0.28 + Math.random() * 0.62;
      seeds[i * 2 + 1] = Math.random() * Math.PI * 2;

      const warm = Math.random() > 0.32;
      colors[i * 3] = warm ? 1.0 : 0.62;
      colors[i * 3 + 1] = warm ? 0.74 : 0.78;
      colors[i * 3 + 2] = warm ? 0.38 : 0.95;
    }

    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    geo.setAttribute('aSeed', new THREE.BufferAttribute(seeds, 2));
    geo.setAttribute('color', new THREE.BufferAttribute(colors, 3));

    const mat = new THREE.ShaderMaterial({
      uniforms: {
        uTime: this.emberUniforms.uTime,
        uMap: { value: this.textures.softGlowTex },
      },
      vertexShader: /* glsl */ `
        attribute vec2 aSeed;
        attribute vec3 color;
        uniform float uTime;
        varying vec3 vColor;
        varying float vAlpha;
        void main() {
          vColor = color;
          vec3 p = position;
          float h = mod(p.y + uTime * aSeed.x, 14.5);
          p.y = 0.25 + h;
          p.x += sin(uTime * 0.65 + aSeed.y) * 0.45;
          p.z += cos(uTime * 0.52 + aSeed.y * 1.3) * 0.35;
          vAlpha = smoothstep(0.0, 1.5, h) * (1.0 - smoothstep(11.5, 14.5, h));
          vec4 mv = modelViewMatrix * vec4(p, 1.0);
          gl_PointSize = clamp(160.0 / max(1.0, -mv.z), 2.0, 12.0);
          gl_Position = projectionMatrix * mv;
        }
      `,
      fragmentShader: /* glsl */ `
        uniform sampler2D uMap;
        varying vec3 vColor;
        varying float vAlpha;
        void main() {
          vec4 tex = texture2D(uMap, gl_PointCoord);
          gl_FragColor = vec4(vColor * tex.rgb, tex.a * vAlpha * 0.56);
        }
      `,
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
    });

    const points = new THREE.Points(geo, mat);
    points.frustumCulled = false;
    this.group.add(points);
  }

  private buildBrushCursor(): void {
    const edges = new THREE.EdgesGeometry(new THREE.BoxGeometry(2.02, 0.25, 2.02));
    this.brushCursor.add(new THREE.LineSegments(edges, new THREE.LineBasicMaterial({ color: 0xffbe4f })));
    const plate = new THREE.Mesh(
      new THREE.PlaneGeometry(1.98, 1.98),
      new THREE.MeshBasicMaterial({ color: 0xd99b30, transparent: true, opacity: 0.22, depthWrite: false }),
    );
    plate.rotation.x = -Math.PI / 2;
    plate.position.y = -0.1;
    this.brushCursor.add(plate);
    this.brushCursor.position.y = 0.14;
    this.brushCursor.visible = false;
    this.group.add(this.brushCursor);
  }

  public loadGrid(newGrid: Uint8Array, showEagle = true): void {
    this.grid.set(newGrid);
    this.eagleGroup.visible = showEagle;
    this.setEagleAlive(true);
    this.rebuildAllInstances();
  }

  public setEagleAlive(alive: boolean): void {
    this.baseAlive = alive;
    this.eagleCrest.visible = alive;
    this.eagleRuinGroup.visible = !alive;
    this.eagleLight.intensity = alive ? 2.2 : 0.45;
    this.eagleLight.color.setHex(alive ? 0xffaa38 : 0xff4411);
  }

  public setCell(gx: number, gz: number, type: TileType): BrickPopInfo[] {
    if (gx < 0 || gx >= GRID_SIZE || gz < 0 || gz >= GRID_SIZE) return [];
    const idx = gz * GRID_SIZE + gx;
    const prev = this.grid[idx] as TileType;
    if (prev === type) return [];

    const popped = prev === TileType.BRICK ? this.computeCellBrickTransforms(gx, gz, idx) : [];
    this.grid[idx] = type;
    this.rebuildAllInstances();
    return popped;
  }

  private computeCellBrickTransforms(gx: number, gz: number, idx: number): BrickPopInfo[] {
    const wx = this.gridToWorldX(gx);
    const wz = this.gridToWorldZ(gz);
    const colors = this.brickCellColors[idx];
    const out: BrickPopInfo[] = [];

    for (let layer = 0; layer < 3; layer++) {
      const y = 0.26 + layer * 0.53;
      const rot = layer % 2 === 1;
      for (let b = 0; b < 2; b++) {
        const offset = b === 0 ? -0.245 : 0.245;
        const jx = (((idx * 17 + layer * 7 + b * 3) % 7) - 3) * 0.004;
        const jz = (((idx * 11 + layer * 5 + b * 9) % 7) - 3) * 0.004;
        const jr = (((idx * 13 + layer * 3 + b * 5) % 5) - 2) * 0.012;
        out.push({
          x: (rot ? wx : wx + offset) + jx,
          y,
          z: (rot ? wz + offset : wz) + jz,
          rotY: (rot ? Math.PI * 0.5 : 0) + jr,
          color: colors[layer * 2 + b],
        });
      }
    }
    return out;
  }

  /**
   * Densely packs active terrain instances so GPU only vertex-shades & shadow-maps
   * tiles that actually exist on the current map (cuts >85% wasted zero-scale geometry).
   */
  public rebuildAllInstances(): void {
    let brickCount = 0;
    let steelCount = 0;
    let iceCount = 0;
    let forestCount = 0;
    let waterCount = 0;

    const forestPaletteLower = [0x3b7236, 0x417a3b, 0x356931, 0x46803e];
    const forestPaletteUpper = [0x589849, 0x62a350, 0x4e8c42, 0x68ab54];

    for (let gz = 0; gz < GRID_SIZE; gz++) {
      for (let gx = 0; gx < GRID_SIZE; gx++) {
        const idx = gz * GRID_SIZE + gx;
        const type = this.grid[idx] as TileType;
        const wx = this.gridToWorldX(gx);
        const wz = this.gridToWorldZ(gz);

        // Floor tile (recessed beneath canal water)
        this.dummy.rotation.set(0, 0, 0);
        this.dummy.scale.set(1, 1, 1);
        this.dummy.position.set(wx, type === TileType.WATER ? -0.78 : -0.3, wz);
        this.dummy.updateMatrix();
        this.floorInstanced.setMatrixAt(idx, this.dummy.matrix);

        if (type === TileType.BRICK) {
          const bricks = this.computeCellBrickTransforms(gx, gz, idx);
          for (let b = 0; b < BRICKS_PER_CELL; b++) {
            const info = bricks[b];
            this.dummy.position.set(info.x, info.y, info.z);
            this.dummy.rotation.set(0, info.rotY, 0);
            this.dummy.scale.set(1, 1, 1);
            this.dummy.updateMatrix();
            this.brickInstanced.setMatrixAt(brickCount, this.dummy.matrix);
            this.brickInstanced.setColorAt(brickCount, this.tmpColor.setHex(info.color));
            brickCount++;
          }
        } else if (type === TileType.STEEL) {
          this.dummy.position.set(wx, 0.81, wz);
          this.dummy.rotation.set(0, 0, 0);
          this.dummy.scale.set(1, 1, 1);
          this.dummy.updateMatrix();
          this.steelInstanced.setMatrixAt(steelCount++, this.dummy.matrix);
        } else if (type === TileType.ICE) {
          this.dummy.position.set(wx, 0.03, wz);
          this.dummy.rotation.set(0, 0, 0);
          this.dummy.scale.set(1, 1, 1);
          this.dummy.updateMatrix();
          this.iceInstanced.setMatrixAt(iceCount++, this.dummy.matrix);
        } else if (type === TileType.FOREST) {
          const jitter = ((gx * 37 + gz * 17) % 10) * 0.03;
          const cIdx = (gx * 5 + gz * 11) & 3;
          this.dummy.position.set(wx - 0.14, 1.18 + jitter, wz - 0.1);
          this.dummy.rotation.set(gx * 0.5, gz * 0.8, 0);
          this.dummy.scale.set(1.12, 0.92, 1.12);
          this.dummy.updateMatrix();
          this.forestInstanced.setMatrixAt(forestCount, this.dummy.matrix);
          this.forestInstanced.setColorAt(forestCount, this.tmpColor.setHex(forestPaletteLower[cIdx]));
          forestCount++;

          this.dummy.position.set(wx + 0.18, 1.48, wz + 0.15);
          this.dummy.rotation.set(gz * 0.4, gx * 1.1, 0.2);
          this.dummy.scale.set(0.86, 0.86, 0.86);
          this.dummy.updateMatrix();
          this.forestInstanced.setMatrixAt(forestCount, this.dummy.matrix);
          this.forestInstanced.setColorAt(forestCount, this.tmpColor.setHex(forestPaletteUpper[cIdx]));
          forestCount++;
        } else if (type === TileType.WATER) {
          this.dummy.position.set(wx, -0.14, wz);
          this.dummy.rotation.set(0, 0, 0);
          this.dummy.scale.set(1, 1, 1);
          this.dummy.updateMatrix();
          this.waterInstanced.setMatrixAt(waterCount++, this.dummy.matrix);
        }
      }
    }

    this.floorInstanced.count = MAX_CELLS;
    this.floorInstanced.instanceMatrix.needsUpdate = true;

    this.brickInstanced.count = brickCount;
    this.brickInstanced.visible = brickCount > 0;
    if (brickCount > 0) {
      this.brickInstanced.instanceMatrix.needsUpdate = true;
      if (this.brickInstanced.instanceColor) this.brickInstanced.instanceColor.needsUpdate = true;
    }

    this.steelInstanced.count = steelCount;
    this.steelInstanced.visible = steelCount > 0;
    if (steelCount > 0) this.steelInstanced.instanceMatrix.needsUpdate = true;

    this.iceInstanced.count = iceCount;
    this.iceInstanced.visible = iceCount > 0;
    if (iceCount > 0) this.iceInstanced.instanceMatrix.needsUpdate = true;

    this.forestInstanced.count = forestCount;
    this.forestInstanced.visible = forestCount > 0;
    if (forestCount > 0) {
      this.forestInstanced.instanceMatrix.needsUpdate = true;
      if (this.forestInstanced.instanceColor) this.forestInstanced.instanceColor.needsUpdate = true;
    }

    this.waterInstanced.count = waterCount;
    this.waterInstanced.visible = waterCount > 0;
    if (waterCount > 0) this.waterInstanced.instanceMatrix.needsUpdate = true;
  }

  public update(_dt: number, elapsed: number): void {
    this.waterUniforms.uTime.value = elapsed;
    this.forestUniforms.uTime.value = elapsed;
    this.emberUniforms.uTime.value = elapsed;

    if (this.eagleGroup.visible && this.baseAlive) {
      this.eagleCrest.position.y = 1.05 + Math.sin(elapsed * 2.2) * 0.05;
      this.eagleCrest.rotation.y = Math.sin(elapsed * 0.8) * 0.22;
      this.eagleRingOuter.rotation.y = elapsed * 1.15;
      this.eagleRingOuter.rotation.x = Math.sin(elapsed * 0.9) * 0.45;
      this.eagleRingInner.rotation.x = -elapsed * 1.6;
      this.eagleRingInner.rotation.z = elapsed * 0.85;
      this.eagleLight.intensity = 2.0 + Math.sin(elapsed * 4.5) * 0.35;
    }
  }
}
