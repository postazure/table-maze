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
 * Shrines: small alcoves off the corridors, a few on every maze floor.
 *
 * Nothing about them blocks: the hero walks over one to light it, so a shrine
 * can be walked past now and come back to later. Each lights once and then
 * stays dark for the rest of the floor.
 *
 * Every gift runs out on its own. Five of them are timers; the ward is spent
 * instead, a pool of temporary hearts that soaks damage until it is gone.
 *  - ward:  temporary hearts on top of the hero's own, spent before real ones
 *  - fury:  more attack for a while
 *  - stone: more defense for a while
 *  - frost: for a while, an ice ball flies at the nearest monster in sight
 *           every few seconds and freezes it solid for a moment
 *  - mend:  hearts refill fast for a while, fighting or not
 *  - time:  monsters near the hero crawl for a while
 */
export type ShrineKind = 'ward' | 'fury' | 'stone' | 'frost' | 'mend' | 'time';

export const SHRINE_KINDS: readonly ShrineKind[] = ['ward', 'fury', 'stone', 'frost', 'mend', 'time'];

/** Every shrine but the ward hands out a `Buff` that counts down. */
export type TimedShrineKind = Exclude<ShrineKind, 'ward'>;

export interface Shrine {
  id: string;
  pos: Vec; // a Floor tile the hero can stand on; never solid
  kind: ShrineKind;
  /** Set once the hero has stepped on it. A spent shrine goes dark. */
  used: boolean;
  /** The depth it was generated at. All of its numbers scale from this. */
  level: number;
}

/**
 * One running shrine effect. `ms` counts down to 0 and the buff is dropped;
 * `totalMs` is what it started with, which is what the on-screen timer fills
 * against. `timer` is the buff's own cadence (frost's ice balls, mend's
 * pulses) and means nothing for the others.
 */
export interface Buff {
  kind: TimedShrineKind;
  ms: number;
  totalMs: number;
  level: number;
  timer: number;
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
 *            hero back. Like every monster it is solid: a hero who walks into
 *            one fights it instead of passing through.
 *  - lurker: sits on `home` and blocks it. When the hero comes within
 *            `sightRange` (BFS tile distance through open floor) it switches
 *            to `chasing` and follows the hero. That range is the cap, not
 *            the whole story: a lurker standing above the hero's level gives
 *            up a tile of it per level of the gap, to a floor of two tiles
 *            (see `lurkerSightRange`), so the easy floors leave more room to
 *            back out. Once the hero is further than
 *            `sightRange + 1`, or further than `leash` tiles from the
 *            lurker's home, it gives up (`returning`) and holds its ground
 *            right there instead of walking back to `home`.
 *            This is the monster you bait: pull it away from the corridor it
 *            guards, then loop around it (levels contain a few loops).
 */
export type RosterKind = 'guard' | 'patrol' | 'lurker';
/**
 * Boss-level monsters (see engine/boss.ts). None of them appear on maze floors.
 *  - minion:     a trash skeleton raised by the necromancer. Chases the hero
 *                anywhere on the floor (no sight limit, no leash), slowly.
 *                Weak hits that shove the hero back. Solid, so it clogs paths.
 *  - crystal:    a necromancer's spell crystal. Never moves, never attacks;
 *                the hero smashes it like any monster. No xp/gold.
 *  - boss:       the necromancer himself. Rooted in the middle of his
 *                chamber, channelling. `invulnerable`; he flees when the last
 *                crystal breaks and the stairs appear on his tile.
 *  - minotaur:   `invulnerable`, chases the hero anywhere, slowly, forever.
 *                Every hit takes a third of the hero's max hp.
 *  - angel:      `invulnerable`. Idle (weeping) until the hero enters its room
 *                (`roomId`), then it hunts the hero anywhere, forever, but
 *                mostly in lock-step with the hero: one hero step, one angel
 *                step, plus a slow creep of one tile every `ANGEL_CREEP_MS`
 *                so waiting only delays it. A touch (attack) takes a third
 *                of max hp.
 */
export type BossMonsterKind = 'minion' | 'crystal' | 'boss' | 'minotaur' | 'angel';
export type MonsterKind = RosterKind | BossMonsterKind;
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
  /**
   * Frozen solid: remaining ms. While > 0 the monster does not move and does
   * not attack at all (a shrine ice ball, not the frost blade's half speed).
   */
  frozenMs: number;
  hitFlash: number; // ms remaining of "just got hit" flash (renderer reads, game decrements)
  lunge?: Vec; // unit vector of a short attack lunge animation, set by game when it attacks
  lungeT: number; // ms remaining of lunge
  /** Takes no damage at all (bosses, angels). Hits show "Immune" instead. */
  invulnerable?: boolean;
  /** angel: index into `BossData.rooms` of the room it starts in. */
  roomId?: number;
}

/**
 * A pocket of the maze that branches off the route to the stairs, loops back on
 * itself, and rejoins nowhere: walking one never advances you toward the
 * stairs, it only costs you the detour. Blocking every tile of every warren
 * always leaves the stairs reachable.
 */
