import { GRID_SIZE, TileType } from '../types';

/**
 * 13x13 macro-map legend (each char expands to 2x2 micro-cells in 26x26 grid,
 * except Eagle Base and Brick Perimeter around Base which are sculpted at fine 1x1 resolution):
 * '.' = Empty
 * '#' = Brick
 * '@' = Steel
 * '~' = Water
 * '%' = Forest
 * '=' = Ice
 */
const CAMPAIGN_MACRO_MAPS: string[][] = [
  // Stage 01: 1985 Classic Homage
  [
    '.............',
    '.#.#.#.#.#.#.',
    '.#.#.#.#.#.#.',
    '.#.#.#@#.#.#.',
    '.#.#.#.#.#.#.',
    '...#.....#...',
    '@..#.###.#..@',
    '%..#.....#..%',
    '%.#.#.#.#.#.%',
    '..#.#.#.#.#..',
    '..#.#...#.#..',
    '..#.......#..',
    '.............',
  ],
  // Stage 02: Canal Stronghold
  [
    '.............',
    '.##..#.#..##.',
    '.#...#.#...#.',
    '...%%...%%...',
    '~~~~.###.~~~~',
    '~~~~..@..~~~~',
    '...##...##...',
    '.#..#.#.#..#.',
    '.@#.......#@.',
    '..##.###.##..',
    '..#.......#..',
    '....#...#....',
    '.............',
  ],
  // Stage 03: Glacial Bastion
  [
    '.............',
    '.#.===.===.#.',
    '.#.===@===.#.',
    '...==#.#==...',
    '.@@.=====.@@.',
    '.##.==@==.##.',
    '====.....====',
    '.#..=====..#.',
    '.#.#=====#.#.',
    '...#.===.#...',
    '.@#.......#@.',
    '..#.......#..',
    '.............',
  ],
  // Stage 04: Ardennes Forest Ambush
  [
    '.............',
    '.%%.##.##.%%.',
    '.%%.#...#.%%.',
    '.%%..%%%..%%.',
    '..#..%@%..#..',
    '~~#..%%%..#~~',
    '....#...#....',
    '.%%.##@##.%%.',
    '.%%.......%%.',
    '..##.%%%.##..',
    '..#..%%%..#..',
    '.............',
    '.............',
  ],
  // Stage 05: Twin Citadel Siege
  [
    '.............',
    '.#@#..#..#@#.',
    '.#.#..#..#.#.',
    '.....###.....',
    '.##.~~.~~.##.',
    '.@..~~@~~..@.',
    '..%.##.##.%..',
    '.%%.#...#.%%.',
    '.@#..###..#@.',
    '..#.......#..',
    '..#.#...#.#..',
    '.............',
    '.............',
  ],
];

const PVP_MACRO_MAPS: string[][] = [
  // PvP 01: Iron Cross
  [
    '.............',
    '.............',
    '..##..@..##..',
    '..#..###..#..',
    '....%...%....',
    '...#.###.#...',
    '..@#.#@#.#@..',
    '...#.###.#...',
    '....%...%....',
    '..#..###..#..',
    '..##..@..##..',
    '.............',
    '.............',
  ],
  // PvP 02: Canal Duel
  [
    '.............',
    '.............',
    '..##.%%%.##..',
    '..#.......#..',
    '~~~~.###.~~~~',
    '.....#@#.....',
    '..%%.###.%%..',
    '.....#@#.....',
    '~~~~.###.~~~~',
    '..#.......#..',
    '..##.%%%.##..',
    '.............',
    '.............',
  ],
  // PvP 03: Frost Arena
  [
    '.............',
    '.............',
    '..@#=====#@..',
    '..#.=====.#..',
    '==..##.##..==',
    '==.%..@..%.==',
    '==..#.@.#..==',
    '==.%..@..%.==',
    '==..##.##..==',
    '..#.=====.#..',
    '..@#=====#@..',
    '.............',
    '.............',
  ],
];

function charToTile(ch: string): TileType {
  switch (ch) {
    case '#':
      return TileType.BRICK;
    case '@':
      return TileType.STEEL;
    case '~':
      return TileType.WATER;
    case '%':
      return TileType.FOREST;
    case '=':
      return TileType.ICE;
    default:
      return TileType.EMPTY;
  }
}

