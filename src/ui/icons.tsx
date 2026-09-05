/**
 * Tiny 8x8 pixel icons rendered as inline SVG so they stay crisp at any
 * size. Each icon is a list of rows; every character maps to a palette color
 * and '.' is transparent.
 */

import type { ReactElement } from 'react';
import type { ItemKind, ItemSlot, ShrineKind } from '../engine/types';
import { ITEM_KINDS, SHRINE_KINDS } from '../engine/types';
import { ITEM_ART, SHRINE_ART, SLOT_ART } from '../render/itemArt';

type Rows = readonly string[];
type Palette = Readonly<Record<string, string>>;

type BaseIconName =
  | 'sword'
  | 'shield'
  | 'coin'
  | 'doorKey'
  | 'chestKey'
  | 'skull'
  | 'heart'
  | 'potion'
  | 'sound'
  | 'soundOff';
/**
 * Every magic item kind, gear slot and shrine kind is also a valid icon name,
 * drawn from itemArt.ts — so the HUD, the help screen and the map all show the
 * same picture for the same thing.
 */
export type IconName = BaseIconName | ItemKind | ItemSlot | ShrineKind;

const ITEM_SLOTS: readonly ItemSlot[] = ['offense', 'defense', 'spirit'];

const BASE_ICONS: Record<BaseIconName, { rows: Rows; palette: Palette }> = {
  sword: {
    rows: ['......SS', '.....SSS', '....SSS.', '...SSS..', 'B.SSS...', '.BBS....', '.HBB....', 'HH.B....'],
    palette: { S: '#d8d8e8', B: '#8a6a2a', H: '#f5c451' },
  },
  shield: {
    rows: ['.AAAAAA.', 'AAGAAGAA', 'AAAGGAAA', 'AAAGGAAA', '.AAGGAA.', '.AAAAAA.', '..AAAA..', '...AA...'],
    palette: { A: '#6b7a99', G: '#f5c451' },
  },
  coin: {
    rows: ['..GGGG..', '.GGYYGG.', 'GGYGGYGG', 'GGYGGGGG', 'GGYGGGGG', 'GGYGGYGG', '.GGYYGG.', '..GGGG..'],
    palette: { G: '#f5c451', Y: '#8a6a2a' },
  },
  // Magic key: bold 16x16 bow-and-shaft silhouette, purple/magenta, with the
  // ring (bow) itself shaped into a watching eye — matches the eye doors it
  // opens. Same rows/palette as the map sprite in renderer.ts
  // (DOOR_KEY_ROWS) so the HUD icon matches the map exactly.
  doorKey: {
    rows: [
      '................',
      '................',
      '......DDDD......',
      '.....DWHTHD.....',
      '....DWHHHHHD....',
      '...DHHDDDDHHD...',
      '...DHHDDDDHHD...',
      '...DHHDDDDHHD...',
      '...DHHDDDDHHD...',
      '....DPPPPPPD....',
      '.....DPPPPD.....',
      '......DPPDDDDD..',
      '......DPPPPPPPD.',
      '......DPPDDDPPD.',
      '......DPPD..DD..',
      '.......DD.......',
    ],
    palette: { P: '#b56cff', D: '#5a2596', H: '#ff5c8a', T: '#ffd0dc', W: '#ffffff' },
  },
  // Plain gold classic key (opens chests) — same 16x16 bow/shaft/teeth
  // skeleton as the door key, no horns. Same rows/palette as the map sprite
  // in renderer.ts (CHEST_KEY_ROWS).
  chestKey: {
    rows: [
      '................',
      '................',
      '......DDDD......',
      '.....DWPPPD.....',
      '....DWPPPPPD....',
      '...DPPDDDDPPD...',
      '...DPPD..DPPD...',
      '...DPPD..DPPD...',
      '...DPPDDDDPPD...',
      '....DPPPPPPD....',
      '.....DPPPPD.....',
      '......DPPDDDDD..',
      '......DPPPPPPPD.',
      '......DPPDDDPPD.',
      '......DPPD..DD..',
      '.......DD.......',
    ],
    palette: { P: '#f5c451', D: '#8a5a10', W: '#ffffff' },
  },
  heart: {
    rows: ['.DD..DD.', 'DRRDDRRD', 'DRRRRRRD', 'DRRRRRRD', '.DRRRRD.', '..DRRD..', '...DD...', '........'],
    palette: { R: '#e53b3b', D: '#1a0507' },
  },
  // A small golden flask: narrow neck, round body, one highlight pixel.
  potion: {
    rows: ['...DD...', '...DD...', '..DDDD..', '.DGGGGD.', 'DGGGGGGD', 'DGWGGGGD', '.DGGGGD.', '..DDDD..'],
    palette: { D: '#8a5a10', G: '#f5c451', W: '#fff6d0' },
  },
  skull: {
    rows: ['..WWWW..', '.WWWWWW.', 'WWEWWEWW', 'WWEWWEWW', 'WWWWWWWW', '.WWWWWW.', '..W.W.W.', '..WWWWW.'],
    palette: { W: '#f0ecff', E: '#141414' },
  },
  // A speaker cone with two sound waves coming off it (sound on)...
  sound: {
    rows: ['....S...', '...SS...', '..SSS.W.', 'SSSSS.WW', 'SSSSS.WW', '..SSS.W.', '...SS...', '....S...'],
    palette: { S: '#f5c451', W: '#f5c451' },
  },
  // ...and the same cone, greyed out, with a red cross where the waves were.
  soundOff: {
    rows: ['....S...', '...SS...', '..SSSX.X', 'SSSSS.X.', 'SSSSS.X.', '..SSSX.X', '...SS...', '....S...'],
    palette: { S: '#7d7a91', X: '#e53b3b' },
  },
};

/** BASE_ICONS plus every ItemKind, ItemSlot and ShrineKind from itemArt.ts. */
const ICONS = { ...BASE_ICONS } as Record<IconName, { rows: Rows; palette: Palette }>;
for (const kind of ITEM_KINDS) ICONS[kind] = ITEM_ART[kind];
for (const slot of ITEM_SLOTS) ICONS[slot] = SLOT_ART[slot];
for (const kind of SHRINE_KINDS) ICONS[kind] = SHRINE_ART[kind];

export interface PixelIconProps {
  name: IconName;
  size?: number; // CSS px
  title?: string;
}

export function PixelIcon({ name, size = 16, title }: PixelIconProps) {
  const { rows, palette } = ICONS[name];
  const w = rows[0]?.length ?? 0;
  const h = rows.length;
  const rects: ReactElement[] = [];
  rows.forEach((row, y) => {
    for (let x = 0; x < row.length; x++) {
      const c = row[x];
      if (c === '.') continue;
      const fill = palette[c];
      if (!fill) continue;
      rects.push(<rect key={`${x}-${y}`} x={x} y={y} width={1} height={1} fill={fill} />);
    }
  });
  return (
    <svg
      className="pixel-icon"
      width={size}
      height={size}
      viewBox={`0 0 ${w} ${h}`}
      shapeRendering="crispEdges"
      role={title ? 'img' : 'presentation'}
      aria-label={title}
    >
      {rects}
    </svg>
  );
}
