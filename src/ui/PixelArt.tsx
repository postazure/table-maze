/**
 * Generic inline-SVG renderer for an 8x8 (or NxM) pixel-art sprite: an array
 * of rows ('.' = transparent, any other char keys into `palette`). Shared by
 * ChestModal, ItemModal, and anywhere else that needs to draw a sprite that
 * isn't one of the named icons in icons.tsx (e.g. the chest or the shop
 * pedestal).
 */

import type { ReactElement } from 'react';

export interface PixelArtProps {
  rows: readonly string[];
  palette: Readonly<Record<string, string>>;
  size: number; // CSS px, square
  className?: string;
}

export function PixelArt({ rows, palette, size, className }: PixelArtProps) {
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
      className={className}
      width={size}
      height={size}
      viewBox={`0 0 ${w} ${h}`}
      shapeRendering="crispEdges"
      aria-hidden="true"
    >
      {rects}
    </svg>
  );
}
