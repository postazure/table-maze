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
 *  - guard:  never leaves its tile and blocks it. Dozes until provoked: it
 *            only attacks an adjacent hero while it has been in combat
 *            recently (a few seconds), so the hero can slip past an untouched
 *            guard.
 *  - patrol: walks back and forth along `patrolPath` (list of tiles, walked
 *            forward then backward) and never chases. It attacks whoever is
 *            adjacent when its cooldown allows, but its hits never knock the
 *            hero back. Patrols do not block: the hero shoves past one (the
 *            two swap tiles) at the cost of a short stagger, so a wandering
 *            monster can never seal a corridor.
 *  - lurker: sits on `home` and blocks it. When the hero comes within
 *            `sightRange` (BFS tile distance through open floor) it switches
 *            to `chasing` and follows the hero. Once the hero is further than
 *            `sightRange + 1`, or further than `leash` tiles from the
 *            lurker's home, it gives up and walks back `home` (`returning`).
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
  /** Poison: remaining ms and damage per tick (one tick per second). 0 = none. */
  poisonMs: number;
  poisonDmg: number;
  /** Slow: remaining ms. While > 0 the monster moves and attacks at half speed. */
  slowMs: number;
  hitFlash: number; // ms remaining of "just got hit" flash (renderer reads, game decrements)
  lunge?: Vec; // unit vector of a short attack lunge animation, set by game when it attacks
  lungeT: number; // ms remaining of lunge
}

