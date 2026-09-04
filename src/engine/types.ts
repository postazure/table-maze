/**
 * Shared data contract for Table Maze.
 *
 * Every module imports its types from here. Keep this file free of runtime
 * logic (a couple of tiny helpers at the bottom are fine).
 *
 * Coordinate system
 * -----------------
 * The level is a TILE grid: `tiles[y][x]`, x to the right, y downwards.
 * Width/height are odd numbers. Walls and floors are both tiles
 * (classic "2n+1" maze grid). Entities always sit on Floor tiles.
 * Hero/monsters move one tile at a time in 4 directions.
 */

export type Vec = { x: number; y: number };

export const enum Tile {
  Wall = 0,
  Floor = 1,
}

export type Dir = 'N' | 'E' | 'S' | 'W';
export const DIRS: Record<Dir, Vec> = {
  N: { x: 0, y: -1 },
  E: { x: 1, y: 0 },
  S: { x: 0, y: 1 },
  W: { x: -1, y: 0 },
};

/** Stable string key for a tile, used for Sets/Maps: "x,y". */
export const key = (p: Vec): string => `${p.x},${p.y}`;
export const parseKey = (k: string): Vec => {
  const [x, y] = k.split(',').map(Number);
  return { x, y };
};
export const eq = (a: Vec, b: Vec): boolean => a.x === b.x && a.y === b.y;
export const manhattan = (a: Vec, b: Vec): number => Math.abs(a.x - b.x) + Math.abs(a.y - b.y);

// ---------------------------------------------------------------------------
// Level content
// ---------------------------------------------------------------------------

/** Keys come in two kinds. Door keys open doors, chest keys open chests. */
export type KeyKind = 'door' | 'chest';

export interface KeyItem {
  id: string;
  pos: Vec;
  kind: KeyKind;
  taken: boolean;
}

export interface Door {
  id: string;
  pos: Vec; // a Floor tile in a corridor; blocks movement while `open === false`
  open: boolean;
}

export interface LootItem {
  name: string; // e.g. "Iron Sword"
  atk?: number; // permanent bonus
  def?: number; // permanent bonus
  maxHp?: number; // permanent bonus
}

export interface Loot {
  gold: number;
  xp: number;
  item?: LootItem;
}

export interface Chest {
  id: string;
  pos: Vec;
  opened: boolean;
  loot: Loot;
}

/**
 * Monster behaviours:
 *  - guard:  never leaves its tile. Attacks the hero when adjacent.
 *  - patrol: walks back and forth along `patrolPath` (list of tiles, walked
 *            forward then backward). Attacks the hero when adjacent, and will
 *            step toward the hero if the hero is on its path and in sight,
 *            then resume the patrol.
 *  - lurker: sits on `home`. When the hero comes within `sightRange` (BFS
 *            tile distance through open floor) it switches to `chasing` and
 *            follows the hero. When the hero gets further than `leash` tiles
 *            from the lurker it gives up and walks back `home` (`returning`).
 *            This is the monster you bait: pull it away from the corridor it
 *            guards, then loop around it (levels contain a few loops).
 */
export type MonsterKind = 'guard' | 'patrol' | 'lurker';
export type MonsterState = 'idle' | 'chasing' | 'returning';

export interface Monster {
  id: string;
  kind: MonsterKind;
  name: string; // display name, e.g. "Slime", "Skeleton"
  glyph: string; // single emoji/char used by the renderer, e.g. "👹"
  pos: Vec; // current tile
  rpos: Vec; // render position (fractional tile coords), lerped toward pos by the game
  home: Vec; // spawn tile
  hp: number;
  maxHp: number;
  atk: number;
  def: number;
  level: number; // shown on the sprite; drives the stat scaling
  xp: number; // xp granted on death
  gold: number; // gold dropped on death
  /** Milliseconds between moves. Lower = faster. */
  moveInterval: number;
  moveCooldown: number; // ms until next move is allowed
  attackInterval: number; // ms between attacks
  attackCooldown: number;
  state: MonsterState;
  patrolPath?: Vec[]; // patrol only
  patrolIndex?: number; // patrol only
  patrolDir?: 1 | -1; // patrol only
  sightRange: number; // lurker/patrol: BFS tiles
  leash: number; // lurker: BFS tiles from home before giving up
  alive: boolean;
  /** ms since this monster last dealt or took damage; drives its self-heal. */
  sinceCombat: number;
  hitFlash: number; // ms remaining of "just got hit" flash (renderer reads, game decrements)
  lunge?: Vec; // unit vector of a short attack lunge animation, set by game when it attacks
  lungeT: number; // ms remaining of lunge
}

