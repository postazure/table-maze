/**
 * Art for the Cemetery world: the graveyard's props, its two monsters
 * (ghoul, shade — the angels use monsterArt's own 'angel' sprite), and the
 * game-over scene.
 */
import type { ArtSpec } from '../itemArt';
import type { CreatureCfg } from '../monsterArt';

// ---------------------------------------------------------------------------
// Props
// ---------------------------------------------------------------------------

/** A shut crypt: nothing but an overgrown mound until it is bumped open. */
const CRYPT_SHUT: ArtSpec = {
  rows: ['........', '..GGGG..', '.GMMMMG.', 'GMMMMMMG', 'GMMMMMMG', '.GMMMMG.', '..GGGG..', '........'],
  palette: { G: '#2f4a35', M: '#3f5c3a' },
};

/** Opened: a stone archway over a dark doorway down. */
const CRYPT_OPEN: ArtSpec = {
  rows: ['..SSSS..', '.SSSSSS.', 'SSDDDDSS', 'SSDDDDSS', 'SSDDDDSS', 'SSDDDDSS', '.SSSSSS.', '........'],
  palette: { S: '#6b6b7a', D: '#16162a' },
};

/** Done: the same archway, looted — the door stands open on nothing. */
const CRYPT_DONE: ArtSpec = {
  rows: ['..SSSS..', '.SLLLLS.', 'SLDDDDLS', 'SLD..DLS', 'SLD..DLS', 'SLDDDDLS', '.SLLLLS.', '........'],
  palette: { S: '#4a4a56', L: '#6b6b7a', D: '#0c0c16' },
};

export const PROP_ART: Record<string, ArtSpec> = {
  crypt: CRYPT_SHUT,
  'crypt:shut': CRYPT_SHUT,
  'crypt:open': CRYPT_OPEN,
  'crypt:done': CRYPT_DONE,

  // An iron fence run: posts and a rail, reading as stone-hard next to a
  // hedge's soft green.
  fence: {
    rows: ['I.I.I.I.', 'I.I.I.I.', 'IIIIIIII', 'I.I.I.I.', 'I.I.I.I.', 'IIIIIIII', 'I.I.I.I.', '........'],
    palette: { I: '#2a2f33' },
  },

  // A plain headstone with a fleck of moss, decoration only.
  grave: {
    rows: ['..GGGG..', '.GGMGGG.', 'GGGGGGGG', 'GGGGGMGG', '..GGGG..', '..GGGG..', '..GGGG..', '........'],
    palette: { G: '#8f8ca8', M: '#3f5c3a' },
  },

  // The contraption: a brass frame, gaining a lit part per piece delivered.
  contraption: {
    rows: ['BBBBBBBB', 'B......B', 'B......B', 'B......B', 'B......B', 'B......B', 'B......B', 'BBBBBBBB'],
    palette: { B: '#8a6a2a' },
  },
  'contraption:empty': {
    rows: ['BBBBBBBB', 'B......B', 'B......B', 'B......B', 'B......B', 'B......B', 'B......B', 'BBBBBBBB'],
    palette: { B: '#8a6a2a' },
  },
  'contraption:one': {
    rows: ['BBBBBBBB', 'B......B', 'B......B', 'B..GG..B', 'B..GG..B', 'B......B', 'B......B', 'BBBBBBBB'],
    palette: { B: '#8a6a2a', G: '#f5c451' },
  },
  'contraption:two': {
    rows: ['BBBBBBBB', 'B.L..L.B', 'B......B', 'B..GG..B', 'B..GG..B', 'B......B', 'B......B', 'BBBBBBBB'],
    palette: { B: '#8a6a2a', G: '#f5c451', L: '#8fe3ff' },
  },
  'contraption:three': {
    rows: ['BBBBBBBB', 'B.L..L.B', 'B......B', 'B..GG..B', 'B..GG..B', 'B.Y..Y.B', 'B......B', 'BBBBBBBB'],
    palette: { B: '#8a6a2a', G: '#f5c451', L: '#8fe3ff', Y: '#c9a227' },
  },
  'contraption:complete': {
    rows: ['CCCCCCCC', 'C.WWWW.C', 'C.WWWW.C', 'C.WWWW.C', 'C.WWWW.C', 'C.WWWW.C', 'C.WWWW.C', 'CCCCCCCC'],
    palette: { C: '#f5d76e', W: '#fff6d0' },
  },

  // The four relic pieces, one small icon each.
  'piece:gear': {
    rows: ['..G.G...', '.GGGGG..', 'G.GGG.G.', 'GGGGGGG.', 'G.GGG.G.', '.GGGGG..', '..G.G...', '........'],
    palette: { G: '#c9a227' },
  },
  'piece:lens': {
    rows: ['..LLLL..', '.LWWWWL.', 'LWWWWWWL', 'LWWWWWWL', '.LWWWWL.', '..LLLL..', '....DD..', '....DD..'],
    palette: { L: '#2f6f8f', W: '#8fe3ff', D: '#5a3a1c' },
  },
  'piece:bell': {
    rows: ['...BB...', '..BBBB..', '.BBBBBB.', '.BBBBBB.', 'BBBBBBBB', '..BBBB..', '...OO...', '........'],
    palette: { B: '#c9a227', O: '#8a6a2a' },
  },
  'piece:key': {
    rows: ['..KK....', '.K..K...', '.K..K...', '..KK....', '...KKKK.', '...K.K..', '...K.K..', '........'],
    palette: { K: '#8f8ca8' },
  },

  // Stairs back up out of a crypt: pale steps climbing away.
  'stairs-up': {
    rows: ['......SS', '.....SSS', '....SSS.', '...SSS..', '..SSS...', '.SSS....', 'SSS.....', '........'],
    palette: { S: '#9a97ad' },
  },

  // The portal home: a ring of violet light, live on the surface at any time.
  'portal-home': {
    rows: ['..PPPP..', '.PLLLLP.', 'PLWWWWLP', 'PLWWWWLP', 'PLWWWWLP', 'PLWWWWLP', '.PLLLLP.', '..PPPP..'],
    palette: { P: '#5a2596', L: '#b56cff', W: '#e8d9ff' },
  },
};

