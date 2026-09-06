import { useEffect, useState } from 'react';
import { LENS_NAME } from '../engine/lens';
import { PixelIcon } from './icons';

/** The lens holds still for a beat, then breaks. */
const CRACK_MS = 550;
/** ...and the shards have finished falling by here, when the stairs carry on. */
const DONE_MS = 1900;

/** The shards, as fractions of the way across and down, plus a spin each. */
const SHARDS = [
  { x: -32, y: -18, spin: -140 },
  { x: 26, y: -26, spin: 120 },
  { x: -20, y: 22, spin: 95 },
  { x: 34, y: 14, spin: -80 },
  { x: 4, y: 34, spin: 200 },
  { x: -40, y: 4, spin: -35 },
];

export interface LensShatterModalProps {
  onClose: () => void;
}

/**
 * The lens breaking on the way out of the shop.
 *
 * The hero is already standing on the stairs and the world is frozen behind
 * this: nothing here is a decision, so there is no button. It cracks, it falls
 * apart, and the game carries on by itself — the only popup in the game that
 * closes on its own, because it is the only one that is telling you something
 * has already happened rather than asking you what to do about it.
 */
export function LensShatterModal({ onClose }: LensShatterModalProps) {
  const [broken, setBroken] = useState(false);

  useEffect(() => {
    const crack = window.setTimeout(() => setBroken(true), CRACK_MS);
    const done = window.setTimeout(onClose, DONE_MS);
    return () => {
      window.clearTimeout(crack);
      window.clearTimeout(done);
    };
  }, [onClose]);

  return (
    <div className="modal-backdrop lens-backdrop" role="dialog" aria-label={`The ${LENS_NAME} shattered`}>
      <div className="lens-modal">
        <div className={`lens-stage${broken ? ' lens-broken' : ''}`}>
          <div className="lens-flash" />
          <div className="lens-glass">
            <PixelIcon name="lens" size={96} />
          </div>
          {SHARDS.map((shard, i) => (
            <span
              key={i}
              className="lens-shard"
              style={
                {
                  '--shard-x': `${shard.x}px`,
                  '--shard-y': `${shard.y}px`,
                  '--shard-spin': `${shard.spin}deg`,
                  '--shard-delay': `${i * 40}ms`,
                } as React.CSSProperties
              }
            />
          ))}
        </div>
        <span className="lens-caption">The {LENS_NAME} shattered</span>
      </div>
    </div>
  );
}
