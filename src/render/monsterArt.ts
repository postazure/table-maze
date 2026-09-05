import { THEMES } from '../engine/themes';

// ---------------------------------------------------------------------------
// Procedural creature sprites: a symmetric "blob" half-width profile (or an
// explicit pixel list for irregular shapes like the snake) plus accent/eye
// overrides. Produces the same row/palette shape buildIcon (renderer.ts)
// expects: an 8x8 grid of chars + a char->hex palette.
// ---------------------------------------------------------------------------

export interface CreatureCfg {
  widths?: number[]; // length 8, half-width (0-4) per row; ignored if bodyPositions is set
  bodyPositions?: Array<[number, number]>;
  body: string;
  accent?: string;
  accentPositions?: Array<[number, number]>;
  eye?: string;
  eyePositions?: Array<[number, number]>;
}

export function creatureRows(cfg: CreatureCfg): { rows: string[]; palette: Record<string, string> } {
  const size = 8;
  const grid: string[][] = Array.from({ length: size }, () => Array<string>(size).fill('.'));

  if (cfg.bodyPositions) {
    for (const [x, y] of cfg.bodyPositions) grid[y][x] = 'X';
  } else {
    const widths = cfg.widths ?? [];
    for (let y = 0; y < size; y++) {
      const wgt = widths[y] ?? 0;
      for (let x = 0; x < size; x++) {
        const dist = Math.abs(x - 3.5) - 0.5;
        if (dist <= wgt - 1) grid[y][x] = 'X';
      }
    }
  }
  for (const [x, y] of cfg.accentPositions ?? []) grid[y][x] = 'Y';
  for (const [x, y] of cfg.eyePositions ?? []) grid[y][x] = 'E';

  const palette: Record<string, string> = { X: cfg.body };
  if (cfg.accent) palette.Y = cfg.accent;
  if (cfg.eye) palette.E = cfg.eye;
  return { rows: grid.map((r) => r.join('')), palette };
}

