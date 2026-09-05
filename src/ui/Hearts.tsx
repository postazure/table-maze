import type { ReactElement } from 'react';
import { HEART } from '../engine/types';

/** 8x8 pixel heart; 'R' pixels are the fill, 'D' the dark outline. */
const HEART_ROWS = ['.DD..DD.', 'DRRDDRRD', 'DRRRRRRD', 'DRRRRRRD', '.DRRRRD.', '..DRRD..', '...DD...', '........'];

interface HeartProps {
  quarters: 0 | 1 | 2 | 3 | 4;
  size: number;
  dim: boolean;
  id: string;
  /** Fill colour, and the darker shade the empty part is drawn in. */
  fill: string;
  hollow: string;
}

function Heart({ quarters, size, dim, id, fill: fillColor, hollow }: HeartProps) {
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
      <g fill={hollow}>{empty}</g>
      <g fill={dim ? '#8f8ca8' : fillColor} clipPath={`url(#${clipId})`}>
        {fill}
      </g>
      <g fill="#1a0507">{outline}</g>
    </svg>
  );
}

/** The hero's own hearts: red, over a dark red hollow. */
const RED_FILL = '#e53b3b';
const RED_HOLLOW = '#3a0f12';
/** A ward shrine's temporary hearts: blue, so they never read as real ones. */
const WARD_FILL = '#5aa9ff';
const WARD_HOLLOW = '#12304f';

export interface HeartsProps {
  hp: number;
  maxHp: number;
  /** Grey hearts while the hero is knocked down. */
  dim?: boolean;
  size?: number;
  /** Ward shrine: temporary quarter hearts left, and what they started at. */
  tempHp?: number;
  tempHpMax?: number;
}

/**
 * Zelda-style heart row. One heart per 4 hp, filled in quarters.
 *
 * A ward shrine's temporary hearts hang off the end of the row in blue. They
 * are the ward's own timer: nothing counts down, they simply empty as hits
 * land, and the row is a heart shorter when they are gone.
 */
export function Hearts({ hp, maxHp, dim = false, size = 14, tempHp = 0, tempHpMax = 0 }: HeartsProps) {
  const total = Math.max(1, Math.ceil(maxHp / HEART));
  const units = Math.max(0, Math.min(maxHp, Math.round(hp)));
  const hearts: ReactElement[] = [];
  for (let i = 0; i < total; i++) {
    const q = Math.max(0, Math.min(4, units - i * HEART)) as 0 | 1 | 2 | 3 | 4;
    hearts.push(
      <Heart key={i} id={String(i)} quarters={q} size={size} dim={dim} fill={RED_FILL} hollow={RED_HOLLOW} />,
    );
  }
  const tempUnits = Math.max(0, Math.round(tempHp));
  const tempTotal = tempUnits > 0 ? Math.max(1, Math.ceil(Math.max(tempHpMax, tempUnits) / HEART)) : 0;
  for (let i = 0; i < tempTotal; i++) {
    const q = Math.max(0, Math.min(4, tempUnits - i * HEART)) as 0 | 1 | 2 | 3 | 4;
    hearts.push(
      <Heart key={`t${i}`} id={`t${i}`} quarters={q} size={size} dim={false} fill={WARD_FILL} hollow={WARD_HOLLOW} />,
    );
  }
  const label = tempUnits > 0
    ? `Health ${units} of ${maxHp} quarter hearts, plus ${tempUnits} temporary`
    : `Health ${units} of ${maxHp} quarter hearts`;
  return (
    <div className="hud-hearts" role="img" aria-label={label}>
      {hearts}
    </div>
  );
}
