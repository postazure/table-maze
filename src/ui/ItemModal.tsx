import { useEffect, useState } from 'react';
import type { MagicItem } from '../engine/types';
import { ITEM_SLOT } from '../engine/types';
import { PEDESTAL_ART } from '../render/itemArt';
import { PixelIcon } from './icons';
import { PixelArt } from './PixelArt';

export interface ItemModalProps {
  item: MagicItem;
  /** The item pushed out of the slot, if any. */
  replaced: MagicItem | null;
  onClose: () => void;
}

/**
 * Wordless "you bought a magic item" popup: the item icon rises with
 * sparkles above a stone pedestal. If it replaced something, the old item
 * shows small and crossed out with an arrow pointing at the new one. Tap
 * anywhere to continue. Same modal-backdrop/modal-ready mechanics as
 * ChestModal.
 */
export function ItemModal({ item, replaced, onClose }: ItemModalProps) {
  const [risen, setRisen] = useState(false);
  const [ready, setReady] = useState(false);
  const slot = ITEM_SLOT[item.kind];

  useEffect(() => {
    const rise = window.setTimeout(() => setRisen(true), 400);
    const done = window.setTimeout(() => setReady(true), 1200);
    return () => {
      window.clearTimeout(rise);
      window.clearTimeout(done);
    };
  }, []);

  const close = () => {
    if (ready) onClose();
  };

  return (
    <div className={`modal-backdrop${ready ? ' modal-ready' : ''}`} onPointerDown={close} role="dialog" aria-label="Item bought">
      <div className="item-modal">
        <div className={`item-stage${risen ? ' item-risen' : ''}`}>
          <div className="item-glow" />
          <div className="item-prize">
            <PixelIcon name={item.kind} size={64} />
            <span className="item-slot-badge">
              <PixelIcon name={slot} size={14} />
            </span>
            <span className="item-level-badge">Lv {item.level}</span>
          </div>
          <PixelArt rows={PEDESTAL_ART.rows} palette={PEDESTAL_ART.palette} size={72} className="item-pedestal" />
          <span className="item-spark item-spark-a" />
          <span className="item-spark item-spark-b" />
          <span className="item-spark item-spark-c" />
        </div>
        {replaced && (
          <div className="item-replaced">
            <span className="item-replaced-old">
              <PixelIcon name={replaced.kind} size={28} />
            </span>
            <span className="item-replaced-arrow" aria-hidden="true" />
            <PixelIcon name={item.kind} size={28} />
          </div>
        )}
        <div className="item-tap" aria-hidden="true">
          <span className="item-tap-dot" />
        </div>
      </div>
    </div>
  );
}
