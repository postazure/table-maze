/**
 * The Cracked Lens and the hidden passages it is for.
 *
 * Every maze floor hides a **wing**: a small dungeon of rooms dug into the
 * rock behind the outer wall, with the floor's hardest monsters, a sealed
 * treasure room and the odd altar (see wings.ts), that the floor does not
 * admit to. Every tile of one is unbroken brick to look at and solid to walk
 * into, so a hero without the lens never knows it is there.
 *
 * The **lens** is found in a chest on the first or second floor of a themed
 * set (see `themeForDepth`). It comes out of the chest already cracked, which
 * is where its name comes from and why nobody is surprised when it finally
 * gives out. Carrying it does exactly one thing: standing on
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

/**
 * A lens turns up in a chest on the first two floors of a set, never the
 * third — and never on the run's first floor at all, which is what makes
 * the heirloom lens (engine/crafting.ts) the one lens floor one ever sees.
 */
export function lensFloor(depth: number): boolean {
  const d = Math.max(1, Math.floor(depth));
  if (d === 1) return false;
  return floorOfSet(d) < 3;
}

/**
 * Does this hero hold a lens that still works at this depth? An unbreakable
 * lens (crafted at the jeweller's bench, see engine/crafting.ts) works on
 * every depth for the rest of the run; an ordinary one only on the set it
 * was found in.
 */
export function lensActive(hero: Hero, depth: number): boolean {
  const lens = hero.lens;
  if (!lens) return false;
  return lens.unbreakable ? true : lens.set === floorSet(depth);
}

/** The lens' display name. One item, one name, everywhere. */
export const LENS_NAME = 'Cracked Lens';

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
 * How see-through the brick gets at the hero's feet. Nearly all the way: what
 * keeps a passage feeling like a passage is the radius, not the haze — you
 * read the next few tiles of one and no more, however clearly you read them.
 * The last sliver of brick is left in deliberately so the ground still says
 * "you are inside the wall" rather than reading as ordinary floor.
 */
export const LENS_ALPHA = 0.97;

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
