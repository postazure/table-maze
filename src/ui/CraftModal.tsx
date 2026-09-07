import { BRASS_DESCRIPTION, BRASS_NAME } from '../engine/crafting';
import { LENS_NAME } from '../engine/lens';
import { PixelIcon } from './icons';

export interface CraftModalProps {
  canCraft: boolean;
  reason: string;
  onCraft: () => void;
  onClose: () => void;
}

/**
 * At the jeweller's bench: the lens and the brass, and the one thing they
 * make. The Combine button greys out with the refusal in words whenever
 * `canCraft` is false — no lens for this depth, a lens already whole, or no
 * brass to spend — same shape as the forge's own greyed-out row.
 */
export function CraftModal({ canCraft, reason, onCraft, onClose }: CraftModalProps) {
  return (
    <div className="modal-backdrop modal-ready shop-backdrop" role="dialog" aria-label="The jeweller's bench">
      <div className="shop-modal">
        <div className="shop-head">
          <span className="shop-slot">
            <PixelIcon name="lens" size={14} />
            Bench
          </span>
          <span className="shop-head-hint">Brass fills the housing</span>
        </div>

        <div className="shop-body">
          <div className="shop-item">
            <div className="shop-item-icon">
              <PixelIcon name="lens" size={56} />
            </div>
            <div className="shop-item-text">
              <div className="shop-item-name">Whole Lens</div>
            </div>
          </div>

          <p className="shop-desc">
            Spend the brass and the {LENS_NAME} never shatters again — on any floor, for the rest of the run.
          </p>

          <div className="shop-swap">
            <span className="shop-swap-label">Costs</span>
            <PixelIcon name="brass" size={16} />
            <span className="shop-swap-name">{BRASS_NAME}</span>
          </div>
          <p className="shop-desc">{BRASS_DESCRIPTION}</p>

          {!canCraft && <div className="shop-warn">{reason}</div>}
        </div>

        <div className="shop-actions">
          <button
            type="button"
            className="shop-btn shop-btn-buy"
            onClick={onCraft}
            disabled={!canCraft}
            aria-label="Combine the lens and the brass"
          >
            <span className="shop-btn-label">Combine</span>
          </button>
          <button type="button" className="shop-btn shop-btn-exit shop-btn-wide" onClick={onClose} aria-label="Leave the bench">
            Leave
          </button>
        </div>
      </div>
    </div>
  );
}
