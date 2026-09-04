import { useEffect, useRef } from 'react';
import type { Game } from '../engine/game';
import { Renderer } from '../render/renderer';
import { attachInput } from '../render/input';

export interface MazeCanvasProps {
  game: Game;
}

/**
 * The maze viewport. Hosts the canvas, the renderer, the pointer input and
 * the requestAnimationFrame loop that advances the simulation.
 */
export function MazeCanvas({ game }: MazeCanvasProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const renderer = new Renderer(canvas);
    const detachInput = attachInput(canvas, renderer, game);

    let level = game.state.level;
    const resize = () => renderer.resize(game.state.level);
    resize();
    window.addEventListener('resize', resize);
    window.addEventListener('orientationchange', resize);
    const observer = canvas.parentElement ? new ResizeObserver(resize) : null;
    observer?.observe(canvas.parentElement as HTMLElement);

    let raf = 0;
    let last = performance.now();
    const frame = (now: number) => {
      const dt = Math.min(50, now - last);
      last = now;
      game.tick(dt);
      if (game.state.level !== level) {
        level = game.state.level;
        renderer.resize(level);
      }
      renderer.draw(game.state, dt);
      raf = requestAnimationFrame(frame);
    };
    raf = requestAnimationFrame(frame);

    return () => {
      cancelAnimationFrame(raf);
      observer?.disconnect();
      window.removeEventListener('resize', resize);
      window.removeEventListener('orientationchange', resize);
      detachInput();
    };
  }, [game]);

  return (
    <div className="maze-wrap">
      <canvas ref={canvasRef} className="maze" aria-label="Maze" />
    </div>
  );
}