export interface Warren {
  /**
   * The one tile inside the warren that touches the rest of the maze — its
   * only way in or out. The renderer breaks the wall open around this tile so
   * the player can learn to read a side passage without being told.
   */
  mouth: Vec;
  /** Every tile of the warren, `mouth` included. */
  tiles: Vec[];
}

export interface LevelData {
  depth: number; // 1-based dungeon depth
  seed: number;
  /**
   * 'maze' is a normal floor. 'boss' is the boss chamber that follows every
   * third floor, and 'shop' the small room that follows the boss.
   */
  kind: 'maze' | 'shop' | 'boss';
  /** Visual theme id (see engine/themes.ts); changes every three floors. */
  theme: string;
  /** Only on shop levels. */
  shop?: Shop;
  /** Only on boss levels. */
  boss?: BossData;
  width: number; // tiles, odd
  height: number; // tiles, odd
  tiles: Tile[][]; // tiles[y][x]
  start: Vec; // hero spawn (Floor)
  exit: Vec; // stairs down (Floor)
  keys: KeyItem[];
  doors: Door[];
  chests: Chest[];
  monsters: Monster[];
  /**
   * Side loops off the route (see maze.ts). Optional: absent on boss and shop
   * floors, and on levels saved before warrens existed.
   */
  warrens?: Warren[];
  /**
   * The floor's shrine alcoves (see maze.ts). Optional: maze floors only, and
   * absent on boss and shop floors.
   */
  shrines?: Shrine[];
}

// ---------------------------------------------------------------------------
// Boss chambers (after every third floor, right before the shop)
// ---------------------------------------------------------------------------

export type BossKind = 'necromancer' | 'minotaur' | 'angels';
export const BOSS_KINDS: readonly BossKind[] = ['necromancer', 'minotaur', 'angels'];

/** An axis-aligned rectangle of floor tiles, inclusive of `x..x+w-1`, `y..y+h-1`. */
export interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

/**
 * Per-boss objective state. `defeated` flips once the objective is met: the
 * reward has been given and the stairs are live.
 *
 *  - necromancer: a large central chamber with the necromancer (a 'boss'
 *    monster) channelling in the middle. Five winding corridors branch off
 *    the chamber, each ending at a 'crystal' monster. Every `spawnEveryMs`
 *    a 'minion' skeleton rises next to the necromancer (while fewer than
 *    `maxMinions` are alive). `spellMs` counts down from `spellTotalMs`;
 *    at 0 the spell completes and it is game over. Smash all five crystals
 *    and the necromancer flees: his tile becomes the stairs. `level.exit` is
 *    his tile from the start (hidden and blocked by him until then).
 *  - minotaur: a braided maze with a few open chambers. One 'minotaur'
 *    monster hunts the hero from the far side. Reach `level.exit` to win.
 *  - angels: a grid of rooms (`rooms`) joined by winding corridors, several
 *    holding an 'angel'. Reach `level.exit` to win.
 */
export type BossData =
  | {
      kind: 'necromancer';
      defeated: boolean;
      spellMs: number;
      spellTotalMs: number;
      /** ms until the next skeleton rises. */
      spawnMs: number;
      spawnEveryMs: number;
      maxMinions: number;
      crystalsTotal: number;
    }
  | { kind: 'minotaur'; defeated: boolean }
  | { kind: 'angels'; defeated: boolean; rooms: Rect[] };

/** Does `p` lie inside `r`? */
export const inRect = (r: Rect, p: Vec): boolean =>
  p.x >= r.x && p.y >= r.y && p.x < r.x + r.w && p.y < r.y + r.h;

/** Boss hits (minotaur, angel) take this fraction of the hero's max hp, ignoring defense. */
export const BOSS_HIT_FRACTION = 1 / 3;

/**
 * Awake angels answer every hero step with one of their own, and on top of
 * that creep one tile closer every this many ms whether the hero moves or
 * not. Slow enough to plan around, but standing still never saves you.
 */
export const ANGEL_CREEP_MS = 2200;

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

/**
 * A pedestal in a shop level. Two tiles by two: `pos` is its top-left tile and
 * all four are solid, like a chest. Walk into any of them to open the offer.
 */
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
  /**
   * Spirit: the hero's hold on the dungeon's magic. It creeps up with their
   * level and every spirit-slot item adds to it, the way the stone ring adds
   * defense. Nothing in a fight reads it — what it buys is shrines: every
   * point makes a shrine's gift bigger (see `engine/shrines.ts`).
   */
  spirit: number;
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
  /**
   * Ward shrine: temporary quarter-hearts stacked on top of `hp`. Every hit
   * eats these first, and they never come back on their own — once they are
   * spent the ward is over.
   */
  tempHp: number;
  /** What `tempHp` started at, so the HUD can show how much of the ward is left. */
  tempHpMax: number;
  /** Shrine effects still running, newest last. See `engine/shrines.ts`. */
  buffs: Buff[];
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

