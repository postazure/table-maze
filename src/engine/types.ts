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
  /**
   * A health potion: raises `Hero.potionCapacity` (and hands over that many
   * potions right away). Unlike the other trinkets this one never melts down
   * for coins on a repeat find — see `openChest` in game.ts.
   */
  potionCapacity?: number;
}

export interface Loot {
  gold: number;
  xp: number;
  item?: LootItem;
  /**
   * A Cracked Lens (see engine/lens.ts). Chests on the first two floors of a
   * themed set carry one. A hero who already holds a lens melts a second one
   * down for coins, the same way a duplicate trinket goes.
   */
  lens?: boolean;
  /**
   * A magic item, the kind the shop sells. Only ever found in the treasure
   * room of a hidden wing, behind its seal — the payoff for having gone
   * looking with the lens and worked the lock.
   */
  magic?: MagicItem;
}

export interface Chest {
  id: string;
  pos: Vec;
  opened: boolean;
  loot: Loot;
  /**
   * A mimic: not a chest at all, but a monster that looks exactly like one
   * until the hero touches it. Only ever found in the hidden wings. Bumping it
   * springs it (see `springMimic` in game.ts): the chest is gone and a
   * `mimic` monster stands where it was. It needs no key and gives no loot as
   * a chest; the monster carries the gold instead.
   */
  mimic?: boolean;
}

// ---------------------------------------------------------------------------
// Puzzles: what stands between a wing's rooms and its treasure
// ---------------------------------------------------------------------------

/**
 * Relics: keystones picked up in the wings of earlier floors, carried for the
 * rest of the run, and spent on a keystone seal that is carved with the same
 * shape. Which floors offer one is a deterministic function of the run seed
 * (see `relicOffered` in puzzles.ts), so a seal only ever asks for a relic
 * the run actually put somewhere behind the hero — whether they found it is
 * another matter.
 */
export type RelicKind = 'sun' | 'moon' | 'star';
export const RELIC_KINDS: readonly RelicKind[] = ['sun', 'moon', 'star'];

export interface Relic {
  id: string;
  pos: Vec; // floor the hero walks over to pick it up
  kind: RelicKind;
  taken: boolean;
}

/**
 * A rune on the floor of a wing. Lit by stepping on it, in the order its seal
 * wants; a wrong step puts every rune of that seal out again.
 */
export interface Rune {
  id: string;
  pos: Vec;
  /** Which of the four rune shapes this one shows (index into the art table). */
  glyph: number;
  sealId: string;
  lit: boolean;
}

/**
 * How a rune seal tells the player its order:
 *  - pips: each rune shows its place in the sequence as dots. Obvious.
 *  - seal: the sequence is carved on the sealed door; go and read it.
 *  - none: nothing anywhere. Three runes, six orders, and a walk each time.
 */
export type RuneHint = 'pips' | 'seal' | 'none';

/**
 * An orb: something the hero picks up in one room and carries to the cradle
 * before a sealed door in another. A hero carrying one has both hands full
 * and sets it down to fight (see `dropOrb` in game.ts). Leaving the wing with
 * it sends it back to where it was found.
 */
export interface Orb {
  id: string;
  pos: Vec;
  /** Where it was first found; where it returns to if it leaves the wing. */
  home: Vec;
  sealId: string;
  state: 'floor' | 'carried' | 'placed';
}

/** What a seal wants before it opens. */
export type SealLock =
  | { kind: 'runes'; hint: RuneHint; order: string[]; lit: number }
  | { kind: 'orb'; socket: Vec; placed: boolean }
  | { kind: 'keystone'; relic: RelicKind };

/**
 * A sealed doorway: the one corridor tile into a wing's treasure room, solid
 * until its lock is satisfied. Never a door key's business.
 */
export interface Seal {
  id: string;
  pos: Vec;
  open: boolean;
  lock: SealLock;
}

/**
 * An altar in a wing, carved for one boss. Bump it carrying that boss's
 * trophy and the trophy is spent for a boon (see engine/boons.ts) that lasts
 * the next few runs. Solid, like a chest. Nothing on it says which trophy
 * beyond the carving.
 */
