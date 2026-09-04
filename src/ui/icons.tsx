/**
 * Tiny 8x8 pixel icons rendered as inline SVG so they stay crisp at any
 * size. Each icon is a list of rows; every character maps to a palette color
 * and '.' is transparent.
 */

import type { ReactElement } from 'react';
import type { ItemKind, ItemSlot } from '../engine/types';
import { ITEM_KINDS } from '../engine/types';
import { ITEM_ART, SLOT_ART } from '../render/itemArt';

type Rows = readonly string[];
type Palette = Readonly<Record<string, string>>;

type BaseIconName = 'sword' | 'shield' | 'coin' | 'doorKey' | 'chestKey' | 'skull' | 'heart';
/** Every magic item kind and every gear slot are also valid icon names, drawn from itemArt.ts. */
export type IconName = BaseIconName | ItemKind | ItemSlot;

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
  // Magic key: purple/magenta with two tiny devil horns off the bow — matches
  // the horned doors it opens. Same rows/palette as the map sprite in
  // renderer.ts (DOOR_KEY_ROWS) so the HUD icon matches the map exactly.
  doorKey: {
    rows: ['.H.H....', '.WPP....', 'P...P...', 'P..PPPPP', '.PPP...D', '......D.', '........', '........'],
    palette: { P: '#b56cff', D: '#6d2fb0', H: '#ff5c8a', W: '#ffffff' },
  },
  // Plain gold classic key (opens chests). Same rows/palette as the map
  // sprite in renderer.ts (CHEST_KEY_ROWS).
  chestKey: {
    rows: ['........', '.GGG....', 'G...G...', 'G..GGGGG', '.GGD...D', '......D.', '........', '........'],
    palette: { G: '#f5c451', D: '#c9931e' },
  },
  heart: {
    rows: ['.DD..DD.', 'DRRDDRRD', 'DRRRRRRD', 'DRRRRRRD', '.DRRRRD.', '..DRRD..', '...DD...', '........'],
    palette: { R: '#e53b3b', D: '#1a0507' },
  },
  skull: {
    rows: ['..WWWW..', '.WWWWWW.', 'WWEWWEWW', 'WWEWWEWW', 'WWWWWWWW', '.WWWWWW.', '..W.W.W.', '..WWWWW.'],
    palette: { W: '#f0ecff', E: '#141414' },
  },
};

/** BASE_ICONS plus every ItemKind (from ITEM_ART) and ItemSlot (from SLOT_ART). */
const ICONS = { ...BASE_ICONS } as Record<IconName, { rows: Rows; palette: Palette }>;
for (const kind of ITEM_KINDS) ICONS[kind] = ITEM_ART[kind];
for (const slot of ITEM_SLOTS) ICONS[slot] = SLOT_ART[slot];

export interface PixelIconProps {
  name: IconName;
  size?: number; // CSS px
  title?: string;
}

export function PixelIcon({ name, size = 16, title }: PixelIconProps) {
  const { rows, palette } = ICONS[name];
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
      viewBox="0 0 8 8"
      shapeRendering="crispEdges"
      role={title ? 'img' : 'presentation'}
      aria-label={title}
    >
      {rects}
    </svg>
  );
}
