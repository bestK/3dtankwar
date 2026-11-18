import * as THREE from 'three';

export interface TextureBundle {
  envMap: THREE.Texture;
  brickMap: THREE.CanvasTexture;
  brickNormal: THREE.CanvasTexture;
  brickRoughness: THREE.CanvasTexture;
  steelMap: THREE.CanvasTexture;
  steelNormal: THREE.CanvasTexture;
  steelRoughness: THREE.CanvasTexture;
  floorMap: THREE.CanvasTexture;
  floorNormal: THREE.CanvasTexture;
  floorRoughness: THREE.CanvasTexture;
  iceNormal: THREE.CanvasTexture;
  armorNormal: THREE.CanvasTexture;
  treadMap: THREE.CanvasTexture;
  scorchTex: THREE.CanvasTexture;
  trackDecalTex: THREE.CanvasTexture;
  softGlowTex: THREE.CanvasTexture;
}

function hash2D(x: number, y: number, seed = 1337): number {
  let n = Math.imul(x, 374761393) + Math.imul(y, 668265263) + Math.imul(seed, 1442695041);
  n = (n ^ (n >>> 13)) * 1274126177;
  return ((n ^ (n >>> 16)) >>> 0) / 4294967295;
}

function valueNoise(x: number, y: number, scale: number, seed = 42): number {
  const sx = x / scale;
  const sy = y / scale;
  const x0 = Math.floor(sx);
  const y0 = Math.floor(sy);
  const fx = sx - x0;
  const fy = sy - y0;
  const ux = fx * fx * (3 - 2 * fx);
  const uy = fy * fy * (3 - 2 * fy);
  const n00 = hash2D(x0, y0, seed);
  const n10 = hash2D(x0 + 1, y0, seed);
  const n01 = hash2D(x0, y0 + 1, seed);
  const n11 = hash2D(x0 + 1, y0 + 1, seed);
  const nx0 = n00 + (n10 - n00) * ux;
  const nx1 = n01 + (n11 - n01) * ux;
  return nx0 + (nx1 - nx0) * uy;
}

function fbm(x: number, y: number, baseScale: number, seed = 42): number {
  let v = 0;
  let amp = 0.5;
  let s = baseScale;
  for (let i = 0; i < 4; i++) {
    v += amp * valueNoise(x, y, Math.max(1, s), seed + i * 97);
    s *= 0.5;
    amp *= 0.5;
  }
  return v;
}

function heightToNormalCanvas(height: Float32Array, size: number, strength: number): HTMLCanvasElement {
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d')!;
  const img = ctx.createImageData(size, size);
  const d = img.data;

  const sample = (x: number, y: number) => {
    const wx = ((x % size) + size) % size;
    const wy = ((y % size) + size) % size;
    return height[wy * size + wx];
  };

  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const tl = sample(x - 1, y - 1);
      const t = sample(x, y - 1);
      const tr = sample(x + 1, y - 1);
      const l = sample(x - 1, y);
      const r = sample(x + 1, y);
      const bl = sample(x - 1, y + 1);
      const b = sample(x, y + 1);
      const br = sample(x + 1, y + 1);

      const dx = (tr + 2 * r + br - (tl + 2 * l + bl)) * strength;
      const dy = (bl + 2 * b + br - (tl + 2 * t + tr)) * strength;
      const dz = 1.0;
      const inv = 1 / Math.hypot(dx, dy, dz);

      const idx = (y * size + x) * 4;
      d[idx] = Math.round((-dx * inv * 0.5 + 0.5) * 255);
      d[idx + 1] = Math.round((-dy * inv * 0.5 + 0.5) * 255);
      d[idx + 2] = Math.round((dz * inv * 0.5 + 0.5) * 255);
      d[idx + 3] = 255;
    }
  }
  ctx.putImageData(img, 0, 0);
  return canvas;
}

function makeTex(
  canvas: HTMLCanvasElement,
  srgb = false,
  repeatX = 1,
  repeatY = 1,
): THREE.CanvasTexture {
  const tex = new THREE.CanvasTexture(canvas);
  tex.wrapS = THREE.RepeatWrapping;
  tex.wrapT = THREE.RepeatWrapping;
  tex.repeat.set(repeatX, repeatY);
  tex.anisotropy = 8;
  if (srgb) tex.colorSpace = THREE.SRGBColorSpace;
  tex.needsUpdate = true;
  return tex;
}

