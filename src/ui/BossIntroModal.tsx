import type { BossKind } from '../engine/types';
import { bossName } from '../engine/boss';
import { MONSTER_CFGS, creatureRows } from '../render/monsterArt';
import { PixelArt } from './PixelArt';

export interface BossIntroModalProps {
  boss: BossKind;
  onClose: () => void;
}

/** Sprite key into MONSTER_CFGS for each boss kind. */
const BOSS_SPRITE_KEY: Record<BossKind, string> = {
  necromancer: 'necromancer',
  minotaur: 'minotaur',
  angels: 'angel',
};

const BOSS_COPY: Record<BossKind, { objective: string; tips: string[]; verb: string }> = {
  necromancer: {
    objective:
      'The Necromancer is casting a spell in the middle of his chamber. Smash all 5 crystals at the ends of the five corridors before the spell finishes.',
    tips: [
      'The bar at the top is the spell. When it runs out, you lose.',
      'He keeps raising skeletons. They are weak, but they shove and they block the corridors.',
      'You cannot hurt him. Go for the crystals.',
      'The stairs appear where he stood.',
    ],
    verb: 'Fight!',
  },
  minotaur: {
    objective: 'The Minotaur hunts you. It is slow, but it never stops. Find the stairs.',
    tips: [
      'Three hits and you are dead.',
      'You cannot hurt it. Run.',
      'Stuck at a dead end? Lead it around a loop to clear the way.',
    ],
    verb: 'Run!',
  },
  angels: {
    objective: 'Weeping angels haunt these rooms. They are slow, but they know where you are. Find the stairs.',
    tips: [
      'Enter a room with an angel and it wakes. It hunts you anywhere after that.',
      'They take the doorways of your room and wait, just out of reach.',
      'Block every way out and they move in. Never let a room be sealed.',
      'Three touches turn you to stone.',
    ],
    verb: 'Go!',
  },
};

/**
 * Entering a boss chamber: what it is, what to do about it. Button-dismissed
 * only — the backdrop never closes it, so a stray tap can't skip past the
 * warning that a loss here ends the run.
 */
export function BossIntroModal({ boss, onClose }: BossIntroModalProps) {
  const copy = BOSS_COPY[boss];
  const spriteKey = BOSS_SPRITE_KEY[boss];
  const cfg = MONSTER_CFGS[spriteKey] ?? MONSTER_CFGS.skeleton;
  const { rows, palette } = creatureRows(cfg);

  return (
    <div className="modal-backdrop boss-backdrop" role="dialog" aria-label={`${bossName(boss)} encounter`}>
      <div className="boss-modal boss-intro-modal">
        <div className="boss-head">
          <span className="boss-title">{bossName(boss)}</span>
        </div>
        <div className="boss-body">
          <div className="boss-sprite-wrap">
            <PixelArt rows={rows} palette={palette} size={64} />
          </div>
          <p className="boss-desc">{copy.objective}</p>
          <ul className="help-list boss-tips">
            {copy.tips.map((tip, i) => (
              <li key={i}>{tip}</li>
            ))}
          </ul>
          <p className="boss-warn-line">If you fail here, the run is over.</p>
        </div>
        <button type="button" className="hud-btn-newgame boss-btn-primary" onClick={onClose} aria-label={copy.verb}>
          {copy.verb}
        </button>
      </div>
    </div>
  );
}
