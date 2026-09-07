import type { BossKind } from '../engine/types';
import { trophyName } from '../engine/boons';
import { crystalName } from '../engine/crafting';
import { PixelIcon, crystalIcon } from './icons';

export interface CarveModalProps {
  trophies: BossKind[];
  onCarve: (boss: BossKind) => void;
  onClose: () => void;
}

/**
 * The carving shrine: every trophy still in the pack, one row each, "Carve"
 * turning it into that boss's crystal. Two trophies of the same boss are two
 * rows — carving one leaves the other exactly where it was.
 */
export function CarveModal({ trophies, onCarve, onClose }: CarveModalProps) {
  return (
    <div className="modal-backdrop modal-ready shop-backdrop" role="dialog" aria-label="A carving shrine">
      <div className="shop-modal">
        <div className="shop-head">
          <span className="shop-slot">
            <PixelIcon name="skull" size={14} />
            Carving shrine
          </span>
          <span className="shop-head-hint">One trophy, one crystal</span>
        </div>

        <div className="shop-body">
          <p className="shop-desc">Cut a trophy into a crystal. Crystals outlive the run; the trophy does not.</p>
          {trophies.map((boss, i) => (
            <button
              key={`${boss}-${i}`}
              type="button"
              className="shop-btn forge-row"
              onClick={() => onCarve(boss)}
              aria-label={`Carve the ${trophyName(boss)} into a ${crystalName(boss)}`}
            >
              <span className="forge-row-icon">
                <PixelIcon name={boss} size={28} />
              </span>
              <span className="forge-row-text">
                <span className="forge-row-name">{trophyName(boss)}</span>
                <span className="forge-row-levels">
                  <span className="item-replaced-arrow" aria-hidden="true" />
                  <PixelIcon name={crystalIcon(boss)} size={14} /> {crystalName(boss)}
                </span>
              </span>
              <span className="shop-price">Carve</span>
            </button>
          ))}
        </div>

        <div className="shop-actions">
          <button type="button" className="shop-btn shop-btn-exit shop-btn-wide" onClick={onClose} aria-label="Leave the trophies as they are">
            Leave
          </button>
        </div>
      </div>
    </div>
  );
}
