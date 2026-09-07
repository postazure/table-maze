import type { WorldData, WorldKind } from '../engine/types';
import { WORLDS } from '../engine/worlds';

export interface WorldIntroModalProps {
  world: WorldKind;
  stage: number;
  /** `level.world.data` as it stands right now; the module's own words for this stage. */
  data: WorldData['data'];
  onClose: () => void;
}

/**
 * Arriving on a floor of a boss world: what this place is, what to do here.
 * Button-dismissed only, exactly as `BossIntroModal` — the backdrop never
 * closes it, so nothing runs (see `Game.tick`) until the player has read it.
 */
export function WorldIntroModal({ world, stage, data, onClose }: WorldIntroModalProps) {
  const module = WORLDS[world];
  const { title, lines } = module.intro(stage, data);

  return (
    <div className="modal-backdrop boss-backdrop" role="dialog" aria-label={`${module.name}: ${title}`}>
      <div className="boss-modal boss-intro-modal">
        <div className="boss-head">
          <span className="boss-title">{title}</span>
          <span className="boss-subtitle">{module.name}</span>
        </div>
        <div className="boss-body">
          {lines.map((line, i) => (
            <p key={i} className="boss-desc">
              {line}
            </p>
          ))}
        </div>
        <button type="button" className="hud-btn-newgame boss-btn-primary" onClick={onClose} aria-label="Continue">
          Continue
        </button>
      </div>
    </div>
  );
}