export const MONSTER_CFGS: Record<string, CreatureCfg> = {
  rat: {
    widths: [0, 0, 2, 3, 3, 2, 1, 0],
    body: '#8a7256',
    accent: '#c98a8a',
    accentPositions: [
      [1, 2],
      [7, 4],
    ],
    eye: '#141414',
    eyePositions: [[3, 3]],
  },
  bat: {
    widths: [3, 4, 2, 1, 0, 0, 0, 0],
    body: '#4a4763',
    accent: '#2c2a3d',
    accentPositions: [
      [0, 0],
      [7, 0],
    ],
    eye: '#e5484d',
    eyePositions: [
      [2, 1],
      [5, 1],
    ],
  },
  spider: {
    widths: [0, 1, 3, 3, 1, 0, 0, 0],
    body: '#2f2a3d',
    accent: '#7b6cff',
    accentPositions: [
      [0, 3],
      [7, 3],
      [0, 4],
      [7, 4],
      [1, 5],
      [6, 5],
    ],
    eye: '#e5484d',
    eyePositions: [
      [3, 2],
      [4, 2],
    ],
  },
  snake: {
    bodyPositions: [
      [1, 0],
      [2, 0],
      [2, 1],
      [3, 1],
      [4, 2],
      [5, 2],
      [5, 3],
      [4, 3],
      [3, 4],
      [2, 4],
      [2, 5],
      [3, 5],
      [4, 6],
      [5, 6],
      [5, 7],
      [4, 7],
    ],
    body: '#3aa15a',
    eye: '#141414',
    eyePositions: [[1, 0]],
  },
  zombie: {
    widths: [0, 2, 2, 3, 3, 3, 3, 2],
    body: '#5c7a52',
    accent: '#2e3b2a',
    accentPositions: [
      [3, 4],
      [4, 4],
      [3, 5],
      [4, 5],
    ],
    eye: '#c9c9c9',
    eyePositions: [
      [2, 2],
      [5, 2],
    ],
  },
  skeleton: {
    widths: [0, 2, 2, 3, 2, 3, 2, 3],
    body: '#e8e6f0',
    accent: '#8f8ca8',
    accentPositions: [
      [3, 4],
      [4, 5],
    ],
    eye: '#141414',
    eyePositions: [
      [2, 2],
      [5, 2],
    ],
  },
  ogre: {
    widths: [0, 3, 4, 4, 4, 4, 3, 2],
    body: '#7a8f5a',
    accent: '#4a3b2a',
    accentPositions: [
      [1, 0],
      [6, 0],
      [2, 5],
      [3, 5],
      [4, 5],
      [5, 5],
    ],
    eye: '#e5484d',
    eyePositions: [
      [2, 2],
      [5, 2],
    ],
  },
  goblin: {
    widths: [0, 1, 2, 3, 2, 3, 2, 2],
    body: '#6fae52',
    accent: '#3a2b1f',
    accentPositions: [
      [1, 1],
      [6, 1],
    ],
    eye: '#f5c451',
    eyePositions: [
      [3, 2],
      [4, 2],
    ],
  },
  drake: {
    widths: [1, 2, 3, 4, 3, 2, 1, 1],
    body: '#3a6ea8',
    accent: '#f5c451',
    accentPositions: [
      [0, 2],
      [7, 2],
      [3, 0],
    ],
    eye: '#e5484d',
    eyePositions: [
      [3, 2],
      [4, 2],
    ],
  },
  wraith: {
    widths: [1, 2, 3, 3, 3, 2, 2, 1],
    body: '#7b6cff',
    eye: '#e8e6f0',
    eyePositions: [
      [3, 2],
      [4, 2],
    ],
  },
  vampire: {
    widths: [0, 2, 2, 3, 3, 2, 3, 2],
    body: '#8b1e2b',
    accent: '#e8e6f0',
    accentPositions: [
      [2, 2],
      [3, 2],
      [4, 2],
      [5, 2],
    ],
    eye: '#e5484d',
    eyePositions: [
      [3, 2],
      [4, 2],
    ],
  },
  scorpion: {
    widths: [0, 0, 2, 3, 3, 2, 0, 0],
    body: '#b8443a',
    accent: '#5e1f1a',
    accentPositions: [
      [6, 1],
      [7, 0],
      [0, 3],
    ],
    eye: '#141414',
    eyePositions: [
      [3, 3],
      [4, 3],
    ],
  },

  // -- new roster additions --------------------------------------------------

  toad: {
    widths: [0, 3, 4, 4, 3, 3, 2, 0],
    body: '#5cae5a',
    accent: '#2e5c34',
    accentPositions: [
      [2, 4],
      [3, 4],
      [4, 4],
      [5, 4],
    ],
    eye: '#f5c451',
    eyePositions: [
      [2, 1],
      [5, 1],
    ],
  },
  crab: {
    widths: [0, 0, 2, 3, 3, 2, 0, 0],
    body: '#c9502c',
    accent: '#8f2f18',
    accentPositions: [
      [0, 2],
      [7, 2],
      [0, 3],
      [7, 3],
    ],
    eye: '#141414',
    eyePositions: [
      [3, 2],
      [4, 2],
    ],
  },
  leech: {
    widths: [2, 3, 3, 3, 3, 3, 3, 2],
    body: '#6b1f2a',
    accent: '#4a1220',
    accentPositions: [
      [2, 2],
      [5, 2],
      [2, 4],
      [5, 4],
      [2, 6],
      [5, 6],
    ],
    eye: '#e5484d',
    eyePositions: [
      [3, 0],
      [4, 0],
    ],
  },
  slime: {
    widths: [0, 2, 3, 4, 4, 3, 2, 0],
    body: '#5ec970',
    accent: '#bff2c9',
    accentPositions: [
      [2, 2],
      [3, 2],
    ],
    eye: '#1a3a20',
    eyePositions: [
      [3, 4],
      [4, 4],
    ],
  },
  golem: {
    widths: [3, 4, 4, 4, 4, 4, 4, 3],
    body: '#7a7a86',
    accent: '#5a5a66',
    accentPositions: [
      [1, 3],
      [6, 3],
      [1, 5],
      [6, 5],
    ],
    eye: '#8be3ff',
    eyePositions: [
      [2, 2],
      [5, 2],
    ],
  },
  imp: {
    widths: [2, 3, 2, 2, 3, 2, 1, 0],
    body: '#c9402c',
    accent: '#5a1810',
    accentPositions: [
      [2, 0],
      [5, 0],
    ],
    eye: '#f5c451',
    eyePositions: [
      [3, 2],
      [4, 2],
    ],
  },
  salamander: {
    bodyPositions: [
      [0, 1],
      [1, 1],
      [1, 2],
      [2, 2],
      [3, 3],
      [4, 3],
      [4, 4],
      [3, 4],
      [2, 5],
      [1, 5],
      [1, 6],
      [2, 6],
      [3, 7],
      [4, 7],
    ],
    body: '#e08a3a',
    accent: '#8f4a1a',
    accentPositions: [
      [1, 3],
      [3, 5],
    ],
    eye: '#141414',
    eyePositions: [[0, 1]],
  },
  beetle: {
    widths: [0, 3, 4, 4, 4, 4, 3, 0],
    body: '#4a1a18',
    accent: '#ff6a2c',
    accentPositions: [
      [3, 2],
      [4, 3],
      [3, 4],
      [4, 5],
    ],
    eye: '#1a0605',
    eyePositions: [
      [2, 1],
      [5, 1],
    ],
  },
  yeti: {
    widths: [1, 3, 4, 4, 4, 4, 3, 2],
    body: '#eef2f7',
    accent: '#c7d0dc',
    accentPositions: [
      [1, 3],
      [6, 4],
      [2, 6],
    ],
    eye: '#2a4a6b',
    eyePositions: [
      [2, 2],
      [5, 2],
    ],
  },
  wolf: {
    widths: [2, 3, 2, 3, 3, 3, 2, 1],
    body: '#6b6f7a',
    accent: '#3a3d47',
    accentPositions: [
      [1, 0],
      [6, 0],
      [3, 6],
      [4, 6],
    ],
    eye: '#e5484d',
    eyePositions: [
      [2, 2],
      [5, 2],
    ],
  },
  sprite: {
    widths: [0, 2, 3, 3, 2, 1, 0, 0],
    body: '#bfe3ff',
    accent: '#e8f7ff',
    accentPositions: [
      [1, 1],
      [6, 2],
      [2, 6],
    ],
    eye: '#3a6ea8',
    eyePositions: [
      [3, 2],
      [4, 2],
    ],
  },
  treant: {
    widths: [0, 0, 0, 0, 2, 2, 2, 2],
    body: '#6b4423',
    accent: '#3aa15a',
    accentPositions: [
      [3, 0],
      [4, 0],
      [2, 1],
      [3, 1],
      [4, 1],
      [5, 1],
      [1, 2],
      [2, 2],
      [5, 2],
      [6, 2],
      [2, 3],
      [3, 3],
      [4, 3],
      [5, 3],
    ],
    eye: '#1a0f06',
    eyePositions: [
      [3, 2],
      [4, 2],
    ],
  },
  boar: {
    widths: [0, 2, 3, 4, 4, 3, 2, 1],
    body: '#8a5a3a',
    accent: '#e8e6d8',
    accentPositions: [
      [1, 5],
      [6, 5],
    ],
    eye: '#141414',
    eyePositions: [
      [2, 2],
      [5, 2],
    ],
  },
  knight: {
    widths: [0, 3, 4, 4, 4, 4, 3, 2],
    body: '#8f97a8',
    accent: '#5a6272',
    accentPositions: [
      [2, 3],
      [5, 3],
      [2, 5],
      [5, 5],
    ],
    eye: '#141414',
    eyePositions: [
      [3, 2],
      [4, 2],
    ],
  },
  ghost: {
    widths: [0, 2, 3, 3, 3, 3, 3, 3],
    body: '#e8e6f0',
    eye: '#1a1a24',
    eyePositions: [
      [2, 3],
      [5, 3],
    ],
  },
  larva: {
    widths: [0, 2, 3, 4, 4, 3, 2, 0],
    body: '#f0e0a0',
    accent: '#c9b870',
    accentPositions: [
      [2, 2],
      [5, 2],
      [2, 4],
      [5, 4],
    ],
    eye: '#1a1408',
    eyePositions: [
      [3, 1],
      [4, 1],
    ],
  },
  ant: {
    widths: [0, 2, 1, 1, 2, 1, 1, 2],
    body: '#2a1f16',
    accent: '#4a3222',
    accentPositions: [
      [0, 3],
      [7, 3],
      [0, 5],
      [7, 5],
    ],
    eye: '#c9402c',
    eyePositions: [
      [3, 0],
      [4, 0],
    ],
  },
  bee: {
    widths: [0, 2, 3, 3, 3, 3, 2, 0],
    body: '#f5c451',
    accent: '#1a1608',
    accentPositions: [
      [0, 2],
      [7, 2],
      [2, 3],
      [3, 3],
      [4, 3],
      [5, 3],
      [2, 5],
      [3, 5],
      [4, 5],
      [5, 5],
    ],
    eye: '#141414',
    eyePositions: [
      [3, 1],
      [4, 1],
    ],
  },
  wasp: {
    widths: [1, 2, 2, 2, 2, 2, 1, 0],
    body: '#f5c451',
    accent: '#1a1608',
    accentPositions: [
      [2, 2],
      [3, 2],
      [4, 2],
      [5, 2],
      [2, 5],
      [3, 5],
      [4, 5],
      [5, 5],
    ],
    eye: '#e5484d',
    eyePositions: [
      [3, 0],
      [4, 0],
    ],
  },
  demon: {
    widths: [2, 3, 3, 4, 4, 3, 3, 2],
    body: '#4a0f14',
    accent: '#1a0508',
    accentPositions: [
      [1, 0],
      [6, 0],
    ],
    eye: '#f5e050',
    eyePositions: [
      [2, 2],
      [5, 2],
    ],
  },

  blob: {
    widths: [0, 2, 3, 4, 4, 3, 2, 0],
    body: '#8f8ca8',
    eye: '#141414',
    eyePositions: [
      [3, 3],
      [4, 3],
    ],
  },

  // -- boss encounters --------------------------------------------------------

  // A hooded robe (asymmetric so a staff can lean off the right shoulder,
  // hence bodyPositions rather than symmetric widths). Pale face patch (Y)
  // sits inside the hood; tiny green eyes (E) glow beneath it, and the same
  // green reappears as a glowing orb atop the staff.
  necromancer: {
    bodyPositions: [
      [3, 0],
      [4, 0],
      [2, 1],
      [3, 1],
      [4, 1],
      [5, 1],
      [7, 1],
      [1, 2],
      [2, 2],
      [3, 2],
      [4, 2],
      [5, 2],
      [6, 2],
      [7, 2],
      [1, 3],
      [2, 3],
      [3, 3],
      [4, 3],
      [5, 3],
      [6, 3],
      [7, 3],
      [1, 4],
      [2, 4],
      [3, 4],
      [4, 4],
      [5, 4],
      [6, 4],
      [7, 4],
      [1, 5],
      [2, 5],
      [3, 5],
      [4, 5],
      [5, 5],
      [6, 5],
      [7, 5],
      [1, 6],
      [2, 6],
      [3, 6],
      [4, 6],
      [5, 6],
      [6, 6],
      [7, 6],
      [0, 7],
      [1, 7],
      [2, 7],
      [3, 7],
      [4, 7],
      [5, 7],
      [6, 7],
    ],
    body: '#3a1f52',
    accent: '#d8c9b8',
    accentPositions: [
      [3, 2],
      [4, 2],
    ],
    eye: '#3aff6e',
    eyePositions: [
      [3, 3],
      [4, 3],
      [7, 0],
    ],
  },
  // A faceted gem, symmetric, so bodyPositions draws the diamond directly.
  // Dark stone base (Y) underneath, one white facet highlight (E) up top.
  crystal: {
    bodyPositions: [
      [3, 0],
      [4, 0],
      [2, 1],
      [3, 1],
      [4, 1],
      [5, 1],
      [1, 2],
      [2, 2],
      [3, 2],
      [4, 2],
      [5, 2],
      [6, 2],
      [1, 3],
      [2, 3],
      [3, 3],
      [4, 3],
      [5, 3],
      [6, 3],
      [2, 4],
      [3, 4],
      [4, 4],
      [5, 4],
      [3, 5],
      [4, 5],
    ],
    body: '#c13fe0',
    accent: '#241a30',
    accentPositions: [
      [2, 6],
      [3, 6],
      [4, 6],
      [5, 6],
      [2, 7],
      [3, 7],
      [4, 7],
      [5, 7],
    ],
    eye: '#ffffff',
    eyePositions: [[3, 1]],
  },
  // Big and wide (widths hits the full 8px row through the shoulders), bone
  // horns curling off the top corners, red eyes.
  minotaur: {
    widths: [2, 3, 4, 4, 4, 4, 4, 3],
    body: '#6b4226',
    accent: '#e8dcc0',
    accentPositions: [
      [1, 0],
      [6, 0],
    ],
    eye: '#ff2a2a',
    eyePositions: [
      [2, 2],
      [5, 2],
    ],
  },
  // A weeping angel statue: pale stone, hands (the lighter accent) covering
  // the whole eye line so no eye color is ever needed.
  angel: {
    widths: [0, 2, 3, 3, 3, 3, 3, 3],
    body: '#9a9aa4',
    accent: '#c7c7d1',
    accentPositions: [
      [2, 2],
      [3, 2],
      [4, 2],
      [5, 2],
    ],
  },
};

