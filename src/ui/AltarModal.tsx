import type { BoonKind, BossKind } from '../engine/types';
import { BOON_RUNS, boonDescription, boonName, trophyName } from '../engine/boons';
import { PixelIcon } from './icons';

export interface AltarModalProps {
  trophy: BossKind;
  boon: BoonKind;
  onOffer: () => void;
  onClose: () => void;
}

/**
 * Standing at an altar with the trophy it is carved for. The altar names
 * what it gives and for how long; the trophy is the hero's to keep or lay
 * down. Green lays it down, red walks away.
 */
export function AltarModal({ trophy, boon, onOffer, onClose }: AltarModalProps) {
  return (
    <div className="modal-backdrop modal-ready shop-backdrop" role="dialog" aria-label="An altar">
      <div className="shop-modal">
        <div className="shop-head">
          <span className="shop-slot">
            <PixelIcon name={trophy} size={14} />
            Altar
          </span>
          <span className="shop-head-hint">It wants what you carry</span>
        </div>

        <div className="shop-body">
          <div className="shop-item">
            <div className="shop-item-icon">
              <PixelIcon name={boon} size={56} />
            </div>
            <div className="shop-item-text">
              <div className="shop-item-name">{boonName(boon)}</div>
              <div className="shop-item-level">{BOON_RUNS} runs</div>
            </div>
          </div>

          <p className="shop-desc">{boonDescription(boon)}</p>
          <p className="shop-desc">
            It holds for this run and the next {BOON_RUNS - 1}, then breaks. The altar takes the {trophyName(trophy)} for it.
          </p>

          <div className="shop-swap">
            <span className="shop-swap-label">Costs</span>
            <PixelIcon name={trophy} size={16} />
            <span className="shop-swap-name">{trophyName(trophy)}</span>
          </div>
        </div>

        <div className="shop-actions">
          <button type="button" className="shop-btn shop-btn-buy" onClick={onOffer} aria-label={`Offer the ${trophyName(trophy)}`}>
            <span className="shop-btn-label">Offer it</span>
          </button>
          <button type="button" className="shop-btn shop-btn-exit shop-btn-wide" onClick={onClose} aria-label="Keep the trophy">
            Keep it
          </button>
        </div>
      </div>
    </div>
  );
}
