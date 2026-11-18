import * as THREE from 'three';
import { CameraPreset } from '../types';

export class CameraRig {
  public readonly camera: THREE.PerspectiveCamera;
  public preset: CameraPreset = 'diorama';
  public autoTurntable = true;

  private theta = 0; // Horizontal azimuth
  private phi = 0.72; // Polar angle from Y+ (0.28 overhead .. 1.36 street-level)
  private distance = 31.5;

  private targetTheta = 0;
  private targetPhi = 0.72;
  private targetDistance = 31.5;

  private focus = new THREE.Vector3(0, 0, 1.2);
  private targetFocus = new THREE.Vector3(0, 0, 1.2);
  private pointerOffset = new THREE.Vector2(0, 0);

  private isDraggingOrbit = false;
  private isDraggingPan = false;
  private lastMouseX = 0;
  private lastMouseY = 0;

  private trauma = 0;
  private shakeClock = 0;
  private recoilKick = new THREE.Vector3();

  constructor(aspect: number) {
    this.camera = new THREE.PerspectiveCamera(42, aspect, 0.4, 180);
    this.updateCameraTransform(0.016);
  }

  public resize(aspect: number): void {
    this.camera.aspect = aspect;
    this.camera.updateProjectionMatrix();
  }

  public setPreset(preset: CameraPreset): void {
    this.preset = preset;
    this.autoTurntable = false;
    if (preset === 'diorama') {
      this.targetTheta = 0;
      this.targetPhi = 0.68;
      this.targetDistance = 30.5;
      this.targetFocus.set(0, 0, 1.0);
    } else if (preset === 'chase') {
      this.targetPhi = 1.14;
      this.targetDistance = 13.5;
    } else if (preset === 'orbit') {
      this.targetPhi = 0.84;
      this.targetDistance = 28.0;
    }
  }

  public setHeroPresentation(): void {
    this.preset = 'orbit';
    this.autoTurntable = true;
    this.targetPhi = 0.82;
    this.targetDistance = 30.0;
    this.targetFocus.set(0, 0.2, 0.5);
  }

  public addTrauma(amount: number): void {
    this.trauma = Math.min(1.0, this.trauma + amount);
  }

  public addDirectionalKick(dirX: number, dirZ: number, strength: number): void {
    this.recoilKick.x -= dirX * strength;
    this.recoilKick.z -= dirZ * strength;
    this.addTrauma(strength * 0.45);
  }

  public get shakeIntensity(): number {
    return this.trauma * this.trauma;
  }

  public attachDomEvents(
    dom: HTMLElement,
    canLeftOrbit: () => boolean,
    canTouchOrbit: () => boolean = canLeftOrbit,
  ): void {
    dom.addEventListener('contextmenu', (e) => e.preventDefault());

    dom.addEventListener('pointerdown', (e) => {
      const wantOrbit =
        e.button === 2 ||
        (e.button === 0 && e.altKey) ||
        (e.button === 0 && (e.pointerType === 'touch' ? canTouchOrbit() : canLeftOrbit()));
      const wantPan = e.button === 1 || (e.button === 2 && e.shiftKey);

      if (wantPan) {
        this.isDraggingPan = true;
        this.autoTurntable = false;
        this.lastMouseX = e.clientX;
        this.lastMouseY = e.clientY;
        document.body.classList.add('is-orbiting');
      } else if (wantOrbit) {
        this.isDraggingOrbit = true;
        this.autoTurntable = false;
        this.lastMouseX = e.clientX;
        this.lastMouseY = e.clientY;
        document.body.classList.add('is-orbiting');
      }
    });

    window.addEventListener('pointermove', (e) => {
      this.pointerOffset.set(
        (e.clientX / Math.max(1, window.innerWidth)) * 2 - 1,
        (e.clientY / Math.max(1, window.innerHeight)) * 2 - 1,
      );

      if (!this.isDraggingOrbit && !this.isDraggingPan) return;
      const dx = e.clientX - this.lastMouseX;
      const dy = e.clientY - this.lastMouseY;
      this.lastMouseX = e.clientX;
      this.lastMouseY = e.clientY;

      if (this.isDraggingOrbit) {
        this.targetTheta -= dx * 0.0068;
        this.targetPhi = Math.max(0.24, Math.min(1.38, this.targetPhi - dy * 0.0058));
      } else if (this.isDraggingPan) {
        const panScale = this.targetDistance * 0.0014;
        const cosT = Math.cos(this.theta);
        const sinT = Math.sin(this.theta);
        this.targetFocus.x -= (dx * cosT + dy * sinT) * panScale;
        this.targetFocus.z -= (-dx * sinT + dy * cosT) * panScale;
        this.targetFocus.x = Math.max(-12, Math.min(12, this.targetFocus.x));
        this.targetFocus.z = Math.max(-12, Math.min(12, this.targetFocus.z));
      }
    });

    const stopDrag = () => {
      this.isDraggingOrbit = false;
      this.isDraggingPan = false;
      document.body.classList.remove('is-orbiting');
    };
    window.addEventListener('pointerup', stopDrag);
    window.addEventListener('pointercancel', stopDrag);

    dom.addEventListener('dblclick', (e) => {
      if (e.button === 2 || canLeftOrbit()) {
        this.setPreset(this.preset);
      }
    });

    dom.addEventListener(
      'wheel',
      (e) => {
        e.preventDefault();
        const zoomStep = e.deltaY * 0.018;
        this.targetDistance = Math.max(9.5, Math.min(46.0, this.targetDistance + zoomStep));
      },
      { passive: false },
    );
  }

