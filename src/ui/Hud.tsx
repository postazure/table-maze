import { memo } from 'react';
import type { HudModel } from './hudModel';

export interface HudProps {
  model: HudModel;
  onNewGame: () => void;
}

/** Round a percentage down to a multiple of 4 for a chunky, "stepped" bar fill. */
function steppedPct(value: number, max: number): number {
  if (max <= 0) return 0;
  const pct = Math.max(0, Math.min(100, (value / max) * 100));
  return Math.floor(pct / 4) * 4;
}

function HudInner({ model, onNewGame }: HudProps) {
  const hpPct = steppedPct(model.hp, model.maxHp);
  const xpPct = steppedPct(model.xp, model.xpToNext);

  const handleNewGame = () => {
    if (window.confirm('Start a new run? Progress will be lost.')) {
      onNewGame();
    }
  };

  return (
    <>
      <div className="hud-top">
        <div className="hud-badges">
          <span className="hud-badge">
            DEPTH <b>{model.depth}</b>
          </span>
          <span className="hud-badge">
            LV <b>{model.level}</b>
          </span>
        </div>
        <button type="button" className="hud-btn-newgame" onClick={handleNewGame}>
          New Game
        </button>
      </div>

      <div className="hud-bars">
        <div className="hud-bar-row">
          <span className="hud-bar-label">HP</span>
          <div className="hud-bar-track">
            <div className={`hud-bar-fill hud-hp${model.stunned ? ' hud-stunned' : ''}`} style={{ width: `${hpPct}%` }} />
          </div>
          <span className="hud-bar-text">
            {Math.max(0, Math.round(model.hp))}/{Math.round(model.maxHp)}
          </span>
        </div>
        <div className="hud-bar-row">
          <span className="hud-bar-label">XP</span>
          <div className="hud-bar-track">
            <div className="hud-bar-fill hud-xp" style={{ width: `${xpPct}%` }} />
          </div>
          <span className="hud-bar-text">
            {Math.round(model.xp)}/{Math.round(model.xpToNext)}
          </span>
        </div>
      </div>

      <div className="hud-stats">
        <div className="hud-stat">
          <span className="hud-lbl">ATK</span>
          {model.atk}
        </div>
        <div className="hud-stat">
          <span className="hud-lbl">DEF</span>
          {model.def}
        </div>
        <div className="hud-stat">
          <span className="hud-lbl">GOLD</span>
          {model.gold}
        </div>
        <div className="hud-stat">
          <span className="hud-lbl">DKEY</span>
          {model.doorKeys}
        </div>
        <div className="hud-stat">
          <span className="hud-lbl">CKEY</span>
          {model.chestKeys}
        </div>
        <div className="hud-stat">
          <span className="hud-lbl">KILLS</span>
          {model.kills}
        </div>
        <div className="hud-stat">
          <span className="hud-lbl">CHEST</span>
          {model.chests}
        </div>
      </div>

      <div className="hud-log">
        {model.log.map((text, i) => {
          const age = Math.min(2, model.log.length - 1 - i);
          return (
            <div key={i} className={`hud-log-line hud-age-${age}`}>
              {text}
            </div>
          );
        })}
      </div>
    </>
  );
}

export const Hud = memo(HudInner);
