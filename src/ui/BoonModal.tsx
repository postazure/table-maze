import type { BoonKind } from '../engine/types';
import { boonDescription, boonName } from '../engine/boons';
import { PixelIcon } from './icons';

export interface BoonModalProps {
  boon: BoonKind;
  runsLeft: number;
  onClose: () => void;
}

/** The altar took the trophy. What the hero has now, and for how long. */
export function BoonModal({ boon, runsLeft, onClose }: BoonModalProps) {
  return (
    <div className="modal-backdrop boss-backdrop" role="dialog" aria-label="Boon granted">
      <div className="boss-modal boss-won-modal">
        <div className="boss-head boss-head-won">
          <span className="boss-title boss-title-won">{boonName(boon)}</span>
          <span className="boss-subtitle">The altar accepts</span>
        </div>
        <div className="boss-body boss-won-body">
          <div className="boss-reward">
            <div className="boss-reward-icon">
              <PixelIcon name={boon} size={56} />
            </div>
            <div className="boss-reward-text">
              <div className="boss-reward-name">{boonDescription(boon)}</div>
            </div>
          </div>
          <p className="boss-desc boss-healed-line">
            Yours now, and for {runsLeft} more run{runsLeft === 1 ? '' : 's'} after this one. Then it breaks.
          </p>
        </div>
        <button type="button" className="hud-btn-newgame boss-btn-primary" onClick={onClose} aria-label="Continue">
          Continue
        </button>
      </div>
    </div>
  );
}
