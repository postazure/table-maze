import type { BossKind } from '../engine/types';
import { crystalName } from '../engine/crafting';
import { PixelIcon, crystalIcon } from './icons';

export interface PortalModalProps {
  crystals: BossKind[];
  onEnter: (boss: BossKind) => void;
  onClose: () => void;
}

/** The world each boss's crystal opens. */
const WORLD_NAME: Record<BossKind, string> = {
  minotaur: 'Olympus',
  necromancer: 'Boston',
  angels: 'The Cemetery',
};

/**
 * The portal: every crystal in the pack, one row each, naming the world it
 * opens. "Enter" spends it — `Game.usePortal` does the rest.
 */
export function PortalModal({ crystals, onEnter, onClose }: PortalModalProps) {
  return (
    <div className="modal-backdrop modal-ready shop-backdrop" role="dialog" aria-label="A portal">
      <div className="shop-modal">
        <div className="shop-head">
          <span className="shop-slot">
            <PixelIcon name="lens" size={14} />
            Portal
          </span>
          <span className="shop-head-hint">One crystal, one world</span>
        </div>

        <div className="shop-body">
          <p className="shop-desc">Spend a crystal to step through. The main floor waits for you on the other side.</p>
          {crystals.map((boss, i) => (
            <button
              key={`${boss}-${i}`}
              type="button"
              className="shop-btn forge-row"
              onClick={() => onEnter(boss)}
              aria-label={`Enter ${WORLD_NAME[boss]} with the ${crystalName(boss)}`}
            >
              <span className="forge-row-icon">
                <PixelIcon name={crystalIcon(boss)} size={28} />
              </span>
              <span className="forge-row-text">
                <span className="forge-row-name">{WORLD_NAME[boss]}</span>
                <span className="forge-row-levels">
                  <span className="shop-muted">{crystalName(boss)}</span>
                </span>
              </span>
              <span className="shop-price">Enter</span>
            </button>
          ))}
        </div>

        <div className="shop-actions">
          <button type="button" className="shop-btn shop-btn-exit shop-btn-wide" onClick={onClose} aria-label="Leave the portal dark">
            Leave
          </button>
        </div>
      </div>
    </div>
  );
}