export interface LevelData {
  depth: number; // 1-based dungeon depth
  seed: number;
  width: number; // tiles, odd
  height: number; // tiles, odd
  tiles: Tile[][]; // tiles[y][x]
  start: Vec; // hero spawn (Floor)
  exit: Vec; // stairs down (Floor)
  keys: KeyItem[];
  doors: Door[];
  chests: Chest[];
  monsters: Monster[];
}

// ---------------------------------------------------------------------------
// Hero / progression
// ---------------------------------------------------------------------------

export interface Hero {
  pos: Vec; // current tile
  rpos: Vec; // render position, lerped by the game
  facing: Dir;
  hp: number;
  maxHp: number;
  atk: number;
  def: number;
  level: number;
  xp: number;
  xpToNext: number;
  gold: number;
  keys: Record<KeyKind, number>; // how many of each key kind the hero carries
  items: LootItem[]; // permanent items picked up (bonuses already applied to stats)
  hitFlash: number; // ms remaining
  stun: number; // ms the hero cannot move (short staggers)
  /**
   * Knocked-down rest. While true the hero sleeps ("zzz"), ignores input,
   * is ignored by monsters, and heals quickly; control returns at full hp.
   */
  sleeping: boolean;
  lunge?: Vec;
  lungeT: number;
  /** ms since the hero was last in combat; used for out-of-combat regen. */
  sinceCombat: number;
}

// ---------------------------------------------------------------------------
// Runtime state
// ---------------------------------------------------------------------------

/** Transient visual effects. The game pushes them, the renderer draws & ages them. */
export type Effect =
  | { kind: 'text'; pos: Vec; text: string; color: string; t: number; ttl: number }
  | { kind: 'flash'; pos: Vec; color: string; t: number; ttl: number }
  | { kind: 'shake'; t: number; ttl: number; strength: number };

export interface Message {
  text: string;
  t: number; // ms since shown
}

/** A blocking popup the UI shows while the simulation is frozen. */
export type Modal = { kind: 'chest'; loot: Loot };

export interface GameState {
  version: number; // save format version
  depth: number;
  seed: number; // run seed; level seed is derived from it + depth
  hero: Hero;
  level: LevelData;
  /** Tiles the hero has stepped on this level, as `key(pos)` strings. */
  trail: Set<string>;
  /** Queued tiles the hero will walk through next (each adjacent to the previous). */
  path: Vec[];
  /** Tile currently under the finger, or null. Renderer draws a cursor. */
  pointer: Vec | null;
  fx: Effect[];
  log: Message[]; // recent messages, newest last; game trims to ~5
  stats: {
    kills: number;
    deepest: number;
    playMs: number;
  };
  /** true once the hero steps on the exit; game handles the transition. */
  descending: number; // ms remaining of the descend animation, 0 when not descending
  /** While set, `Game.tick` does nothing; the UI must call `Game.dismissModal()`. */
  modal: Modal | null;
}

/** JSON-serialisable form of GameState (Set -> array). */
export interface SaveData extends Omit<GameState, 'trail' | 'fx' | 'pointer' | 'path' | 'log' | 'modal'> {
  trail: string[];
}

// ---------------------------------------------------------------------------
// Module contracts (what each module must export). See src/CONTRACTS.md.
// ---------------------------------------------------------------------------

/** Anything that can map a screen point to a tile. Implemented by the Renderer. */
export interface TileMapper {
  /** Returns the tile under the client coordinates, or null if outside the maze. */
  tileAt(clientX: number, clientY: number): Vec | null;
}

export interface Rng {
  /** float in [0,1) */
  next(): number;
  /** integer in [min, max] inclusive */
  int(min: number, max: number): number;
  pick<T>(arr: readonly T[]): T;
  shuffle<T>(arr: T[]): T[]; // in place, returns arr
  chance(p: number): boolean;
}

export const SAVE_VERSION = 3;

/** Health is measured in quarter-hearts. One heart = 4 hp. */
export const HEART = 4;
