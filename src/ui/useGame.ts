import { useCallback, useEffect, useRef, useState } from 'react';
import { Game } from '../engine/game';
import { clearSave, loadGame, saveGame } from '../engine/save';
import { deriveHudModel, hudModelEquals, type HudModel } from './hudModel';

/**
 * Owns the single Game instance for the app. The simulation itself runs in
 * `MazeCanvas`' animation loop; this hook only exposes the game, a
 * throttled HUD model (React re-renders only when a displayed value changes),
 * and the "new game" action. Persistence is wired here too.
 */
export function useGame() {
  const [game] = useState(() => new Game(loadGame()));
  const [hud, setHud] = useState<HudModel>(() => deriveHudModel(game.state));
  const lastHud = useRef<HudModel | null>(hud);

  // Debounced autosave whenever the game reports a change.
  useEffect(() => {
    let timer: number | null = null;
    game.onChange = (state) => {
      if (timer !== null) return;
      timer = window.setTimeout(() => {
        timer = null;
        saveGame(state);
      }, 250);
    };
    const flush = () => saveGame(game.state);
    const onVisibility = () => {
      if (document.visibilityState === 'hidden') flush();
    };
    document.addEventListener('visibilitychange', onVisibility);
    window.addEventListener('pagehide', flush);
    return () => {
      game.onChange = undefined;
      if (timer !== null) window.clearTimeout(timer);
      document.removeEventListener('visibilitychange', onVisibility);
      window.removeEventListener('pagehide', flush);
    };
  }, [game]);

  // Poll the HUD model at a modest rate; the canvas loop runs at 60fps but
  // the HUD only needs to catch up a few times a second.
  useEffect(() => {
    const id = window.setInterval(() => {
      const next = deriveHudModel(game.state);
      if (!hudModelEquals(lastHud.current, next)) {
        lastHud.current = next;
        setHud(next);
      }
    }, 100);
    return () => window.clearInterval(id);
  }, [game]);

  const newGame = useCallback(() => {
    clearSave();
    game.newGame();
    saveGame(game.state);
  }, [game]);

  // Debug/testing hook (harmless in production).
  useEffect(() => {
    (window as unknown as { __game?: Game }).__game = game;
  }, [game]);

  return { game, hud, newGame };
}