function createStudioEnvironment(renderer: THREE.WebGLRenderer): THREE.Texture {
  const pmrem = new THREE.PMREMGenerator(renderer);
  pmrem.compileEquirectangularShader();

  const envScene = new THREE.Scene();
  envScene.background = new THREE.Color(0x0c1118);

  // Overhead warm tungsten softbox
  const keyPanel = new THREE.Mesh(
    new THREE.PlaneGeometry(28, 28),
    new THREE.MeshBasicMaterial({ color: new THREE.Color(3.6, 2.8, 1.9), side: THREE.DoubleSide }),
  );
  keyPanel.position.set(10, 22, 8);
  keyPanel.lookAt(0, 0, 0);
  envScene.add(keyPanel);

  // Cool steel-blue opposing rim softbox
  const rimPanel = new THREE.Mesh(
    new THREE.PlaneGeometry(24, 16),
    new THREE.MeshBasicMaterial({ color: new THREE.Color(0.85, 1.45, 2.5), side: THREE.DoubleSide }),
  );
  rimPanel.position.set(-18, 12, -14);
  rimPanel.lookAt(0, 0, 0);
  envScene.add(rimPanel);

  // Warm forge horizon strip
  const forgeStrip = new THREE.Mesh(
    new THREE.CylinderGeometry(32, 32, 3.2, 32, 1, true),
    new THREE.MeshBasicMaterial({ color: new THREE.Color(0.95, 0.55, 0.25), side: THREE.BackSide }),
  );
  forgeStrip.position.y = 2;
  envScene.add(forgeStrip);

  // Subtle floor bounce
  const bounce = new THREE.Mesh(
    new THREE.CircleGeometry(30, 24),
    new THREE.MeshBasicMaterial({ color: new THREE.Color(0.18, 0.2, 0.24), side: THREE.DoubleSide }),
  );
  bounce.rotation.x = -Math.PI / 2;
  bounce.position.y = -12;
  envScene.add(bounce);

  const rt = pmrem.fromScene(envScene, 0.035);
  pmrem.dispose();
  return rt.texture;
}

