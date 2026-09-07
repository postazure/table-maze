import type { WorldKind } from '../engine/types';
import { WORLDS } from '../engine/worlds';

export interface WorldWonModalProps {
  world: WorldKind;
  /** The collectible's name (`WorldModule.collectible.name`), as the modal set it. */
  collectible: string;
  onClose: () => void;
}

/**
 * The world is won: its collectible, kept for good. Button-dismissed only,
 * exactly as `BossWonModal`. The way home is still the module's own portal
 * prop — this popup only says what was earned, not that the hero has left.
 */
export function WorldWonModal({ world, collectible, onClose }: WorldWonModalProps) {
  const module = WORLDS[world];
  return (
    <div className="modal-backdrop boss-backdrop" role="dialog" aria-label={`${module.name} won`}>
      <div className="boss-modal boss-won-modal">
        <div className="boss-head boss-head-won">
          <span className="boss-title boss-title-won">{module.name}</span>
          <span className="boss-subtitle">Won!</span>
        </div>
        <div className="boss-body boss-won-body">
          <div className="boss-reward">
            <div className="boss-reward-text">
              <div className="boss-reward-name">{collectible}</div>
            </div>
          </div>
          <p className="boss-desc">Kept for good.</p>
        </div>
        <button type="button" className="hud-btn-newgame boss-btn-primary" onClick={onClose} aria-label="Continue">
          Continue
        </button>
      </div>
    </div>
  );
}
