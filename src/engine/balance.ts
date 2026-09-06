/**
 * Tuning numbers: level size, hero progression, monster stats, loot, damage.
 * Nothing here touches the DOM and all randomness comes from an `Rng`.
 */
import type { Hero, Loot, LootItem, Monster, RosterKind, Rng, Vec } from './types';
import { ANGEL_STEP_MS, HEART } from './types';
import { themeForDepth } from './themes';

// ---------------------------------------------------------------------------
// Level size
// ---------------------------------------------------------------------------

const BASE_W = 21;
const BASE_H = 31;
const MAX_W = 41;
const MAX_H = 61;

/** Odd tile counts, always portrait. Grows two tiles every other depth. */
export function levelDims(depth: number): { width: number; height: number } {
  const d = Math.max(1, Math.floor(depth));
  const grow = Math.floor((d - 1) / 2);
  const width = Math.min(MAX_W, BASE_W + 2 * grow);
  const height = Math.min(MAX_H, BASE_H + 2 * grow);
  return { width, height };
}

// ---------------------------------------------------------------------------
// The weeping angels' floor
// ---------------------------------------------------------------------------

/** The size and staffing of one angel chamber (see boss.ts, angels.ts). */
export interface AngelPlan {
  cols: number;
  rows: number;
  width: number;
  height: number;
  /** Statues placed, if the layout has room for them. */
  minAngels: number;
  maxAngels: number;
  /** ms between the angels' steps on this floor. */
  stepMs: number;
}

/** Angel grids by depth: rooms across, rooms down, then the next tier. */
const ANGEL_GRIDS: readonly { untilDepth: number; cols: number; rows: number }[] = [
  { untilDepth: 9, cols: 3, rows: 4 },
  { untilDepth: 18, cols: 3, rows: 5 },
  { untilDepth: 27, cols: 4, rows: 5 },
  { untilDepth: Infinity, cols: 4, rows: 6 },
];
/** Tiles a room cell gets, before its walls: enough for a 4x4 to a 7x6 room. */
const ANGEL_CELL_W = 9;
const ANGEL_CELL_H = 10;
/** Statues per room, low and high. A bigger floor is never a barer one. */
const ANGEL_DENSITY = { min: 0.35, max: 0.5 };
/** How much of the base step clock (`ANGEL_STEP_MS`) each grid tier shaves off. */
const ANGEL_STEP_TIER = 30;

/**
 * How hard the weeping angels are on floor `depth`. The fight scales by
 * ground rather than by speed: deeper floors add a row (then a column) of
 * rooms, so the walk to the stairs crosses more of them and more statues are
 * awake by the time it ends. Statues per room stay flat, so the bigger floor
 * never feels emptier, and the step clock tightens only a little per tier —
 * they must stay slow enough to walk away from, or the fight goes back to
 * being a losing race.
 */
export function angelPlan(depth: number): AngelPlan {
  const d = Math.max(1, Math.floor(depth));
  const tier = Math.max(0, ANGEL_GRIDS.findIndex((g) => d <= g.untilDepth));
  const { cols, rows } = ANGEL_GRIDS[tier];
  const rooms = cols * rows;
  // Both odd: the boss validator (and the renderer's centring) want it so.
  const width = odd(cols * ANGEL_CELL_W + 2);
  const height = odd(rows * ANGEL_CELL_H + 1);
  return {
    cols,
    rows,
    width,
    height,
    minAngels: Math.floor(rooms * ANGEL_DENSITY.min),
    maxAngels: Math.floor(rooms * ANGEL_DENSITY.max),
    stepMs: ANGEL_STEP_MS - ANGEL_STEP_TIER * tier,
  };
}

const odd = (n: number): number => (n % 2 === 0 ? n + 1 : n);

// ---------------------------------------------------------------------------
// Hero
// ---------------------------------------------------------------------------

/**
 * XP needed to go from `level` to `level + 1`.
 *
 * Tuned against what one floor actually holds, warrens included (see the pacing
 * test in test/maze.test.ts): clearing the patrols, guards and chests of floor
 * `d` is worth about one level, so the hero tracks the depth instead of racing
 * ahead of it. Lurkers are the surplus — the monster you kill when you want a
 * cushion, not the one you have to kill. `xpShare` does the rest of the work:
 * it is what stops a floor's extra monsters turning into extra levels.
 */
export function xpForLevel(level: number): number {
  const l = Math.max(1, Math.floor(level));
  return Math.round(65 * Math.pow(l, 1.1));
}

