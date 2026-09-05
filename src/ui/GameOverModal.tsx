import type { BossKind, RunStats } from '../engine/types';

export interface GameOverModalProps {
  cause: string;
  boss: BossKind;
  stats: RunStats;
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
 * single button that starts a new run. Never window.confirm — there is
 * nothing left to lose, so nothing to confirm.
 */
export function GameOverModal({ cause, stats, onClose }: GameOverModalProps) {
  const rows: [string, string | number][] = [
    ['Deepest floor', stats.deepest],
    ['Hero level', stats.heroLevel],
    ['Kills', stats.kills],
    ['Bosses beaten', stats.bosses],
    ['Gold', stats.gold],
    ['Time played', formatPlayTime(stats.playMs)],
  ];

  return (
    <div className="modal-backdrop boss-backdrop" role="dialog" aria-label="Game over">
      <div className="boss-modal gameover-modal">
        <div className="boss-head">
          <span className="boss-title gameover-title">Game Over</span>
        </div>
        <div className="boss-body">
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
        <button type="button" className="hud-btn-newgame boss-btn-primary" onClick={onClose} aria-label="Start a new game">
          New Game
        </button>
      </div>
    </div>
  );
}
