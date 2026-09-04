import { memo } from 'react';
import type { HudModel } from './hudModel';
import { PixelIcon, type IconName } from './icons';

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

function Stat({ icon, title, value }: { icon: IconName; title: string; value: number }) {
  return (
    <div className="hud-stat" title={title}>
      <PixelIcon name={icon} size={14} title={title} />
      <span className="hud-stat-value">{value}</span>
    </div>
  );
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
        <Stat icon="sword" title="Attack" value={model.atk} />
        <Stat icon="shield" title="Defense" value={model.def} />
        <Stat icon="coin" title="Gold" value={model.gold} />
        <Stat icon="doorKey" title="Door keys" value={model.doorKeys} />
        <Stat icon="chestKey" title="Chest keys" value={model.chestKeys} />
        <Stat icon="skull" title="Kills" value={model.kills} />
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
