export const GRID_SIZE = 26;
export const CELL_SIZE = 1.0;
export const BOARD_SIZE = GRID_SIZE * CELL_SIZE; // 26.0
export const HALF_BOARD = BOARD_SIZE * 0.5; // 13.0

export enum TileType {
  EMPTY = 0,
  BRICK = 1,
  STEEL = 2,
  WATER = 3,
  FOREST = 4,
  ICE = 5,
  BASE = 6,
}

export type GameMode = 'demo' | 'campaign' | 'pvp' | 'coop' | 'workshop';

export type CameraPreset = 'diorama' | 'chase' | 'orbit';

export type EnemyArchetype = 'scout' | 'raider' | 'twin' | 'juggernaut';

export type PowerUpKind = 'star' | 'shield' | 'freeze' | 'fortress' | 'bomb' | 'repair';

export const SQUAD_COLORS = [
  0xd99b30, // P1 Classic Desert Amber Gold
  0x4ea868, // P2 Emerald Olive
  0x4688d8, // P3 Cobalt Steel
  0xd44b42, // P4 Crimson Oxide
];

export const ENEMY_COLORS: Record<EnemyArchetype, number> = {
  scout: 0x93a3b5,
  raider: 0xb86843,
  twin: 0x7c8f56,
  juggernaut: 0x5c6878,
};

export interface PeerPresence {
  peerId: string;
  name: string;
  joinedAt: number;
  slot: number;
  color: number;
  mode: 'pvp' | 'coop';
  kills: number;
  score: number;
  lastSeen: number;
}

export interface NetTankSnapshot {
  seq: number;
  x: number;
  z: number;
  vx: number;
  vz: number;
  hull: number;
  turret: number;
  hp: number;
  maxHp: number;
  shield: number;
  charge: number;
  stars: number;
  alive: number;
  kills: number;
  score: number;
}

export interface NetFireEvent {
  t: 'fire';
  id: string;
  owner: string;
  team: 'player' | 'enemy';
  color: number;
  x: number;
  z: number;
  angle: number;
  speed: number;
  dmg: number;
  heavy: boolean;
  pierceSteel: boolean;
}

export interface NetMapDamageEvent {
  t: 'dmg';
  cells: Array<[number, number, number]>;
  cx: number;
  cz: number;
}

export interface NetHitEvent {
  t: 'hit';
  targetId: string;
  attackerId: string;
  attackerName: string;
  dmg: number;
  fatal: boolean;
  x: number;
  z: number;
}

export interface NetStartEvent {
  t: 'start';
  mode: 'pvp' | 'coop';
  mapIndex: number;
  gridHex: string;
  seed: number;
}

export interface NetPowerUpEvent {
  t: 'pu';
  action: 'spawn' | 'pick';
  id: string;
  kind?: PowerUpKind;
  x?: number;
  z?: number;
  pickerId?: string;
}

export interface NetAiSyncEvent {
  t: 'ai';
  waveLeft: number;
  baseAlive: boolean;
  enemies: Array<[string, EnemyArchetype, number, number, number, number, number, number, number, number]>;
}

export type NetRoomEvent =
  | NetFireEvent
  | NetMapDamageEvent
  | NetHitEvent
  | NetStartEvent
  | NetPowerUpEvent
  | NetAiSyncEvent;

export interface PublicRoomBeacon {
  roomId: string;
  mode: 'pvp' | 'coop';
  hostName: string;
  count: number;
  updatedAt: number;
}
