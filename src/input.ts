/**
 * Finger-drag input. Pointer Events only, with touch scrolling suppressed so a
 * drag across the maze never pans the page or triggers pull-to-refresh.
 */
import type { TileMapper, Vec } from './types';
import type { Game } from './game';

export function attachInput(canvas: HTMLElement, mapper: TileMapper, game: Game): () => void {
  /** pointerId of the finger currently dragging, or null. */
  let activeId: number | null = null;
  /** last tile we reported, so a move within one tile is a no-op. */
  let lastKey: string | null = null;

  const report = (clientX: number, clientY: number): void => {
    const tile: Vec | null = mapper.tileAt(clientX, clientY);
    const k = tile ? `${tile.x},${tile.y}` : '';
    if (k === lastKey) return;
    lastKey = k;
    game.pointerAt(tile);
  };

  const onDown = (e: PointerEvent): void => {
    if (activeId !== null) return; // ignore extra fingers
    activeId = e.pointerId;
    try {
      canvas.setPointerCapture(e.pointerId);
    } catch {
      /* capture is best-effort */
    }
    lastKey = null;
    report(e.clientX, e.clientY);
    e.preventDefault();
  };

  const onMove = (e: PointerEvent): void => {
    if (activeId !== e.pointerId) return;
    report(e.clientX, e.clientY);
    e.preventDefault();
  };

  const end = (e: PointerEvent): void => {
    if (activeId !== e.pointerId) return;
    activeId = null;
    lastKey = null;
    try {
      if (canvas.hasPointerCapture?.(e.pointerId)) canvas.releasePointerCapture(e.pointerId);
    } catch {
      /* already released */
    }
    game.pointerEnd();
  };

  const swallow = (e: Event): void => {
    e.preventDefault();
  };

  canvas.addEventListener('pointerdown', onDown);
  canvas.addEventListener('pointermove', onMove);
  canvas.addEventListener('pointerup', end);
  canvas.addEventListener('pointercancel', end);
  canvas.addEventListener('lostpointercapture', end);
  // Stop scrolling / pull-to-refresh / long-press menus on touch devices.
  canvas.addEventListener('touchstart', swallow, { passive: false });
  canvas.addEventListener('touchmove', swallow, { passive: false });
  canvas.addEventListener('contextmenu', swallow);

  return (): void => {
    canvas.removeEventListener('pointerdown', onDown);
    canvas.removeEventListener('pointermove', onMove);
    canvas.removeEventListener('pointerup', end);
    canvas.removeEventListener('pointercancel', end);
    canvas.removeEventListener('lostpointercapture', end);
    canvas.removeEventListener('touchstart', swallow);
    canvas.removeEventListener('touchmove', swallow);
    canvas.removeEventListener('contextmenu', swallow);
    if (activeId !== null) {
      activeId = null;
      game.pointerEnd();
    }
  };
}
