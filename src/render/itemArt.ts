/**
 * Shared 8x8 pixel art for magic items, slot glyphs, and the shop pedestal.
 * Consumed by the canvas renderer (via `buildIcon`) and by the DOM/React UI
 * (via `artToSvgRects`, or a hand-rolled SVG loop like icons.tsx uses).
 *
 * Same convention as the renderer's other hand-authored sprites: an array of
 * 8-character rows, '.' = transparent, every other char is a key into
 * `palette` (char -> hex color).
 */

import type { ItemKind, ItemSlot, ShrineKind } from '../engine/types';
import { ITEM_KINDS } from '../engine/types';

export interface ArtSpec {
  rows: string[];
  palette: Record<string, string>;
}

// ---------------------------------------------------------------------------
// Item icons — one distinct silhouette + 2-3 colors per kind.
// ---------------------------------------------------------------------------

export const ITEM_ART: Record<ItemKind, ArtSpec> = {
  // offense ------------------------------------------------------------
  longSword: {
    // long diagonal blade corner-to-corner, gold hilt
    rows: ['.......S', '......S.', '.....S..', '....S...', '...S....', '..S.....', '.GG.....', 'GG......'],
    palette: { S: '#d8d8e8', G: '#f5c451' },
  },
  fireStaff: {
    // staff with an orange flame on top
    rows: ['..OY....', '.OOOO...', '..OY....', '...B....', '...B....', '...B....', '...B....', '..BBB...'],
    palette: { O: '#ff6a2d', Y: '#ffcf5c', B: '#8b5a2b' },
  },
  lightningWand: {
    // short rod with a light-blue zigzag bolt
    rows: ['....L...', '...LL...', '..LL....', '...L....', '..W.....', '.W......', '.W......', 'BB......'],
    palette: { L: '#8fd8ff', W: '#c9c9d8', B: '#5a3a1c' },
  },
  poisonDagger: {
    // short blade, brown hilt, green drip
    rows: ['....S...', '...SS...', '...SS...', '..SSP...', '..HH....', '...H....', '...P....', '....P...'],
    palette: { S: '#d8d8e8', P: '#3aa15a', H: '#5a3a1c' },
  },
  frostBlade: {
    // ice-blue blade with a crystal glint
    rows: ['.....W..', '....II..', '...III..', '..III...', '.III....', 'HH......', '.H......', '........'],
    palette: { I: '#7fd3ff', W: '#e8f8ff', H: '#8f8ca8' },
  },
  berserkerAxe: {
    // red double-bladed axe head, brown handle
    rows: ['RD....DR', 'RRR..RRR', '.RR..RR.', '..RRRR..', '...HH...', '...HH...', '...HH...', '...HH...'],
    palette: { R: '#c9302c', D: '#7a1f1c', H: '#6b4423' },
  },
  // defense ------------------------------------------------------------
  shieldAmulet: {
    // blue gem set in a ring
    rows: ['..AAAA..', '.A....A.', 'A..GG..A', 'A.GGGG.A', 'A.GGGG.A', 'A..GG..A', '.A....A.', '..AAAA..'],
    palette: { A: '#6b7a99', G: '#3a8fe0' },
  },
  speedBoots: {
    // brown boot with motion streaks
    rows: ['M.......', '.M......', '..BB....', '..BB....', '..BBB...', '.BBBBB..', 'SSSSSSS.', '........'],
    palette: { B: '#8b5a2b', S: '#3a2b1f', M: '#e8e6f0' },
  },
  thornMail: {
    // grey chest plate with dark spikes
    rows: ['.K.K.K..', 'PPPPPPP.', 'PPPPPPP.', 'PHPPHPP.', 'PPPPPPP.', 'PPPPPPP.', '.PPPPP..', '........'],
    palette: { P: '#8f8ca8', K: '#3a3852', H: '#c9c9d8' },
  },
  phoenixFeather: {
    // orange/red feather, white quill
    rows: ['...O....', '..OOO...', '.ORROR..', '.ORRRO..', '..ORRO..', '...RO...', '....W...', '....W...'],
    palette: { O: '#ff8a3d', R: '#e5484d', W: '#e8e6f0' },
  },
  regenRing: {
    // green ring with a white cross
    rows: ['..GGGG..', '.G....G.', 'G..CC..G', 'G..CC..G', 'G.CCCC.G', 'G..CC..G', '.G....G.', '..GGGG..'],
    palette: { G: '#3aa15a', C: '#e8e6f0' },
  },
  stoneRing: {
    // plain grey ring
    rows: ['..SSSS..', '.S....S.', 'S.H..H.S', 'S......S', 'S......S', 'S.H..H.S', '.S....S.', '..SSSS..'],
    palette: { S: '#6b6b7a', H: '#9a97ad' },
  },
  // spirit ---------------------------------------------------------------
  goldCharm: {
    // gold coin charm on a chain
    rows: ['..C.....', '..C.....', '.CC.....', '.GGGG...', 'GGYYGG..', 'GGGGGG..', '.GGGG...', '........'],
    palette: { C: '#8f8ca8', G: '#f5c451', Y: '#8a6a2a' },
  },
  xpTome: {
    // purple book, gold pages
    rows: ['PPPPPPP.', 'PYYYYYP.', 'PYPPPYP.', 'PYPPPYP.', 'PYYYYYP.', 'PPPPPPP.', 'DDDDDDD.', '........'],
    palette: { P: '#7b6cff', Y: '#f5c451', D: '#4a3d99' },
  },
  lifeAmulet: {
    // red heart gem pendant on a chain
    rows: ['...C....', '...C....', '.DD.DD..', 'DRRDDRRD', 'DRRRRRRD', '.DRRRRD.', '..DRRD..', '...DD...'],
    palette: { C: '#8f8ca8', D: '#1a0507', R: '#e53b3b' },
  },
  keyCompass: {
    // compass ring, gold needle, red tip
    rows: ['..BBBB..', '.B....B.', 'B..N...B', 'B.NNNN.B', 'B.C....B', 'B......B', '.B....B.', '..BBBB..'],
    palette: { B: '#8f8ca8', N: '#f5c451', C: '#e53b3b' },
  },
  vampireFang: {
    // two white fangs, red tips
    rows: ['..W..W..', '..W..W..', '..W..W..', '..R..R..', '..R..R..', '........', '........', '........'],
    palette: { W: '#e8e6f0', R: '#e53b3b' },
  },
  baneTotem: {
    // purple totem with a yellow eye
    rows: ['..TTTT..', '.TTTTTT.', 'TTEEEETT', 'TT.EE.TT', '.TTTTTT.', '..TTTT..', '..DDDD..', '..DDDD..'],
    palette: { T: '#7b5cc9', E: '#f5c451', D: '#3a2b5c' },
  },
};

