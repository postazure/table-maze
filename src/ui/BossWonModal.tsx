import type { BossKind, MagicItem } from '../engine/types';
import { bossName } from '../engine/boss';
import { itemName } from '../engine/items';
import { PixelIcon } from './icons';

export interface BossWonModalProps {
  boss: BossKind;
  upgraded: MagicItem | null;
  heart: boolean;
  onClose: () => void;
}

/**
 * The boss is beaten: the reward (an item level-up or a bonus heart) and a
 * reminder that the party heals up. Button-dismissed only.
 */
export function BossWonModal({ boss, upgraded, heart, onClose }: BossWonModalProps) {
  return (
    <div className="modal-backdrop boss-backdrop" role="dialog" aria-label="Boss beaten">
      <div className="boss-modal boss-won-modal">
        <div className="boss-head boss-head-won">
          <span className="boss-title boss-title-won">Boss beaten!</span>
          <span className="boss-subtitle">{bossName(boss)}</span>
        </div>
        <div className="boss-body boss-won-body">
          {upgraded && (
            <div className="boss-reward">
              <div className="boss-reward-icon">
                <PixelIcon name={upgraded.kind} size={56} />
              </div>
              <div className="boss-reward-text">
                <div className="boss-reward-name">{itemName(upgraded.kind)}</div>
                <div className="boss-reward-levels">
                  <span>Lv {upgraded.level - 1}</span>
                  <span className="item-replaced-arrow" aria-hidden="true" />
                  <span className="boss-reward-new-level">Lv {upgraded.level}</span>
                </div>
              </div>
            </div>
          )}
          {heart && (
            <div className="boss-reward boss-reward-heart">
              <div className="boss-reward-icon">
                <PixelIcon name="heart" size={56} />
              </div>
              <div className="boss-reward-text">
                <div className="boss-reward-name">+1 heart</div>
              </div>
            </div>
          )}
          <p className="boss-desc boss-healed-line">Hearts refilled.</p>
        </div>
        <button type="button" className="hud-btn-newgame boss-btn-primary" onClick={onClose} aria-label="Continue">
          Continue
        </button>
      </div>
    </div>
  );
}
