/**
 * Art for the Boston world (engine/worlds/arkham.ts): rowhouses in three
 * door colours, the church, the chalk circle, the tablet, streetlamps, the
 * way home, and the cultists themselves.
 *
 * Contract: `PROP_ART` is keyed by `Prop.art`, with a `art:state` entry
 * picked over the base when `Prop.state` matches (render/worlds/index.ts).
 * `MONSTER_CFGS` adds the world's own monster looks, merged into the
 * renderer's table at import time. `DEFEAT_ART` is the 16x16 game-over scene.
 */
import type { ArtSpec } from '../itemArt';
import type { CreatureCfg } from '../monsterArt';

// ---------------------------------------------------------------------------
// Houses: one shared silhouette, three door colours, two states. The
// searched state only relights the windows (a bumped door left ajar spills
// light) — same building, same door colour, so a searched house is still
// recognisably the one the clue described.
// ---------------------------------------------------------------------------

const HOUSE_ROWS = [
  'FFFFFFFF',
  'BBBBBBBB',
  'BWWBBWWB',
  'BBBBBBBB',
  'BWWBBWWB',
  'BBBBBBBB',
  'BBBDDBBB',
  'BBBDDBBB',
];

const HOUSE_ROOF = '#241e1a';
const HOUSE_WALL = '#5c4f49';
const WINDOW_DARK = '#17141c';
const WINDOW_LIT = '#f2c14e';
const DOOR_COLORS: Record<'red' | 'blue' | 'green', string> = {
  red: '#b23a3a',
  blue: '#3a5ab2',
  green: '#3ab25a',
};

function houseArt(color: 'red' | 'blue' | 'green', searched: boolean): ArtSpec {
  return {
    rows: HOUSE_ROWS,
    palette: {
      F: HOUSE_ROOF,
      B: HOUSE_WALL,
      W: searched ? WINDOW_LIT : WINDOW_DARK,
      D: DOOR_COLORS[color],
    },
  };
}

export const PROP_ART: Record<string, ArtSpec> = {
  'house-red': houseArt('red', false),
  'house-red:searched': houseArt('red', true),
  'house-blue': houseArt('blue', false),
  'house-blue:searched': houseArt('blue', true),
  'house-green': houseArt('green', false),
  'house-green:searched': houseArt('green', true),

  // A steeple over stone walls, a round pale window instead of a rose
  // window (this glass has nothing so cheerful behind it), one dark door.
  church: {
    rows: ['...SS...', '..SSSS..', '.SSSSSS.', 'BBBBBBBB', 'BB.WW.BB', 'BBBBBBBB', 'BBBDDBBB', 'BBBDDBBB'],
    palette: { S: '#2a2a34', B: '#4a4038', W: '#cfc7e6', D: '#2c1e14' },
  },

  // A grey slab, glyphs still faintly glowing from whatever last read them.
  tablet: {
    rows: ['..TTTT..', '.TTTTTT.', 'TTGTGTTT', 'TTTGTTTT', 'TTGTGTTT', 'TTTTTTTT', '.TTTTTT.', '..TTTT..'],
    palette: { T: '#8a8a92', G: '#3aff8f' },
  },

  // Chalk drawn on the cobbles, a mark lit red at its centre.
  circle: {
    rows: ['..CCCC..', '.C....C.', 'C..GG..C', 'C..GG..C', 'C..GG..C', 'C..GG..C', '.C....C.', '..CCCC..'],
    palette: { C: '#e8e4d8', G: '#8a2a2a' },
  },
  // Broken: the ring scuffed through, the mark gone dark and scorched.
  'circle:broken': {
    rows: ['..C..C..', '.C....C.', '........', '...XX...', '...XX...', '........', '.C....C.', '..C..C..'],
    palette: { C: '#8a8578', X: '#1a1310' },
  },

  lamp: {
    rows: ['...LL...', '..LLLL..', '...LL...', '...PP...', '...PP...', '...PP...', '...PP...', '..PPPP..'],
    palette: { L: '#f5d76e', P: '#2a2a30' },
  },

  'portal-home': {
    rows: ['..PPPP..', '.PLLLLP.', 'PLWWWWLP', 'PLWWWWLP', 'PLWWWWLP', 'PLWWWWLP', '.PLLLLP.', '..PPPP..'],
    palette: { P: '#5a2596', L: '#b56cff', W: '#e8d9ff' },
  },
};

// ---------------------------------------------------------------------------
// The cultist: a hooded robe, a pale sliver of face under the hood, a knife
// held off to one side (asymmetric, hence bodyPositions rather than a
// symmetric width profile).
// ---------------------------------------------------------------------------

export const MONSTER_CFGS: Record<string, CreatureCfg> = {
  cultist: {
    widths: [1, 2, 3, 3, 3, 3, 2, 2],
    body: '#332b45',
    accent: '#c9c9d8',
    accentPositions: [
      [7, 3],
      [7, 4],
    ],
    eye: '#d8c9ad',
    eyePositions: [
      [3, 2],
      [4, 2],
    ],
  },
};

// A fog-bound street: a hooded shape rising above the rooftops, its eyes
// the only warmth in the whole scene besides one or two lit windows.
export const DEFEAT_ART: ArtSpec = {
  rows: [
    '................',
    '.......SS.......',
    '......SSSS......',
    '.....SSSSSS.....',
    '....SS.EE.SS....',
    '....SSS..SSS....',
    '...SS......SS...',
    '...SS.FFFF.SS...',
    '..SS...FF...SS..',
    '.SS..........SS.',
    'RRRRRRRRRRRRRRRR',
    'R.W..R..W..R.W.R',
    'RRRR.RRRR.RRRRRR',
    'RRRRRRRRRRRRRRRR',
    'FFFFFFFFFFFFFFFF',
    '................',
  ],
  palette: {
    S: '#243120',
    E: '#3aff8f',
    F: '#4a5568',
    R: '#151018',
    W: '#f2c14e',
  },
};