  public update(
    dt: number,
    playerPos?: THREE.Vector3 | null,
    playerTurretAngle?: number,
  ): void {
    if (this.autoTurntable && !this.isDraggingOrbit) {
      this.targetTheta += dt * 0.13;
    }

    if (playerPos) {
      if (this.preset === 'chase') {
        if (!this.isDraggingOrbit && playerTurretAngle !== undefined) {
          // Smoothly align behind turret angle unless user is manually dragging orbit
          const desired = playerTurretAngle + Math.PI;
          let diff = desired - this.targetTheta;
          diff = Math.atan2(Math.sin(diff), Math.cos(diff));
          this.targetTheta += diff * Math.min(1, dt * 3.8);
        }
        this.targetFocus.set(playerPos.x, 0.85, playerPos.z);
      } else if (this.preset === 'diorama' && !this.isDraggingPan) {
        this.targetFocus.set(
          playerPos.x * 0.24 + this.pointerOffset.x * 1.15,
          0.15,
          playerPos.z * 0.24 + 0.8 + this.pointerOffset.y * 0.95,
        );
      }
    }

    this.updateCameraTransform(dt);
  }

  private updateCameraTransform(dt: number): void {
    const smooth = 1 - Math.exp(-dt * 9.5);
    this.theta += (this.targetTheta - this.theta) * smooth;
    this.phi += (this.targetPhi - this.phi) * smooth;
    this.distance += (this.targetDistance - this.distance) * smooth;
    this.focus.lerp(this.targetFocus, smooth);

    this.recoilKick.multiplyScalar(Math.exp(-dt * 14));
    this.trauma = Math.max(0, this.trauma - dt * 1.55);
    this.shakeClock += dt * 38;

    const shake = this.trauma * this.trauma;
    const shakeX = Math.sin(this.shakeClock * 1.7) * shake * 0.42;
    const shakeY = Math.cos(this.shakeClock * 2.3) * shake * 0.34;
    const shakeZ = Math.sin(this.shakeClock * 1.9 + 1.1) * shake * 0.42;

    const sinPhi = Math.sin(this.phi);
    const cosPhi = Math.cos(this.phi);
    const sinTheta = Math.sin(this.theta);
    const cosTheta = Math.cos(this.theta);

    const cx = this.focus.x + this.distance * sinPhi * sinTheta + shakeX + this.recoilKick.x;
    const cy = this.focus.y + this.distance * cosPhi + shakeY;
    const cz = this.focus.z + this.distance * sinPhi * cosTheta + shakeZ + this.recoilKick.z;

    this.camera.position.set(cx, cy, cz);
    this.camera.lookAt(
      this.focus.x + shakeX * 0.35,
      this.focus.y + shakeY * 0.35,
      this.focus.z + shakeZ * 0.35,
    );
  }
}