/** Share of a monster's xp gained or lost per level between it and the hero. */
const XP_PER_LEVEL_GAP = 0.5;
/** However far ahead the hero gets, a kill is still worth this much of it. */
const MIN_XP_SHARE = 0.05;
/** However far behind, a kill is never worth more than this much of it. */
const MAX_XP_SHARE = 3;

/**
 * How much of a monster's xp the hero actually banks, from the difference in
 * their levels. The red and green tags on the sprites are the player's read on
 * it: a red monster is above you and pays over the odds, a green one is below
 * you and pays a fraction. The rate is the same in both directions; the clamps
 * are not, and that is the whole shape of it — falling behind can treble a
 * kill, running ahead only ever cuts it to a twentieth.
 *
 * This is what makes the warrens worth walking into. A hero who has fallen
 * behind the depth can go and clear one to catch up and force a guarded
 * corridor, and the further behind they are the faster it works. A hero
 * already running ahead of the depth gets almost nothing for the same work, so
 * grinding levels out rather than running away with the run. Gold is not
 * scaled: an over-levelled hero who clears a warren anyway still gets paid,
 * just not in levels.
 */
export function xpShare(heroLevel: number, monsterLevel: number): number {
  const gap = Math.floor(monsterLevel) - Math.floor(heroLevel);
  return Math.min(MAX_XP_SHARE, Math.max(MIN_XP_SHARE, 1 + XP_PER_LEVEL_GAP * gap));
}

/**
 * Level is its own axis of power, separate from the atk/def stats gear and
 * chests hand out. Both a hero's and a monster's base attack and max HP ride
 * this curve; a single point of atk or def from a trinket is deliberately
 * worth a fraction of what one level is worth, so gear tunes a fight instead
 * of deciding it. `LEVEL_GROWTH` is picked, and checked against a "guard" (see
 * the role tables below and the balance tests in `test/maze.test.ts`), so the
 * shape of a fight tracks the level gap and nothing else: something your own
 * level is a real fight you comfortably win, one level down is safer still,
 * one level up you can lose, and two levels up you lose outright — the same
 * shape whether that gap opens up at level 2 or level 20.
 */
const LEVEL_GROWTH = 1.2;
export const HERO_ATK_BASE = 2;
export const HERO_HP_BASE = 16; // quarter hearts: four hearts at level one

/**
 * The hero's own spirit at `level`, before any spirit-slot item adds to it.
 *
 * Flat and slow on purpose. Spirit is not a third combat stat racing atk and
 * hp up the `levelCurve`; it is a dial on how much a shrine gives, and the
 * point of a shrine is that it runs out. One point to start with and one more
 * every third level keeps a deep hero's alcoves better than a shallow hero's
 * without ever making them the plan.
 */
export function spiritForLevel(level: number): number {
  return 1 + Math.floor(Math.max(1, Math.floor(level)) / 3);
}

/** Base attack or HP a combatant of `level` carries before role and gear. */
export function levelCurve(base: number, level: number): number {
  const l = Math.max(1, Math.floor(level));
  return Math.max(1, Math.round(base * Math.pow(LEVEL_GROWTH, l - 1)));
}

export function newHero(): Hero {
  return {
    pos: { x: 1, y: 1 },
    rpos: { x: 1, y: 1 },
    facing: 'S',
    hp: levelCurve(HERO_HP_BASE, 1),
    maxHp: levelCurve(HERO_HP_BASE, 1),
    atk: levelCurve(HERO_ATK_BASE, 1),
    def: 0,
    spirit: spiritForLevel(1),
    level: 1,
    xp: 0,
    xpToNext: xpForLevel(1),
    gold: 0,
    keys: { door: 0, chest: 0 },
    items: [],
    potions: 0,
    potionCapacity: 0,
    hitFlash: 0,
    stun: 0,
    sleeping: false,
    gear: { offense: null, defense: null, spirit: null },
    shieldReady: false,
    timers: { shield: 0, fire: 0, life: 0, phoenix: 0, bane: 0 },
    tempHp: 0,
    tempHpMax: 0,
    buffs: [],
    lens: null,
    lungeT: 0,
    sinceCombat: 99999,
  };
}

/**
 * Spend banked xp on as many level-ups as it covers. Atk and max HP move by
 * the curve's delta for the new level, so gear bonuses already folded into
 * those fields (see `equip` in items.ts) are carried forward rather than
 * overwritten. Defense is never granted by a level: it is a gear-only stat,
 * kept deliberately small next to what a level of atk/HP is worth.
 */
