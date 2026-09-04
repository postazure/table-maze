import { Game } from './game';
import { Renderer } from './render';
import { Hud } from './hud';
import { attachInput } from './input';
import { loadGame, saveGame, clearSave } from './save';

const canvas = document.getElementById('maze') as HTMLCanvasElement;
const hudRoot = document.getElementById('hud') as HTMLElement;

const game = new Game(loadGame());
const renderer = new Renderer(canvas);
const hud = new Hud(hudRoot, {
  onNewGame: () => {
    clearSave();
    game.newGame();
    renderer.resize(game.state.level);
    saveGame(game.state);
  },
});

let saveTimer: number | null = null;
game.onChange = (state) => {
  // Debounce saves so a long drag doesn't hammer localStorage.
  if (saveTimer !== null) return;
  saveTimer = window.setTimeout(() => {
    saveTimer = null;
    saveGame(state);
  }, 250);
};

let lastLevel = game.state.level;
renderer.resize(lastLevel);
window.addEventListener('resize', () => renderer.resize(game.state.level));
window.addEventListener('orientationchange', () => renderer.resize(game.state.level));
attachInput(canvas, renderer, game);

let last = performance.now();
function frame(now: number) {
  const dt = Math.min(50, now - last);
  last = now;
  game.tick(dt);
  if (game.state.level !== lastLevel) {
    lastLevel = game.state.level;
    renderer.resize(lastLevel);
  }
  renderer.draw(game.state, dt);
  hud.update(game.state);
  requestAnimationFrame(frame);
}
requestAnimationFrame(frame);

// Persist when the tab is hidden / closed.
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'hidden') saveGame(game.state);
});
window.addEventListener('pagehide', () => saveGame(game.state));

// Debug/testing hook (harmless in production).
(window as unknown as { __game: Game }).__game = game;