export const MONSTER_KEYWORDS = [
  'rat',
  'bat',
  'spider',
  'snake',
  'zombie',
  'skeleton',
  'ogre',
  'goblin',
  'drake',
  'wraith',
  'vampire',
  'scorpion',
  'toad',
  'crab',
  'leech',
  'slime',
  'golem',
  'imp',
  'salamander',
  'beetle',
  'yeti',
  'wolf',
  'sprite',
  'treant',
  'boar',
  'knight',
  'ghost',
  'larva',
  'ant',
  'bee',
  'wasp',
  'demon',
  'necromancer',
  'crystal',
  'minotaur',
  'angel',
] as const;

const MONSTER_KEYWORD_SET: ReadonlySet<string> = new Set(MONSTER_KEYWORDS);

/**
 * Resolves a monster's display name to a sprite key by matching whole words
 * only (never a substring): "Treant" must not match "ant", and "Salamander"
 * must not match "ant"/"lam". Falls back to the generic 'blob' sprite.
 */
export function monsterSpriteKey(name: string): string {
  const words = name.toLowerCase().split(/\s+/);
  for (const w of words) {
    if (MONSTER_KEYWORD_SET.has(w)) return w;
  }
  return 'blob';
}

// ---------------------------------------------------------------------------
// Startup sanity check: every monster name used by every theme roster must
// resolve to a real (non-'blob') sprite key, so a roster/sprite mismatch is
// caught immediately instead of silently rendering the fallback blob.
// ---------------------------------------------------------------------------