export interface Altar {
  id: string;
  pos: Vec;
  trophy: BossKind;
  used: boolean;
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
 *            right there for a few seconds — long enough that ducking out of
 *            sight and straight back in still baits it — before it walks
 *            back to `chaseFrom`, the tile it was standing on when this chase
 *            started (not necessarily `home`: a lurker can be re-baited
 *            mid-walk-back, from wherever it had gotten to). Getting there
 *            settles it back to `idle`.
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
 *                (`roomId`), then it lays siege: one step every
 *                `ANGEL_STEP_MS` (far slower than the hero) straight toward
 *                the doorways of whatever room the hero is in, keeping out
 *                of arm's reach until the hero has nowhere left to run.
 *                Then every angel closes in, and a touch (attack) takes a
 *                third of max hp. See angels.ts.
 */
export type BossMonsterKind = 'minion' | 'crystal' | 'boss' | 'minotaur' | 'angel';
/**
 * The mimic: a chest in a hidden wing that was never a chest. Springs when
 * bumped and hunts like a lurker, leashed to the wing it was waiting in.
 * Theme-independent: every dungeon has the same one.
 */
export type WingMonsterKind = 'mimic';
export type MonsterKind = RosterKind | BossMonsterKind | WingMonsterKind;
/**
 * `closing` is the angels' own: the ring has shut and they are moving in for
 * the kill (angels.ts). Every other kind only ever uses the first three.
 */
export type MonsterState = 'idle' | 'chasing' | 'returning' | 'closing';

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
  /** Lurker only: where it stood when the current chase began. Set on the
   *  idle -> chasing transition, kept through any returning -> chasing
   *  re-aggro, cleared once it walks all the way back and settles to idle. */
  chaseFrom?: Vec;
  /** Lurker only: ms left before a `returning` lurker starts walking back to
   *  `chaseFrom`. Holds it in place at the give-up spot for a grace window
   *  first, so ducking out of sight and back still re-aggros it. */
  giveUpMs?: number;
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

/**
 * A passage the floor keeps to itself: a **wing** of rooms behind the wall.
 *
 * Every tile of one is real floor in `tiles` — pathfinding, monsters and the
 * renderer all treat it as ground — but it is drawn as unbroken brick and the
 * hero is refused entry unless they carry a lens (see engine/lens.ts).
 *
 * A wing is a small dungeon of its own: a grid of rooms joined by short
 * corridors, entered through one mouth (sometimes with a second, a back door
 * further along the wall), with a treasure room at the far end behind a
 * sealed door (see `Seal`). `rooms` are the room rectangles, `treasure` the
 * index of the one behind the seal, `entry` the one the mouth opens into.
 *
 * They never *have* to be walked: `validate` in maze.ts walls them all off
 * and checks the stairs are still reachable, so a hero without a lens is
 * never stuck — only poorer.
 */
export interface Passage {
  id: string;
  kind: 'wing';
  /** Every tile of the wing, mouths included. All hidden. */
  tiles: Vec[];
  /** The tiles where the wing touches the maze: one, or two with a back door. */
  mouths: Vec[];
  rooms: Rect[];
  entry: number;
  treasure: number;
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
  /**
   * A second stairs down, in the treasure room of a wing big enough to be a
   * real walk (see wings.ts). Stepping on it descends exactly as `exit` does,
   * so clearing the wing is a way down rather than a detour to walk back out
   * of. Hidden ground, like the rest of the wing.
   */
  wingExit?: Vec;
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
   * The floor's hidden passages (see maze.ts and lens.ts). Optional: maze
   * floors only, and absent on levels saved before passages existed.
   */
  passages?: Passage[];
  /**
   * The floor's shrine alcoves (see maze.ts). Optional: maze floors only, and
   * absent on boss and shop floors.
   */
  shrines?: Shrine[];
  /**
   * What the wings hold besides monsters and chests (see engine/wings.ts and
   * engine/puzzles.ts). All optional, all maze floors only, and every one of
   * them stands on hidden ground.
   */
  seals?: Seal[];
  runes?: Rune[];
  orbs?: Orb[];
  relics?: Relic[];
  altars?: Altar[];
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
 * Angel pacing and nerve (angels.ts). One step every `ANGEL_STEP_MS` — over
 * four times slower than the hero — but they walk the whole floor straight
 * at their goal, so a shorter way round through another room still gets them
 * there first. This is the clock on the first angel floors; deeper ones shave
 * a little off it (`angelPlan`, balance.ts).
 */
export const ANGEL_STEP_MS = 600;
/**
 * While the hero still has a way out, angels never step onto a tile this
 * close to them: they take the doors instead, and touch nobody.
 */
export const ANGEL_REACH = 1;
/** How close a spare angel (no door left to hold) creeps before it waits. */
export const ANGEL_RING = 3;
/**
 * Runaway guard on the "is there still a way out?" search: a space this big
 * is not one anybody is sealing, so the angels hold off.
 */
export const ANGEL_TRAP_AREA = 200;
/**
 * Once they close in they stay committed until the hero is this far (walking
 * distance) from every last one of them.
 */
export const ANGEL_BREAK = 7;

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

/**
 * The forge in a shop: a 2x2 block like a podium. Walk into it and the hero
 * may pay to raise one worn magic item a level instead of buying a new one.
 * It counts as the shop's one purchase, the same as a podium does.
 */
export interface ShopForge {
  pos: Vec;
}

export interface Shop {
  offers: ShopOffer[];
  forge: ShopForge;
  /** Set once anything is bought (an item or an upgrade); everything else goes dark. */
  bought: boolean;
}

// ---------------------------------------------------------------------------
// Hero / progression
// ---------------------------------------------------------------------------

/**
 * The Cracked Lens the hero is carrying, or null. Found in a chest, bound to
 * the three-floor themed set it was found in, and shattered on the way out of
 * that set's shop. See engine/lens.ts.
 */
export interface Lens {
  /** The depth the chest that held it was on. */
  depth: number;
  /** The themed set it works in: floors `set * 3 + 1` through `set * 3 + 3`. */
  set: number;
}

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
  /**
   * Health potions: found in chests, never bought. Each one found raises
   * `potionCapacity` by one and is handed over full. Spent automatically the
   * instant the hero would be knocked down and the phoenix feather (if worn)
   * is not the one answering it (see `knockDown` in combat.ts): heals to half
   * max hp instead of a knockdown, wherever the hero is, boss chambers
   * included. Refills to `potionCapacity` at the start of every level.
   */
  potions: number;
  potionCapacity: number;
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
  /**
   * The Cracked Lens, or null. Nothing in a fight reads it: all it does is
   * open this set's hidden passages and light the way a few tiles at a time.
   */
  lens: Lens | null;
  /**
   * The orb the hero is carrying (its id in `LevelData.orbs`), or null. Both
   * hands are full while it is set: the hero sets it down to swing.
   */
  carrying: string | null;
  /** Relics picked up this run and not yet spent on a keystone seal. */
  relics: RelicKind[];
  /** One trophy per boss beaten this run, until an altar takes it. */
  trophies: BossKind[];
}

/**
 * A boon: what an altar hands over for a boss trophy. It outlives the run:
 * `runsLeft` more runs start with it, and then it breaks. Kept in its own
 * localStorage slot beside the save (see save.ts), because a save is wiped
 * when a run ends and a boon is the one thing meant to survive that.
 */
export type BoonKind = 'deathless' | 'vigor' | 'sight';
export const BOON_KINDS: readonly BoonKind[] = ['deathless', 'vigor', 'sight'];

export interface Boon {
  kind: BoonKind;
  /** Runs it will still apply to after the current one. 0 = breaks after this run. */
  runsLeft: number;
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
  | 'potion'
  | 'wake'
  | 'buy'
  | 'shieldUp'
  | 'shieldPop'
  | 'phoenix'
  | 'crystal'
  | 'immune'
  | 'shrine'
  | 'wardBreak'
  | 'lens'
  | 'lensBreak'
  | 'angel'
  | 'bossWin'
  | 'gameOver'
  | 'rune'
  | 'runeFail'
  | 'seal'
  | 'orbLift'
  | 'orbSet'
  | 'relic'
  | 'mimic'
  | 'altar'
  | 'forge';

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
  /**
   * A chest opened. `choice` is set when the chest held a magic item and the
   * hero already wears something in its slot: nothing is equipped until the
   * player says so (`Game.takeMagic()`) or melts it down (`Game.sellMagic()`).
   */
  | { kind: 'chest'; loot: Loot; choice: { magic: MagicItem; replaces: MagicItem; sellGold: number } | null }
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
  /**
   * Standing at the shop's forge: every worn item and what a level on each
   * would cost. The UI calls `Game.buyUpgrade(slot)` or `Game.dismissModal()`.
   */
  | {
      kind: 'shopForge';
      gold: number;
      offers: { slot: ItemSlot; item: MagicItem; price: number }[];
      soldOut: boolean;
    }
  /** A worn item was raised a level at the forge. */
  | { kind: 'upgraded'; item: MagicItem }
  /**
   * Standing at an altar with the trophy it is carved for. `Game.offerTrophy()`
   * spends the trophy for the boon; `Game.dismissModal()` keeps it.
   */
  | { kind: 'altar'; altarId: string; trophy: BossKind; boon: BoonKind }
  /** The altar took the trophy. Tap to continue. */
  | { kind: 'boon'; boon: BoonKind; runsLeft: number }
  /** The help screen: current gear explained in words. Opened from the HUD. */
  | { kind: 'help' }
  /**
   * The hero is walking out of the shop with a lens still in their pocket.
   * Everything stops while it shatters; dismissing it drops the lens and lets
   * the stairs finish. Closed by the animation itself, not by a button.
   */
  | { kind: 'lensShatter' }
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
   * sentence ("The Minotaur caught you."). `retryCost` (gold, fixed at the
   * moment of death) buys back into the same boss fight via
   * `Game.retryBoss()`; dismissing the modal instead starts a new run.
   */
  | { kind: 'gameOver'; cause: string; boss: BossKind; stats: RunStats; retryCost: number };

/** Everything the game-over screen shows about the run that just ended. */
export interface RunStats {
  deepest: number;
  heroLevel: number;
  kills: number;
  bosses: number;
  gold: number;
  playMs: number;
  /** Boss retries paid so far this run. */
  retries: number;
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
    /** Times the hero has paid to retry a lost boss fight this run. */
    bossRetries: number;
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
  /**
   * The boons this run started under (or picked up at an altar), with how many
   * runs each has left after this one. Read by the help screen; the effects
   * themselves were applied to the hero when the run began.
   */
  boons: Boon[];
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

export const SAVE_VERSION = 9;

/** Health is measured in quarter-hearts. One heart = 4 hp. */
export const HEART = 4;
