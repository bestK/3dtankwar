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
  private waterUniforms = {
    uTime: { value: 0 },
    uLightDir: { value: new THREE.Vector3(0.55, 0.75, 0.35).normalize() },
  };
  private forestUniforms = { uTime: { value: 0 } };

  private eagleGroup = new THREE.Group();
  private eagleCrest = new THREE.Group();
  private eagleRingOuter!: THREE.Mesh;
  private eagleRingInner!: THREE.Mesh;
  private eagleRuinGroup = new THREE.Group();
  private eagleLight!: THREE.PointLight;
  public baseAlive = true;

  private enemyRackMeshes: THREE.Mesh[] = [];
  private playerRackMeshes: THREE.Mesh[] = [];

  private emberPoints!: THREE.Points;
  private emberPositions!: Float32Array;
  private emberSpeeds!: Float32Array;

  public brushCursor = new THREE.Group();
  private brickCellColors: number[][] = [];
  private dummy = new THREE.Object3D();
  private zeroMatrix = new THREE.Matrix4().makeScale(0, 0, 0);

  constructor(private textures: TextureBundle) {
    this.buildWarTablePlinth();
    this.buildTileLayers();
    this.buildWaterPlane();
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

  private buildWarTablePlinth(): void {
    const plinth = new THREE.Group();

    const baseMat = new THREE.MeshStandardMaterial({
      color: 0x161d26,
      roughness: 0.52,
      metalness: 0.65,
      normalMap: this.textures.steelNormal,
      normalScale: new THREE.Vector2(0.35, 0.35),
    });

    const underSlab = new THREE.Mesh(new RoundedBoxGeometry(31.4, 2.1, 31.4, 3, 0.22), baseMat);
    underSlab.position.y = -1.58;
    underSlab.receiveShadow = true;
    plinth.add(underSlab);

    const lowerPedestal = new THREE.Mesh(
      new RoundedBoxGeometry(27.6, 2.4, 27.6, 2, 0.18),
      new THREE.MeshStandardMaterial({ color: 0x0f141c, roughness: 0.65, metalness: 0.55 }),
    );
    lowerPedestal.position.y = -3.6;
    plinth.add(lowerPedestal);

    const rimMat = new THREE.MeshStandardMaterial({
      color: 0x202936,
      roughness: 0.4,
      metalness: 0.75,
      normalMap: this.textures.steelNormal,
      normalScale: new THREE.Vector2(0.4, 0.4),
    });

    const wt = 2.4;
    const wh = 0.72;
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
      color: 0xd49d3b,
      roughness: 0.28,
      metalness: 0.88,
    });

    const nTrim = new THREE.Mesh(new THREE.BoxGeometry(BOARD_SIZE + 0.28, 0.06, 0.14), brassMat);
    nTrim.position.set(0, 0.45, -HALF_BOARD - 0.07);
    plinth.add(nTrim);
    const sTrim = nTrim.clone();
    sTrim.position.z = HALF_BOARD + 0.07;
    plinth.add(sTrim);

    const wTrim = new THREE.Mesh(new THREE.BoxGeometry(0.14, 0.06, BOARD_SIZE), brassMat);
    wTrim.position.set(-HALF_BOARD - 0.07, 0.45, 0);
    plinth.add(wTrim);
    const eTrim = wTrim.clone();
    eTrim.position.x = HALF_BOARD + 0.07;
    plinth.add(eTrim);

    const tickGeo = new THREE.BoxGeometry(0.06, 0.04, 0.32);
    for (let i = -12; i <= 12; i += 2) {
      const t1 = new THREE.Mesh(tickGeo, brassMat);
      t1.position.set(i, 0.46, -HALF_BOARD - 0.38);
      plinth.add(t1);
      const t2 = t1.clone();
      t2.position.z = HALF_BOARD + 0.38;
      plinth.add(t2);
    }

    // 4 Corner Floodlight Pylons + Volumetric Cones
    const mastMat = new THREE.MeshStandardMaterial({ color: 0x2b3646, roughness: 0.36, metalness: 0.82 });
    const lensMat = new THREE.MeshBasicMaterial({ color: new THREE.Color(2.4, 1.95, 1.35) });

    const coneGeo = new THREE.ConeGeometry(4.2, 13.5, 22, 1, true);
    coneGeo.translate(0, -6.75, 0);
    const posAttr = coneGeo.attributes.position;
    const coneColors = new Float32Array(posAttr.count * 4);
    for (let i = 0; i < posAttr.count; i++) {
      const alpha = Math.pow(1 + posAttr.getY(i) / 13.5, 2.2) * 0.065;
      coneColors[i * 4] = 1.0;
      coneColors[i * 4 + 1] = 0.84;
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
      const ped = new THREE.Mesh(new THREE.BoxGeometry(0.85, 0.45, 0.85), brassMat);
      ped.position.y = 0.22;
      pylon.add(ped);

      const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.11, 0.18, 6.2, 10), mastMat);
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
        roughness: 0.78,
        metalness: 0.22,
      }),
      MAX_CELLS,
    );
    this.floorInstanced.receiveShadow = true;
    this.group.add(this.floorInstanced);

    this.brickInstanced = new THREE.InstancedMesh(
      new RoundedBoxGeometry(0.47, 0.51, 0.94, 2, 0.045),
      new THREE.MeshStandardMaterial({
        map: this.textures.brickMap,
        normalMap: this.textures.brickNormal,
        roughnessMap: this.textures.brickRoughness,
        normalScale: new THREE.Vector2(1.1, 1.1),
        roughness: 0.84,
        metalness: 0.06,
      }),
      MAX_CELLS * BRICKS_PER_CELL,
    );
    this.brickInstanced.castShadow = true;
    this.brickInstanced.receiveShadow = true;
    this.group.add(this.brickInstanced);

    const palette = [0xd46a48, 0xbf5537, 0xa8452a, 0xc9603f, 0xb34c30, 0xdc7956];
    for (let i = 0; i < MAX_CELLS; i++) {
      const sub: number[] = [];
      for (let b = 0; b < BRICKS_PER_CELL; b++) {
        const c = palette[(i * 7 + b * 13) % palette.length];
        sub.push(c);
        this.brickInstanced.setColorAt(i * BRICKS_PER_CELL + b, new THREE.Color(c));
      }
      this.brickCellColors.push(sub);
    }
    if (this.brickInstanced.instanceColor) this.brickInstanced.instanceColor.needsUpdate = true;

    this.steelInstanced = new THREE.InstancedMesh(
      new RoundedBoxGeometry(0.96, 1.62, 0.96, 3, 0.065),
      new THREE.MeshStandardMaterial({
        map: this.textures.steelMap,
        normalMap: this.textures.steelNormal,
        roughnessMap: this.textures.steelRoughness,
        normalScale: new THREE.Vector2(1.15, 1.15),
        roughness: 0.32,
        metalness: 0.88,
      }),
      MAX_CELLS,
    );
    this.steelInstanced.castShadow = true;
    this.steelInstanced.receiveShadow = true;
    this.group.add(this.steelInstanced);

    this.iceInstanced = new THREE.InstancedMesh(
      new RoundedBoxGeometry(0.99, 0.08, 0.99, 2, 0.02),
      new THREE.MeshPhysicalMaterial({
        color: 0x9ce3f8,
        normalMap: this.textures.iceNormal,
        normalScale: new THREE.Vector2(0.45, 0.45),
        roughness: 0.08,
        metalness: 0.12,
        clearcoat: 0.9,
        clearcoatRoughness: 0.08,
        transparent: true,
        opacity: 0.84,
      }),
      MAX_CELLS,
    );
    this.iceInstanced.receiveShadow = true;
    this.group.add(this.iceInstanced);

    const forestMat = new THREE.MeshStandardMaterial({
      color: 0x4b8742,
      roughness: 0.78,
      metalness: 0.05,
      transparent: true,
      opacity: 0.9,
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
          float sway = sin(uTime * 2.4 + wPos.x * 0.9 + wPos.z * 0.7) * 0.065 * max(0.0, transformed.y + 0.4);
          transformed.x += sway;
          transformed.z += cos(uTime * 1.9 + wPos.z * 1.1) * 0.045 * max(0.0, transformed.y + 0.4);
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
    this.group.add(this.forestInstanced);
  }

  private buildWaterPlane(): void {
    const waterGeo = new THREE.PlaneGeometry(BOARD_SIZE, BOARD_SIZE, 88, 88);
    waterGeo.rotateX(-Math.PI / 2);

    const waterMat = new THREE.ShaderMaterial({
      uniforms: this.waterUniforms,
      transparent: true,
      depthWrite: false,
      vertexShader: /* glsl */ `
        uniform float uTime;
        varying vec3 vWorldPos;
        varying vec3 vNormal;
        float wave(vec2 p, float t) {
          return sin(p.x * 2.3 + t * 2.1) * cos(p.y * 1.9 - t * 1.6) * 0.032
               + sin((p.x + p.y) * 3.7 - t * 2.8) * 0.016;
        }
        void main() {
          vec3 pos = position;
          float h = wave(pos.xz, uTime);
          pos.y += h;
          float eps = 0.08;
          float hx = wave(pos.xz + vec2(eps, 0.0), uTime) - h;
          float hz = wave(pos.xz + vec2(0.0, eps), uTime) - h;
          vNormal = normalize(vec3(-hx / eps, 1.0, -hz / eps));
          vec4 wp = modelMatrix * vec4(pos, 1.0);
          vWorldPos = wp.xyz;
          gl_Position = projectionMatrix * viewMatrix * wp;
        }
      `,
      fragmentShader: /* glsl */ `
        uniform float uTime;
        uniform vec3 uLightDir;
        varying vec3 vWorldPos;
        varying vec3 vNormal;
        void main() {
          vec3 viewDir = normalize(cameraPosition - vWorldPos);
          vec3 n = normalize(vNormal);
          float fresnel = pow(1.0 - max(dot(viewDir, n), 0.0), 3.2);
          float spec = pow(max(dot(n, normalize(uLightDir + viewDir)), 0.0), 96.0);
          float caustic = smoothstep(0.35, 0.95, (sin(vWorldPos.x * 5.2 + uTime * 2.4) * sin(vWorldPos.z * 5.2 - uTime * 1.9)) * 0.5 + 0.5) * 0.16;
          vec3 col = mix(vec3(0.07, 0.28, 0.39), vec3(0.19, 0.58, 0.74), 0.45 + caustic);
          col = mix(col, vec3(0.55, 0.76, 0.92), fresnel * 0.55) + vec3(1.0, 0.92, 0.76) * spec * 1.35;
          gl_FragColor = vec4(col, 0.84);
        }
      `,
    });

    const waterMesh = new THREE.Mesh(waterGeo, waterMat);
    waterMesh.position.y = -0.14;
    waterMesh.renderOrder = 2;
    this.group.add(waterMesh);
  }

  private buildEagleMonument(): void {
    this.eagleGroup.position.set(0, 0, 12.0);
    const basaltMat = new THREE.MeshStandardMaterial({ color: 0x1b222c, roughness: 0.55, metalness: 0.6 });
    const goldMat = new THREE.MeshStandardMaterial({ color: 0xe6ad45, roughness: 0.22, metalness: 0.92 });
    const coreMat = new THREE.MeshStandardMaterial({
      color: 0xffc65c,
      emissive: new THREE.Color(0xff941a),
      emissiveIntensity: 2.2,
      roughness: 0.15,
    });

    const b1 = new THREE.Mesh(new THREE.CylinderGeometry(0.92, 1.02, 0.24, 8), basaltMat);
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

    this.eagleRingOuter = new THREE.Mesh(new THREE.TorusGeometry(0.76, 0.035, 8, 32), goldMat);
    this.eagleCrest.add(this.eagleRingOuter);
    this.eagleRingInner = new THREE.Mesh(new THREE.TorusGeometry(0.56, 0.026, 8, 28), basaltMat);
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
    const miniGeo = new RoundedBoxGeometry(0.62, 0.32, 0.82, 2, 0.06);
    const enemyMat = new THREE.MeshStandardMaterial({ color: 0xa6533a, roughness: 0.42, metalness: 0.68 });
    const playerMat = new THREE.MeshStandardMaterial({ color: 0xd99b30, roughness: 0.34, metalness: 0.76 });

    for (let i = 0; i < 20; i++) {
      const m = new THREE.Mesh(miniGeo, enemyMat);
      m.position.set(-14.0 - (i % 2) * 0.78, 0.62, -10.5 + Math.floor(i / 2) * 1.15);
      m.castShadow = true;
      this.group.add(m);
      this.enemyRackMeshes.push(m);
    }
    for (let i = 0; i < 6; i++) {
      const m = new THREE.Mesh(miniGeo, playerMat);
      m.position.set(14.2, 0.62, 5.5 + i * 1.25);
      m.castShadow = true;
      this.group.add(m);
      this.playerRackMeshes.push(m);
    }
  }

  public updateRackCounts(enemyRemaining: number, playerLives: number): void {
    for (let i = 0; i < this.enemyRackMeshes.length; i++) this.enemyRackMeshes[i].visible = i < enemyRemaining;
    for (let i = 0; i < this.playerRackMeshes.length; i++) this.playerRackMeshes[i].visible = i < playerLives;
  }

  private buildAtmosphericEmbers(): void {
    const count = 220;
    this.emberPositions = new Float32Array(count * 3);
    this.emberSpeeds = new Float32Array(count);
    const colors = new Float32Array(count * 3);

    for (let i = 0; i < count; i++) {
      this.emberPositions[i * 3] = (Math.random() - 0.5) * 38;
      this.emberPositions[i * 3 + 1] = Math.random() * 14 + 0.3;
      this.emberPositions[i * 3 + 2] = (Math.random() - 0.5) * 38;
      this.emberSpeeds[i] = 0.25 + Math.random() * 0.65;
      const warm = Math.random() > 0.35;
      colors[i * 3] = warm ? 1.0 : 0.62;
      colors[i * 3 + 1] = warm ? 0.72 : 0.76;
      colors[i * 3 + 2] = warm ? 0.36 : 0.92;
    }

    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(this.emberPositions, 3));
    geo.setAttribute('color', new THREE.BufferAttribute(colors, 3));

    this.emberPoints = new THREE.Points(
      geo,
      new THREE.PointsMaterial({
        size: 0.24,
        map: this.textures.softGlowTex,
        vertexColors: true,
        transparent: true,
        opacity: 0.58,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
      }),
    );
    this.group.add(this.emberPoints);
  }

  private buildBrushCursor(): void {
    const edges = new THREE.EdgesGeometry(new THREE.BoxGeometry(2.02, 0.25, 2.02));
    this.brushCursor.add(new THREE.LineSegments(edges, new THREE.LineBasicMaterial({ color: 0xffbe4f })));
    const plate = new THREE.Mesh(
      new THREE.PlaneGeometry(1.98, 1.98),
      new THREE.MeshBasicMaterial({ color: 0xd99b30, transparent: true, opacity: 0.2, depthWrite: false }),
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
    this.writeCellMatrices(gx, gz, idx, type);
    this.markAllDirty();
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
        out.push({
          x: rot ? wx : wx + offset,
          y,
          z: rot ? wz + offset : wz,
          rotY: rot ? Math.PI * 0.5 : 0,
          color: colors[layer * 2 + b],
        });
      }
    }
    return out;
  }

  public rebuildAllInstances(): void {
    for (let gz = 0; gz < GRID_SIZE; gz++) {
      for (let gx = 0; gx < GRID_SIZE; gx++) {
        const idx = gz * GRID_SIZE + gx;
        this.writeCellMatrices(gx, gz, idx, this.grid[idx] as TileType);
      }
    }
    this.markAllDirty();
  }

  private writeCellMatrices(gx: number, gz: number, idx: number, type: TileType): void {
    const wx = this.gridToWorldX(gx);
    const wz = this.gridToWorldZ(gz);

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
        this.brickInstanced.setMatrixAt(idx * BRICKS_PER_CELL + b, this.dummy.matrix);
      }
    } else {
      for (let b = 0; b < BRICKS_PER_CELL; b++) {
        this.brickInstanced.setMatrixAt(idx * BRICKS_PER_CELL + b, this.zeroMatrix);
      }
    }

    if (type === TileType.STEEL) {
      this.dummy.position.set(wx, 0.81, wz);
      this.dummy.rotation.set(0, 0, 0);
      this.dummy.scale.set(1, 1, 1);
      this.dummy.updateMatrix();
      this.steelInstanced.setMatrixAt(idx, this.dummy.matrix);
    } else {
      this.steelInstanced.setMatrixAt(idx, this.zeroMatrix);
    }

    if (type === TileType.ICE) {
      this.dummy.position.set(wx, 0.03, wz);
      this.dummy.rotation.set(0, 0, 0);
      this.dummy.scale.set(1, 1, 1);
      this.dummy.updateMatrix();
      this.iceInstanced.setMatrixAt(idx, this.dummy.matrix);
    } else {
      this.iceInstanced.setMatrixAt(idx, this.zeroMatrix);
    }

    if (type === TileType.FOREST) {
      const jitter = ((gx * 37 + gz * 17) % 10) * 0.03;
      this.dummy.position.set(wx - 0.14, 1.18 + jitter, wz - 0.1);
      this.dummy.rotation.set(gx * 0.5, gz * 0.8, 0);
      this.dummy.scale.set(1.12, 0.92, 1.12);
      this.dummy.updateMatrix();
      this.forestInstanced.setMatrixAt(idx * 2, this.dummy.matrix);

      this.dummy.position.set(wx + 0.18, 1.46, wz + 0.15);
      this.dummy.rotation.set(gz * 0.4, gx * 1.1, 0.2);
      this.dummy.scale.set(0.86, 0.85, 0.86);
      this.dummy.updateMatrix();
      this.forestInstanced.setMatrixAt(idx * 2 + 1, this.dummy.matrix);
    } else {
      this.forestInstanced.setMatrixAt(idx * 2, this.zeroMatrix);
      this.forestInstanced.setMatrixAt(idx * 2 + 1, this.zeroMatrix);
    }
  }

  private markAllDirty(): void {
    this.floorInstanced.instanceMatrix.needsUpdate = true;
    this.brickInstanced.instanceMatrix.needsUpdate = true;
    this.steelInstanced.instanceMatrix.needsUpdate = true;
    this.iceInstanced.instanceMatrix.needsUpdate = true;
    this.forestInstanced.instanceMatrix.needsUpdate = true;
  }

  public update(dt: number, elapsed: number): void {
    this.waterUniforms.uTime.value = elapsed;
    this.forestUniforms.uTime.value = elapsed;

    if (this.eagleGroup.visible && this.baseAlive) {
      this.eagleCrest.position.y = 1.05 + Math.sin(elapsed * 2.2) * 0.05;
      this.eagleCrest.rotation.y = Math.sin(elapsed * 0.8) * 0.22;
      this.eagleRingOuter.rotation.y = elapsed * 1.15;
      this.eagleRingOuter.rotation.x = Math.sin(elapsed * 0.9) * 0.45;
      this.eagleRingInner.rotation.x = -elapsed * 1.6;
      this.eagleRingInner.rotation.z = elapsed * 0.85;
      this.eagleLight.intensity = 2.0 + Math.sin(elapsed * 4.5) * 0.35;
    }

    const pos = this.emberPoints.geometry.attributes.position as THREE.BufferAttribute;
    for (let i = 0; i < this.emberSpeeds.length; i++) {
      let y = this.emberPositions[i * 3 + 1] + this.emberSpeeds[i] * dt;
      const x = this.emberPositions[i * 3] + Math.sin(elapsed * 0.7 + i) * 0.14 * dt;
      if (y > 15.0) y = 0.2;
      this.emberPositions[i * 3] = x;
      this.emberPositions[i * 3 + 1] = y;
    }
    pos.needsUpdate = true;
  }
}