// Sanity: every ItemKind in the contract must have art (helps catch typos
// if ITEM_KINDS grows before this file is updated).
for (const k of ITEM_KINDS) {
  if (!ITEM_ART[k]) throw new Error(`itemArt: missing ITEM_ART entry for "${k}"`);
}

// ---------------------------------------------------------------------------
// Slot glyphs — small, single-purpose icons: offense = sword, defense =
// shield, spirit = star.
// ---------------------------------------------------------------------------

export const SLOT_ART: Record<ItemSlot, ArtSpec> = {
  offense: {
    rows: ['......S.', '.....S..', '....S...', '...S....', '..H.....', '.H......', 'H.......', '........'],
    palette: { S: '#d8d8e8', H: '#f5c451' },
  },
  defense: {
    rows: ['.SSSS...', 'SSGSSS..', 'SSGSSS..', '.SSSS...', '..SS....', '..SS....', '........', '........'],
    palette: { S: '#6b7a99', G: '#f5c451' },
  },
  spirit: {
    rows: ['...S....', '...S....', 'SSSSSSS.', '.SSSSS..', '..S.S...', '.S...S..', 'S.....S.', '........'],
    palette: { S: '#f5c451' },
  },
};

// ---------------------------------------------------------------------------
// Shrine glyphs — one per shrine kind, in that shrine's own colour (see
// SHRINE_COLORS in engine/shrines.ts). The same glyph is used three times
// over: sunk into the alcove on the map, as the timer pip over the hero's
// head, and in the HUD row under the hearts. Learn it once, read it anywhere.
// ---------------------------------------------------------------------------