export interface LevelData {
  depth: number; // 1-based dungeon depth
  seed: number;
  /** 'maze' is a normal floor. 'shop' is the small room visited after every third floor. */
  kind: 'maze' | 'shop';
  /** Visual theme id (see engine/themes.ts); changes every three floors. */
  theme: string;
  /** Only on shop levels. */
  shop?: Shop;
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
// Magic items (bought in shops, one per slot, all passive)
// ---------------------------------------------------------------------------

export type ItemSlot = 'offense' | 'defense' | 'spirit';

/**
 * Every magic item kind. Each belongs to exactly one slot (see ITEM_SLOT).
 * All effects are passive: they trigger on conditions, timers, or chance,
 * never on new controls. Numbers scale with `MagicItem.level` (the depth the
 * item was bought at); see src/engine/items.ts for the formulas.
 *
 * offense
 *  - longSword     reach: swings hit a monster two tiles away in a straight line
 *  - fireStaff     timer: every few seconds a fireball flies at the nearest monster in sight, splash damage
 *  - lightningWand chance on hit: lightning chains from the target to nearby monsters
 *  - poisonDagger  on hit: the monster is poisoned and takes damage over time
 *  - frostBlade    on hit: the monster is slowed (moves and attacks at half speed)
 *  - berserkerAxe  condition: while at or below half hearts, big attack bonus
 * defense
 *  - shieldAmulet  timer: a bubble that absorbs one hit, recharges after a while
 *  - speedBoots    constant: the hero walks faster
 *  - thornMail     on being hit: the attacker takes damage back
 *  - phoenixFeather on knockdown (cooldown): burst back up at half hearts instead of sleeping
 *  - regenRing     constant: hearts refill much faster out of combat and while sleeping
 *  - stoneRing     constant: defense bonus and immunity to knockback
 * spirit
 *  - goldCharm     constant: more gold from monsters and chests
 *  - xpTome        constant: more xp from monsters and chests
 *  - lifeAmulet    constant: extra max hearts; timer: a quarter heart every few seconds even in combat
 *  - keyCompass    constant: an arrow over the hero points to the nearest key (or the stairs)
 *  - vampireFang   on kill: heal; chance on hit: heal a quarter heart
 *  - baneTotem     constant: monsters near the hero move slower and lurkers see less far
 */
export type ItemKind =
  | 'longSword'
  | 'fireStaff'
  | 'lightningWand'
  | 'poisonDagger'
  | 'frostBlade'
  | 'berserkerAxe'
  | 'shieldAmulet'
  | 'speedBoots'
  | 'thornMail'
  | 'phoenixFeather'
  | 'regenRing'
  | 'stoneRing'
  | 'goldCharm'
  | 'xpTome'
  | 'lifeAmulet'
  | 'keyCompass'
  | 'vampireFang'
  | 'baneTotem';

export const ITEM_KINDS: readonly ItemKind[] = [
  'longSword',
  'fireStaff',
  'lightningWand',
  'poisonDagger',
  'frostBlade',
  'berserkerAxe',
  'shieldAmulet',
  'speedBoots',
  'thornMail',
  'phoenixFeather',
  'regenRing',
  'stoneRing',
  'goldCharm',
  'xpTome',
  'lifeAmulet',
  'keyCompass',
  'vampireFang',
  'baneTotem',
];

export const ITEM_SLOT: Record<ItemKind, ItemSlot> = {
  longSword: 'offense',
  fireStaff: 'offense',
  lightningWand: 'offense',
  poisonDagger: 'offense',
  frostBlade: 'offense',
  berserkerAxe: 'offense',
  shieldAmulet: 'defense',
  speedBoots: 'defense',
  thornMail: 'defense',
  phoenixFeather: 'defense',
  regenRing: 'defense',
  stoneRing: 'defense',
  goldCharm: 'spirit',
  xpTome: 'spirit',
  lifeAmulet: 'spirit',
  keyCompass: 'spirit',
  vampireFang: 'spirit',
  baneTotem: 'spirit',
};

export interface MagicItem {
  kind: ItemKind;
  /** The depth it was bought at. All of its numbers scale from this. */
  level: number;
}

/** A pedestal in a shop level. Solid like a chest; walk into it to buy. */
export interface ShopOffer {
  id: string;
  pos: Vec;
  item: MagicItem;
  price: number; // gold
}

export interface Shop {
  offers: ShopOffer[];
  /** Set once anything is bought; the other pedestals go dark. */
  bought: boolean;
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
  /** One magic item per slot. Bonuses of constant items are applied to the base stats on equip. */
  gear: Record<ItemSlot, MagicItem | null>;
  /** shieldAmulet: true while the bubble is up (absorbs the next hit). */
  shieldReady: boolean;
  /** Per-item timers in ms (shield recharge, fireball, life pulse, phoenix cooldown...). */
  timers: { shield: number; fire: number; life: number; phoenix: number; bane: number };
}

// ---------------------------------------------------------------------------
// Runtime state
// ---------------------------------------------------------------------------

/** Transient visual effects. The game pushes them, the renderer draws & ages them. */
/**
 * Transient visual effects. `t` starts at 0 (or negative to delay the effect:
 * the renderer ages it but draws nothing while t < 0) and the effect is
 * dropped once t >= ttl.
 */
export type Effect =
  | { kind: 'text'; pos: Vec; text: string; color: string; t: number; ttl: number }
  | { kind: 'flash'; pos: Vec; color: string; t: number; ttl: number }
  | { kind: 'shake'; t: number; ttl: number; strength: number }
  /** Jagged lightning through `points` (tile coords, in order). */
  | { kind: 'bolt'; points: Vec[]; color: string; t: number; ttl: number }
  /** A projectile flying from `from` to `to` over ttl (fireball). */
  | { kind: 'projectile'; from: Vec; to: Vec; color: string; t: number; ttl: number }
  /** A ring expanding from `pos` to `radius` tiles over ttl (pulses, bubble pop). */
  | { kind: 'ring'; pos: Vec; radius: number; color: string; t: number; ttl: number }
  /** A straight slash line from `from` to `to` (long sword reach). */
  | { kind: 'slash'; from: Vec; to: Vec; color: string; t: number; ttl: number };

export interface Message {
  text: string;
  t: number; // ms since shown
}

/** A blocking popup the UI shows while the simulation is frozen. */
export type Modal =
  | { kind: 'chest'; loot: Loot }
  /** Bought a magic item. `replaced` is the item it pushed out of the slot, if any. */
  | { kind: 'item'; item: MagicItem; replaced: MagicItem | null }
  /** The help screen: current gear explained in words. Opened from the HUD. */
  | { kind: 'help' };

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
  /** keyCompass: the tile the arrow over the hero points at, or null. Updated by the game. */
  compass: Vec | null;
}

/** JSON-serialisable form of GameState (Set -> array). */
export interface SaveData extends Omit<GameState, 'trail' | 'fx' | 'pointer' | 'path' | 'log' | 'modal' | 'compass'> {
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

export const SAVE_VERSION = 4;

/** Health is measured in quarter-hearts. One heart = 4 hp. */
export const HEART = 4;
