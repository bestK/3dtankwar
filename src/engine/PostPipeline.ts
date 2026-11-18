import * as THREE from 'three';
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js';
import { OutputPass } from 'three/examples/jsm/postprocessing/OutputPass.js';
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass.js';
import { ShaderPass } from 'three/examples/jsm/postprocessing/ShaderPass.js';
import { UnrealBloomPass } from 'three/examples/jsm/postprocessing/UnrealBloomPass.js';

const CinematicDioramaShader = {
  uniforms: {
    tDiffuse: { value: null },
    uTime: { value: 0 },
    uShock: { value: 0 },
    uTiltAmount: { value: 0.35 },
    uTexel: { value: new THREE.Vector2(1 / 1920, 1 / 1080) },
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
    uniform float uTiltAmount;
    uniform vec2 uTexel;
    varying vec2 vUv;

    void main() {
      vec2 center = vUv - 0.5;
      float dist = length(center);

      // Subtle tilt-shift blur at far top/bottom edges for miniature war-table feel
      float edgeFocus = smoothstep(0.28, 0.52, abs(vUv.y - 0.52)) * uTiltAmount;
      vec2 blurStep = vec2(0.0, uTexel.y * 2.4 * edgeFocus);

      // Dynamic shockwave radial chromatic offset
      vec2 caOffset = center * (0.0018 + uShock * 0.014) * dist;

      vec3 col = texture2D(tDiffuse, vUv).rgb * 0.5;
      col.r += texture2D(tDiffuse, vUv + caOffset + blurStep).r * 0.25;
      col.r += texture2D(tDiffuse, vUv + caOffset - blurStep).r * 0.25;
      col.g += texture2D(tDiffuse, vUv + blurStep).g * 0.25;
      col.g += texture2D(tDiffuse, vUv - blurStep).g * 0.25;
      col.b += texture2D(tDiffuse, vUv - caOffset + blurStep).b * 0.25;
      col.b += texture2D(tDiffuse, vUv - caOffset - blurStep).b * 0.25;

      // Subtle micro-grain
      float grain = fract(sin(dot(vUv * (uTime * 0.13 + 1.0), vec2(12.9898, 78.233))) * 43758.5453);
      col += (grain - 0.5) * 0.014;

      // Clean theatrical vignette
      float vig = smoothstep(0.92, 0.32, dist);
      col *= mix(0.68, 1.03, vig);

      gl_FragColor = vec4(max(col, vec3(0.0)), 1.0);
    }
  `,
};

export class PostPipeline {
  public readonly composer: EffectComposer;
  public readonly bloomPass: UnrealBloomPass;
  private lensPass: ShaderPass;

  constructor(
    renderer: THREE.WebGLRenderer,
    scene: THREE.Scene,
    camera: THREE.Camera,
    width: number,
    height: number,
  ) {
    const rt = new THREE.WebGLRenderTarget(width, height, {
      type: THREE.HalfFloatType,
      samples: 4,
    });

    this.composer = new EffectComposer(renderer, rt);
    this.composer.addPass(new RenderPass(scene, camera));

    this.bloomPass = new UnrealBloomPass(new THREE.Vector2(width, height), 0.56, 0.42, 0.88);
    this.composer.addPass(this.bloomPass);

    this.lensPass = new ShaderPass(CinematicDioramaShader);
    this.lensPass.uniforms.uTexel.value.set(1 / Math.max(1, width), 1 / Math.max(1, height));
    this.composer.addPass(this.lensPass);

    this.composer.addPass(new OutputPass());
  }

  public resize(width: number, height: number): void {
    this.composer.setSize(width, height);
    this.bloomPass.setSize(width, height);
    this.lensPass.uniforms.uTexel.value.set(1 / Math.max(1, width), 1 / Math.max(1, height));
  }

  public render(elapsed: number, shock: number, tiltAmount: number): void {
    this.lensPass.uniforms.uTime.value = elapsed;
    this.lensPass.uniforms.uShock.value = shock;
    this.lensPass.uniforms.uTiltAmount.value = tiltAmount;
    this.composer.render();
  }
}
