/**
 * Tuning numbers: level size, hero progression, monster stats, loot, damage.
 * Nothing here touches the DOM and all randomness comes from an `Rng`.
 */
import type { Hero, Loot, LootItem, Monster, MonsterKind, Rng, Vec } from './types';
import { HEART } from './types';
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
// Hero
// ---------------------------------------------------------------------------

/** XP needed to go from `level` to `level + 1`. */
export function xpForLevel(level: number): number {
  const l = Math.max(1, Math.floor(level));
  return Math.round(10 * Math.pow(l, 1.5));
}

export function newHero(): Hero {
  return {
    pos: { x: 1, y: 1 },
    rpos: { x: 1, y: 1 },
    facing: 'S',
    hp: 3 * HEART,
    maxHp: 3 * HEART,
    atk: 2,
    def: 0,
    level: 1,
    xp: 0,
    xpToNext: xpForLevel(1),
    gold: 0,
    keys: { door: 0, chest: 0 },
    items: [],
    hitFlash: 0,
    stun: 0,
    sleeping: false,
    gear: { offense: null, defense: null, spirit: null },
    shieldReady: false,
    timers: { shield: 0, fire: 0, life: 0, phoenix: 0, bane: 0 },
    lungeT: 0,
    sinceCombat: 99999,
  };
}

/** Spend banked xp on as many level-ups as it covers. */
export function applyLevelUp(hero: Hero): void {
  let guard = 0;
  while (hero.xp >= hero.xpToNext && guard++ < 200) {
    hero.xp -= hero.xpToNext;
    hero.level += 1;
    hero.maxHp += HEART; // one more heart
    hero.atk += 1;
    if (hero.level % 2 === 0) hero.def += 1;
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

/** Fully-formed monster of `kind` sitting on `pos`, scaled to `depth`. */
export function makeMonster(
  kind: MonsterKind,
  depth: number,
  rng: Rng,
  pos: Vec,
  id: string,
): Monster {
  const depthN = Math.max(1, Math.floor(depth));
  const look = rng.pick(themeForDepth(depthN).roster[kind]);
  // Patrols match the dungeon depth, guards sit a level above it, lurkers
  // two above. Every level, a few monsters roll one level higher to stand out.
  const lift = kind === 'patrol' ? 0 : kind === 'guard' ? 1 : 2;
  const level = depthN + lift + (rng.chance(0.2) ? 1 : 0);
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

  // The three roles are tuned against a hero whose level matches the depth
  // (see the head-on fight simulation in the PR that set these numbers):
  //  - patrol: a speed bump. Three swings to kill, a quarter heart or so lost.
  //  - guard:  a real fight. Won at parity, but for roughly half the hearts;
  //            a hero a couple of levels under gets knocked down.
  //  - lurker: not a fight to pick. At parity it knocks the hero down before
  //            it dies; two or three levels over it is winnable and costly.
  //            The intended answer is to bait it away and loop around.
  switch (kind) {
    case 'guard':
      // Rooted, tanky, hits hard but slowly.
      hp = 10 + 5 * d;
      atk = d;
      def = Math.floor((d - 1) / 2);
      moveInterval = 100000; // never moves
      attackInterval = 900;
      sightRange = 2;
      leash = 0;
      xp = 8 + 4 * d;
      gold = rng.int(2, 5 + d);
      break;
    case 'patrol':
      // Walks its beat; squishy trash.
      hp = 4 + 2 * d;
      atk = Math.max(1, Math.floor(d / 3));
      def = Math.floor((d - 1) / 4);
      moveInterval = 450;
      attackInterval = 800;
      sightRange = 3;
      leash = 0;
      xp = 3 + 2 * d;
      gold = rng.int(0, 2 + d);
      break;
    default:
      // Lurker: fast enough to punish a careless hero, slower than a running
      // one, and far too strong to trade blows with at level.
      hp = 8 + 7 * d;
      atk = 1 + Math.floor(1.2 * d);
      def = Math.floor(d / 2);
      moveInterval = 260;
      attackInterval = 700;
      sightRange = 4;
      leash = 7;
      xp = 12 + 6 * d;
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
    hitFlash: 0,
    lungeT: 0,
  };
}

// ---------------------------------------------------------------------------
// Loot
// ---------------------------------------------------------------------------

const SWORDS = ['Rusty Sword', 'Iron Sword', 'Steel Sword', 'Silver Sword', 'Dragonfang Sword'];
const SHIELDS = ['Cracked Shield', 'Wooden Shield', 'Iron Shield', 'Tower Shield', 'Aegis Shield'];
const AMULETS = ['Copper Amulet', 'Jade Amulet', 'Ruby Amulet', 'Star Amulet', 'Heartstone Amulet'];
const RINGS = ['Tin Ring', 'Bone Ring', 'Gold Ring', 'Opal Ring', 'Ring of Ages'];

export function rollChestLoot(depth: number, rng: Rng): Loot {
  const d = Math.max(1, Math.floor(depth));
  const tier = tierOf(d);
  const loot: Loot = {
    gold: rng.int(5, 15) * d,
    xp: 3 * d,
  };
  if (rng.chance(0.45)) {
    const roll = rng.int(0, 3);
    let item: LootItem;
    if (roll === 0) item = { name: SWORDS[tier], atk: 1 + Math.floor(d / 5) };
    else if (roll === 1) item = { name: SHIELDS[tier], def: 1 + Math.floor(d / 7) };
    else if (roll === 2) item = { name: AMULETS[tier], maxHp: HEART * (1 + Math.floor(d / 4)) }; // whole hearts
    else item = { name: RINGS[tier], maxHp: HEART * (1 + Math.floor(d / 6)) };
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
