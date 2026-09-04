import type { ReactElement } from 'react';
import { HEART } from '../engine/types';

/** 8x8 pixel heart; 'R' pixels are the fill, 'D' the dark outline. */
const HEART_ROWS = ['.DD..DD.', 'DRRDDRRD', 'DRRRRRRD', 'DRRRRRRD', '.DRRRRD.', '..DRRD..', '...DD...', '........'];

interface HeartProps {
  quarters: 0 | 1 | 2 | 3 | 4;
  size: number;
  dim: boolean;
  id: string;
}

function Heart({ quarters, size, dim, id }: HeartProps) {
  const outline: ReactElement[] = [];
  const empty: ReactElement[] = [];
  const fill: ReactElement[] = [];
  HEART_ROWS.forEach((row, y) => {
    for (let x = 0; x < row.length; x++) {
      const c = row[x];
      if (c === 'D') outline.push(<rect key={`o${x}-${y}`} x={x} y={y} width={1} height={1} />);
      else if (c === 'R') {
        empty.push(<rect key={`e${x}-${y}`} x={x} y={y} width={1} height={1} />);
        fill.push(<rect key={`f${x}-${y}`} x={x} y={y} width={1} height={1} />);
      }
    }
  });
  // Fill from the left: each quarter is two pixel columns of the 8-wide heart.
  const clipId = `heart-clip-${id}`;
  return (
    <svg className="hud-heart" width={size} height={size} viewBox="0 0 8 8" shapeRendering="crispEdges" aria-hidden="true">
      <defs>
        <clipPath id={clipId}>
          <rect x={0} y={0} width={quarters * 2} height={8} />
        </clipPath>
      </defs>
      <g fill="#3a0f12">{empty}</g>
      <g fill={dim ? '#8f8ca8' : '#e53b3b'} clipPath={`url(#${clipId})`}>
        {fill}
      </g>
      <g fill="#1a0507">{outline}</g>
    </svg>
  );
}

export interface HeartsProps {
  hp: number;
  maxHp: number;
  /** Grey hearts while the hero is knocked down. */
  dim?: boolean;
  size?: number;
}

/** Zelda-style heart row. One heart per 4 hp, filled in quarters. */
export function Hearts({ hp, maxHp, dim = false, size = 14 }: HeartsProps) {
  const total = Math.max(1, Math.ceil(maxHp / HEART));
  const units = Math.max(0, Math.min(maxHp, Math.round(hp)));
  const hearts: ReactElement[] = [];
  for (let i = 0; i < total; i++) {
    const q = Math.max(0, Math.min(4, units - i * HEART)) as 0 | 1 | 2 | 3 | 4;
    hearts.push(<Heart key={i} id={String(i)} quarters={q} size={size} dim={dim} />);
  }
  return (
    <div className="hud-hearts" role="img" aria-label={`Health ${units} of ${maxHp} quarter hearts`}>
      {hearts}
    </div>
  );
}
