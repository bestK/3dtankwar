import * as THREE from 'three';
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js';
import { OutputPass } from 'three/examples/jsm/postprocessing/OutputPass.js';
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass.js';
import { ShaderPass } from 'three/examples/jsm/postprocessing/ShaderPass.js';
import { UnrealBloomPass } from 'three/examples/jsm/postprocessing/UnrealBloomPass.js';
import { QualityTier } from '../types';

/**
 * Profiles GPU model, CPU concurrency, memory, pointer type, and effective screen pixels
 * to match the ideal starting graphics quality tier for the current computer/device.
 */
export function detectHardwareQualityTier(renderer: THREE.WebGLRenderer): QualityTier {
  const isCoarse = window.matchMedia('(pointer: coarse)').matches;
  const cores = navigator.hardwareConcurrency || 4;
  const memoryGb = (navigator as Navigator & { deviceMemory?: number }).deviceMemory ?? 8;
  const gl = renderer.getContext();

  let gpuRenderer = '';
  try {
    const dbg = gl.getExtension('WEBGL_debug_renderer_info');
    gpuRenderer = dbg
      ? String(gl.getParameter(dbg.UNMASKED_RENDERER_WEBGL) || '')
      : String(gl.getParameter(gl.RENDERER) || '');
  } catch {
    gpuRenderer = '';
  }
  const gpu = gpuRenderer.toLowerCase();
  const maxTex = Number(gl.getParameter(gl.MAX_TEXTURE_SIZE) || 4096);

  if (
    maxTex < 8192 ||
    memoryGb <= 2 ||
    cores <= 2 ||
    /swiftshader|llvmpipe|software|basic render|microsoft basic|gdi generic/.test(gpu) ||
    /hd graphics [2345]\d\d|uhd graphics 60\d|mali-4|mali-t|adreno \(tm\) [345]\d\d|powervr/.test(gpu)
  ) {
    return 'low';
  }

  if (isCoarse || memoryGb <= 4 || cores <= 4) {
    return 'medium';
  }

  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  const effectivePixels = window.innerWidth * window.innerHeight * dpr * dpr;

  if (
    /rtx |gtx 16|gtx 10[678]|gtx 20|radeon rx [56789]|radeon pro|arc a[57]|apple m[1-9]/.test(gpu) ||
    (/apple gpu/.test(gpu) && /mac/i.test(navigator.userAgent) && cores >= 8)
  ) {
    return effectivePixels > 9_500_000 && !/max|ultra|rtx [345]\d[789]0/.test(gpu) ? 'medium' : 'high';
  }

  if (/intel.*(iris|uhd|hd graphics)|radeon\(tm\) graphics|vega/.test(gpu)) {
    return 'medium';
  }

  if (cores >= 8 && memoryGb >= 8 && effectivePixels <= 6_000_000) {
    return 'high';
  }
  return 'medium';
}

const CinematicDioramaShader = {
  uniforms: {
    tDiffuse: { value: null },
    uTime: { value: 0 },
    uShock: { value: 0 },
  },
  vertexShader: /* glsl */ `
    varying vec2 vUv;
    void main() {
      vUv = uv;
      gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
    }
  `,
  fragmentShader: /* glsl */ `
    uniform sampler2D tDiffuse;
    uniform float uTime;
    uniform float uShock;
    varying vec2 vUv;

    void main() {
      vec2 center = vUv - 0.5;
      float dist = length(center);

      vec3 col;
      // Fast 1-tap path during steady play; 3-tap radial chromatic shock only on impacts
      if (uShock > 0.015) {
        vec2 caOffset = center * (uShock * 0.014) * dist;
        col.r = texture2D(tDiffuse, vUv + caOffset).r;
        col.g = texture2D(tDiffuse, vUv).g;
        col.b = texture2D(tDiffuse, vUv - caOffset).b;
      } else {
        col = texture2D(tDiffuse, vUv).rgb;
      }

      // Crisp warm-vs-slate contrast curve
      col = mix(col, smoothstep(0.0, 1.0, col), 0.06);

      // Subtle filmic micro-dither to prevent dark fog banding
      float grain = fract(sin(dot(vUv * (uTime * 0.07 + 1.0), vec2(12.9898, 78.233))) * 43758.5453);
      col += (grain - 0.5) * 0.009;

      // Clean theatrical vignette
      float vig = smoothstep(0.94, 0.3, dist);
      col *= mix(0.72, 1.03, vig);

      gl_FragColor = vec4(max(col, vec3(0.0)), 1.0);
    }
  `,
};

export class PostPipeline {
  public readonly composer: EffectComposer;
  public readonly bloomPass: UnrealBloomPass;
  private lensPass: ShaderPass;
  private quality: QualityTier = 'high';
  private width: number;
  private height: number;

  constructor(
    private renderer: THREE.WebGLRenderer,
    private scene: THREE.Scene,
    private camera: THREE.Camera,
    width: number,
    height: number,
  ) {
    this.width = width;
    this.height = height;

    const isCoarse = window.matchMedia('(pointer: coarse)').matches;
    const rt = new THREE.WebGLRenderTarget(width, height, {
      type: THREE.HalfFloatType,
      samples: isCoarse ? 0 : 2,
    });

    this.composer = new EffectComposer(renderer, rt);
    this.composer.addPass(new RenderPass(scene, camera));

    this.bloomPass = new UnrealBloomPass(
      new THREE.Vector2(Math.max(1, Math.floor(width * 0.5)), Math.max(1, Math.floor(height * 0.5))),
      0.48,
      0.38,
      0.9,
    );
    this.composer.addPass(this.bloomPass);

    this.lensPass = new ShaderPass(CinematicDioramaShader);
    this.composer.addPass(this.lensPass);

    this.composer.addPass(new OutputPass());
  }

  public setQuality(tier: QualityTier): void {
    this.quality = tier;
    this.bloomPass.enabled = tier !== 'low';
    this.lensPass.enabled = tier === 'high';
    this.resize(this.width, this.height);
  }

  public resize(width: number, height: number): void {
    this.width = Math.max(1, width);
    this.height = Math.max(1, height);
    if (this.quality === 'low') return;
    this.composer.setSize(this.width, this.height);
    const bloomScale = this.quality === 'high' ? 0.5 : 0.35;
    this.bloomPass.setSize(
      Math.max(1, Math.floor(this.width * bloomScale)),
      Math.max(1, Math.floor(this.height * bloomScale)),
    );
  }

  public render(elapsed: number, shock: number, _tiltAmount: number): void {
    if (this.quality === 'low') {
      this.renderer.render(this.scene, this.camera);
      return;
    }
    this.lensPass.uniforms.uTime.value = elapsed;
    this.lensPass.uniforms.uShock.value = shock;
    this.composer.render();
  }
}