export function createEmptyGrid(): Uint8Array {
  return new Uint8Array(GRID_SIZE * GRID_SIZE);
}

export function stampEagleFortress(grid: Uint8Array, wallType: TileType = TileType.BRICK): void {
  // Eagle core occupies micro-cells x: 12..13, z: 24..25
  // Protective wall occupies x: 11..14, z: 23..25 around it
  for (let z = 23; z <= 25; z++) {
    for (let x = 11; x <= 14; x++) {
      const isCore = (x === 12 || x === 13) && (z === 24 || z === 25);
      grid[z * GRID_SIZE + x] = isCore ? TileType.BASE : wallType;
    }
  }
}

export function buildCampaignGrid(stageIndex: number): Uint8Array {
  const grid = createEmptyGrid();
  const rows = CAMPAIGN_MACRO_MAPS[((stageIndex % CAMPAIGN_MACRO_MAPS.length) + CAMPAIGN_MACRO_MAPS.length) % CAMPAIGN_MACRO_MAPS.length];

  for (let mz = 0; mz < 13; mz++) {
    const line = rows[mz] || '.............';
    for (let mx = 0; mx < 13; mx++) {
      const tile = charToTile(line[mx] || '.');
      for (let dz = 0; dz < 2; dz++) {
        for (let dx = 0; dx < 2; dx++) {
          const gx = mx * 2 + dx;
          const gz = mz * 2 + dz;
          grid[gz * GRID_SIZE + gx] = tile;
        }
      }
    }
  }

  // Clear enemy top spawn pads (x: 0..1, 12..13, 24..25 at z: 0..1) and player bottom spawn pads
  const clear2x2 = (sx: number, sz: number) => {
    for (let dz = 0; dz < 2; dz++) {
      for (let dx = 0; dx < 2; dx++) {
        grid[(sz + dz) * GRID_SIZE + (sx + dx)] = TileType.EMPTY;
      }
    }
  };
  clear2x2(0, 0);
  clear2x2(12, 0);
  clear2x2(24, 0);
  clear2x2(8, 24);
  clear2x2(16, 24);

  stampEagleFortress(grid, TileType.BRICK);
  return grid;
}

export function buildPvpGrid(mapIndex: number): Uint8Array {
  const grid = createEmptyGrid();
  const rows = PVP_MACRO_MAPS[((mapIndex % PVP_MACRO_MAPS.length) + PVP_MACRO_MAPS.length) % PVP_MACRO_MAPS.length];

  for (let mz = 0; mz < 13; mz++) {
    const line = rows[mz] || '.............';
    for (let mx = 0; mx < 13; mx++) {
      const tile = charToTile(line[mx] || '.');
      for (let dz = 0; dz < 2; dz++) {
        for (let dx = 0; dx < 2; dx++) {
          grid[(mz * 2 + dz) * GRID_SIZE + (mx * 2 + dx)] = tile;
        }
      }
    }
  }

  // Clear 4 corner spawn zones
  const spawns = [
    [1, 1],
    [23, 23],
    [1, 23],
    [23, 1],
  ];
  for (const [sx, sz] of spawns) {
    for (let dz = -1; dz <= 2; dz++) {
      for (let dx = -1; dx <= 2; dx++) {
        const gx = sx + dx;
        const gz = sz + dz;
        if (gx >= 0 && gx < GRID_SIZE && gz >= 0 && gz < GRID_SIZE) {
          grid[gz * GRID_SIZE + gx] = TileType.EMPTY;
        }
      }
    }
  }
  return grid;
}

export function encodeGrid(grid: Uint8Array): string {
  let out = '';
  for (let i = 0; i < grid.length; i++) {
    out += (grid[i] & 0x0f).toString(16);
  }
  return out;
}

export function decodeGrid(hex: string): Uint8Array {
  const grid = createEmptyGrid();
  const len = Math.min(grid.length, hex.length);
  for (let i = 0; i < len; i++) {
    const v = parseInt(hex[i], 16);
    grid[i] = Number.isNaN(v) ? 0 : v;
  }
  return grid;
}