export function applyLevelUp(hero: Hero): void {
  let guard = 0;
  while (hero.xp >= hero.xpToNext && guard++ < 200) {
    hero.xp -= hero.xpToNext;
    const from = hero.level;
    hero.level += 1;
    hero.atk += levelCurve(HERO_ATK_BASE, hero.level) - levelCurve(HERO_ATK_BASE, from);
    hero.maxHp += levelCurve(HERO_HP_BASE, hero.level) - levelCurve(HERO_HP_BASE, from);
    // Added as a delta, not assigned: whatever a spirit item contributed to
    // the stat has to survive the level up.
    hero.spirit += spiritForLevel(hero.level) - spiritForLevel(from);
    hero.hp = hero.maxHp;
    hero.xpToNext = xpForLevel(hero.level);
  }
}

// ---------------------------------------------------------------------------
// Monsters
// ---------------------------------------------------------------------------

function tierOf(depth: number): number {
  if (depth <= 3) return 0;
  if (depth <= 7) return 1;
  if (depth <= 12) return 2;
  if (depth <= 20) return 3;
  return 4;
}

/** First depth on which a monster may roll a level above its role's. */
const ELITE_FROM_DEPTH = 3;

export interface MonsterOpts {
  /**
   * This monster is the only way past. A gate never takes the role lift or the
   * elite roll: it sits at the floor's own level, so a hero who is keeping up
   * with the depth can always get through. Guards are rooted and heal back to
   * full between attempts, so a gate the hero cannot out-fight is a dead run.
   */
  gate?: boolean;
  /**
   * The hero's level as they step onto the floor. Caps the role lift (see
   * `monsterLevelCap`). Left out, nothing is capped — which is what the
   * generator tests and the balance tables want.
   */
  heroLevel?: number;
}

/**
 * How far above the hero a freshly spawned monster may sit.
 *
 * A level is worth much more at the bottom of the ladder than further up: two
 * levels over a level-one hero is a monster with three times the health and
 * four times the swing, while two over a level-nine hero is a slightly harder
 * fight. So the headroom starts at one level and opens up as the hero climbs,
 * one more level of it every `SPAWN_OVER_PER_LEVELS`, up to the full role lift
 * — past that point the cap never bites and floors generate as they always did.
 *
 * The cap never reaches below the floor's own depth: diving past your level
 * does not make the dungeon shallower, it just stops the floor stacking elites
 * and lurkers on top of a hero who is already behind.
 */
const SPAWN_OVER_BASE = 1;
const SPAWN_OVER_PER_LEVELS = 4;
/** Never more than two levels over: a fight the hero can lose, not one they can't win. */
const SPAWN_OVER_MAX = 2;

/** Highest level a monster may spawn at on `depth` for a hero of `heroLevel`. */
export function monsterLevelCap(depth: number, heroLevel: number | undefined): number {
  if (heroLevel === undefined) return Infinity;
  const h = Math.max(1, Math.floor(heroLevel));
  const over = Math.min(SPAWN_OVER_MAX, SPAWN_OVER_BASE + Math.floor(h / SPAWN_OVER_PER_LEVELS));
  return Math.max(Math.max(1, Math.floor(depth)), h + over);
}

