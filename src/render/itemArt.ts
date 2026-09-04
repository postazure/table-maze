/**
 * Shared 8x8 pixel art for magic items, slot glyphs, and the shop pedestal.
 * Consumed by the canvas renderer (via `buildIcon`) and by the DOM/React UI
 * (via `artToSvgRects`, or a hand-rolled SVG loop like icons.tsx uses).
 *
 * Same convention as the renderer's other hand-authored sprites: an array of
 * 8-character rows, '.' = transparent, every other char is a key into
 * `palette` (char -> hex color).
 */

import type { ItemKind, ItemSlot } from '../engine/types';
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
// Shop pedestal — a stone column an item icon is drawn hovering above.
// ---------------------------------------------------------------------------

export const PEDESTAL_ART: ArtSpec = {
  rows: ['PPPPPPPP', 'LLLLLLLL', '.PPPPPP.', '..PPPP..', '..PPPP..', '..PPPP..', '.PPPPPP.', 'PPPPPPPP'],
  palette: { P: '#6b6b7a', L: '#9a97ad' },
};

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