export function createProceduralTextures(renderer: THREE.WebGLRenderer): TextureBundle {
  const envMap = createStudioEnvironment(renderer);

  // 1. Kiln-fired Brick Grain & Mortar
  const bSize = 256;
  const bDiff = document.createElement('canvas');
  bDiff.width = bSize;
  bDiff.height = bSize;
  const bCtx = bDiff.getContext('2d')!;
  const bImg = bCtx.createImageData(bSize, bSize);
  const bRoughCanvas = document.createElement('canvas');
  bRoughCanvas.width = bSize;
  bRoughCanvas.height = bSize;
  const bRCtx = bRoughCanvas.getContext('2d')!;
  const bRImg = bRCtx.createImageData(bSize, bSize);
  const bHeight = new Float32Array(bSize * bSize);

  for (let y = 0; y < bSize; y++) {
    for (let x = 0; x < bSize; x++) {
      const n1 = fbm(x, y, 28, 11);
      const n2 = valueNoise(x, y, 5, 77);
      const pit = valueNoise(x, y, 2.5, 191) > 0.78 ? -0.22 : 0;
      const edgeDist = Math.min(x, y, bSize - 1 - x, bSize - 1 - y) / 14;
      const bevel = Math.min(1, edgeDist);

      const h = bevel * 0.7 + n1 * 0.22 + n2 * 0.08 + pit;
      bHeight[y * bSize + x] = h;

      const idx = (y * bSize + x) * 4;
      const shade = 0.8 + n1 * 0.28 + pit * 0.35;
      bImg.data[idx] = Math.min(255, Math.round(212 * shade));
      bImg.data[idx + 1] = Math.min(255, Math.round(108 * shade));
      bImg.data[idx + 2] = Math.min(255, Math.round(76 * shade));
      bImg.data[idx + 3] = 255;

      const rVal = Math.round((0.76 + (1 - bevel) * 0.16 - n2 * 0.1) * 255);
      bRImg.data[idx] = rVal;
      bRImg.data[idx + 1] = rVal;
      bRImg.data[idx + 2] = rVal;
      bRImg.data[idx + 3] = 255;
    }
  }
  bCtx.putImageData(bImg, 0, 0);
  bRCtx.putImageData(bRImg, 0, 0);
  const brickNormalCanvas = heightToNormalCanvas(bHeight, bSize, 2.4);

  // 2. Riveted Rolled Armor Steel
  const sSize = 256;
  const sDiff = document.createElement('canvas');
  sDiff.width = sSize;
  sDiff.height = sSize;
  const sCtx = sDiff.getContext('2d')!;
  const sImg = sCtx.createImageData(sSize, sSize);
  const sRough = document.createElement('canvas');
  sRough.width = sSize;
  sRough.height = sSize;
  const sRCtx = sRough.getContext('2d')!;
  const sRImg = sRCtx.createImageData(sSize, sSize);
  const sHeight = new Float32Array(sSize * sSize);

  const rivets = [
    [28, 28],
    [228, 28],
    [28, 228],
    [228, 228],
    [128, 28],
    [128, 228],
    [28, 128],
    [228, 128],
  ];

  for (let y = 0; y < sSize; y++) {
    for (let x = 0; x < sSize; x++) {
      const brush = valueNoise(x * 0.25, y * 3.5, 8, 303) * 0.12 + fbm(x, y, 36, 509) * 0.14;
      const border = Math.min(x, y, sSize - 1 - x, sSize - 1 - y);
      let h = border < 10 ? border / 10 : 1.0;

      // Inner recessed cross panel seam
      if (Math.abs(x - 128) < 3 || Math.abs(y - 128) < 3) {
        h -= 0.22;
      }

      // Raised rivets
      let rivetBoost = 0;
      for (const [rx, ry] of rivets) {
        const d = Math.hypot(x - rx, y - ry);
        if (d < 8) {
          rivetBoost = Math.cos((d / 8) * (Math.PI * 0.5)) * 0.45;
          break;
        }
      }

      h = h * 0.65 + brush + rivetBoost;
      sHeight[y * sSize + x] = h;

      const idx = (y * sSize + x) * 4;
      const lum = 152 + brush * 85 + rivetBoost * 45 - (border < 8 ? 28 : 0);
      sImg.data[idx] = Math.min(255, Math.max(0, Math.round(lum * 0.93)));
      sImg.data[idx + 1] = Math.min(255, Math.max(0, Math.round(lum * 0.98)));
      sImg.data[idx + 2] = Math.min(255, Math.max(0, Math.round(lum * 1.06)));
      sImg.data[idx + 3] = 255;

      const rough = Math.min(255, Math.max(35, Math.round((0.32 + brush * 0.5 - rivetBoost * 0.2) * 255)));
      sRImg.data[idx] = rough;
      sRImg.data[idx + 1] = rough;
      sRImg.data[idx + 2] = rough;
      sRImg.data[idx + 3] = 255;
    }
  }
  sCtx.putImageData(sImg, 0, 0);
  sRCtx.putImageData(sRImg, 0, 0);
  const steelNormalCanvas = heightToNormalCanvas(sHeight, sSize, 2.8);

  // 3. Basalt War-Table Tactical Floor (tiles every 2x2 macro cell)
  const fSize = 512;
  const fDiff = document.createElement('canvas');
  fDiff.width = fSize;
  fDiff.height = fSize;
  const fCtx = fDiff.getContext('2d')!;
  const fImg = fCtx.createImageData(fSize, fSize);
  const fRough = document.createElement('canvas');
  fRough.width = fSize;
  fRough.height = fSize;
  const fRCtx = fRough.getContext('2d')!;
  const fRImg = fRCtx.createImageData(fSize, fSize);
  const fHeight = new Float32Array(fSize * fSize);

  for (let y = 0; y < fSize; y++) {
    for (let x = 0; x < fSize; x++) {
      const slate = fbm(x, y, 48, 811);
      const micro = valueNoise(x, y, 6, 919);
      const macroGroove = x < 4 || y < 4 || x > fSize - 5 || y > fSize - 5 ? -0.28 : 0;
      const subGroove = Math.abs(x - 256) < 2 || Math.abs(y - 256) < 2 ? -0.12 : 0;

      const h = 0.6 + slate * 0.26 + micro * 0.08 + macroGroove + subGroove;
      fHeight[y * fSize + x] = h;

      const idx = (y * fSize + x) * 4;
      const base = 36 + slate * 20 + micro * 7 + (macroGroove < 0 ? -8 : 0);
      // Subtle brass hairline on macro tile border
      const isBrassTick =
        (x === 5 || y === 5) && ((x > 20 && x < 52) || (y > 20 && y < 52));
      if (isBrassTick) {
        fImg.data[idx] = 122;
        fImg.data[idx + 1] = 96;
        fImg.data[idx + 2] = 52;
      } else {
        fImg.data[idx] = Math.round(base * 0.92);
        fImg.data[idx + 1] = Math.round(base * 1.02);
        fImg.data[idx + 2] = Math.round(base * 1.18);
      }
      fImg.data[idx + 3] = 255;

      const r = Math.round((0.58 + slate * 0.24 - (macroGroove < 0 ? 0.1 : 0)) * 255);
      fRImg.data[idx] = r;
      fRImg.data[idx + 1] = r;
      fRImg.data[idx + 2] = r;
      fRImg.data[idx + 3] = 255;
    }
  }
  fCtx.putImageData(fImg, 0, 0);
  fRCtx.putImageData(fRImg, 0, 0);
  const floorNormalCanvas = heightToNormalCanvas(fHeight, fSize, 2.0);

  // 4. Scratched Glacial Ice Normal
  const iSize = 256;
  const iHeight = new Float32Array(iSize * iSize);
  for (let y = 0; y < iSize; y++) {
    for (let x = 0; x < iSize; x++) {
      const diag1 = valueNoise(x + y * 0.6, y * 0.2, 6, 1201);
      const diag2 = valueNoise(x * 0.3, y - x * 0.5, 9, 1301);
      iHeight[y * iSize + x] = fbm(x, y, 32, 1409) * 0.5 + diag1 * 0.25 + diag2 * 0.25;
    }
  }
  const iceNormalCanvas = heightToNormalCanvas(iHeight, iSize, 1.4);

  // 5. Cast Armor Micro-Grain Normal
  const aSize = 128;
  const aHeight = new Float32Array(aSize * aSize);
  for (let y = 0; y < aSize; y++) {
    for (let x = 0; x < aSize; x++) {
      aHeight[y * aSize + x] = fbm(x, y, 14, 1607) * 0.6 + valueNoise(x, y, 3, 1709) * 0.4;
    }
  }
  const armorNormalCanvas = heightToNormalCanvas(aHeight, aSize, 0.9);

  // 6. Tank Track Tread Ribbing Texture
  const tCanvas = document.createElement('canvas');
  tCanvas.width = 64;
  tCanvas.height = 256;
  const tCtx = tCanvas.getContext('2d')!;
  tCtx.fillStyle = '#1b1f24';
  tCtx.fillRect(0, 0, 64, 256);
  for (let y = 0; y < 256; y += 16) {
    tCtx.fillStyle = '#363e48';
    tCtx.fillRect(3, y + 2, 58, 9);
    tCtx.fillStyle = '#4c5663';
    tCtx.fillRect(6, y + 3, 22, 4);
    tCtx.fillRect(36, y + 3, 22, 4);
  }

  // 7. Scorch Crater Decal Sprite
  const scCanvas = document.createElement('canvas');
  scCanvas.width = 128;
  scCanvas.height = 128;
  const scCtx = scCanvas.getContext('2d')!;
  const scGrad = scCtx.createRadialGradient(64, 64, 4, 64, 64, 60);
  scGrad.addColorStop(0, 'rgba(10, 8, 7, 0.92)');
  scGrad.addColorStop(0.38, 'rgba(24, 18, 15, 0.72)');
  scGrad.addColorStop(0.72, 'rgba(38, 30, 24, 0.25)');
  scGrad.addColorStop(1, 'rgba(0, 0, 0, 0)');
  scCtx.fillStyle = scGrad;
  scCtx.fillRect(0, 0, 128, 128);

  // 8. Tread Track Mark Decal
  const trCanvas = document.createElement('canvas');
  trCanvas.width = 64;
  trCanvas.height = 64;
  const trCtx = trCanvas.getContext('2d')!;
  trCtx.fillStyle = 'rgba(12, 14, 18, 0.42)';
  trCtx.fillRect(6, 8, 14, 48);
  trCtx.fillRect(44, 8, 14, 48);

  // 9. Soft Volumetric Glow Sprite
  const glCanvas = document.createElement('canvas');
  glCanvas.width = 128;
  glCanvas.height = 128;
  const glCtx = glCanvas.getContext('2d')!;
  const glGrad = glCtx.createRadialGradient(64, 64, 0, 64, 64, 64);
  glGrad.addColorStop(0, 'rgba(255, 255, 255, 1)');
  glGrad.addColorStop(0.28, 'rgba(255, 220, 160, 0.65)');
  glGrad.addColorStop(0.65, 'rgba(255, 160, 70, 0.18)');
  glGrad.addColorStop(1, 'rgba(255, 120, 30, 0)');
  glCtx.fillStyle = glGrad;
  glCtx.fillRect(0, 0, 128, 128);

  const scorchTex = new THREE.CanvasTexture(scCanvas);
  scorchTex.colorSpace = THREE.SRGBColorSpace;
  const trackDecalTex = new THREE.CanvasTexture(trCanvas);
  const softGlowTex = new THREE.CanvasTexture(glCanvas);
  softGlowTex.colorSpace = THREE.SRGBColorSpace;

  return {
    envMap,
    brickMap: makeTex(bDiff, true, 1, 1),
    brickNormal: makeTex(brickNormalCanvas, false, 1, 1),
    brickRoughness: makeTex(bRoughCanvas, false, 1, 1),
    steelMap: makeTex(sDiff, true, 1, 1),
    steelNormal: makeTex(steelNormalCanvas, false, 1, 1),
    steelRoughness: makeTex(sRough, false, 1, 1),
    floorMap: makeTex(fDiff, true, 13, 13),
    floorNormal: makeTex(floorNormalCanvas, false, 13, 13),
    floorRoughness: makeTex(fRough, false, 13, 13),
    iceNormal: makeTex(iceNormalCanvas, false, 6, 6),
    armorNormal: makeTex(armorNormalCanvas, false, 2, 2),
    treadMap: makeTex(tCanvas, true, 1, 4),
    scorchTex,
    trackDecalTex,
    softGlowTex,
  };
}