/** Fully-formed monster of `kind` sitting on `pos`, scaled to `depth`. */
export function makeMonster(
  kind: RosterKind,
  depth: number,
  rng: Rng,
  pos: Vec,
  id: string,
  opts: MonsterOpts = {},
): Monster {
  const depthN = Math.max(1, Math.floor(depth));
  const look = rng.pick(themeForDepth(depthN).roster[kind]);
  // Patrols match the dungeon depth, guards sit a level above it, lurkers
  // two above. From the third floor down, a few monsters roll one level higher
  // to stand out; the first two floors are read-the-controls floors and never
  // do. A gate takes neither: see MonsterOpts.gate.
  const lift = kind === 'patrol' ? 0 : kind === 'guard' ? 1 : 2;
  const elite = depthN >= ELITE_FROM_DEPTH && rng.chance(0.2);
  // The lift is what the floor wants; the cap is what the hero can take.
  const cap = monsterLevelCap(depthN, opts.heroLevel);
  const level = opts.gate ? depthN : Math.min(depthN + lift + (elite ? 1 : 0), cap);
  const d = level;

  let hp: number;
  let atk: number;
  let def: number;
  let moveInterval: number;
  let attackInterval: number;
  let sightRange: number;
  let leash: number;
  let xp: number;
  let gold: number;

  // The three roles are tuned against the hero the game actually produces: one
  // who clears each floor's patrols, guards and chests, so runs a level or so
  // over the depth and carries a handful of chest trinkets (see the head-on
  // fight test in test/maze.test.ts, which holds these numbers in place):
  //  - patrol: a speed bump. A few swings to kill, a quarter heart or so lost.
  //  - guard:  a real fight, won but for a third of the hearts or more. A hero
  //            a couple of levels under gets knocked down. The exception is a
  //            gate (see MonsterOpts.gate), which is deliberately softer.
  //  - lurker: not a fight to pick early on — at level it knocks the hero
  //            down before it dies, so the first several floors it is still
  //            "bait it away and loop around". A hero who has kept pace with
  //            the depth (see `playedTo` in the balance test) gets a real,
  //            if costly, shot at one from partway through the run; either
  //            way it spends most of your hearts even when you win.
  switch (kind) {
    case 'guard':
      // Rooted, tanky, hits hard but slowly. A guard is the "fair fight"
      // role: at the hero's own level it rides the same atk/HP curve the
      // hero does. A guard with something to protect swings at the full
      // curve; a gate — the one you have no way around — swings softer, so
      // a hero who is a little behind can still force their way down.
      hp = Math.round(levelCurve(HERO_HP_BASE, d) * 1.35);
      atk = Math.round(levelCurve(HERO_ATK_BASE, d) * (opts.gate ? 0.6 : 1));
      def = 0;
      moveInterval = 100000; // never moves
      attackInterval = 900;
      sightRange = 2;
      leash = 0;
      xp = 8 + 4 * d;
      gold = rng.int(2, 5 + d);
      break;
    case 'patrol':
      // Walks its beat; squishy trash next to the hero's own curve.
      hp = Math.round(levelCurve(HERO_HP_BASE, d) * 0.6);
      atk = Math.max(1, Math.round(levelCurve(HERO_ATK_BASE, d) * 0.55));
      def = 0;
      moveInterval = 450;
      attackInterval = 800;
      sightRange = 3;
      leash = 0;
      xp = 3 + 2 * d;
      gold = rng.int(0, 2 + d);
      break;
    default:
      // Lurker: fast enough to punish a careless hero, slower than a running
      // one, and, early on, far too strong to trade blows with at level. A
      // hero who has kept pace with the depth starts to have a real (if
      // costly) shot at one from partway through the run.
      hp = Math.round(levelCurve(HERO_HP_BASE, d) * 1.4);
      atk = Math.round(levelCurve(HERO_ATK_BASE, d) * 1.85);
      def = Math.round(levelCurve(HERO_ATK_BASE, d) * 0.25);
      moveInterval = 260;
      attackInterval = 700;
      sightRange = 4;
      leash = 12;
      xp = 10 + 4 * d;
      gold = rng.int(3, 6 + 2 * d);
      break;
  }

  return {
    id,
    kind,
    name: look.name,
    glyph: look.glyph,
    pos: { x: pos.x, y: pos.y },
    rpos: { x: pos.x, y: pos.y },
    home: { x: pos.x, y: pos.y },
    hp,
    maxHp: hp,
    atk,
    def,
    level,
    xp,
    gold,
    moveInterval,
    moveCooldown: 0,
    attackInterval,
    attackCooldown: 0,
    state: 'idle',
    sightRange,
    leash,
    alive: true,
    sinceCombat: 99999,
    poisonMs: 0,
    poisonDmg: 0,
    slowMs: 0,
    frozenMs: 0,
    hitFlash: 0,
    lungeT: 0,
  };
}

// ---------------------------------------------------------------------------
// Lurker aggro
// ---------------------------------------------------------------------------

/**
 * A lurker's aggro range is the one thing about it that reads the hero.
 *
 * The fight itself never gets fairer: a lurker is two levels over the floor
 * and stays a monster you bait rather than trade with. What changes is how
 * far it reaches for you. While it stands above the hero — which is every
 * lurker on the easy floors, where the hero is still level one or two — it
 * notices later, so a hero who wanders into its corridor has room to back
 * out. Catch up to its level and it hunts you the full distance again.
 *
 * The drop is capped both ways: at most `LURKER_SIGHT_MAX_DROP` tiles off,
 * never under `LURKER_SIGHT_MIN`, and never over the lurker's own
 * `sightRange` (out-levelling one does not make it blinder or sharper — it
 * just stops holding back).
 */