export const SHRINE_ART: Record<ShrineKind, ArtSpec> = {
  // Temporary hearts: the HUD heart, in ward blue.
  ward: {
    rows: ['.BB..BB.', 'BWWBBWWB', 'BWWWWWWB', 'BWWWWWWB', '.BWWWWB.', '..BWWB..', '...BB...', '........'],
    palette: { W: '#5aa9ff', B: '#1b3f6b' },
  },
  // More attack: an arrow pointing up.
  fury: {
    rows: ['...RR...', '..RRRR..', '.RRRRRR.', 'RRRRRRRR', '...RR...', '...RR...', '...DD...', '...DD...'],
    palette: { R: '#ff5c5c', D: '#8a2a2a' },
  },
  // More defense: a plain stone shield, pale enough to read off a stone wall.
  stone: {
    rows: ['.SSSSSS.', 'SDDDDDDS', 'SDSSSSDS', 'SDSSSSDS', 'SDSSSSDS', '.SDDDDS.', '..SDDS..', '...SS...'],
    palette: { S: '#e4eaf6', D: '#7a86a0' },
  },
  // Ice balls: a snowflake.
  frost: {
    rows: ['...I....', 'I..I..I.', '.I.I.I..', '..III...', 'IIIIIII.', '..III...', '.I.I.I..', 'I..I..I.'],
    palette: { I: '#bfe3ff' },
  },
  // Fast healing: the green cross the regen ring already uses, filled in.
  mend: {
    rows: ['..GGGG..', '..GWWG..', 'GGGWWGGG', 'GWWWWWWG', 'GWWWWWWG', 'GGGWWGGG', '..GWWG..', '..GGGG..'],
    palette: { G: '#2f7a45', W: '#8fd694' },
  },
  // Monsters crawling: an hourglass.
  time: {
    rows: ['PPPPPPPP', '.PWWWWP.', '..PWWP..', '...PP...', '...PP...', '..PWWP..', '.PWWWWP.', 'PPPPPPPP'],
    palette: { P: '#b98cff', W: '#e8d9ff' },
  },
};

/**
 * The alcove a shrine sits in, as it stands on the map: 16x16, i.e. one
 * sub-pixel per pixel of a single tile. An arch of stone around a dark niche
 * the renderer paints the shrine's glyph into. It is drawn ON a floor tile
 * the hero can walk over — an alcove never blocks anything.
 */
export const ALCOVE_ART: ArtSpec = {
  rows: [
    '................',
    '.....PPPPPP.....',
    '....PLNNNNLP....',
    '...PLNNNNNNLP...',
    '...PLNNNNNNLP...',
    '..PLNNNNNNNNLP..',
    '..PLNNNNNNNNLP..',
    '..PLNNNNNNNNLP..',
    '..PLNNNNNNNNLP..',
    '..PLNNNNNNNNLP..',
    '..PLNNNNNNNNLP..',
    '..PLNNNNNNNNLP..',
    '..PLNNNNNNNNLP..',
    '..PDDDDDDDDDDP..',
    '..PPPPPPPPPPPP..',
    '..DDDDDDDDDDDD..',
  ],
  palette: { P: '#6b6b7a', L: '#9a97ad', D: '#3f3f4d', N: '#16162a' },
};

// ---------------------------------------------------------------------------
// The Cracked Lens — the one thing in the game that is not a stat.
// ---------------------------------------------------------------------------

