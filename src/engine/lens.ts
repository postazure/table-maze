/**
 * The Lens of Truth and the hidden passages it is for.
 *
 * A maze floor carries a few **passages**: real corridors dug into the rock,
 * with monsters and sometimes a vault at the end, that the floor does not
 * admit to. Every tile of one is unbroken brick to look at and solid to walk
 * into, so a hero without the lens never knows they are there.
 *
 * The **lens** is found in a chest on the first or second floor of a themed
 * set (see `themeForDepth`). Carrying it does exactly one thing: standing on
 * the doorstep of a passage, or inside one, lights a radius around the hero,
 * the brick fading back to solid at the edge.
 *
 * Nothing marks a passage from further off — no seam, no glow, nothing on the
 * map. You find one by walking past its mouth and seeing the wall open, which
 * means the lens rewards covering ground rather than reading an indicator, and
 * a floor still keeps most of its passages from a player who took the direct
 * route. It is a lamp, not a map: even inside one you only ever see the next
 * few tiles.
 *
 * It is bound to the three-floor set it was found in and shatters as the hero
 * leaves that set's shop, so a lens is something you go looking for again
 * every time the dungeon changes theme.
 */
import { key, manhattan } from './types';
import type { Hero, LevelData, Passage, Vec } from './types';

/** Floors 1-3 are set 0, floors 4-6 set 1, and so on — the same grouping the themes use. */
export function floorSet(depth: number): number {
  return Math.floor((Math.max(1, Math.floor(depth)) - 1) / 3);
}

/** Which floor of its set this depth is: 1, 2 or 3. */
export function floorOfSet(depth: number): 1 | 2 | 3 {
  const n = ((Math.max(1, Math.floor(depth)) - 1) % 3) + 1;
  return n as 1 | 2 | 3;
}

/** A lens turns up in a chest on the first two floors of a set, never the third. */
export function lensFloor(depth: number): boolean {
  return floorOfSet(depth) < 3;
}

/** Vaults — a passage ending in a chest with a magic item — are the third floor's own. */
export function vaultFloor(depth: number): boolean {
  return floorOfSet(depth) === 3;
}

/** Does this hero hold a lens that still works at this depth? */
export function lensActive(hero: Hero, depth: number): boolean {
  const lens = hero.lens;
  return !!lens && lens.set === floorSet(depth);
}

/** The lens' display name. One item, one name, everywhere. */
export const LENS_NAME = 'Lens of Truth';

// ---------------------------------------------------------------------------
// Hidden ground
// ---------------------------------------------------------------------------

/**
 * Every passage tile of a level, as `key(p)` strings. Cached per level: this
 * is asked once per BFS node while monsters path, and a level's passages never
 * change after generation.
 */
const tileCache = new WeakMap<LevelData, Set<string>>();
/** Every mouth tile of a level. Same deal. */
const mouthCache = new WeakMap<LevelData, Set<string>>();

export function passageTiles(level: LevelData): Set<string> {
  let set = tileCache.get(level);
  if (!set) {
    set = new Set<string>();
    for (const p of level.passages ?? []) for (const t of p.tiles) set.add(key(t));
    tileCache.set(level, set);
  }
  return set;
}

export function passageMouths(level: LevelData): Set<string> {
  let set = mouthCache.get(level);
  if (!set) {
    set = new Set<string>();
    for (const p of level.passages ?? []) for (const m of p.mouths) set.add(key(m));
    mouthCache.set(level, set);
  }
  return set;
}

/** Is this tile hidden ground — floor the maze draws as wall? */
export function hiddenAt(level: LevelData, p: Vec): boolean {
  if (!level.passages?.length) return false;
  return passageTiles(level).has(key(p));
}

/** Is this tile the threshold of a passage — the bit a lens makes visible? */
export function mouthAt(level: LevelData, p: Vec): boolean {
  if (!level.passages?.length) return false;
  return passageMouths(level).has(key(p));
}

/**
 * Are these two tiles on the same side of the brick — both inside a passage,
 * or both out in the maze?
 *
 * A passage touches the maze at its mouths, so a tile in one and a tile in the
 * other really can end up neighbours. Nothing may reach across that join:
 * a monster stationed in a passage cannot swing at a hero standing in the
 * corridor outside it (or be swung at), and no fireball, ice ball, chain or
 * splash crosses it either. Everything that reaches a tile it is not standing
 * on asks this first.
 */
export function sameSide(level: LevelData, a: Vec, b: Vec): boolean {
  if (!level.passages?.length) return true;
  return hiddenAt(level, a) === hiddenAt(level, b);
}

export function passageAt(level: LevelData, p: Vec): Passage | null {
  for (const passage of level.passages ?? []) {
    for (const t of passage.tiles) if (t.x === p.x && t.y === p.y) return passage;
  }
  return null;
}

// ---------------------------------------------------------------------------
// The light itself
// ---------------------------------------------------------------------------

/** Out to this many tiles the reveal is at full strength. */
export const LENS_CORE = 2.5;
/** ...and by this many it has faded back to solid brick. */
export const LENS_RADIUS = 6.5;
/**
 * Even at the hero's feet the brick never goes fully. A passage is meant to
 * stay a passage: you read the next few tiles of it, not the shape of the
 * whole thing the way you read the rest of the floor.
 */
export const LENS_ALPHA = 0.88;

/** How much of the brick is see-through this far (in tiles) from the hero. */
export function lensRevealAt(dist: number): number {
  if (dist <= LENS_CORE) return LENS_ALPHA;
  if (dist >= LENS_RADIUS) return 0;
  return LENS_ALPHA * (1 - (dist - LENS_CORE) / (LENS_RADIUS - LENS_CORE));
}

/**
 * Is the lamp lit? Only while the hero is actually in a passage, or standing
 * next to a mouth about to step in — walking a corridor that happens to run
 * alongside one shows nothing.
 */
export function lensLit(level: LevelData, hero: Hero, depth: number): boolean {
  if (!level.passages?.length || !lensActive(hero, depth)) return false;
  if (hiddenAt(level, hero.pos)) return true;
  for (const m of passageMouths(level)) {
    const [x, y] = m.split(',').map(Number);
    if (manhattan({ x, y }, hero.pos) <= 1) return true;
  }
  return false;
}
