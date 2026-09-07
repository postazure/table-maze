/**
 * Art for Olympus (the minotaur's world): every prop the module places
 * (engine/worlds/greece.ts) and its own monsters. 8x8 for props, 16x16 for
 * the game-over scene — same convention as itemArt.ts: rows of chars, '.' is
 * transparent, every other char keys into `palette`.
 */
import type { ArtSpec } from '../itemArt';
import type { CreatureCfg } from '../monsterArt';

const STONE = '#9a9aa4';
const STONE_DARK = '#6b6b76';

export const PROP_ART: Record<string, ArtSpec> = {
  'portal-home': {
    rows: ['..PPPP..', '.PLLLLP.', 'PLWWWWLP', 'PLWWWWLP', 'PLWWWWLP', 'PLWWWWLP', '.PLLLLP.', '..PPPP..'],
    palette: { P: '#5a2596', L: '#b56cff', W: '#e8d9ff' },
  },

  // -- the three statues: a carved stone figure, symbol on the chest ---------
  'statue:zeus': {
    rows: ['..SSSS..', '.SSSSSS.', 'SS.YY.SS', 'SSSYYSSS', 'SS.YY.SS', 'SSSSSSSS', 'SS.SS.SS', 'DD....DD'],
    palette: { S: STONE, D: STONE_DARK, Y: '#f5c451' },
  },
  'statue:zeus:lit': {
    rows: ['..SSSS..', '.SYYYYS.', 'SS.YY.SS', 'SSSYYSSS', 'SS.YY.SS', 'SSYYYYSS', 'SS.SS.SS', 'DD....DD'],
    palette: { S: STONE, D: STONE_DARK, Y: '#f5c451' },
  },
  'statue:poseidon': {
    rows: ['..SSSS..', '.SSSSSS.', 'SS.C..SS', 'SSCCC.SS', 'SS.C..SS', 'SSSSSSSS', 'SS.SS.SS', 'DD....DD'],
    palette: { S: STONE, D: STONE_DARK, C: '#3a8fe0' },
  },
  'statue:poseidon:lit': {
    rows: ['..SSSS..', '.SCCCCS.', 'SS.C..SS', 'SSCCC.SS', 'SS.C..SS', 'SSCCCCSS', 'SS.SS.SS', 'DD....DD'],
    palette: { S: STONE, D: STONE_DARK, C: '#3a8fe0' },
  },
  'statue:hades': {
    rows: ['..SSSS..', '.SSSSSS.', 'SS.HH.SS', 'SSHHHHSS', 'SSH..HSS', 'SSSSSSSS', 'SS.SS.SS', 'DD....DD'],
    palette: { S: STONE, D: STONE_DARK, H: '#7b5cc9' },
  },
  'statue:hades:lit': {
    rows: ['..SSSS..', '.SHHHHS.', 'SS.HH.SS', 'SSHHHHSS', 'SSH..HSS', 'SSHHHHSS', 'SS.SS.SS', 'DD....DD'],
    palette: { S: STONE, D: STONE_DARK, H: '#7b5cc9' },
  },

  // -- archways: each realm's own colour, the hub gate a plain worn stone ----
  'gate:sky': {
    rows: ['.CCCCCC.', 'C.WWWW.C', 'C.W..W.C', 'C.W..W.C', 'C.W..W.C', 'C.W..W.C', 'C......C', 'CCCCCCCC'],
    palette: { C: '#7fbfff', W: '#eaf4ff' },
  },
  'gate:sea': {
    rows: ['.CCCCCC.', 'C.TTTT.C', 'C.T..T.C', 'C.T..T.C', 'C.T..T.C', 'C.T..T.C', 'C......C', 'CCCCCCCC'],
    palette: { C: '#2f6a9e', T: '#8fd8ff' },
  },
  'gate:underworld': {
    rows: ['.DDDDDD.', 'D.KKKK.D', 'D.K..K.D', 'D.K..K.D', 'D.K..K.D', 'D.K..K.D', 'D......D', 'DDDDDDDD'],
    palette: { D: '#3d2433', K: '#0d070b' },
  },
  'gate:hub': {
    rows: ['.SSSSSS.', 'S.BBBB.S', 'S.B..B.S', 'S.B..B.S', 'S.B..B.S', 'S.B..B.S', 'S......S', 'SSSSSSSS'],
    palette: { S: STONE, B: '#3a3a44' },
  },

  // -- the three symbols of power --------------------------------------------
  'symbol:bolt': {
    rows: ['...YY...', '..YY....', '.YYYYY..', '..YY....', '.YYY....', '..YY....', '.YY.....', '.Y......'],
    palette: { Y: '#f5c451' },
  },
  'symbol:trident': {
    rows: ['G.G.G...', 'G.G.G...', 'GGGGG...', '..G.....', '..G.....', '..G.....', '..G.....', '.GGG....'],
    palette: { G: '#2fae8a' },
  },
  'symbol:helm': {
    rows: ['.DDDDD..', 'DDPPPDD.', 'DPPPPPD.', 'DPP.PPD.', 'DPPPPPD.', 'DD...DD.', '..DDD...', '........'],
    palette: { D: '#241a30', P: '#4a3a66' },
  },

  wax: {
    rows: ['........', '..WWWW..', '.WWWWWW.', '.WWWWWW.', 'WWWWWWWW', 'WWWWWWWW', '.WWWWWW.', '........'],
    palette: { W: '#e0b64a' },
  },
  helm: {
    // a ship's wheel: brown rim, spokes, gold hub
    rows: ['..RRRR..', '.R.RR.R.', 'RR.RR.RR', 'RRRHHRRR', 'RRRHHRRR', 'RR.RR.RR', '.R.RR.R.', '..RRRR..'],
    palette: { R: '#6b4423', H: '#f5c451' },
  },
  obol: {
    rows: ['........', '..GGGG..', '.G....G.', 'G.GGGG.G', 'G.GGGG.G', '.G....G.', '..GGGG..', '........'],
    palette: { G: '#c9a227' },
  },
  cake: {
    rows: ['........', '..DD....', '.DYDYD..', 'DYYYYYD.', 'DYYYYYD.', 'DDDDDDD.', '.HHHHH..', '........'],
    palette: { D: '#8a5a2b', Y: '#e0b64a', H: '#5a3a1c' },
  },
  brazier: {
    rows: ['........', '........', 'B......B', 'BB....BB', '.BBBBBB.', '..BBBB..', '...BB...', '..BBBB..'],
    palette: { B: '#4a3a30' },
  },
  'brazier:lit': {
    rows: ['..OY....', '.OOOY...', 'B.OOY..B', 'BB.OY.BB', '.BBBBBB.', '..BBBB..', '...BB...', '..BBBB..'],
    palette: { B: '#4a3a30', O: '#ff8a3d', Y: '#ffcf5c' },
  },
  seal: {
    rows: ['SSSSSSSS', 'S.KKKK.S', 'S.K..K.S', 'S.KYYK.S', 'S.KYYK.S', 'S.K..K.S', 'S.KKKK.S', 'SSSSSSSS'],
    palette: { S: STONE_DARK, K: '#1a1420', Y: '#f5c451' },
  },
};