/**
 * A round glass lens in a bright rim, with a gold tab to hold it by, and a
 * hairline fracture running across it. Pale and cold on purpose: it belongs
 * with the light it throws, not with the gold of the keys and chests it turns
 * up beside.
 *
 * The crack is the whole name, and it is doing a job: nobody should be
 * surprised when the thing finally comes apart on the stairs out of the shop.
 */
export const LENS_ART: ArtSpec = {
  rows: [
    '..RRRR..',
    '.RGGGGR.',
    'RGWWGGCR',
    'RGWGGGCR',
    'RGGGGCGR',
    'RGGGCGGR',
    '.RGCGGR.',
    '..RRHH..',
  ],
  // The crack runs rim to rim in a steady diagonal down the right of the
  // glass, and the glint sits in the far corner from it with two or three dark
  // pixels between them the whole way. That gap is the whole trick: bring the
  // two any closer and at popup size the eye joins them into one squiggle
  // rather than reading a fracture and a highlight.
  palette: { R: '#8fe3ff', G: '#2f6f8f', W: '#eafcff', C: '#cfefff', H: '#f5c451' },
};

/** Where the shrine glyph goes inside `ALCOVE_ART`, as fractions of the tile. */
export const ALCOVE_NICHE = { x: 4 / 16, y: 4 / 16, size: 8 / 16 };

// ---------------------------------------------------------------------------
// Shop pedestal — a stone column an item icon is drawn hovering above.
// ---------------------------------------------------------------------------

/** Small 8x8 column, used by the purchase popup. */
export const PEDESTAL_ART: ArtSpec = {
  rows: ['PPPPPPPP', 'LLLLLLLL', '.PPPPPP.', '..PPPP..', '..PPPP..', '..PPPP..', '.PPPPPP.', 'PPPPPPPP'],
  palette: { P: '#6b6b7a', L: '#9a97ad' },
};

/**
 * The podium as it stands on the map: 16x16, i.e. one sub-pixel per pixel of
 * a 2x2 tile block. The middle is a sunken 8x8 niche (rows 4-11, columns
 * 4-11) the renderer paints the slot emblem into, so every podium says
 * "offense", "defense" or "spirit" without a word on it.
 */
export const PODIUM_ART: ArtSpec = {
  rows: [
    '................',
    '..LLLLLLLLLLLL..',
    '..PPPPPPPPPPPP..',
    '..DDDDDDDDDDDD..',
    '...PNNNNNNNNP...',
    '...PNNNNNNNNP...',
    '...PNNNNNNNNP...',
    '...PNNNNNNNNP...',
    '...PNNNNNNNNP...',
    '...PNNNNNNNNP...',
    '...PNNNNNNNNP...',
    '...PNNNNNNNNP...',
    '..LLLLLLLLLLLL..',
    '..PPPPPPPPPPPP..',
    '..DDDDDDDDDDDD..',
    '................',
  ],
  palette: { P: '#6b6b7a', L: '#9a97ad', D: '#3f3f4d', N: '#26263a' },
};

/**
 * Where the slot emblem goes inside `PODIUM_ART`, as fractions of the 2x2
 * block: the niche is the middle 8 of 16 sub-pixels each way.
 */
export const PODIUM_NICHE = { x: 4 / 16, y: 4 / 16, size: 8 / 16 };

// ---------------------------------------------------------------------------
// DOM helper: turn an ArtSpec into a flat list of unit rects a React/SVG
// component can render (see src/ui/PixelArt.tsx).
// ---------------------------------------------------------------------------

export interface PixelRect {
  x: number;
  y: number;
  fill: string;
}

export function artToSvgRects(art: ArtSpec): PixelRect[] {
  const rects: PixelRect[] = [];
  for (let y = 0; y < art.rows.length; y++) {
    const row = art.rows[y];
    for (let x = 0; x < row.length; x++) {
      const ch = row[x];
      if (ch === '.' || ch === undefined) continue;
      const fill = art.palette[ch];
      if (!fill) continue;
      rects.push({ x, y, fill });
    }
  }
  return rects;
}