// ---------------------------------------------------------------------------
// Monsters
// ---------------------------------------------------------------------------

export const MONSTER_CFGS: Record<string, CreatureCfg> = {
  // Hunched, slow, green-grey. A stoop rather than a stance: narrow at the
  // shoulders where a living thing would be widest, widening toward the feet.
  ghoul: {
    widths: [0, 1, 2, 3, 4, 4, 3, 2],
    body: '#5c6b5c',
    accent: '#3a453a',
    accentPositions: [
      [2, 5],
      [5, 5],
    ],
    eye: '#c9e070',
    eyePositions: [
      [3, 2],
      [4, 2],
    ],
  },
  // Grey and thin like a wraith, but hollow where a wraith glows: the eyes
  // are the one thing on it darker than the rest.
  shade: {
    widths: [0, 2, 3, 3, 3, 3, 3, 3],
    body: '#6b6b76',
    eye: '#141414',
    eyePositions: [
      [2, 3],
      [5, 3],
    ],
  },
};

// ---------------------------------------------------------------------------
// Game over: a statue among the graves, under a thin moon.
// ---------------------------------------------------------------------------

export const DEFEAT_ART: ArtSpec = {
  rows: [
    '..............YY',
    '................',
    '................',
    '......SSSS......',
    '.....SSSSSS.....',
    '.....SAAAAS.....',
    '.....SSSSSS.....',
    '.....SSSSSS.....',
    '....SSSSSSSS....',
    '....SS....SS....',
    '....SS....SS....',
    '....SS....SS....',
    '................',
    '..HH........HH..',
    '.HHHH......HHHH.',
    'GGGGGGGGGGGGGGGG',
  ].map((r) => (r.length === 16 ? r : r.padEnd(16, '.').slice(0, 16))),
  palette: { S: '#9a9aa4', A: '#c7c7d1', Y: '#e8e6c9', H: '#6b6b7a', G: '#141420' },
};
