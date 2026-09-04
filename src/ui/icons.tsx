/**
 * Tiny 8x8 pixel icons rendered as inline SVG so they stay crisp at any
 * size. Each icon is a list of rows; every character maps to a palette color
 * and '.' is transparent.
 */

import type { ReactElement } from 'react';

type Rows = readonly string[];
type Palette = Readonly<Record<string, string>>;

const ICONS: Record<IconName, { rows: Rows; palette: Palette }> = {
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
  doorKey: {
    rows: ['........', '.GGG....', 'G...G...', 'G..GGGGG', '.GGG...G', '......G.', '........', '........'],
    palette: { G: '#f5c451' },
  },
  chestKey: {
    rows: ['........', '.GGG....', 'G...G...', 'G..GGGGG', '.GGG...G', '......G.', '........', '........'],
    palette: { G: '#5aa9ff' },
  },
  skull: {
    rows: ['..WWWW..', '.WWWWWW.', 'WWEWWEWW', 'WWEWWEWW', 'WWWWWWWW', '.WWWWWW.', '..W.W.W.', '..WWWWW.'],
    palette: { W: '#f0ecff', E: '#141414' },
  },
};

export type IconName = 'sword' | 'shield' | 'coin' | 'doorKey' | 'chestKey' | 'skull';

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
