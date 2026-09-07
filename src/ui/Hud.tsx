import { memo, useCallback, useRef } from 'react';
import type { ItemSlot } from '../engine/types';
import type { HudModel } from './hudModel';
import { PixelIcon, type IconName } from './icons';
import { Hearts } from './Hearts';

const GEAR_SLOTS: readonly ItemSlot[] = ['offense', 'defense', 'spirit'];

/** How long a press on the speaker button has to hold before it opens the volume modal. */
const LONG_PRESS_MS = 500;

export interface HudProps {
  model: HudModel;
  onNewGame: () => void;
  onHelp: () => void;
  /** Sound and music on? Drives the speaker button. */
  soundOn: boolean;
  onToggleSound: () => void;
  /** A long press on the speaker button opens the volume modal instead of toggling. */
  onOpenVolume: () => void;
}

/** Round a percentage down to a multiple of 4 for a chunky, "stepped" bar fill. */
function steppedPct(value: number, max: number): number {
  if (max <= 0) return 0;
  const pct = Math.max(0, Math.min(100, (value / max) * 100));
  return Math.floor(pct / 4) * 4;
}

function Stat({
  icon,
  title,
  value,
  buffed = false,
}: {
  icon: IconName;
  title: string;
  value: number;
  /** A shrine is holding this number up: light it so the player can see why. */
  buffed?: boolean;
}) {
  return (
    <div className={`hud-stat${buffed ? ' hud-stat-buffed' : ''}`} title={buffed ? `${title} (shrine)` : title}>
      <PixelIcon name={icon} size={14} title={title} />
      <span className="hud-stat-value">{value}</span>
    </div>
  );
}

function HudInner({ model, onNewGame, onHelp, soundOn, onToggleSound, onOpenVolume }: HudProps) {
  const xpPct = steppedPct(model.xp, model.xpToNext);

  const handleNewGame = () => {
    if (window.confirm('Start a new run? Progress will be lost.')) {
      onNewGame();
    }
  };

  // A tap toggles sound; holding the same button opens the volume modal
  // instead. The timer decides which one happened, and the click handler
  // (which always fires on release) checks the flag to skip the toggle.
  const longPress = useRef(false);
  const pressTimer = useRef<number | null>(null);

  const cancelPressTimer = useCallback(() => {
    if (pressTimer.current !== null) {
      window.clearTimeout(pressTimer.current);
      pressTimer.current = null;
    }
  }, []);

  const handleSoundPointerDown = useCallback(() => {
    longPress.current = false;
    cancelPressTimer();
    pressTimer.current = window.setTimeout(() => {
      pressTimer.current = null;
      longPress.current = true;
      onOpenVolume();
    }, LONG_PRESS_MS);
  }, [cancelPressTimer, onOpenVolume]);

  const handleSoundClick = useCallback(() => {
    if (longPress.current) {
      longPress.current = false;
      return;
    }
    onToggleSound();
  }, [onToggleSound]);

  return (
    <>
      <div className="hud-top">
        <div className="hud-badges">
          <span className="hud-badge">
            {model.levelKind === 'shop' ? (
              <>SHOP</>
            ) : model.levelKind === 'boss' ? (
              <>BOSS</>
            ) : model.levelKind === 'world' ? (
              <>{(model.worldName ?? 'WORLD').toUpperCase()}</>
            ) : (
              <>
                DEPTH <b>{model.depth}</b>
              </>
            )}
          </span>
          <span className="hud-badge">
            LV <b>{model.level}</b>
          </span>
          {model.lens && (
            <span className="hud-badge hud-badge-lens" title="Cracked Lens — see the unseen">
              <PixelIcon name="lens" size={12} title="Cracked Lens" />
            </span>
          )}
        </div>
        <div className="hud-buttons">
          <button
            type="button"
            className="hud-btn-newgame hud-btn-help"
            onClick={handleSoundClick}
            onPointerDown={handleSoundPointerDown}
            onPointerUp={cancelPressTimer}
            onPointerLeave={cancelPressTimer}
            onPointerCancel={cancelPressTimer}
            onContextMenu={(e) => e.preventDefault()}
            aria-label={soundOn ? 'Turn sound off (hold for volume)' : 'Turn sound on (hold for volume)'}
            aria-pressed={soundOn}
          >
            <PixelIcon name={soundOn ? 'sound' : 'soundOff'} size={14} />
          </button>
          <button type="button" className="hud-btn-newgame hud-btn-help" onClick={onHelp} aria-label="Help">
            ?
          </button>
          <button type="button" className="hud-btn-newgame" onClick={handleNewGame}>
            New Game
          </button>
        </div>
      </div>

      <div className="hud-bars">
        <div className="hud-bar-row">
          <span className="hud-bar-label">HP</span>
          <div className="hud-hp-content">
            <Hearts
              hp={model.hp}
              maxHp={model.maxHp}
              dim={model.stunned}
              tempHp={model.tempHp}
              tempHpMax={model.tempHpMax}
            />
            {model.potionCapacity > 0 && (
              <div
                className="hud-potions"
                role="img"
                aria-label={`Health potions: ${model.potions} of ${model.potionCapacity}`}
              >
                {Array.from({ length: model.potionCapacity }, (_, i) => (
                  <span key={i} className={`hud-potion${i < model.potions ? ' hud-potion-filled' : ''}`}>
                    <PixelIcon name="potion" size={14} />
                  </span>
                ))}
              </div>
            )}
          </div>
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
        <Stat icon="sword" title="Attack" value={model.atk} buffed={model.atkBuffed} />
        <Stat icon="shield" title="Defense" value={model.def} buffed={model.defBuffed} />
        <Stat icon="spirit" title="Spirit (shrines give more)" value={model.spirit} />
        <Stat icon="coin" title="Gold" value={model.gold} />
        <Stat icon="doorKey" title="Door keys" value={model.doorKeys} />
        <Stat icon="chestKey" title="Chest keys" value={model.chestKeys} />
        <Stat icon="skull" title="Kills" value={model.kills} />
      </div>

      <div className="hud-gear">
        {GEAR_SLOTS.map((slot) => {
          const item = model.gear[slot];
          return (
            <div key={slot} className={`hud-gear-slot${item ? ' hud-gear-filled' : ''}`} title={slot}>
              <PixelIcon name={item ? item.kind : slot} size={20} />
              {item && <span className="hud-gear-level">{item.level}</span>}
            </div>
          );
        })}
      </div>
    </>
  );
}

export const Hud = memo(HudInner);