/** Tiles of sight a lurker gives up per level it stands above the hero. */
const LURKER_SIGHT_PER_LEVEL = 1;
/** However far above the hero it is, it never gives up more than this. */
const LURKER_SIGHT_MAX_DROP = 2;
/** ...and never sees less than this: stand beside one and it still bites. */
const LURKER_SIGHT_MIN = 2;

/** How far a lurker of `monsterLevel` reaches for a hero of `heroLevel`. */
export function lurkerSightRange(base: number, monsterLevel: number, heroLevel: number): number {
  const ahead = Math.max(0, Math.floor(monsterLevel) - Math.floor(heroLevel));
  const drop = Math.min(LURKER_SIGHT_MAX_DROP, ahead * LURKER_SIGHT_PER_LEVEL);
  return Math.max(LURKER_SIGHT_MIN, base - drop);
}

// ---------------------------------------------------------------------------
// Loot
// ---------------------------------------------------------------------------

const SWORDS = ['Rusty Sword', 'Iron Sword', 'Steel Sword', 'Silver Sword', 'Dragonfang Sword'];
const SHIELDS = ['Cracked Shield', 'Wooden Shield', 'Iron Shield', 'Tower Shield', 'Aegis Shield'];
const AMULETS = ['Copper Amulet', 'Jade Amulet', 'Ruby Amulet', 'Star Amulet', 'Heartstone Amulet'];
const RINGS = ['Tin Ring', 'Bone Ring', 'Gold Ring', 'Opal Ring', 'Ring of Ages'];

/**
 * Coins a duplicate trinket is melted down for. The hero carries one of each
 * (see `openChest`), so past the first of a kind a chest pays gold instead —
 * which is the point of gold: it buys the magic items in the shop.
 */
export function trinketGold(depth: number): number {
  return 8 * Math.max(1, Math.floor(depth));
}

/**
 * Gold to buy back into a boss fight the hero just lost, instead of ending
 * the run. Scales with the floor's own depth (a deeper floor's gold economy
 * is already bigger) and climbs further with every retry already bought
 * this run, anywhere, so leaning on it over and over gets expensive fast
 * rather than turning every boss into a coin-operated checkpoint.
 */
export function bossRetryCost(depth: number, retriesSoFar: number): number {
  const d = Math.max(1, Math.floor(depth));
  const n = Math.max(0, Math.floor(retriesSoFar));
  const raw = (20 + 10 * d) * (1 + 0.6 * n);
  return Math.max(10, Math.round(raw / 5) * 5);
}

export function rollChestLoot(depth: number, rng: Rng): Loot {
  const d = Math.max(1, Math.floor(depth));
  const tier = tierOf(d);
  const loot: Loot = {
    gold: rng.int(5, 15) * d,
    xp: 3 * d,
  };
  // Trinket bonuses are deliberately small: the hero only ever carries one of
  // each name (see `openChest`), and even a full set is worth a fraction of
  // what levelling up gives. Chests pay in gold; the shop is where gold turns
  // into power. A health potion is the one trinket kind exempt from the
  // one-per-name rule: every one found is a real gain.
  if (rng.chance(0.45)) {
    const roll = rng.int(0, 4);
    let item: LootItem;
    if (roll === 0) item = { name: SWORDS[tier], atk: 1 + Math.floor(d / 10) };
    else if (roll === 1) item = { name: SHIELDS[tier], def: 1 + Math.floor(d / 14) };
    else if (roll === 2) item = { name: AMULETS[tier], maxHp: HEART * (1 + Math.floor(d / 8)) }; // whole hearts
    else if (roll === 3) item = { name: RINGS[tier], maxHp: HEART * (1 + Math.floor(d / 12)) };
    else item = { name: 'Health Potion', potionCapacity: 1 };
    loot.item = item;
  }
  return loot;
}

// ---------------------------------------------------------------------------
// Combat maths
// ---------------------------------------------------------------------------

/** Damage of one hit; always at least 1 so fights cannot stall. */
/**
 * Damage in quarter-hearts. A plain hit is attack minus defense (at least a
 * quarter heart); one hit in five is a crit for one extra quarter.
 */
export function damage(attackerAtk: number, defenderDef: number, rng: Rng): number {
  const base = Math.max(1, attackerAtk - defenderDef);
  return base + (rng.chance(0.2) ? 1 : 0);
}
