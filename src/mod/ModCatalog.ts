import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import astonUrl from './aston_martin.glb?url';
import carUrl from './car.glb?url';
import forkliftUrl from './forklift.glb?url';
import handTruckUrl from './hand_truck.glb?url';
import lamborghiniUrl from './lamborghini.glb?url';
import policeUrl from './police-car.glb?url';
import tankUrl from './tank.glb?url';
import tricycleUrl from './tricycle.glb?url';

export interface VehicleMod {
  id: string;
  label: string;
  url: string;
  yaw?: number;
}

export const VEHICLE_MODS: VehicleMod[] = [
  { id: 'default', label: '默认坦克', url: '' },
  { id: 'tank', label: '装甲车 IFV', url: tankUrl },
  { id: 'car', label: '轿车', url: carUrl },
  { id: 'aston', label: '阿斯顿马丁', url: astonUrl },
  { id: 'lambo', label: '兰博基尼', url: lamborghiniUrl },
  { id: 'police', label: '警车', url: policeUrl },
  { id: 'forklift', label: '叉车', url: forkliftUrl },
  { id: 'tricycle', label: '三轮车', url: tricycleUrl },
  { id: 'handtruck', label: '手推车', url: handTruckUrl },
];

const MOD_BY_ID = new Map(VEHICLE_MODS.map((mod) => [mod.id, mod]));

/** Selection strings are `id` or `id:flip` for a 180° facing correction. */
export function parseMod(selection: string): { mod: VehicleMod | null; flip: boolean } {
  const [rawId, flag] = (selection || '').split(':');
  const mod = MOD_BY_ID.get(rawId);
  if (!mod || mod.id === 'default') return { mod: null, flip: false };
  return { mod, flip: flag === 'flip' };
}

export function isValidModSelection(selection: string): boolean {
  return Boolean(MOD_BY_ID.get((selection || '').split(':')[0]));
}

const modelCache = new Map<string, Promise<THREE.Object3D | null>>();

export function loadVehicleMod(selection: string): Promise<THREE.Object3D | null> {
  const { mod } = parseMod(selection);
  if (!mod) return Promise.resolve(null);

  let pending = modelCache.get(mod.id);
  if (!pending) {
    pending = new Promise((resolve) => {
      new GLTFLoader().load(
        mod.url,
        (gltf) => {
          const scene = gltf.scene;
          scene.traverse((object) => {
            const mesh = object as THREE.Mesh;
            if (mesh.isMesh) {
              mesh.castShadow = true;
              mesh.receiveShadow = true;
            }
          });
          resolve(scene);
        },
        undefined,
        () => resolve(null),
      );
    });
    modelCache.set(mod.id, pending);
  }
  return pending;
}
