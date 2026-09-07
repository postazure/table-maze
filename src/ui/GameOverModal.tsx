import type { BossKind, RunStats, WorldKind } from '../engine/types';
import { WORLDS } from '../engine/worlds';
import { WORLD_DEFEAT_ART } from '../render/worlds';
import { PixelArt } from './PixelArt';
import { PixelIcon } from './icons';

export interface GameOverModalProps {
  cause: string;
  boss: BossKind;
  stats: RunStats;
  /** Gold to buy back into this same fight, fixed at the moment of death. */
  retryCost: number;
  /** Set when the run ended on a boss world's floor rather than a boss chamber. */
  world?: WorldKind;
  onRetry: () => void;
  onClose: () => void;
}

/** "125:07" -> "m:ss" (no leading zero on minutes, seconds padded). */
function formatPlayTime(ms: number): string {
  const totalSeconds = Math.max(0, Math.floor(ms / 1000));
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${minutes}:${seconds.toString().padStart(2, '0')}`;
}

/**
 * The run is over. One plain-sentence cause, then a stats grid, then a
 * button to buy back into this same fight (greyed out if the purse is
 * short) and a button that starts a new run instead. Never window.confirm on
 * "New Game" — there is nothing left to lose by starting over, so nothing to
 * confirm.
 */
export function GameOverModal({ cause, stats, retryCost, world, onRetry, onClose }: GameOverModalProps) {
  const rows: [string, string | number][] = [
    ['Deepest floor', stats.deepest],
    ['Hero level', stats.heroLevel],
    ['Kills', stats.kills],
    ['Bosses beaten', stats.bosses],
    ['Gold', stats.gold],
    ['Time played', formatPlayTime(stats.playMs)],
  ];
  if (stats.retries > 0) rows.push(['Boss retries paid', stats.retries]);
  const canRetry = stats.gold >= retryCost;
  const worldName = world ? WORLDS[world].name : null;
  const art = world ? WORLD_DEFEAT_ART[world] : null;

  return (
    <div className="modal-backdrop boss-backdrop" role="dialog" aria-label="Game over">
      <div className="boss-modal gameover-modal">
        <div className="boss-head">
          <span className="boss-title gameover-title">{worldName ? `Lost in ${worldName}` : 'Game Over'}</span>
        </div>
        <div className="boss-body">
          {art && (
            <div className="boss-sprite-wrap">
              <PixelArt rows={art.rows} palette={art.palette} size={128} />
            </div>
          )}
          <p className="boss-desc gameover-cause">{cause}</p>
          <div className="gameover-stats">
            {rows.map(([label, value]) => (
              <div key={label} className="gameover-stat">
                <span className="gameover-stat-label">{label}</span>
                <span className="gameover-stat-value">{value}</span>
              </div>
            ))}
          </div>
        </div>
        <div className="shop-actions">
          <button
            type="button"
            className="shop-btn shop-btn-buy"
            onClick={onRetry}
            disabled={!canRetry}
            aria-label={worldName ? `Pay ${retryCost} gold to try the stage again` : `Pay ${retryCost} gold to retry this boss`}
          >
            <span className="shop-btn-label">{worldName ? 'Try the stage again' : 'Retry this fight'}</span>
            <span className="shop-price">
              <PixelIcon name="coin" size={14} />
              {retryCost}
            </span>
          </button>
        </div>
        {!canRetry && <div className="shop-warn">Not enough gold to retry.</div>}
        <button type="button" className="hud-btn-newgame boss-btn-primary" onClick={onClose} aria-label="Start a new game">
          New Game
        </button>
      </div>
    </div>
  );
}