/**
 * A sound the simulation asks for. The engine only ever names the moment; the
 * audio layer (`src/audio/`) decides what it sounds like, so nothing in here
 * touches the Web Audio API.
 *
 * The first group fires often enough that the same clip on repeat would grate,
 * so the audio layer nudges the pitch and envelope of every play a little. The
 * second group each mean one specific thing and always sound the same, which
 * is what makes them worth learning.
 */
export type SfxId =
  // Heard constantly: played with a little variation each time.
  | 'step'
  | 'swing'
  | 'hit'
  | 'kill'
  | 'hurt'
  | 'rise'
  | 'fireball'
  | 'zap'
  | 'iceball'
  // One meaning each: always the same sound.
  | 'keyDoor'
  | 'keyChest'
  | 'doorOpen'
  | 'locked'
  | 'chestOpen'
  | 'stairs'
  | 'levelUp'
  | 'knockDown'
  | 'wake'
  | 'buy'
  | 'shieldUp'
  | 'shieldPop'
  | 'phoenix'
  | 'crystal'
  | 'immune'
  | 'shrine'
  | 'wardBreak'
  | 'angel'
  | 'bossWin'
  | 'gameOver';

/** The `SfxId`s that get per-play variation. Everything else is fixed. */
export const VARIED_SFX: readonly SfxId[] = [
  'step',
  'swing',
  'hit',
  'kill',
  'hurt',
  'rise',
  'fireball',
  'zap',
  'iceball',
];

export interface Message {
  text: string;
  t: number; // ms since shown
}

/** A blocking popup the UI shows while the simulation is frozen. */
export type Modal =
  | { kind: 'chest'; loot: Loot }
  /**
   * Standing at a shop pedestal: what the item is, what it does, what it
   * costs. The UI calls `Game.buyOffer(offerId)` or `Game.dismissModal()`.
   */
  | {
      kind: 'shopOffer';
      offerId: string;
      item: MagicItem;
      price: number;
      /** Hero gold when the popup opened (the world is frozen, so it cannot move). */
      gold: number;
      /** The item this one would push out of its slot, if any. */
      replaces: MagicItem | null;
      /** Something was already bought in this shop: nothing else is for sale. */
      soldOut: boolean;
    }
  /** Bought a magic item. `replaced` is the item it pushed out of the slot, if any. */
  | { kind: 'item'; item: MagicItem; replaced: MagicItem | null }
  /** The help screen: current gear explained in words. Opened from the HUD. */
  | { kind: 'help' }
  /**
   * Entering a boss chamber: what the boss is and what the hero must do.
   * Dismissed by its button only (never by tapping the backdrop). The
   * world (and the necromancer's spell clock) waits until it is closed.
   */
  | { kind: 'bossIntro'; boss: BossKind }
  /**
   * The boss is beaten. `upgraded` is the magic item that gained a level
   * (already at its new level), or null when the hero wore nothing, in
   * which case they gained a heart (`heart` is true). Button to dismiss.
   */
  | { kind: 'bossWon'; boss: BossKind; upgraded: MagicItem | null; heart: boolean }
  /**
   * The run is over (only ever in a boss chamber). `cause` is one plain
   * sentence ("The Minotaur caught you."). Dismissing it starts a new run.
   */
  | { kind: 'gameOver'; cause: string; boss: BossKind; stats: RunStats };

/** Everything the game-over screen shows about the run that just ended. */
export interface RunStats {
  deepest: number;
  heroLevel: number;
  kills: number;
  bosses: number;
  gold: number;
  playMs: number;
}

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
  /**
   * Sounds asked for since the last frame, oldest first. The audio layer
   * drains it every frame; with the sound off nothing reads it, so `pushSfx`
   * caps the queue rather than letting it grow without end.
   */
  sfx: SfxId[];
  log: Message[]; // recent messages, newest last; game trims to ~5
  stats: {
    kills: number;
    deepest: number;
    playMs: number;
    /** Bosses beaten this run. */
    bosses: number;
  };
  /** true once the hero steps on the exit; game handles the transition. */
  descending: number; // ms remaining of the descend animation, 0 when not descending
  /** While set, `Game.tick` does nothing; the UI must call `Game.dismissModal()`. */
  modal: Modal | null;
  /** keyCompass: the tile the arrow over the hero points at, or null. Updated by the game. */
  compass: Vec | null;
  /**
   * The run ended (game over in a boss chamber). Persisted so a reload never
   * resurrects a dead run: `saveGame` clears the save instead of writing it.
   */
  over: boolean;
}

/** JSON-serialisable form of GameState (Set -> array). */
export interface SaveData
  extends Omit<GameState, 'trail' | 'fx' | 'sfx' | 'pointer' | 'path' | 'log' | 'modal' | 'compass'> {
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

export const SAVE_VERSION = 7;

/** Health is measured in quarter-hearts. One heart = 4 hp. */
export const HEART = 4;