export const MONSTER_CFGS: Record<string, CreatureCfg> = {
  medusa: {
    widths: [2, 3, 3, 3, 3, 2, 1, 0],
    body: '#3a8f52',
    accent: '#7be08a',
    accentPositions: [
      [0, 0],
      [7, 0],
      [1, 1],
      [6, 1],
    ],
    eye: '#ff2a2a',
    eyePositions: [
      [2, 2],
      [5, 2],
    ],
  },
  siren: {
    widths: [0, 2, 3, 3, 3, 2, 2, 1],
    body: '#e8d9c9',
    accent: '#3a8fe0',
    accentPositions: [
      [2, 5],
      [3, 6],
      [4, 6],
      [5, 5],
    ],
    eye: '#1a3a5c',
    eyePositions: [
      [3, 2],
      [4, 2],
    ],
  },
  cerberus: {
    widths: [2, 4, 4, 4, 4, 4, 3, 2],
    body: '#241a14',
    accent: '#4a3a30',
    accentPositions: [
      [1, 0],
      [6, 0],
      [3, 0],
      [4, 0],
    ],
    eye: '#ff2a2a',
    eyePositions: [
      [1, 2],
      [2, 2],
      [3, 1],
      [4, 1],
      [5, 2],
      [6, 2],
    ],
  },
  shade: {
    widths: [0, 2, 3, 3, 3, 3, 3, 3],
    body: '#8a8a8a',
    eye: '#3a3a3a',
    eyePositions: [
      [2, 3],
      [5, 3],
    ],
  },
};

// A statue of a hero, petrified mid-stride among clouds — Medusa's stage, and
// the one every world's defeat art borrows the feel of.
export const DEFEAT_ART: ArtSpec = {
  rows: [
    'SSSS....SSSSSSSS',
    'SS........SSSSSS',
    'S..........SSSSS',
    '............SSSS',
    '.....GGG........',
    '....GGGGG.......',
    '....GG.GG.......',
    '.....GGG........',
    '....GGGGG.......',
    '...GGGGGGG......',
    '...GG.G.GG......',
    '...GG.G.GG......',
    '..GGG...GGG.....',
    '..GG.....GG.....',
    'DDDDDDDDDDDDDDDD',
    'DDDDDDDDDDDDDDDD',
  ],
  palette: { S: '#dbe6f7', G: '#8a8a94', D: '#5a6b8a' },
};