for (const theme of THEMES) {
  for (const looks of Object.values(theme.roster)) {
    for (const look of looks) {
      const key = monsterSpriteKey(look.name);
      if (key === 'blob' || !MONSTER_CFGS[key]) {
        throw new Error(
          `monsterArt: theme "${theme.id}" roster entry "${look.name}" does not resolve to a known monster sprite`,
        );
      }
    }
  }
}

// ---------------------------------------------------------------------------
// Startup sanity check: a creature's sprite key means the same role
// (guard/patrol/lurker) everywhere it turns up, across every theme. Two
// roster entries that resolve to the same sprite (e.g. "Wolf" and "Ice Wolf"
// both key to "wolf") are the same creature reskinned, so a player should
// never meet it as a lurker in one theme and a patrol in another — let alone
// both roles inside one theme's own roster, which this also catches.
// ---------------------------------------------------------------------------

const roleForSpriteKey = new Map<string, string>();
for (const theme of THEMES) {
  for (const [role, looks] of Object.entries(theme.roster)) {
    for (const look of looks) {
      const key = monsterSpriteKey(look.name);
      const prevRole = roleForSpriteKey.get(key);
      if (prevRole && prevRole !== role) {
        throw new Error(
          `monsterArt: "${look.name}" (sprite "${key}") is a ${role} in theme "${theme.id}" but a ${prevRole} elsewhere`,
        );
      }
      roleForSpriteKey.set(key, role);
    }
  }
}
